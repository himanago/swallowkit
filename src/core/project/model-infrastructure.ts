import * as fs from "fs";
import * as path from "path";
import { getAllModels } from "../scaffold/model-parser";
import { FileOperationSession } from "../operations/file-session";
import { generateModelContainerMigration } from "../operations/migration-generator";
import { withWorkingDirectory } from "../operations/runtime";
import { MachineCommandError } from "../../machine/errors";
import { loadMigrationManifest, MIGRATION_MANIFEST_PATH } from "./migrations";

export interface ModelInfrastructureFinding {
  code: "model-container-migration-missing" | "model-container-migration-stale";
  model: string;
  filePath: string;
  message: string;
  suggestedFix: string;
}

export async function inspectModelInfrastructure(
  projectRoot: string = process.cwd()
): Promise<ModelInfrastructureFinding[]> {
  return withWorkingDirectory(projectRoot, async () => {
    const models = await getAllModels();
    const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
    const manifestExists = fs.existsSync(manifestPath);
    const manifest = manifestExists ? loadMigrationManifest(projectRoot) : null;
    const findings: ModelInfrastructureFinding[] = [];

    for (const model of models) {
      if (model.connectorConfig) continue;

      const registered = manifest?.migrations.find(
        (migration) => migration.source === "model" && migration.sourceModel === model.name
      );
      const session = new FileOperationSession("collect", projectRoot);
      try {
        const migration = generateModelContainerMigration(model, session);
        if (!migration) continue;

        const templateOperation = session.operations.find(
          (operation) => operation.path === migration.template
        );
        if (templateOperation?.action === "skip") continue;

        const missing = !registered;
        findings.push({
          code: missing ? "model-container-migration-missing" : "model-container-migration-stale",
          model: model.name,
          filePath: model.filePath,
          message: missing
            ? `Persistent model ${model.name} has no registered Cosmos container migration.`
            : `The registered Cosmos container migration for ${model.name} is missing or differs from the current schema.`,
          suggestedFix: `Run "swallowkit machine plan model-infrastructure ${model.name}" and apply the reviewed plan.`,
        });
      } catch (error) {
        const missingManifest = error instanceof MachineCommandError && error.code === "migration-manifest-not-found";
        findings.push({
          code: missingManifest || !registered ? "model-container-migration-missing" : "model-container-migration-stale",
          model: model.name,
          filePath: model.filePath,
          message: error instanceof Error
            ? `Cannot verify the Cosmos container migration for ${model.name}: ${error.message}`
            : `Cannot verify the Cosmos container migration for ${model.name}.`,
          suggestedFix: missingManifest
            ? 'Run "swallowkit migrations init --legacy-baseline" before registering model container migrations.'
            : `Review the migration history for ${model.name}; applied or ambiguous infrastructure must be reconciled with an explicit migration.`,
        });
      }
    }

    return findings;
  });
}
