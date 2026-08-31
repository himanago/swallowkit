/**
 * Plan / Apply Auth — add-auth を collect モードで実行して差分計画を作成し、
 * 承認・鮮度チェックを経て実際に適用する。
 */

import * as crypto from "crypto";
import * as path from "path";
import { addAuthCommand } from "../../cli/commands/add-auth";
import { MachineCommandError } from "../../machine/errors";
import { getSwallowKitVersion } from "../../version";
import { findArtifactRecord, loadArtifactLedger } from "../project/artifacts";
import { deletePlanState, loadPlanState, savePlanState } from "../project/state";
import {
  ArtifactOwnership,
  FileOperationSession,
  hashFileIfExists,
  runWithFileSession,
} from "./file-session";
import {
  captureConsoleMessagesWithError,
  deriveCapturedErrorMessage,
  interceptProcessExit,
  ProcessExitInterceptError,
  trackFileMutations,
} from "./runtime";

export interface PlanAuthOptions {
  provider: string;
  scheme?: string;
  /** SWA の許可 identity provider。未指定時は add-auth 側の既定 (['aad'])。 */
  allowedProviders?: string[];
}

export type AuthPlanAction = "create" | "update" | "overwrite" | "append" | "delete" | "skip";

export interface AuthPlanOperation {
  path: string;
  action: AuthPlanAction;
  ownership: ArtifactOwnership;
  conflict: boolean;
  conflictReason?: string;
}

export interface AuthPlanData {
  planId: string;
  planType: "auth";
  provider: string;
  scheme?: string;
  allowedProviders?: string[];
  createdAt: string;
  swallowkitVersion: string;
  operations: AuthPlanOperation[];
  warnings: string[];
  conflicts: AuthPlanOperation[];
  requiresApproval: boolean;
  /** project-relative path -> pre-plan content hash (null = did not exist). Used for stale-plan detection. */
  fingerprints: Record<string, string | null>;
}

function deriveAuthErrorMessage(messages: { errors: string[]; warnings: string[]; logs: string[] }): string {
  return deriveCapturedErrorMessage(messages, "Auth operation failed.");
}

/**
 * add-auth を collect セッションで実行し、記録された操作を返す。ディスクには書き込まない。
 */
async function collectAuthOperations(options: PlanAuthOptions): Promise<FileOperationSession> {
  const session = new FileOperationSession("collect");
  const originalMachineOutput = process.env.SWALLOWKIT_MACHINE_OUTPUT;
  process.env.SWALLOWKIT_MACHINE_OUTPUT = "1";

  try {
    const captured = await captureConsoleMessagesWithError(async () => {
      await interceptProcessExit(async () => {
        await runWithFileSession(session, async () => {
          await addAuthCommand({ provider: options.provider, scheme: options.scheme, allowedProviders: options.allowedProviders });
        });
      });
    });

    if (captured.error) {
      if (captured.error instanceof ProcessExitInterceptError) {
        throw new Error(deriveAuthErrorMessage(captured.messages));
      }
      if (captured.error instanceof Error) {
        throw captured.error;
      }
      throw new Error(deriveAuthErrorMessage(captured.messages));
    }

    return session;
  } finally {
    if (originalMachineOutput === undefined) {
      delete process.env.SWALLOWKIT_MACHINE_OUTPUT;
    } else {
      process.env.SWALLOWKIT_MACHINE_OUTPUT = originalMachineOutput;
    }
  }
}

export async function planAuthOperation(options: PlanAuthOptions): Promise<AuthPlanData> {
  const projectRoot = process.cwd();
  const session = await collectAuthOperations(options);
  const ledger = loadArtifactLedger(projectRoot);

  const operations: AuthPlanOperation[] = [];
  const fingerprints: Record<string, string | null> = {};
  const warnings = [...session.warnings];

  for (const op of session.operations) {
    fingerprints[op.path] = op.previousHash;

    let action: AuthPlanAction;
    let conflict = false;
    let conflictReason: string | undefined;

    switch (op.action) {
      case "create":
        action = "create";
        break;
      case "skip":
        action = "skip";
        break;
      case "append":
        action = "append";
        break;
      case "delete":
        action = "delete";
        break;
      case "modify": {
        if (op.ownership === "extension-point") {
          // 設定ファイル・登録ポイントへの追記型変更は想定内の更新として扱う
          action = "update";
          break;
        }
        const record = ledger ? findArtifactRecord(ledger, op.path) : undefined;
        if (record && record.contentHash === op.previousHash) {
          action = "update";
        } else if (record) {
          action = "overwrite";
          conflict = true;
          conflictReason = "modified-after-generation";
        } else {
          action = "overwrite";
          conflict = true;
          conflictReason = "unknown-provenance";
          warnings.push(
            `unknown-provenance: ${op.path} exists but is not tracked in .swallowkit/artifacts.json; regenerating will overwrite it.`
          );
        }
        break;
      }
    }

    operations.push({
      path: op.path,
      action,
      ownership: op.ownership,
      conflict,
      ...(conflictReason ? { conflictReason } : {}),
    });
  }

  const conflicts = operations.filter((op) => op.conflict);

  const planId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        provider: options.provider,
        scheme: options.scheme,
        allowedProviders: options.allowedProviders,
        operations: operations.map((op) => ({ path: op.path, action: op.action })),
        fingerprints,
      })
    )
    .digest("hex")
    .slice(0, 12);

  const plan: AuthPlanData = {
    planId,
    planType: "auth",
    provider: options.provider,
    ...(options.scheme ? { scheme: options.scheme } : {}),
    ...(options.allowedProviders && options.allowedProviders.length > 0 ? { allowedProviders: options.allowedProviders } : {}),
    createdAt: new Date().toISOString(),
    swallowkitVersion: getSwallowKitVersion(),
    operations,
    warnings,
    conflicts,
    requiresApproval: conflicts.length > 0,
    fingerprints,
  };

  savePlanState(plan, projectRoot);
  return plan;
}

