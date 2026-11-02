import { Command } from "commander";
import { CosmosClient, Database, PartitionKeyKind } from "@azure/cosmos";
import * as fs from "fs";
import * as path from "path";
import { ensureSwallowKitProject } from "../../core/config";
import {
  AZURE_SEED_MAX_BYTES,
  AZURE_SEED_MAX_DOCUMENTS,
  AZURE_SEED_NAME_PATTERN,
} from "../../core/project/bootstrap-constants";
import { FieldInfo, ModelInfo, getAllModels, toKebabCase } from "../../core/scaffold/model-parser";
import { resolveCosmosDatabaseNameForWorktree } from "./cosmos-worktree-isolation";
import type { GitCommandRunner } from "./cosmos-worktree-isolation";

export type SeedDocument = Record<string, unknown>;

interface GenerateDevSeedTemplatesOptions {
  environment: string;
  modelsDir?: string;
  seedsDir?: string;
  force?: boolean;
  fromEmulator?: boolean;
}

interface ApplyDevSeedEnvironmentOptions {
  client: CosmosClient;
  databaseName: string;
  environment: string;
  models: ModelInfo[];
  seedsDir?: string;
}

export interface LoadedSeedFile {
  model: ModelInfo;
  containerName: string;
  documents: SeedDocument[];
  filePath: string;
}

export { AZURE_SEED_MAX_BYTES, AZURE_SEED_MAX_DOCUMENTS, AZURE_SEED_NAME_PATTERN };

export interface LocalCosmosConnectionInfo {
  endpoint: string;
  key: string;
  databaseName: string;
  worktreeIsolationEnabled?: boolean;
  localSettingsPath: string;
}

export type ResolveLocalCosmosConnectionResult =
  | { ok: true; value: LocalCosmosConnectionInfo }
  | {
      ok: false;
      reason: "missing-local-settings" | "missing-connection-string" | "invalid-connection-string";
      localSettingsPath: string;
    };

interface ExportedContainerDocuments {
  documents: SeedDocument[];
  containerExists: boolean;
}

const COSMOS_SYSTEM_PROPERTIES = new Set(["_rid", "_self", "_etag", "_attachments", "_ts"]);

export function getContainerNameForModel(model: Pick<ModelInfo, "name">): string {
  return model.name.endsWith('s') ? model.name : `${model.name}s`;
}

export function getSeedEnvironmentDir(environment: string, seedsDir: string = "dev-seeds"): string {
  return path.join(process.cwd(), seedsDir, environment);
}

export function validateAzureSeedName(seedName: string): void {
  if (!AZURE_SEED_NAME_PATTERN.test(seedName)) {
    throw new Error("seed_name must start with an alphanumeric character and contain only letters, numbers, hyphens, or underscores (max 64 characters).");
  }
}

export function normalizeSeedIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseSeedDocuments(content: string, filePath: string): SeedDocument[] {
  const parsed: unknown = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return parsed.map((item, index) => {
      if (!isSeedDocument(item)) {
        throw new Error(`${filePath} must contain only JSON objects. Invalid item at index ${index}.`);
      }

      return item;
    });
  }

  if (isSeedDocument(parsed)) {
    return [parsed];
  }

  throw new Error(`${filePath} must contain a JSON object or an array of JSON objects.`);
}

export async function loadProjectModels(modelsDir: string = "shared/models"): Promise<ModelInfo[]> {
  return getAllModels(modelsDir);
}

export function buildDefaultCosmosDatabaseName(packageName: string): string {
  const normalizedName = packageName.trim();
  const baseName = normalizedName.length > 0 ? normalizedName : "App";
  return `${baseName.charAt(0).toUpperCase()}${baseName.slice(1)}Database`;
}

export function getDefaultCosmosDatabaseName(projectDir: string = process.cwd()): string {
  const packageJsonPath = path.join(projectDir, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: string };
  return buildDefaultCosmosDatabaseName(packageJson.name || "App");
}

