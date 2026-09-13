import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import { hashContent } from "../operations/file-session";

export const MIGRATION_MANIFEST_VERSION = 1;
export const MIGRATION_MANIFEST_PATH = path.join("infra", "migrations", "manifest.json");

export interface MigrationBaselineFile {
  path: string;
  checksum: string;
}

export interface MigrationBaseline {
  version: 0;
  legacy: boolean;
  files: MigrationBaselineFile[];
  checksum: string;
}

export interface InfrastructureMigration {
  version: number;
  slug: string;
  template: string;
  parameters?: string;
  source: "model" | "custom";
  sourceModel?: string;
}

export interface MigrationManifest {
  schemaVersion: 1;
  projectId: string;
  baseline: MigrationBaseline;
  migrations: InfrastructureMigration[];
}

export interface ResolvedMigration extends InfrastructureMigration {
  checksum: string;
  cumulativeChecksum: string;
}

export interface MigrationState {
  schemaVersion: 1;
  version: number;
  checksum: string;
}

function fail(code: string, message: string, details?: unknown): never {
  throw new MachineCommandError(code, message, details, "blocked");
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail("invalid-migration-manifest", `Migration path must stay inside the project: ${value}`);
  }
  return normalized;
}

function readRequiredFile(projectRoot: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(projectRoot, normalized);
  const rootWithSeparator = `${path.resolve(projectRoot)}${path.sep}`;
  if (!absolutePath.startsWith(rootWithSeparator) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail("migration-file-not-found", `Migration file not found: ${normalized}`);
  }
  const realPath = fs.realpathSync(absolutePath);
  if (!realPath.startsWith(rootWithSeparator)) {
    fail("invalid-migration-manifest", `Migration file resolves outside the project: ${normalized}`);
  }
  return fs.readFileSync(absolutePath, "utf-8");
}

function checksumObject(value: unknown): string {
  return hashContent(JSON.stringify(value));
}

export function computeBaselineChecksum(files: MigrationBaselineFile[]): string {
  return checksumObject([...files].sort((left, right) => left.path.localeCompare(right.path)));
}

export function findBaselineDrift(manifest: MigrationManifest, projectRoot: string = process.cwd()): string[] {
  return manifest.baseline.files
    .filter((file) => {
      const absolutePath = path.join(projectRoot, normalizeRelativePath(file.path));
      return !fs.existsSync(absolutePath) || hashContent(fs.readFileSync(absolutePath, "utf-8")) !== file.checksum;
    })
    .map((file) => file.path);
}

export function collectLegacyBaselineFiles(projectRoot: string = process.cwd()): MigrationBaselineFile[] {
  const infraRoot = path.join(projectRoot, "infra");
  if (!fs.existsSync(path.join(infraRoot, "main.bicep"))) {
    fail("infra-not-found", 'infra/main.bicep not found. Run this command from a SwallowKit project.');
  }

  const files: MigrationBaselineFile[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "migrations") visit(absolutePath);
      } else if (entry.isFile() && (entry.name.endsWith(".bicep") || entry.name.endsWith(".json"))) {
        const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
        files.push({ path: relativePath, checksum: hashContent(fs.readFileSync(absolutePath, "utf-8")) });
      }
    }
  };
  visit(infraRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function createMigrationManifest(
  projectRoot: string = process.cwd(),
  options: { legacy?: boolean; projectId?: string } = {}
): MigrationManifest {
  const files = collectLegacyBaselineFiles(projectRoot);
  return {
    schemaVersion: MIGRATION_MANIFEST_VERSION,
    projectId: options.projectId ?? crypto.randomUUID(),
    baseline: {
      version: 0,
      legacy: options.legacy ?? false,
      files,
      checksum: computeBaselineChecksum(files),
    },
    migrations: [],
  };
}

export function saveMigrationManifest(manifest: MigrationManifest, projectRoot: string = process.cwd()): void {
  const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
  if (fs.existsSync(manifestPath)) {
    fail("migration-manifest-exists", `${MIGRATION_MANIFEST_PATH} already exists.`);
  }
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export function replaceMigrationManifest(manifest: MigrationManifest, projectRoot: string = process.cwd()): void {
  validateMigrationManifest(manifest, projectRoot);
  const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  fs.renameSync(temporaryPath, manifestPath);
}

export function loadMigrationManifest(projectRoot: string = process.cwd()): MigrationManifest {
  const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    fail("migration-manifest-not-found", `${MIGRATION_MANIFEST_PATH} not found. Initialize migrations first.`);
  }
  let manifest: MigrationManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as MigrationManifest;
  } catch {
    fail("invalid-migration-manifest", `${MIGRATION_MANIFEST_PATH} is not valid JSON.`);
  }
  validateMigrationManifest(manifest, projectRoot);
  return manifest;
}

