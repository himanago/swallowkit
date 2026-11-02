import * as crypto from "crypto";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import { savePlanState, loadPlanState, deletePlanState } from "../project/state";
import { createModelOperation, CreateModelOperationOptions } from "./create-model";
import { FileOperationSession, hashFileIfExists, runWithFileSession } from "./file-session";
import { addModelMigrationOperation, AddModelMigrationOptions } from "./model-infrastructure";

type ModelPlanRequest =
  | { kind: "model"; options: Omit<CreateModelOperationOptions, "confirmOverwrite"> }
  | { kind: "model-infrastructure"; model: string; options?: AddModelMigrationOptions };

export interface ModelPlanData {
  planId: string;
  planType: "model";
  request: ModelPlanRequest;
  operations: Array<{ path: string; action: string; ownership: string }>;
  fingerprints: Record<string, string | null>;
}

async function collect(request: ModelPlanRequest): Promise<FileOperationSession> {
  const session = new FileOperationSession("collect");
  await runWithFileSession(session, async () => {
    if (request.kind === "model") await createModelOperation(request.options);
    else await addModelMigrationOperation(request.model, request.options);
  });
  return session;
}

export async function planModelOperation(request: ModelPlanRequest, persist = true): Promise<ModelPlanData> {
  const session = await collect(request);
  const fingerprints = { ...session.inputFingerprints };
  for (const operation of session.operations) fingerprints[operation.path] = operation.previousHash;
  for (const file of ["swallowkit.config.js", "swallowkit.config.json", ".swallowkitrc.json", "infra/migrations/manifest.json"]) {
    fingerprints[file] = hashFileIfExists(path.join(process.cwd(), file));
  }
  const operations = session.operations.map(({ path: file, action, ownership }) => ({ path: file, action, ownership }));
  const planId = crypto.createHash("sha256").update(JSON.stringify({ request, fingerprints, operations })).digest("hex").slice(0, 12);
  const plan: ModelPlanData = { planId, planType: "model", request, operations, fingerprints };
  if (persist) savePlanState(plan);
  return plan;
}

export async function applyModelOperation(planId: string): Promise<ModelPlanData> {
  const plan = loadPlanState<ModelPlanData>(planId);
  if (!plan || plan.planType !== "model") {
    throw new MachineCommandError("plan-not-found", `Model plan ${planId} was not found.`, undefined, "blocked");
  }
  const changedFiles = Object.entries(plan.fingerprints).filter(([file, hash]) =>
    hashFileIfExists(path.join(process.cwd(), file)) !== hash).map(([file]) => file);
  if (changedFiles.length) {
    throw new MachineCommandError("stale-plan", "Model inputs or outputs changed after planning. Re-plan before applying.", { changedFiles }, "blocked");
  }
  const session = await collect(plan.request);
  const actual = session.operations.map(({ path: file, action, ownership }) => ({ path: file, action, ownership }));
  if (JSON.stringify(actual) !== JSON.stringify(plan.operations)) {
    throw new MachineCommandError("stale-plan", "The model write set changed after planning. Re-plan before applying.", undefined, "blocked");
  }
  session.replayInto(new FileOperationSession("commit"));
  deletePlanState(planId);
  return plan;
}
