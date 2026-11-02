import * as crypto from "crypto";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import { savePlanState, loadPlanState, deletePlanState } from "../project/state";
import { createModelOperation, CreateModelOperationOptions } from "./create-model";
import { FileOperationSession, hashFileIfExists, runWithFileSession } from "./file-session";
import { addModelMigrationOperation, AddModelMigrationOptions } from "./model-infrastructure";
import { resolvePendingMigrationTarget } from "./migration-refresh";

type ModelPlanRequest =
  | { kind: "model"; options: Omit<CreateModelOperationOptions, "confirmOverwrite"> }
  | { kind: "model-infrastructure"; model: string; options?: AddModelMigrationOptions };

export interface ModelPlanData {
  planId: string;
  planType: "model";
  createdAt: string;
  request: ModelPlanRequest;
  operations: Array<{ path: string; action: string; ownership: string; newHash: string | null }>;
  fingerprints: Record<string, string | null>;
}

async function collect(request: ModelPlanRequest, generatedAt?: string): Promise<FileOperationSession> {
  const session = new FileOperationSession("collect", process.cwd(), generatedAt);
  await runWithFileSession(session, async () => {
    if (request.kind === "model") await createModelOperation(request.options);
    else await addModelMigrationOperation(request.model, request.options);
  });
  return session;
}

function collectFingerprints(session: FileOperationSession): Record<string, string | null> {
  const fingerprints = { ...session.inputFingerprints };
  for (const operation of session.operations) fingerprints[operation.path] = operation.previousHash;
  for (const file of ["swallowkit.config.js", "swallowkit.config.json", ".swallowkitrc.json", "infra/migrations/manifest.json"]) {
    fingerprints[file] = hashFileIfExists(path.join(process.cwd(), file));
  }
  return Object.fromEntries(Object.entries(fingerprints).sort(([left], [right]) => left.localeCompare(right)));
}

function collectOperations(session: FileOperationSession): ModelPlanData["operations"] {
  return session.operations.map(({ path: file, action, ownership, newHash }) => ({ path: file, action, ownership, newHash }));
}

export async function planModelOperation(request: ModelPlanRequest, persist = true): Promise<ModelPlanData> {
  if (request.kind === "model-infrastructure" && request.options?.refreshPending) {
    request = { ...request, options: { ...request.options, ...resolvePendingMigrationTarget(request.options) } };
  }
  const session = await collect(request);
  const fingerprints = collectFingerprints(session);
  const operations = collectOperations(session);
  const planId = crypto.createHash("sha256").update(JSON.stringify({ request, fingerprints, operations })).digest("hex").slice(0, 12);
  const plan: ModelPlanData = { planId, planType: "model", createdAt: session.generatedAt, request, operations, fingerprints };
  if (persist) savePlanState(plan);
  return plan;
}

export async function applyModelOperation(planId: string): Promise<ModelPlanData> {
  const plan = loadPlanState<ModelPlanData>(planId);
  if (!plan || plan.planType !== "model") {
    throw new MachineCommandError("plan-not-found", `Model plan ${planId} was not found.`, undefined, "blocked");
  }
  if (!plan.createdAt || plan.operations.some(operation => operation.newHash === undefined)) {
    throw new MachineCommandError("incompatible-plan", "Model plans require staged content hashes. Re-plan before applying.", undefined, "blocked");
  }
  if (plan.request.kind === "model-infrastructure" && plan.request.options?.refreshPending &&
      !plan.request.options.subscription) {
    throw new MachineCommandError("incompatible-plan", "Refresh plans require a pinned subscription. Re-plan model-infrastructure.", undefined, "blocked");
  }
  const changedFiles = Object.entries(plan.fingerprints).filter(([file, hash]) =>
    hashFileIfExists(path.join(process.cwd(), file)) !== hash).map(([file]) => file);
  if (changedFiles.length) {
    throw new MachineCommandError("stale-plan", "Model inputs or outputs changed after planning. Re-plan before applying.", { changedFiles }, "blocked");
  }
  const session = await collect(plan.request, plan.createdAt);
  const actual = collectOperations(session);
  if (JSON.stringify(collectFingerprints(session)) !== JSON.stringify(plan.fingerprints) ||
      JSON.stringify(actual) !== JSON.stringify(plan.operations)) {
    throw new MachineCommandError("stale-plan", "The model input inventory or staged content changed after planning. Re-plan before applying.", undefined, "blocked");
  }
  session.replayInto(new FileOperationSession("commit"));
  deletePlanState(planId);
  return plan;
}
