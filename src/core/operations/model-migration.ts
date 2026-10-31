/**
 * Generate only the Cosmos DB container migration for a model. Used after
 * `scaffold --skip-infra`, when infrastructure changes become allowed.
 */

import { resolveModelPath } from "../../cli/commands/scaffold";
import { MachineCommandError } from "../../machine/errors";
import { parseModelFile } from "../scaffold/model-parser";
import { recordSessionOperations } from "../project/artifacts";
import { FileOperationSession } from "./file-session";
import { generateModelContainerMigration } from "./migration-generator";

export interface ModelMigrationResult {
  model: string;
  dryRun: boolean;
  migration: { version: number; template: string } | null;
  reason?: string;
  operations: Array<{ path: string; action: string }>;
}

export async function addModelContainerMigration(
  modelInput: string,
  options: { dryRun?: boolean; projectRoot?: string } = {}
): Promise<ModelMigrationResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const modelInfo = await parseModelFile(resolveModelPath(modelInput));
  if (modelInfo.connectorConfig) {
    throw new MachineCommandError(
      "connector-model-has-no-container",
      `${modelInfo.name} uses connector ${modelInfo.connectorConfig.connector}; connector models do not get a Cosmos DB container.`,
      undefined,
      "failed"
    );
  }

  const session = new FileOperationSession(options.dryRun ? "collect" : "commit", projectRoot);
  const migration = generateModelContainerMigration(modelInfo, session);
  if (!options.dryRun) {
    recordSessionOperations(session.operations, {
      schemaHash: modelInfo.semanticFingerprint,
      sourceModel: modelInfo.name,
    }, projectRoot);
  }

  return {
    model: modelInfo.name,
    dryRun: Boolean(options.dryRun),
    migration: migration ? { version: migration.version, template: migration.template } : null,
    ...(migration ? {} : { reason: "The container is already owned by the legacy migration baseline." }),
    operations: session.operations.map((operation) => ({ path: operation.path, action: operation.action })),
  };
}
