import * as fs from "fs";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import { FileOperationSession, hashContent } from "./file-session";
import { recordSessionOperations } from "../project/artifacts";
import { findArtifactRecord, loadArtifactLedger } from "../project/artifacts";
import { confirmPendingMigration, PendingMigrationTarget } from "./migration-refresh";
import {
  InfrastructureMigration,
  MIGRATION_MANIFEST_PATH,
  MigrationManifest,
  createMigrationManifest,
  findBaselineDrift,
  loadMigrationManifest,
  validateMigrationManifest,
} from "../project/migrations";

const GENERATOR = "infrastructure-migration";

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (!slug) {
    throw new MachineCommandError("invalid-migration-slug", "Migration slug must contain letters or numbers.", undefined, "failed");
  }
  return slug;
}

function formatVersion(version: number): string {
  return String(version).padStart(4, "0");
}

function readManifestForSession(session: FileOperationSession): MigrationManifest {
  const manifestPath = path.join(session.rootDirectory, MIGRATION_MANIFEST_PATH);
  if (!session.fileExists(manifestPath)) {
    throw new MachineCommandError(
      "migration-manifest-not-found",
      `Migration manifest not found. Run "swallowkit migrations init --legacy-baseline" before generating or registering Cosmos models.`,
      undefined,
      "blocked"
    );
  }
  try {
    loadMigrationManifest(session.rootDirectory);
    const manifest = JSON.parse(session.readFile(manifestPath)) as MigrationManifest;
    validateMigrationManifest(manifest, session.rootDirectory, relativePath => {
      const absolutePath = path.join(session.rootDirectory, relativePath);
      if (!session.fileExists(absolutePath)) {
        throw new MachineCommandError("migration-file-not-found", `Migration file not found: ${relativePath}`, undefined, "blocked");
      }
      return session.readFile(absolutePath);
    });
    const baselineDrift = findBaselineDrift(manifest, session.rootDirectory);
    if (baselineDrift.length > 0) {
      throw new MachineCommandError(
        "baseline-drift",
        "Baseline infrastructure files changed after migration tracking was initialized. Create an explicit migration or reconcile the baseline first.",
        { changedFiles: baselineDrift },
        "blocked"
      );
    }
    return manifest;
  } catch (error) {
    if (error instanceof MachineCommandError) throw error;
    throw new MachineCommandError("invalid-migration-manifest", `${MIGRATION_MANIFEST_PATH} is not valid JSON.`, undefined, "blocked");
  }
}

function appendMigration(manifest: MigrationManifest, migration: InfrastructureMigration): MigrationManifest {
  return {
    ...manifest,
    migrations: [...manifest.migrations, migration].sort((left, right) => left.version - right.version),
  };
}