export function parseCosmosConnectionString(
  connectionString: string
): Pick<LocalCosmosConnectionInfo, "endpoint" | "key"> | null {
  const endpointMatch = connectionString.match(/AccountEndpoint=([^;]+)/);
  const keyMatch = connectionString.match(/AccountKey=([^;]+)/);

  if (!endpointMatch || !keyMatch) {
    return null;
  }

  return {
    endpoint: endpointMatch[1],
    key: keyMatch[1],
  };
}

export function resolveLocalCosmosConnectionInfo(
  defaultDatabaseName: string,
  functionsDir: string = path.join(process.cwd(), "functions"),
  worktreeOptions: {
    cwd?: string;
    runGit?: GitCommandRunner;
  } = {}
): ResolveLocalCosmosConnectionResult {
  const localSettingsPath = path.join(functionsDir, "local.settings.json");
  if (!fs.existsSync(localSettingsPath)) {
    return { ok: false, reason: "missing-local-settings", localSettingsPath };
  }

  const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, "utf-8")) as {
    Values?: {
      CosmosDBConnection?: string;
      COSMOS_DB_DATABASE_NAME?: string;
    };
  };
  const connectionString = localSettings.Values?.CosmosDBConnection;

  if (!connectionString) {
    return { ok: false, reason: "missing-connection-string", localSettingsPath };
  }

  const parsedConnection = parseCosmosConnectionString(connectionString);
  if (!parsedConnection) {
    return { ok: false, reason: "invalid-connection-string", localSettingsPath };
  }

  const baseDatabaseName = localSettings.Values?.COSMOS_DB_DATABASE_NAME || defaultDatabaseName;
  const databaseNameResolution = resolveCosmosDatabaseNameForWorktree(
    baseDatabaseName,
    worktreeOptions.cwd,
    worktreeOptions.runGit
  );

  return {
    ok: true,
    value: {
      ...parsedConnection,
      databaseName: databaseNameResolution.databaseName,
      worktreeIsolationEnabled: databaseNameResolution.worktreeIsolationEnabled,
      localSettingsPath,
    },
  };
}

export function buildSeedTemplateDocument(
  model: ModelInfo,
  allModels: ModelInfo[] = [model],
  seenModels: Set<string> = new Set()
): SeedDocument {
  const modelLookup = new Map(allModels.map((candidate) => [candidate.name, candidate]));
  return buildSeedTemplateDocumentInternal(model, modelLookup, seenModels);
}

export async function loadDevSeedFiles(
  environment: string,
  models: ModelInfo[],
  seedsDir: string = "dev-seeds"
): Promise<LoadedSeedFile[]> {
  const environmentDir = getSeedEnvironmentDir(environment, seedsDir);
  if (!fs.existsSync(environmentDir)) {
    return [];
  }

  const modelAliases = buildModelAliasMap(models);
  const seedFiles = fs.readdirSync(environmentDir).filter((entry) => entry.endsWith(".json"));
  const loaded: LoadedSeedFile[] = [];

  for (const fileName of seedFiles) {
    const filePath = path.join(environmentDir, fileName);
    const fileStem = path.basename(fileName, ".json");
    const model = modelAliases.get(normalizeSeedIdentifier(fileStem));

    if (!model) {
      console.warn(`⚠️  Skipping seed file without matching schema: ${filePath}`);
      continue;
    }

    const documents = parseSeedDocuments(fs.readFileSync(filePath, "utf-8"), filePath);
    validateSeedDocuments(documents, filePath);

    loaded.push({
      model,
      containerName: getContainerNameForModel(model),
      documents,
      filePath,
    });
  }

  return loaded;
}

