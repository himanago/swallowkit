import * as path from "path";
import { resolveModelPath } from "../../cli/commands/scaffold";
import { ensureSwallowKitProject } from "../config";
import { getAllModels, getModelDependencyPaths, parseModelFile } from "../scaffold/model-parser";
import { buildProjectManifest, SWALLOWKIT_MANIFEST_PATH } from "../project/manifest";
import { recordSessionOperations } from "../project/artifacts";
import { FileOperationSession, getActiveFileSession } from "./file-session";
import { generateModelContainerMigration } from "./migration-generator";
import { MachineCommandError } from "../../machine/errors";
import { PendingMigrationTarget, resolvePendingMigrationTarget } from "./migration-refresh";

export interface AddModelMigrationOptions extends PendingMigrationTarget {
  refreshPending?: boolean;
  dryRun?: boolean;
}

export async function addModelMigrationOperation(modelInput: string, options: AddModelMigrationOptions = {}) {
  ensureSwallowKitProject("migrations add-model");
  const target = options.dryRun ? new FileOperationSession("collect") :
    getActiveFileSession() ?? new FileOperationSession("commit");
  const session = new FileOperationSession("collect", target.rootDirectory, target.generatedAt);
  const models = await getAllModels();
  const model = await parseModelFile(resolveModelPath(modelInput));
  if (model.connectorConfig) {
    throw new MachineCommandError("connector-model-infrastructure", "Connector models do not own Cosmos containers.", { model: model.name }, "blocked");
  }
  for (const candidate of [...models, model]) {
    for (const dependency of getModelDependencyPaths(candidate.filePath)) session.registerInput(dependency);
  }
  const refreshTarget = options.refreshPending ? resolvePendingMigrationTarget(options) : undefined;
  const migration = generateModelContainerMigration(model, session, refreshTarget);
  if (session.operations.some(operation => operation.action !== "skip")) {
    const { manifest } = await buildProjectManifest(session.rootDirectory, models);
    session.writeFile(path.join(session.rootDirectory, SWALLOWKIT_MANIFEST_PATH), JSON.stringify({
      ...manifest, generatedAt: session.generatedAt,
    }, null, 2) + "\n", {
      ownership: "metadata", generator: "model-infrastructure",
    });
    recordSessionOperations(session.operations, {}, session.rootDirectory, session);
  }
  session.replayInto(target);
  return {
    model: model.name, template: migration?.template ?? null, dryRun: options.dryRun ?? false,
    ...(refreshTarget ? { refreshTarget } : {}),
    operations: session.operations.map(({ path: file, action, ownership }) => ({ path: file, action, ownership })),
  };
}

export async function checkModelInfrastructure(projectRoot: string = process.cwd()): Promise<void> {
  const models = await getAllModels();
  for (const model of models) {
    if (model.connectorConfig) continue;
    const session = new FileOperationSession("collect", projectRoot);
    generateModelContainerMigration(model, session);
    const missing = session.operations.filter(operation => operation.action !== "skip");
    if (missing.length > 0) {
      throw new MachineCommandError(
        "model-infrastructure-missing",
        `Cosmos infrastructure is not registered for ${model.name}. Run "swallowkit migrations add-model ${model.filePath}" before provisioning.`,
        { model: model.name, modelPath: model.filePath, missingFiles: missing.map(operation => operation.path) },
        "blocked"
      );
    }
  }
}