function baselineOwnsModelContainer(
  manifest: MigrationManifest,
  model: { name: string; partitionKey: string },
  session: FileOperationSession
): boolean {
  const containerSlug = normalizeSlug(model.name);
  const containerPath = `infra/containers/${containerSlug}-container.bicep`;
  const mainPath = "infra/main.bicep";
  const baselinePaths = new Set(manifest.baseline.files.map((file) => file.path.replace(/\\/g, "/")));
  if (!baselinePaths.has(containerPath) || !baselinePaths.has(mainPath)) return false;

  const mainBicep = session.readFile(path.join(session.rootDirectory, mainPath));
  const wired = mainBicep.includes(`'containers/${containerSlug}-container.bicep'`) ||
    mainBicep.includes(`"containers/${containerSlug}-container.bicep"`);
  if (!wired) return false;

  const containerBicep = session.readFile(path.join(session.rootDirectory, containerPath));
  const moduleStart = mainBicep.search(new RegExp(`^\\s*module\\s+\\w+\\s+['"]containers/${containerSlug}-container\\.bicep['"]\\s*=\\s*\\{`, "m"));
  if (moduleStart < 0) {
    throw new MachineCommandError("baseline-container-configuration-unknown", "Cannot safely analyze the baseline container module wiring.",
      { model: model.name, containerPath }, "blocked");
  }
  const bodyStart = mainBicep.indexOf("{", moduleStart);
  let depth = 1;
  let end = bodyStart + 1;
  for (; end < mainBicep.length && depth > 0; end++) {
    const character = mainBicep[end];
    if (character === "'" || character === '"') {
      const quote = character;
      for (end++; end < mainBicep.length; end++) {
        if (mainBicep[end] === "\\") end++;
        else if (mainBicep[end] === quote) break;
      }
    } else if (character === "{") depth++;
    else if (character === "}") depth--;
  }
  const moduleBody = mainBicep.slice(bodyStart, end);
  const override = moduleBody.match(/partitionKeyPath\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (depth !== 0 || (!override && /partitionKeyPath\s*:/.test(moduleBody))) {
    throw new MachineCommandError("baseline-container-configuration-unknown", "The baseline partition key must be statically known; no container migration was generated.",
      { model: model.name, containerPath }, "blocked");
  }
  const baselinePartitionKey = override ?? containerBicep.match(
    /param\s+partitionKeyPath\s+string\s*=\s*['"]([^'"]+)['"]/
  )?.[1];
  if (!baselinePartitionKey) {
    throw new MachineCommandError("baseline-container-configuration-unknown", "Cannot establish the partition key of the baseline-owned container.",
      { model: model.name, containerPath }, "blocked");
  }
  if (baselinePartitionKey && baselinePartitionKey !== model.partitionKey) {
    throw new MachineCommandError(
      "baseline-container-configuration-change",
      `Model ${model.name} changes the partition key of a baseline-owned container. Create an explicit infrastructure migration instead of regenerating the container.`,
      { model: model.name, baselinePartitionKey, requestedPartitionKey: model.partitionKey, containerPath },
      "blocked"
    );
  }
  return true;
}

function initializeMigrations(projectRoot: string, legacy: boolean): MigrationManifest {
  const manifest = createMigrationManifest(projectRoot, { legacy });
  const session = new FileOperationSession("commit", projectRoot);
  session.writeFile(
    path.join(projectRoot, MIGRATION_MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { ownership: "metadata", generator: GENERATOR }
  );
  recordSessionOperations(session.operations, {}, projectRoot);
  return manifest;
}

export function initializeLegacyMigrations(projectRoot: string = process.cwd()): MigrationManifest {
  return initializeMigrations(projectRoot, true);
}

export function initializeNewProjectMigrations(projectRoot: string): MigrationManifest {
  return initializeMigrations(projectRoot, false);
}

export function createCustomMigration(slugValue: string, projectRoot: string = process.cwd()): InfrastructureMigration {
  const manifest = loadMigrationManifest(projectRoot);
  const slug = normalizeSlug(slugValue);
  if (manifest.migrations.some((migration) => migration.slug === slug)) {
    throw new MachineCommandError("migration-exists", `Migration slug already exists: ${slug}`, undefined, "blocked");
  }
  const version = manifest.migrations.length + 1;
  const directory = path.join("infra", "migrations", `${formatVersion(version)}-${slug}`);
  const template = path.join(directory, "main.bicep").replace(/\\/g, "/");
  const absoluteTemplate = path.join(projectRoot, template);
  if (fs.existsSync(absoluteTemplate)) {
    throw new MachineCommandError("migration-exists", `Migration path already exists: ${template}`, undefined, "blocked");
  }
  const source = `targetScope = 'resourceGroup'

@description('SwallowKit project name')
param projectName string

@description('Azure resource location')
param location string

// Add only new or intentionally updated resources in this migration.
// Reference existing resources with the Bicep "existing" keyword.
`;
  fs.mkdirSync(path.dirname(absoluteTemplate), { recursive: true });
  fs.writeFileSync(absoluteTemplate, source, "utf-8");

  const migration: InfrastructureMigration = { version, slug, template, source: "custom" };
  const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
  fs.writeFileSync(manifestPath, `${JSON.stringify(appendMigration(manifest, migration), null, 2)}\n`, "utf-8");
  return migration;
}

export function generateModelContainerMigration(
  model: { name: string; partitionKey: string; fields?: Array<{ name: string }> },
  session: FileOperationSession = new FileOperationSession("commit"),
  refreshTarget?: PendingMigrationTarget
): InfrastructureMigration | null {
  const partitionField = model.partitionKey.slice(1);
  if (!/^\/[A-Za-z_][A-Za-z0-9_]*$/.test(model.partitionKey) ||
      (model.fields && !model.fields.some(field => field.name === partitionField))) {
    throw new MachineCommandError("invalid-model-partition-key", `Model ${model.name} must declare the partition key field ${model.partitionKey}.`,
      { model: model.name, partitionKey: model.partitionKey }, "blocked");
  }
  const manifest = readManifestForSession(session);
  const existing = manifest.migrations.find((migration) => migration.source === "model" && migration.sourceModel === model.name);
  if (!existing && baselineOwnsModelContainer(manifest, model, session)) {
    return null;
  }
  const slug = normalizeSlug(`create-${model.name}-container`);
  const version = existing?.version ?? manifest.migrations.length + 1;
  const directory = path.join("infra", "migrations", `${formatVersion(version)}-${slug}`);
  const template = (existing?.template ?? path.join(directory, "main.bicep")).replace(/\\/g, "/");
  const containerName = `${model.name}s`;
  const bicep = `targetScope = 'resourceGroup'

@description('SwallowKit project name')
param projectName string

@description('Azure resource location')
param location string

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: 'cosmos-\${projectName}'
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' existing = {
  parent: cosmosAccount
  name: '\${projectName}Database'
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: '${containerName}'
  properties: {
    resource: {
      id: '${containerName}'
      partitionKey: {
        paths: [
          '${model.partitionKey}'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/_etag/?' }
        ]
      }
    }
  }
}

output containerName string = container.name
`;
  const absoluteTemplate = path.join(session.rootDirectory, template);
  session.registerInput(path.join(session.rootDirectory, MIGRATION_MANIFEST_PATH));
  for (const file of manifest.baseline.files) session.registerInput(path.join(session.rootDirectory, file.path));
  for (const migration of manifest.migrations) {
    session.registerInput(path.join(session.rootDirectory, migration.template));
    if (migration.parameters) session.registerInput(path.join(session.rootDirectory, migration.parameters));
  }
  if (existing && session.fileExists(absoluteTemplate) && session.readFile(absoluteTemplate) !== bicep) {
    if (!refreshTarget) {
      throw new MachineCommandError(
        "applied-migration-immutable",
        `The migration for ${model.name} differs from the schema. Its applied status is unknown; no files were changed. Use migrations add-model --refresh-pending with an explicit Azure target to prove it is pending.`,
        { version: existing.version, template, appliedStatus: "unknown" }, "blocked"
      );
    }
    const record = findArtifactRecord(loadArtifactLedger(session.rootDirectory), template);
    if (!record || record.generator !== GENERATOR || record.contentHash !== hashContent(session.readFile(absoluteTemplate))) {
      throw new MachineCommandError("migration-provenance-unknown", "Only an unmodified generated model migration can be refreshed.",
        { version: existing.version, template }, "blocked");
    }
    confirmPendingMigration(manifest, existing.version, refreshTarget, session.rootDirectory);
  }
  session.writeFile(absoluteTemplate, bicep, { ownership: "generated-once", generator: GENERATOR, sourceModel: model.name });

  const migration: InfrastructureMigration = existing ?? {
    version,
    slug,
    template,
    source: "model",
    sourceModel: model.name,
  };
  if (!existing) {
    session.writeFile(
      path.join(session.rootDirectory, MIGRATION_MANIFEST_PATH),
      `${JSON.stringify(appendMigration(manifest, migration), null, 2)}\n`,
      { ownership: "metadata", generator: GENERATOR, sourceModel: model.name }
    );
  }
  return migration;
}