export function validateMigrationManifest(manifest: MigrationManifest, projectRoot: string = process.cwd()): void {
  if (
    !manifest || typeof manifest !== "object" ||
    manifest.schemaVersion !== MIGRATION_MANIFEST_VERSION ||
    typeof manifest.projectId !== "string" || !manifest.projectId ||
    !manifest.baseline || typeof manifest.baseline !== "object" ||
    manifest.baseline.version !== 0 || typeof manifest.baseline.legacy !== "boolean" ||
    !Array.isArray(manifest.baseline.files) || typeof manifest.baseline.checksum !== "string" ||
    !Array.isArray(manifest.migrations)
  ) {
    fail("invalid-migration-manifest", "Unsupported or incomplete migration manifest.");
  }
  for (const file of manifest.baseline.files) {
    if (!file || typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.checksum)) {
      fail("invalid-migration-manifest", "Migration baseline contains an invalid file record.");
    }
  }
  const baselineFiles = manifest.baseline.files.map((file) => ({
    path: normalizeRelativePath(file.path),
    checksum: file.checksum,
  }));
  if (new Set(baselineFiles.map((file) => file.path)).size !== baselineFiles.length) {
    fail("invalid-migration-manifest", "Migration baseline contains duplicate paths.");
  }
  if (computeBaselineChecksum(baselineFiles) !== manifest.baseline.checksum) {
    fail("migration-checksum-mismatch", "The migration baseline inventory was modified.");
  }

  const sorted = [...manifest.migrations].sort((left, right) => left.version - right.version);
  for (let index = 0; index < sorted.length; index += 1) {
    const migration = sorted[index];
    if (!migration || !Number.isSafeInteger(migration.version) || typeof migration.slug !== "string" || typeof migration.template !== "string") {
      fail("invalid-migration-manifest", "Migration manifest contains an invalid entry.");
    }
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(migration.slug)) {
      fail("invalid-migration-manifest", `Migration versions must be contiguous and slugs must be kebab-case (expected version ${expectedVersion}).`);
    }
    if (migration.source !== "model" && migration.source !== "custom") {
      fail("invalid-migration-manifest", `Migration ${migration.version} has an invalid source.`);
    }
    const template = normalizeRelativePath(migration.template);
    if (!template.startsWith("infra/migrations/") || !template.endsWith(".bicep")) {
      fail("invalid-migration-manifest", `Migration template must be a .bicep file under infra/migrations: ${template}`);
    }
    readRequiredFile(projectRoot, template);
    if (migration.parameters) {
      const parameters = normalizeRelativePath(migration.parameters);
      if (!parameters.startsWith("infra/migrations/") || !parameters.endsWith(".json")) {
        fail("invalid-migration-manifest", `Migration parameters must be JSON under infra/migrations: ${parameters}`);
      }
      readRequiredFile(projectRoot, parameters);
    }
  }
}

export function resolveMigrations(manifest: MigrationManifest, projectRoot: string = process.cwd()): ResolvedMigration[] {
  validateMigrationManifest(manifest, projectRoot);
  let cumulativeChecksum = manifest.baseline.checksum;
  return [...manifest.migrations]
    .sort((left, right) => left.version - right.version)
    .map((migration) => {
      const templateContent = readRequiredFile(projectRoot, migration.template);
      const parametersContent = migration.parameters ? readRequiredFile(projectRoot, migration.parameters) : null;
      const checksum = checksumObject({ migration, templateContent, parametersContent });
      cumulativeChecksum = checksumObject({ previous: cumulativeChecksum, version: migration.version, checksum });
      return { ...migration, checksum, cumulativeChecksum };
    });
}

export function checksumAtVersion(manifest: MigrationManifest, version: number, projectRoot: string = process.cwd()): string {
  if (version === 0) return manifest.baseline.checksum;
  const migration = resolveMigrations(manifest, projectRoot).find((item) => item.version === version);
  if (!migration) fail("migration-version-not-found", `Migration version ${version} does not exist locally.`);
  return migration.cumulativeChecksum;
}

export function getMigrationTagKey(projectId: string): string {
  const projectHash = crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 12);
  return `swallowkit-migration-${projectHash}`;
}

export function encodeMigrationState(state: MigrationState): string {
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.version) || state.version < 0 || !/^[a-f0-9]{64}$/.test(state.checksum)) {
    fail("invalid-migration-state", "Cannot encode an invalid migration state.");
  }
  return `1:${state.version}:${state.checksum}`;
}

export function decodeMigrationState(value: string): MigrationState {
  const match = /^1:(0|[1-9]\d*):([a-f0-9]{64})$/.exec(value);
  if (!match) fail("invalid-migration-state", "The Azure migration state tag is invalid.");
  return { schemaVersion: 1, version: Number(match[1]), checksum: match[2] };
}

export function selectPendingMigrations(
  manifest: MigrationManifest,
  remoteState: MigrationState,
  projectRoot: string = process.cwd()
): ResolvedMigration[] {
  const latestVersion = manifest.migrations.length;
  if (remoteState.version > latestVersion) {
    fail("migration-state-ahead", `Azure is at migration ${remoteState.version}, but local latest is ${latestVersion}.`);
  }
  const expectedChecksum = checksumAtVersion(manifest, remoteState.version, projectRoot);
  if (remoteState.checksum !== expectedChecksum) {
    fail("migration-checksum-mismatch", `Azure migration ${remoteState.version} does not match the local history.`);
  }
  return resolveMigrations(manifest, projectRoot).filter((migration) => migration.version > remoteState.version);
}
