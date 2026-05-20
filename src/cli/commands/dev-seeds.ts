import { Command } from "commander";
import { CosmosClient, Database, PartitionKeyKind } from "@azure/cosmos";
import * as fs from "fs";
import * as path from "path";
import { ensureSwallowKitProject } from "../../core/config";
import { FieldInfo, ModelInfo, getAllModels, toKebabCase } from "../../core/scaffold/model-parser";

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

interface LoadedSeedFile {
  model: ModelInfo;
  containerName: string;
  documents: SeedDocument[];
  filePath: string;
}

export interface LocalCosmosConnectionInfo {
  endpoint: string;
  key: string;
  databaseName: string;
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
  functionsDir: string = path.join(process.cwd(), "functions")
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

  return {
    ok: true,
    value: {
      ...parsedConnection,
      databaseName: localSettings.Values?.COSMOS_DB_DATABASE_NAME || defaultDatabaseName,
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
