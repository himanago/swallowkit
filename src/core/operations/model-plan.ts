import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getSwallowKitVersion } from "../../version";
import { MachineCommandError } from "../../machine/errors";
import { createModelOperation, CreateModelOperationOptions } from "./create-model";
import { FileOperationSession, runWithFileSession, hashContent, hashFileIfExists } from "./file-session";
import { deletePlanState, loadPlanState, savePlanState } from "../project/state";
import { addModelContainerMigration } from "./model-migration";

export type ModelPlanAction = "create" | "update" | "overwrite" | "append" | "delete" | "skip";
export type ModelPlanType = "model" | "model-infrastructure";

export interface ModelPlanOperation {
  path: string;
  action: ModelPlanAction;
  ownership: string;
  contentFingerprint: string;
  conflict: boolean;
  conflictReason?: string;
}

export interface ModelPlanData {
  planId: string;
  planType: ModelPlanType;
  names: string[];
  options: Pick<CreateModelOperationOptions, "modelsDir" | "connector" | "overwriteMode">;
  modelInfrastructure?: {
    model: string;
    refreshPending?: boolean;
    resourceGroup?: string;
    subscription?: string;
  };
  createdAt: string;
  swallowkitVersion: string;
  operations: ModelPlanOperation[];
  conflicts: ModelPlanOperation[];
  requiresApproval: boolean;
  fingerprints: Record<string, string | null>;
}

function operationAction(action: FileOperationSession["operations"][number]["action"]): ModelPlanAction {
  switch (action) {
    case "modify": return "update";
    case "skip": return "skip";
    case "delete": return "delete";
    case "append": return "append";
    case "create": return "create";
  }
}

function modelDirectoryFingerprint(projectRoot: string, modelsDir: string): string {
  const absoluteDirectory = path.isAbsolute(modelsDir) ? modelsDir : path.join(projectRoot, modelsDir);
  const names = fs.existsSync(absoluteDirectory)
    ? fs.readdirSync(absoluteDirectory).filter((file) => file.endsWith(".ts")).sort()
    : [];
  return hashContent(JSON.stringify(names));
}

function stableContentFingerprint(_relativePath: string, content: string): string {
  return hashContent(content);
}

async function collectModelOperations(
  options: CreateModelOperationOptions,
  generatedAt?: string
): Promise<FileOperationSession> {
  const projectRoot = process.cwd();
  const session = new FileOperationSession("collect", projectRoot, generatedAt);
  for (const configFile of ["swallowkit.config.js", "swallowkit.config.json", ".swallowkitrc.json"]) {
    session.registerInput(path.join(projectRoot, configFile));
  }
  await runWithFileSession(session, async () => {
    await createModelOperation(options);
  });
  return session;
}

function buildModelPlan(
  options: CreateModelOperationOptions,
  session: FileOperationSession,
  planId = crypto.randomUUID(),
  modelInfrastructure?: ModelPlanData["modelInfrastructure"]
): ModelPlanData {
  const fingerprints: Record<string, string | null> = { ...session.inputFingerprints };
  const modelsDir = options.modelsDir ?? "shared/models";
  const directoryPath = path.isAbsolute(modelsDir)
    ? path.relative(process.cwd(), modelsDir).replace(/\\/g, "/")
    : modelsDir.replace(/\\/g, "/");
  fingerprints[`directory-list:${directoryPath}`] = modelDirectoryFingerprint(process.cwd(), modelsDir);
  const operations = session.operations.map((operation) => {
    fingerprints[operation.path] = operation.previousHash;
    const action = operationAction(operation.action);
    const conflict = action === "update" && operation.ownership === "user-owned";
    const contentFingerprint = stableContentFingerprint(
      operation.path,
      session.readFile(operation.absolutePath)
    );
    return {
      path: operation.path,
      action: conflict ? "overwrite" : action,
      ownership: operation.ownership,
      contentFingerprint,
      conflict,
      ...(conflict ? { conflictReason: "existing user-owned model file would be overwritten" } : {}),
    };
  });
  const conflicts = operations.filter((operation) => operation.conflict);
  return {
    planId,
    planType: modelInfrastructure ? "model-infrastructure" : "model",
    names: [...options.names],
    options: {
      modelsDir: options.modelsDir,
      connector: options.connector,
      overwriteMode: options.overwriteMode ?? "never",
    },
    ...(modelInfrastructure ? { modelInfrastructure } : {}),
    createdAt: session.generatedAt,
    swallowkitVersion: getSwallowKitVersion(),
    operations,
    conflicts,
    requiresApproval: conflicts.length > 0,
    fingerprints,
  };
}

async function collectModelInfrastructureOperations(
  model: string,
  options: NonNullable<ModelPlanData["modelInfrastructure"]>,
  generatedAt?: string
): Promise<{ session: FileOperationSession; modelInfrastructure: NonNullable<ModelPlanData["modelInfrastructure"]> }> {
  const projectRoot = process.cwd();
  const session = new FileOperationSession("collect", projectRoot, generatedAt);
  for (const configFile of ["swallowkit.config.js", "swallowkit.config.json", ".swallowkitrc.json"]) {
    session.registerInput(path.join(projectRoot, configFile));
  }
  const result = await runWithFileSession(session, async () => {
    return addModelContainerMigration(model, {
      ...options,
      dryRun: true,
      projectRoot,
    });
  });
  return {
    session,
    modelInfrastructure: {
      ...options,
      ...(result.resolvedSubscription ? { subscription: result.resolvedSubscription } : {}),
    },
  };
}

