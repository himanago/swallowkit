import * as fs from "fs";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import { FileOperationSession } from "./file-session";
import {
  InfrastructureMigration,
  MIGRATION_MANIFEST_PATH,
  MigrationManifest,
  createMigrationManifest,
  loadMigrationManifest,
  saveMigrationManifest,
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
      `Migration manifest not found. Run "swallowkit migrations init --legacy-baseline" before scaffolding new models.`,
      undefined,
      "blocked"
    );
  }
  try {
    const manifest = JSON.parse(session.readFile(manifestPath)) as MigrationManifest;
    validateMigrationManifest(manifest, session.rootDirectory);
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

export function initializeLegacyMigrations(projectRoot: string = process.cwd()): MigrationManifest {
  const manifest = createMigrationManifest(projectRoot, { legacy: true });
  saveMigrationManifest(manifest, projectRoot);
  return manifest;
}

export function initializeNewProjectMigrations(projectRoot: string): MigrationManifest {
  const manifest = createMigrationManifest(projectRoot, { legacy: false });
  saveMigrationManifest(manifest, projectRoot);
  return manifest;
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
  model: { name: string; partitionKey: string },
  session: FileOperationSession = new FileOperationSession("commit")
): InfrastructureMigration {
  const manifest = readManifestForSession(session);
  const existing = manifest.migrations.find((migration) => migration.source === "model" && migration.sourceModel === model.name);
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
  if (existing && session.fileExists(absoluteTemplate) && session.readFile(absoluteTemplate) !== bicep) {
    throw new MachineCommandError(
      "applied-migration-immutable",
      `The generated migration for model ${model.name} differs from the current schema. Create a new explicit migration instead of changing container properties.`,
      { version: existing.version, template },
      "blocked"
    );
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
