import * as path from "path";
import { ensureSwallowKitProject, loadConfig } from "../config";
import { getAllModels, getModelDependencyPaths, parseModelFile, toPascalCase } from "../scaffold/model-parser";
import { buildProjectManifest, SWALLOWKIT_MANIFEST_PATH } from "../project/manifest";
import { recordSessionOperations } from "../project/artifacts";
import { FileOperationSession, getActiveFileSession } from "./file-session";
import { generateModelContainerMigration } from "./migration-generator";
import { MachineCommandError } from "../../machine/errors";

const CREATE_MODEL_GENERATOR = "create-model";

export interface CreateModelOperationOptions {
  names: string[];
  modelsDir?: string;
  connector?: string;
  overwriteMode?: "prompt" | "always" | "never";
  confirmOverwrite?: (filePath: string) => Promise<boolean>;
  dryRun?: boolean;
}

export interface CreateModelOperationResult {
  createdFiles: string[];
  skippedFiles: string[];
  updatedIndex: boolean;
  connectorType?: "rdb" | "api";
  infrastructureFiles: string[];
  dryRun: boolean;
  operations: Array<{ path: string; action: string; ownership: string }>;
}

function generateModelTemplate(modelName: string): string {
  const pascalName = toPascalCase(modelName);

  return `import { z } from 'zod/v4';

// ${pascalName} model (Zod official pattern: same name for value and type)
export const ${pascalName} = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${pascalName} = z.infer<typeof ${pascalName}>;

// Display name for UI
export const displayName = '${pascalName}';
`;
}

function generateConnectorModelTemplate(modelName: string, connectorName: string, connectorType: "rdb" | "api"): string {
  const pascalName = toPascalCase(modelName);
  const kebabName = modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const pluralName = kebabName.endsWith("s") ? kebabName : `${kebabName}s`;

  const schema = `import { z } from 'zod/v4';

// ${pascalName} model (Zod official pattern: same name for value and type)
export const ${pascalName} = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${pascalName} = z.infer<typeof ${pascalName}>;

// Display name for UI
export const displayName = '${pascalName}';
`;

  if (connectorType === "rdb") {
    return `${schema}
// SwallowKit Connector Metadata
export const connectorConfig = {
  connector: '${connectorName}',
  operations: ['getAll', 'getById'] as const,
  table: '${pluralName}',
  idColumn: 'id',
};
`;
  }

  return `${schema}
// SwallowKit Connector Metadata
export const connectorConfig = {
  connector: '${connectorName}',
  operations: ['getAll', 'getById', 'create', 'update'] as const,
  endpoints: {
    getAll: 'GET /${pluralName}',
    getById: 'GET /${pluralName}/{id}',
    create: 'POST /${pluralName}',
    update: 'PATCH /${pluralName}/{id}',
  },
};
`;
}

function updateSharedIndex(kebabName: string, pascalName: string, session: FileOperationSession): boolean {
  const indexPath = path.join(process.cwd(), "shared", "index.ts");

  if (!session.fileExists(indexPath)) {
    return false;
  }

  const content = session.readFile(indexPath);
  const exportLine = `export { ${pascalName} } from './models/${kebabName}';`;

  if (content.includes(exportLine)) {
    return false;
  }

  session.writeFile(indexPath, `${content}${exportLine}\n`, {
    ownership: "extension-point",
    generator: CREATE_MODEL_GENERATOR,
  });
  return true;
}

export async function createModelOperation(options: CreateModelOperationOptions): Promise<CreateModelOperationResult> {
  ensureSwallowKitProject("create-model");
  for (const name of options.names) {
    if (!/^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*$/.test(name)) {
      throw new MachineCommandError("invalid-model-name", `Invalid model name: ${name}. Use letters, numbers, hyphens or underscores.`, { name }, "blocked");
    }
  }

  let connectorType: "rdb" | "api" | undefined;
  if (options.connector) {
    const config = loadConfig();
    const connectorDefinition = config.connectors?.[options.connector];
    if (!connectorDefinition) {
      throw new Error(
        `Connector '${options.connector}' not found in swallowkit.config.js. ` +
          `Run 'swallowkit add-connector ${options.connector} --type=<rdb|api>' first.`
      );
    }

    connectorType = connectorDefinition.type;
  }

  const modelsDir = options.modelsDir || "shared/models";

  const targetSession = options.dryRun ? new FileOperationSession("collect") :
    getActiveFileSession() ?? new FileOperationSession("commit");
  const session = new FileOperationSession("collect", targetSession.rootDirectory);
  // jest 等の環境で path.resolve の内部 cwd キャッシュが process.chdir と食い違うことが
  // あるため、cwd を明示的に固定して絶対パスを組み立てる。
  const projectRoot = process.cwd();
  const resolveFromRoot = (relativePath: string) =>
    path.isAbsolute(relativePath) ? relativePath : path.join(projectRoot, relativePath);

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];
  const infrastructureFiles: string[] = [];
  let updatedIndex = false;
  const models = await getAllModels(modelsDir);
  for (const model of models) {
    for (const dependency of getModelDependencyPaths(model.filePath)) session.registerInput(dependency);
  }

  for (const name of options.names) {
    const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const filePath = path.join(modelsDir, `${kebabName}.ts`);
    const pascalName = toPascalCase(name);

    if (session.fileExists(resolveFromRoot(filePath))) {
      const overwriteMode = options.overwriteMode || "prompt";
      const shouldOverwrite = overwriteMode === "always"
        ? true
        : overwriteMode === "never"
          ? false
          : options.confirmOverwrite
            ? await options.confirmOverwrite(filePath)
            : false;

      if (!shouldOverwrite) {
        skippedFiles.push(filePath.replace(/\\/g, "/"));
        continue;
      }
    }

    const content = options.connector && connectorType
      ? generateConnectorModelTemplate(name, options.connector, connectorType)
      : generateModelTemplate(name);
    const model = await parseModelFile(resolveFromRoot(filePath), { sourceContent: content });
    if (!model.connectorConfig) {
      const migration = generateModelContainerMigration(model, session);
      if (migration) infrastructureFiles.push(migration.template);
    }
    session.writeFile(resolveFromRoot(filePath), content, {
      ownership: "user-owned",
      generator: CREATE_MODEL_GENERATOR,
      sourceModel: pascalName,
    });
    createdFiles.push(filePath.replace(/\\/g, "/"));
    const existingIndex = models.findIndex(existing => existing.filePath === model.filePath);
    if (existingIndex < 0) models.push(model);
    else models[existingIndex] = model;

    if (updateSharedIndex(kebabName, pascalName, session)) {
      updatedIndex = true;
    }
  }

  if (createdFiles.length > 0) {
    const { manifest } = await buildProjectManifest(projectRoot, models);
    session.writeFile(path.join(projectRoot, SWALLOWKIT_MANIFEST_PATH), JSON.stringify(manifest, null, 2) + "\n", {
      ownership: "metadata", generator: CREATE_MODEL_GENERATOR,
    });
    recordSessionOperations(session.operations, {}, projectRoot, session);
  }
  session.replayInto(targetSession);

  return {
    createdFiles,
    skippedFiles,
    updatedIndex,
    infrastructureFiles,
    dryRun: options.dryRun ?? false,
    operations: session.operations.map(({ path: file, action, ownership }) => ({ path: file, action, ownership })),
    ...(connectorType ? { connectorType } : {}),
  };
}