export async function planModelOperation(
  options: CreateModelOperationOptions,
  persist = true,
  generatedAt?: string
): Promise<ModelPlanData> {
  const projectRoot = process.cwd();
  const session = await collectModelOperations(options, generatedAt);
  const plan = buildModelPlan(options, session);
  if (persist) savePlanState(plan, projectRoot);
  return plan;
}

export async function planModelInfrastructureOperation(
  model: string,
  options: Omit<NonNullable<ModelPlanData["modelInfrastructure"]>, "model"> = {},
  persist = true,
  generatedAt?: string
): Promise<ModelPlanData> {
  const projectRoot = process.cwd();
  const collected = await collectModelInfrastructureOperations(model, { model, ...options }, generatedAt);
  const plan = buildModelPlan({
    names: [model],
    modelsDir: "shared/models",
    overwriteMode: "never",
  }, collected.session, crypto.randomUUID(), collected.modelInfrastructure);
  if (persist) savePlanState(plan, projectRoot);
  return plan;
}

function verifyFingerprints(plan: ModelPlanData, projectRoot: string): string[] {
  return Object.entries(plan.fingerprints).flatMap(([relativePath, expectedHash]) => {
    const actualHash = relativePath.startsWith("directory-list:")
      ? modelDirectoryFingerprint(projectRoot, relativePath.slice("directory-list:".length))
      : hashFileIfExists(path.join(projectRoot, relativePath));
    return actualHash === expectedHash ? [] : [relativePath];
  });
}

export interface ApplyModelOptions {
  planId: string;
  approve?: boolean;
}

export async function applyModelOperation(options: ApplyModelOptions): Promise<{
  planId: string;
  planType: ModelPlanType;
  result: Awaited<ReturnType<typeof createModelOperation>> | Awaited<ReturnType<typeof addModelContainerMigration>>;
  approvedConflicts: ModelPlanOperation[];
}> {
  const projectRoot = process.cwd();
  const basePlan = loadPlanState<ModelPlanData>(options.planId, projectRoot);
  const infrastructureRequest = basePlan?.planType === "model-infrastructure"
    ? basePlan.modelInfrastructure
    : undefined;
  if (!basePlan || (basePlan.planType !== "model" && basePlan.planType !== "model-infrastructure")) {
    throw new MachineCommandError(
      "plan-not-found",
      `Model plan "${options.planId}" was not found. Run "machine plan model" to create a new plan.`,
      { planId: options.planId },
      "blocked"
    );
  }
  if (!basePlan.createdAt || (basePlan.planType === "model-infrastructure" && !infrastructureRequest)) {
    throw new MachineCommandError(
      "incompatible-plan",
      "This model plan does not contain reproducible staged-content metadata. Re-plan before applying.",
      { planId: options.planId },
      "blocked"
    );
  }
  const changedFiles = verifyFingerprints(basePlan, projectRoot);
  if (changedFiles.length > 0) {
    throw new MachineCommandError(
      "stale-plan",
      `Model plan "${options.planId}" is stale: ${changedFiles.length} file(s) changed after planning.`,
      { planId: options.planId, changedFiles },
      "blocked"
    );
  }

  const currentPlan = infrastructureRequest
    ? await planModelInfrastructureOperation(
        infrastructureRequest.model,
        infrastructureRequest,
        false,
        basePlan.createdAt
      )
    : await planModelOperation({ names: basePlan.names, ...basePlan.options }, false, basePlan.createdAt);
  const writeSet = (plan: ModelPlanData) =>
    plan.operations.map(({ path: file, action, ownership, contentFingerprint }) => ({
      path: file,
      action,
      ownership,
      contentFingerprint,
    }));
  if (
    basePlan.swallowkitVersion !== currentPlan.swallowkitVersion ||
    JSON.stringify(basePlan.fingerprints) !== JSON.stringify(currentPlan.fingerprints) ||
    JSON.stringify(basePlan.modelInfrastructure) !== JSON.stringify(currentPlan.modelInfrastructure) ||
    JSON.stringify(writeSet(basePlan)) !== JSON.stringify(writeSet(currentPlan))
  ) {
    throw new MachineCommandError(
      "stale-plan",
      `Model plan "${options.planId}" no longer matches the current generated write set.`,
      { planId: options.planId, planned: writeSet(basePlan), current: writeSet(currentPlan) },
      "blocked"
    );
  }
  if (currentPlan.requiresApproval && !options.approve) {
    throw new MachineCommandError(
      "approval-required",
      `${currentPlan.conflicts.length} existing model file(s) would be overwritten. Review the plan and re-run with --approve.`,
      { planId: options.planId, conflicts: currentPlan.conflicts },
      "requires-human"
    );
  }

  const result = infrastructureRequest
    ? await addModelContainerMigration(infrastructureRequest.model, {
        ...infrastructureRequest,
        dryRun: false,
        projectRoot,
      })
    : await createModelOperation({ names: basePlan.names, ...basePlan.options });
  deletePlanState(options.planId, projectRoot);
  return {
    planId: options.planId,
    planType: basePlan.planType,
    result,
    approvedConflicts: options.approve ? currentPlan.conflicts : [],
  };
}