export function verifyAuthPlanFingerprints(
  plan: AuthPlanData,
  projectRoot: string = process.cwd()
): { fresh: boolean; changedFiles: string[] } {
  const changedFiles: string[] = [];
  for (const [relativePath, expectedHash] of Object.entries(plan.fingerprints)) {
    const currentHash = hashFileIfExists(path.join(projectRoot, relativePath));
    if (currentHash !== expectedHash) {
      changedFiles.push(relativePath);
    }
  }
  return { fresh: changedFiles.length === 0, changedFiles };
}

export interface ApplyAuthOptions {
  provider?: string;
  scheme?: string;
  allowedProviders?: string[];
  planId?: string;
  approve?: boolean;
}

export interface ApplyAuthResult {
  provider: string;
  scheme?: string;
  planId: string;
  createdFiles: string[];
  updatedFiles: string[];
  appendedFiles: string[];
  deletedFiles: string[];
  createdDirectories: string[];
  diagnostics: string[];
  approvedConflicts: AuthPlanOperation[];
  warnings: string[];
}

async function runCommitAuthOperation(options: PlanAuthOptions): Promise<{
  createdFiles: string[];
  updatedFiles: string[];
  appendedFiles: string[];
  deletedFiles: string[];
  createdDirectories: string[];
  diagnostics: string[];
}> {
  const originalMachineOutput = process.env.SWALLOWKIT_MACHINE_OUTPUT;
  process.env.SWALLOWKIT_MACHINE_OUTPUT = "1";

  try {
    const tracked = await trackFileMutations(async () => {
      const captured = await captureConsoleMessagesWithError(async () => {
        await interceptProcessExit(async () => {
          await addAuthCommand({ provider: options.provider, scheme: options.scheme, allowedProviders: options.allowedProviders });
        });
      });

      if (captured.error) {
        if (captured.error instanceof ProcessExitInterceptError) {
          throw new Error(deriveAuthErrorMessage(captured.messages));
        }
        if (captured.error instanceof Error) {
          throw captured.error;
        }
        throw new Error(deriveAuthErrorMessage(captured.messages));
      }

      return captured.messages;
    });

    return {
      createdFiles: tracked.mutations.createdFiles,
      updatedFiles: tracked.mutations.updatedFiles,
      appendedFiles: tracked.mutations.appendedFiles,
      deletedFiles: tracked.mutations.deletedFiles,
      createdDirectories: tracked.mutations.createdDirectories,
      diagnostics: [
        ...tracked.result.warnings.map((warning) => `warning:${warning}`),
        ...tracked.result.errors.map((error) => `error:${error}`),
      ],
    };
  } finally {
    if (originalMachineOutput === undefined) {
      delete process.env.SWALLOWKIT_MACHINE_OUTPUT;
    } else {
      process.env.SWALLOWKIT_MACHINE_OUTPUT = originalMachineOutput;
    }
  }
}

export async function applyAuthOperation(options: ApplyAuthOptions): Promise<ApplyAuthResult> {
  const projectRoot = process.cwd();

  let basePlan: AuthPlanData | null = null;

  if (options.planId) {
    basePlan = loadPlanState<AuthPlanData>(options.planId, projectRoot);
    if (!basePlan) {
      throw new MachineCommandError(
        "plan-not-found",
        `Plan "${options.planId}" was not found. Run "plan auth" to create a new plan.`,
        { planId: options.planId },
        "blocked"
      );
    }

    const freshness = verifyAuthPlanFingerprints(basePlan, projectRoot);
    if (!freshness.fresh) {
      throw new MachineCommandError(
        "stale-plan",
        `Plan "${options.planId}" is stale: ${freshness.changedFiles.length} file(s) changed after the plan was created. Re-run "plan auth".`,
        { planId: options.planId, changedFiles: freshness.changedFiles },
        "blocked"
      );
    }
  }

  const provider = options.provider ?? basePlan?.provider;
  if (!provider) {
    throw new MachineCommandError(
      "invalid-arguments",
      "Either --provider or --plan <planId> must be provided.",
      undefined,
      "failed"
    );
  }

  const effectiveOptions: PlanAuthOptions = {
    provider,
    scheme: options.scheme ?? basePlan?.scheme,
    allowedProviders: options.allowedProviders ?? basePlan?.allowedProviders,
  };

  // 常に最新状態で collect し、競合を再確認する
  const currentPlan = await planAuthOperation(effectiveOptions);

  if (currentPlan.requiresApproval && !options.approve) {
    throw new MachineCommandError(
      "approval-required",
      `${currentPlan.conflicts.length} file(s) were modified after generation and would be overwritten. Review the conflicts and re-run with --approve to proceed.`,
      {
        planId: currentPlan.planId,
        conflicts: currentPlan.conflicts,
      },
      "requires-human"
    );
  }

  const result = await runCommitAuthOperation(effectiveOptions);

  deletePlanState(currentPlan.planId, projectRoot);
  if (options.planId && options.planId !== currentPlan.planId) {
    deletePlanState(options.planId, projectRoot);
  }

  return {
    ...result,
    provider,
    ...(effectiveOptions.scheme ? { scheme: effectiveOptions.scheme } : {}),
    planId: currentPlan.planId,
    approvedConflicts: options.approve ? currentPlan.conflicts : [],
    warnings: currentPlan.warnings,
  };
}