export async function loadAzureBootstrapSeedFiles(
  seedName: string,
  models: ModelInfo[],
  seedsDir: string = "dev-seeds"
): Promise<LoadedSeedFile[]> {
  validateAzureSeedName(seedName);

  const seedsRoot = path.resolve(process.cwd(), seedsDir);
  const environmentDir = path.resolve(seedsRoot, seedName);
  const relativeEnvironmentDir = path.relative(seedsRoot, environmentDir);
  if (relativeEnvironmentDir.startsWith("..") || path.isAbsolute(relativeEnvironmentDir)) {
    throw new Error(`Seed name "${seedName}" resolves outside the configured seeds directory.`);
  }
  if (!fs.existsSync(environmentDir) || !fs.statSync(environmentDir).isDirectory()) {
    throw new Error(`Seed directory "${environmentDir}" does not exist.`);
  }

  const modelAliases = buildModelAliasMap(models);
  const seedFiles = fs.readdirSync(environmentDir).filter((entry) => entry.toLowerCase().endsWith(".json")).sort();
  if (seedFiles.length === 0) {
    throw new Error(`Seed directory "${environmentDir}" contains no JSON files.`);
  }

  const resolvedEnvironmentDir = fs.realpathSync(environmentDir);
  const loaded: LoadedSeedFile[] = [];
  let totalDocuments = 0;
  let totalBytes = 0;

  for (const fileName of seedFiles) {
    const filePath = path.join(environmentDir, fileName);
    const fileStat = fs.lstatSync(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || path.dirname(fs.realpathSync(filePath)) !== resolvedEnvironmentDir) {
      throw new Error(`Seed file "${filePath}" must be a regular file inside its seed directory.`);
    }

    const fileStem = path.basename(fileName, path.extname(fileName));
    const model = modelAliases.get(normalizeSeedIdentifier(fileStem));
    if (!model) {
      throw new Error(`Seed file "${filePath}" does not match a model in shared/models.`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    totalBytes += Buffer.byteLength(content, "utf-8");
    const documents = parseSeedDocuments(content, filePath).map(stripCosmosSystemProperties);
    validateSeedDocuments(documents, filePath);
    validateSeedDocumentsForModel(documents, model, filePath);
    totalDocuments += documents.length;

    loaded.push({
      model,
      containerName: getContainerNameForModel(model),
      documents,
      filePath,
    });
  }

  if (totalDocuments === 0) {
    throw new Error(`Seed directory "${environmentDir}" contains no documents to initialize.`);
  }
  if (totalDocuments > AZURE_SEED_MAX_DOCUMENTS) {
    throw new Error(`Seed contains ${totalDocuments} documents; the Azure bootstrap limit is ${AZURE_SEED_MAX_DOCUMENTS}.`);
  }
  if (totalBytes > AZURE_SEED_MAX_BYTES) {
    throw new Error(`Seed files total ${totalBytes} bytes; the Azure bootstrap limit is ${AZURE_SEED_MAX_BYTES} bytes.`);
  }

  return loaded;
}

export async function applyDevSeedEnvironment({
  client,
  databaseName,
  environment,
  models,
  seedsDir = "dev-seeds",
}: ApplyDevSeedEnvironmentOptions): Promise<boolean> {
  const environmentDir = getSeedEnvironmentDir(environment, seedsDir);
  if (!fs.existsSync(environmentDir)) {
    console.log(`ℹ️  Seed environment "${environment}" not found at ${environmentDir}. Keeping existing Cosmos DB data.`);
    return false;
  }

  const seedFiles = await loadDevSeedFiles(environment, models, seedsDir);
  if (seedFiles.length === 0) {
    console.log(`ℹ️  No seed files found for environment "${environment}". Keeping existing Cosmos DB data.`);
    return false;
  }

  const database = client.database(databaseName);
  console.log(`🧪 Applying Cosmos DB seed data for environment "${environment}"...`);

  for (const seedFile of seedFiles) {
    await recreateContainer(database, seedFile.containerName, seedFile.model.partitionKey);
    const container = database.container(seedFile.containerName);

    for (const document of seedFile.documents) {
      await container.items.create(document);
    }

    console.log(
      `✅ Seeded "${seedFile.containerName}" with ${seedFile.documents.length} item(s) from ${path.basename(seedFile.filePath)}`
    );
  }

  console.log("✅ Cosmos DB seed replacement complete\n");
  return true;
}

export async function generateDevSeedTemplates({
  environment,
  modelsDir = "shared/models",
  seedsDir = "dev-seeds",
  force = false,
}: GenerateDevSeedTemplatesOptions): Promise<void> {
  ensureSwallowKitProject("create-dev-seeds");

  console.log(`🧪 Generating dev seed templates for environment "${environment}"...\n`);
  const models = await loadProjectModels(modelsDir);

  if (models.length === 0) {
    console.log("⚠️  No schemas found under shared/models. Nothing was generated.");
    return;
  }

  const environmentDir = getSeedEnvironmentDir(environment, seedsDir);
  fs.mkdirSync(environmentDir, { recursive: true });

  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const model of models) {
    const filePath = path.join(environmentDir, `${toKebabCase(model.name)}.json`);
    if (!force && fs.existsSync(filePath)) {
      skippedFiles.push(filePath);
      continue;
    }

    const content = JSON.stringify([buildSeedTemplateDocument(model, models)], null, 2) + "\n";
    fs.writeFileSync(filePath, content, "utf-8");
    writtenFiles.push(filePath);
    console.log(`✅ Created: ${filePath}`);
  }

  if (skippedFiles.length > 0) {
    console.log("");
    console.log(`⏭️  Skipped ${skippedFiles.length} existing file(s). Use --force to overwrite them.`);
  }

  console.log("");
  console.log("📝 Next steps:");
  console.log(`  1. Edit JSON files under ${environmentDir}`);
  console.log(`  2. Run 'swallowkit dev --seed-env ${environment}' to replace emulator data before startup`);
}

export function stripCosmosSystemProperties(document: SeedDocument): SeedDocument {
  const sanitized: SeedDocument = {};

  for (const [key, value] of Object.entries(document)) {
    if (!COSMOS_SYSTEM_PROPERTIES.has(key)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function prepareSeedDocumentsForExport(documents: SeedDocument[], filePath: string): SeedDocument[] {
  const preparedDocuments = documents
    .map((document) => stripCosmosSystemProperties(document))
    .sort(compareSeedDocumentsForExport);

  validateSeedDocuments(preparedDocuments, filePath);
  return preparedDocuments;
}

export async function exportDevSeedsFromEmulator({
  environment,
  modelsDir = "shared/models",
  seedsDir = "dev-seeds",
  force = false,
}: GenerateDevSeedTemplatesOptions): Promise<void> {
  ensureSwallowKitProject("create-dev-seeds");

  console.log(`🧪 Exporting dev seeds from local Cosmos DB Emulator for environment "${environment}"...\n`);
  const models = await loadProjectModels(modelsDir);

  if (models.length === 0) {
    console.log("⚠️  No schemas found under shared/models. Nothing was exported.");
    return;
  }

  const connectionInfoResult = resolveLocalCosmosConnectionInfo(getDefaultCosmosDatabaseName());
  if (!connectionInfoResult.ok) {
    throw new Error(buildLocalCosmosConnectionError(connectionInfoResult));
  }

  const { endpoint, key, databaseName, localSettingsPath } = connectionInfoResult.value;
  console.log(`🗄️  Using local Cosmos DB settings from ${localSettingsPath}`);
  console.log(`📦 Export source database: "${databaseName}"\n`);

  const client = new CosmosClient({ endpoint, key });
  const database = client.database(databaseName);

  try {
    await database.read();
  } catch (error: unknown) {
    if (isCosmosNotFoundError(error)) {
      throw new Error(`Cosmos DB database "${databaseName}" was not found in the local emulator.`);
    }

    throw error;
  }

  const environmentDir = getSeedEnvironmentDir(environment, seedsDir);
  fs.mkdirSync(environmentDir, { recursive: true });

  let writtenFiles = 0;
  let skippedFiles = 0;
  let totalDocuments = 0;

  for (const model of models) {
    const containerName = getContainerNameForModel(model);
    const filePath = path.join(environmentDir, `${toKebabCase(model.name)}.json`);

    if (!force && fs.existsSync(filePath)) {
      skippedFiles += 1;
      continue;
    }

    const exported = await readContainerSeedDocuments(database, containerName, filePath);
    fs.writeFileSync(filePath, JSON.stringify(exported.documents, null, 2) + "\n", "utf-8");
    writtenFiles += 1;
    totalDocuments += exported.documents.length;

    const detail = exported.containerExists
      ? `${exported.documents.length} item(s)`
      : "container not found; wrote empty seed";
    console.log(`✅ Exported "${containerName}" to ${filePath} (${detail})`);
  }

  if (skippedFiles > 0) {
    console.log("");
    console.log(`⏭️  Skipped ${skippedFiles} existing file(s). Use --force to overwrite them.`);
  }

  console.log("");
  console.log(`🧾 Export complete: ${writtenFiles} file(s), ${totalDocuments} item(s).`);
  console.log(`📝 Next step: Run 'swallowkit dev --seed-env ${environment}' to replay the exported data.`);
}

export const devSeedsCommand = new Command()
  .name("create-dev-seeds")
  .description("Generate dev seed JSON files from shared/models schemas or export current local Cosmos DB Emulator data")
  .argument("<environment>", "Seed environment name")
  .option("--models-dir <dir>", "Models directory", "shared/models")
  .option("--seeds-dir <dir>", "Dev seeds directory", "dev-seeds")
  .option("--force", "Overwrite existing seed JSON files", false)
  .option("--from-emulator", "Export current data from the local Cosmos DB Emulator instead of generating templates", false)
  .action(async (environment: string, options: { modelsDir?: string; seedsDir?: string; force?: boolean; fromEmulator?: boolean }) => {
    if (options.fromEmulator) {
      await exportDevSeedsFromEmulator({
        environment,
        modelsDir: options.modelsDir,
        seedsDir: options.seedsDir,
        force: options.force,
      });
      return;
    }

    await generateDevSeedTemplates({
      environment,
      modelsDir: options.modelsDir,
      seedsDir: options.seedsDir,
      force: options.force,
    });
  });

function buildSeedTemplateDocumentInternal(
  model: ModelInfo,
  modelLookup: Map<string, ModelInfo>,
  seenModels: Set<string>
): SeedDocument {
  const nextSeen = new Set(seenModels);
  nextSeen.add(model.name);

  const document: SeedDocument = {};

  for (const field of model.fields) {
    document[field.name] = buildTemplateValueForField(model, field, modelLookup, nextSeen);
  }

  return document;
}

function buildTemplateValueForField(
  model: ModelInfo,
  field: FieldInfo,
  modelLookup: Map<string, ModelInfo>,
  seenModels: Set<string>
): unknown {
  if (field.isNestedSchema && field.nestedModelName) {
    const nestedModel = modelLookup.get(field.nestedModelName);
    if (nestedModel) {
      if (seenModels.has(nestedModel.name)) {
        const fallback = { id: `${toKebabCase(nestedModel.name)}-001` };
        return field.isArray ? [fallback] : fallback;
      }

      const nestedDocument = buildSeedTemplateDocumentInternal(nestedModel, modelLookup, seenModels);
      return field.isArray ? [nestedDocument] : nestedDocument;
    }
  }

  if (field.isArray) {
    return [buildScalarTemplateValue(model, field)];
  }

  return buildScalarTemplateValue(model, field);
}

function buildScalarTemplateValue(model: ModelInfo, field: FieldInfo): unknown {
  if (field.name === "id") {
    return `${toKebabCase(model.name)}-001`;
  }

  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues[0];
  }

  if (field.type === "number") {
    return 0;
  }

  if (field.type === "boolean") {
    return false;
  }

  if (field.type === "date" || field.name.endsWith("At")) {
    return "2026-01-01T00:00:00.000Z";
  }

  if (field.type === "object") {
    return {};
  }

  return `${toKebabCase(model.name)}-${toKebabCase(field.name)}-sample`;
}

function buildModelAliasMap(models: ModelInfo[]): Map<string, ModelInfo> {
  const aliases = new Map<string, ModelInfo>();

  for (const model of models) {
    const candidates = [
      model.name,
      model.schemaName,
      toKebabCase(model.name),
      path.basename(model.filePath, path.extname(model.filePath)),
    ];

    for (const candidate of candidates) {
      const normalized = normalizeSeedIdentifier(candidate);
      if (!aliases.has(normalized)) {
        aliases.set(normalized, model);
      }
    }
  }

  return aliases;
}

function isSeedDocument(value: unknown): value is SeedDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSeedDocuments(documents: SeedDocument[], filePath: string): void {
  const ids = new Set<string>();

  documents.forEach((document, index) => {
    if (typeof document.id !== "string" || document.id.trim().length === 0) {
      throw new Error(`${filePath} item at index ${index} must contain a non-empty string id.`);
    }

    if (ids.has(document.id)) {
      throw new Error(`${filePath} contains duplicate id "${document.id}".`);
    }

    ids.add(document.id);
  });
}

function validateSeedDocumentsForModel(documents: SeedDocument[], model: ModelInfo, filePath: string): void {
  const partitionKeyField = model.partitionKey.replace(/^\//, "");
  if (!partitionKeyField || partitionKeyField.includes("/")) {
    throw new Error(`${filePath} uses unsupported partition key path "${model.partitionKey}".`);
  }

  documents.forEach((document, index) => {
    if (!Object.prototype.hasOwnProperty.call(document, partitionKeyField) || document[partitionKeyField] === null) {
      throw new Error(`${filePath} item at index ${index} must contain partition key "${partitionKeyField}".`);
    }

    for (const field of model.fields) {
      if (!Object.prototype.hasOwnProperty.call(document, field.name)) {
        if (!field.isOptional && !field.isNullable) {
          throw new Error(`${filePath} item at index ${index} is missing required field "${field.name}" for model ${model.name}.`);
        }
        continue;
      }

      validateSeedFieldValue(document[field.name], field, `${filePath} item at index ${index} field "${field.name}"`);
    }
  });
}

function validateSeedFieldValue(value: unknown, field: FieldInfo, location: string): void {
  if (value === null) {
    if (!field.isNullable) {
      throw new Error(`${location} must not be null.`);
    }
    return;
  }

  if (field.isArray) {
    if (!Array.isArray(value)) {
      throw new Error(`${location} must be an array.`);
    }
    if (field.constraints?.minItems !== undefined && value.length < field.constraints.minItems) {
      throw new Error(`${location} must contain at least ${field.constraints.minItems} item(s).`);
    }
    if (field.constraints?.maxItems !== undefined && value.length > field.constraints.maxItems) {
      throw new Error(`${location} must contain at most ${field.constraints.maxItems} item(s).`);
    }
    const itemField = { ...field, isArray: false };
    value.forEach((item, index) => validateSeedFieldValue(item, itemField, `${location}[${index}]`));
    return;
  }

  switch (field.type) {
    case "string":
    case "date":
      if (typeof value !== "string") {
        throw new Error(`${location} must be a string.`);
      }
      if (field.type === "date" && Number.isNaN(Date.parse(value))) {
        throw new Error(`${location} must be a valid date string.`);
      }
      if (field.constraints?.minLength !== undefined && value.length < field.constraints.minLength) {
        throw new Error(`${location} must be at least ${field.constraints.minLength} characters.`);
      }
      if (field.constraints?.maxLength !== undefined && value.length > field.constraints.maxLength) {
        throw new Error(`${location} must be at most ${field.constraints.maxLength} characters.`);
      }
      if (field.constraints?.pattern && !new RegExp(field.constraints.pattern, field.constraints.patternFlags).test(value)) {
        throw new Error(`${location} does not match the model pattern.`);
      }
      if (field.enumValues && !field.enumValues.includes(value)) {
        throw new Error(`${location} must match one of the model's allowed values.`);
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${location} must be a finite number.`);
      }
      if (field.isInteger && !Number.isInteger(value)) {
        throw new Error(`${location} must be an integer.`);
      }
      if (field.constraints?.minimum !== undefined && (field.constraints.exclusiveMinimum ? value <= field.constraints.minimum : value < field.constraints.minimum)) {
        throw new Error(`${location} is below the model's minimum.`);
      }
      if (field.constraints?.maximum !== undefined && (field.constraints.exclusiveMaximum ? value >= field.constraints.maximum : value > field.constraints.maximum)) {
        throw new Error(`${location} is above the model's maximum.`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`${location} must be a boolean.`);
      }
      return;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${location} must be an object.`);
      }
      if (field.objectFields) {
        for (const nestedField of field.objectFields) {
          const nestedValue = (value as Record<string, unknown>)[nestedField.name];
          if (!Object.prototype.hasOwnProperty.call(value, nestedField.name)) {
            if (!nestedField.isOptional && !nestedField.isNullable) {
              throw new Error(`${location} is missing required field "${nestedField.name}".`);
            }
            continue;
          }
          validateSeedFieldValue(nestedValue, nestedField, `${location}.${nestedField.name}`);
        }
      }
      return;
    default:
      return;
  }
}

function compareSeedDocumentsForExport(left: SeedDocument, right: SeedDocument): number {
  const leftId = typeof left.id === "string" ? left.id : "";
  const rightId = typeof right.id === "string" ? right.id : "";

  if (leftId.length === 0 && rightId.length === 0) {
    return 0;
  }

  if (leftId.length === 0) {
    return 1;
  }

  if (rightId.length === 0) {
    return -1;
  }

  return leftId.localeCompare(rightId);
}

function buildLocalCosmosConnectionError(
  result: Exclude<ResolveLocalCosmosConnectionResult, { ok: true; value: LocalCosmosConnectionInfo }>
): string {
  switch (result.reason) {
    case "missing-local-settings":
      return `local.settings.json not found at ${result.localSettingsPath}. Start from a SwallowKit app with Azure Functions configured.`;
    case "missing-connection-string":
      return `CosmosDBConnection not found in ${result.localSettingsPath}.`;
    case "invalid-connection-string":
      return `Invalid CosmosDBConnection format in ${result.localSettingsPath}.`;
  }

  throw new Error(`Unhandled local Cosmos connection error: ${JSON.stringify(result)}`);
}

async function readContainerSeedDocuments(
  database: Database,
  containerName: string,
  filePath: string
): Promise<ExportedContainerDocuments> {
  const container = database.container(containerName);

  try {
    await container.read();
  } catch (error: unknown) {
    if (isCosmosNotFoundError(error)) {
      return { documents: [], containerExists: false };
    }

    throw error;
  }

  const { resources } = await container.items.query<SeedDocument>("SELECT * FROM c").fetchAll();
  return {
    documents: prepareSeedDocumentsForExport(resources, filePath),
    containerExists: true,
  };
}

function isCosmosNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 404;
}

async function recreateContainer(database: Database, containerName: string, partitionKeyPath: string = '/id'): Promise<void> {
  try {
    await database.container(containerName).delete();
  } catch (error: any) {
    if (error?.code !== 404) {
      throw error;
    }
  }

  try {
    await database.containers.createIfNotExists({
      id: containerName,
      partitionKey: {
        paths: [partitionKeyPath],
        kind: PartitionKeyKind.Hash,
        version: 2,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`⚠️  Failed to recreate "${containerName}" with full partition key definition: ${message}`);
    console.log("🔄 Retrying with simple partition key...");
    await database.containers.createIfNotExists({
      id: containerName,
      partitionKey: {
        paths: [partitionKeyPath],
      },
    });
  }
}
