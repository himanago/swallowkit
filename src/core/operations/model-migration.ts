/**
 * Register the Cosmos DB container migration and synchronize project metadata
 * without generating CRUD or modifying the model schema.
 */

import { resolveModelPath } from "../../cli/commands/scaffold";
import { MachineCommandError } from "../../machine/errors";
import { parseModelFile } from "../scaffold/model-parser";
import * as fs from "fs";
import * as path from "path";
import { findArtifactRecord, loadArtifactLedger, recordSessionOperations } from "../project/artifacts";
import { hashContent } from "./file-session";
import { FileOperationSession, getActiveFileSession } from "./file-session";
import { generateModelContainerMigration } from "./migration-generator";
import { loadMigrationManifest } from "../project/migrations";
import { readRemoteMigrationState } from "./provision-operations";
import { syncProjectManifest } from "../project/manifest";

export interface ModelMigrationResult {
  model: string;
  dryRun: boolean;
  migration: { version: number; template: string } | null;
  resolvedSubscription?: string;
  reason?: string;
  operations: Array<{ path: string; action: string }>;
}

export async function addModelContainerMigration(
  modelInput: string,
  options: { dryRun?: boolean; projectRoot?: string; refreshPending?: boolean; resourceGroup?: string; subscription?: string } = {}
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

  const activeSession = getActiveFileSession();
  const session = new FileOperationSession("collect", projectRoot, activeSession?.generatedAt);
  let allowPendingRefresh = false;
  let resolvedSubscription: string | undefined;
  if (options.refreshPending) {
    if (!options.resourceGroup) {
      throw new MachineCommandError("invalid-arguments", "--refresh-pending requires --resource-group so Azure application state can be checked.", undefined, "failed");
    }
    const manifest = loadMigrationManifest(projectRoot);
    const existing = manifest.migrations.find((migration) => migration.source === "model" && migration.sourceModel === modelInfo.name);
    if (!existing) {
      throw new MachineCommandError("model-migration-not-pending", `No registered container migration exists for ${modelInfo.name} to refresh.`, undefined, "blocked");
    }
    const remote = readRemoteMigrationState(projectRoot, options.resourceGroup, options.subscription, existing.version);
    resolvedSubscription = remote.subscription;
    if (remote.appliedVersion >= existing.version) {
      throw new MachineCommandError(
        "applied-migration-immutable",
        `Migration ${existing.version} for ${modelInfo.name} is already applied in ${options.resourceGroup}; create a new explicit infrastructure migration instead.`,
        { version: existing.version, appliedVersion: remote.appliedVersion, sourceModel: modelInfo.name },
        "blocked"
      );
    }
    const artifact = findArtifactRecord(loadArtifactLedger(projectRoot), existing.template);
    const templatePath = path.join(projectRoot, existing.template);
    const currentTemplate = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, "utf-8") : null;
    if (!artifact || artifact.ownership !== "generated-once" || artifact.sourceModel !== modelInfo.name ||
        !artifact.schemaHash || !/^[a-f0-9]{64}$/.test(artifact.schemaHash) ||
        currentTemplate === null || artifact.contentHash !== hashContent(currentTemplate)) {
      throw new MachineCommandError(
        "migration-ownership-unverified",
        `The pending migration for ${modelInfo.name} is not provably an unmodified SwallowKit-generated file; it will not be refreshed.`,
        { template: existing.template, sourceModel: modelInfo.name },
        "blocked"
      );
    }
    allowPendingRefresh = true;
  }
  const migration = generateModelContainerMigration(modelInfo, session, { allowPendingRefresh });
  recordSessionOperations(session.operations, {
    schemaHash: modelInfo.semanticFingerprint,
    sourceModel: modelInfo.name,
  }, projectRoot, session);
  await syncProjectManifest(projectRoot, undefined, session);
  if (!options.dryRun || activeSession?.mode === "collect") {
    session.applyTo(activeSession ?? new FileOperationSession("commit", projectRoot, session.generatedAt));
  }

  const operations: Array<{ path: string; action: string }> = session.operations.map((operation) => ({
    path: operation.path,
    action: operation.action,
  }));

  return {
    model: modelInfo.name,
    dryRun: Boolean(options.dryRun),
    migration: migration ? { version: migration.version, template: migration.template } : null,
    ...(resolvedSubscription ? { resolvedSubscription } : {}),
    ...(migration ? {} : { reason: "The container is already owned by the legacy migration baseline." }),
    operations,
  };
}
