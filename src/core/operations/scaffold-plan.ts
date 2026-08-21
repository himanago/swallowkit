/**
 * Plan Scaffold — scaffold を collect モードで実行し、書き込み予定を差分計画として返す。
 * ディスクへの書き込みは一切行わない。
 */

import * as crypto from "crypto";
import * as path from "path";
import { resolveModelPath, scaffoldCommand } from "../../cli/commands/scaffold";
import { getSwallowKitVersion } from "../../version";
import { findArtifactRecord, loadArtifactLedger } from "../project/artifacts";
import { savePlanState } from "../project/state";
import {
  ArtifactOwnership,
  FileOperationSession,
  hashFileIfExists,
  runWithFileSession,
  toProjectRelativePath,
} from "./file-session";
import {
  captureConsoleMessagesWithError,
  deriveCapturedErrorMessage,
  interceptProcessExit,
  ProcessExitInterceptError,
} from "./runtime";

export interface PlanScaffoldOptions {
  model: string;
  functionsDir?: string;
  apiDir?: string;
  apiOnly?: boolean;
}

export type ScaffoldPlanAction = "create" | "update" | "overwrite" | "append" | "delete" | "skip";

export interface ScaffoldPlanOperation {
  path: string;
  action: ScaffoldPlanAction;
  ownership: ArtifactOwnership;
  conflict: boolean;
  conflictReason?: string;
}

export interface ScaffoldPlanData {
  planId: string;
  planType: "scaffold";
  model: string;
  options: {
    functionsDir?: string;
    apiDir?: string;
    apiOnly?: boolean;
  };
  createdAt: string;
  swallowkitVersion: string;
  operations: ScaffoldPlanOperation[];
  warnings: string[];
  conflicts: ScaffoldPlanOperation[];
  requiresApproval: boolean;
  /** project-relative path -> pre-plan content hash (null = did not exist). Used for stale-plan detection. */
  fingerprints: Record<string, string | null>;
}

function deriveScaffoldErrorMessage(messages: { errors: string[]; warnings: string[]; logs: string[] }): string {
  return deriveCapturedErrorMessage(messages, "Scaffold plan failed.");
}

/**
 * scaffold を collect セッションで実行し、記録された操作を返す。
 */
async function collectScaffoldOperations(options: PlanScaffoldOptions): Promise<FileOperationSession> {
  const session = new FileOperationSession("collect");
  const originalMachineOutput = process.env.SWALLOWKIT_MACHINE_OUTPUT;
  process.env.SWALLOWKIT_MACHINE_OUTPUT = "1";

  try {
    const captured = await captureConsoleMessagesWithError(async () => {
      await interceptProcessExit(async () => {
        await runWithFileSession(session, async () => {
          await scaffoldCommand({
            model: options.model,
            functionsDir: options.functionsDir,
            apiDir: options.apiDir,
            apiOnly: options.apiOnly,
          });
        });
      });
    });

    if (captured.error) {
      if (captured.error instanceof ProcessExitInterceptError) {
        throw new Error(deriveScaffoldErrorMessage(captured.messages));
      }
      if (captured.error instanceof Error) {
        throw captured.error;
      }
      throw new Error(deriveScaffoldErrorMessage(captured.messages));
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

export async function planScaffoldOperation(options: PlanScaffoldOptions): Promise<ScaffoldPlanData> {
  const projectRoot = process.cwd();
  const session = await collectScaffoldOperations(options);
  const ledger = loadArtifactLedger(projectRoot);

  const operations: ScaffoldPlanOperation[] = [];
  const fingerprints: Record<string, string | null> = {};
  const warnings = [...session.warnings];

  for (const op of session.operations) {
    fingerprints[op.path] = op.previousHash;

    let action: ScaffoldPlanAction;
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
        const record = ledger ? findArtifactRecord(ledger, op.path) : undefined;
        if (record && record.contentHash === op.previousHash) {
          // 生成後に変更されていない managed ファイルの再生成 — 安全
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

  // モデルファイル自体も fingerprint に含め、Plan 後のスキーマ変更を stale として検出する
  try {
    const modelPath = resolveModelPath(options.model);
    fingerprints[toProjectRelativePath(projectRoot, modelPath)] = hashFileIfExists(modelPath);
  } catch {
    // resolveModelPath が失敗する場合は collectScaffoldOperations 側で既に失敗している
  }

  const conflicts = operations.filter((op) => op.conflict);

  const planId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        model: options.model,
        options: { functionsDir: options.functionsDir, apiDir: options.apiDir, apiOnly: options.apiOnly },
        operations: operations.map((op) => ({ path: op.path, action: op.action })),
        fingerprints,
      })
    )
    .digest("hex")
    .slice(0, 12);

  const plan: ScaffoldPlanData = {
    planId,
    planType: "scaffold",
    model: options.model,
    options: {
      ...(options.functionsDir ? { functionsDir: options.functionsDir } : {}),
      ...(options.apiDir ? { apiDir: options.apiDir } : {}),
      ...(options.apiOnly !== undefined ? { apiOnly: options.apiOnly } : {}),
    },
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

export function verifyPlanFingerprints(
  plan: ScaffoldPlanData,
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
