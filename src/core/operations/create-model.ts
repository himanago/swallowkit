import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { ensureSwallowKitProject, loadConfig } from "../config";
import { getAllModels, parseModelFile, toPascalCase } from "../scaffold/model-parser";
import { syncProjectManifest } from "../project/manifest";
import { recordSessionOperations } from "../project/artifacts";
import { FileOperationSession, getActiveFileSession } from "./file-session";
import { generateModelContainerMigration } from "./migration-generator";

const CREATE_MODEL_GENERATOR = "create-model";

export interface CreateModelOperationOptions {
  names: string[];
  modelsDir?: string;
  connector?: string;
  overwriteMode?: "prompt" | "always" | "never";
  confirmOverwrite?: (filePath: string) => Promise<boolean>;
}

export interface CreateModelOperationResult {
  createdFiles: string[];
  skippedFiles: string[];
  updatedIndex: boolean;
  infrastructureFiles: string[];
  connectorType?: "rdb" | "api";
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

export function updateSharedIndex(
  modelPath: string,
  schemaName: string,
  session: FileOperationSession,
  sourceModel?: string
): boolean {
  const indexPath = path.join(process.cwd(), "shared", "index.ts");
  session.registerInput(indexPath);
  const content = session.fileExists(indexPath) ? session.readFile(indexPath) : "";
  const modulePath = `./${path.relative(path.dirname(indexPath), modelPath).replace(/\\/g, "/").replace(/\.ts$/, "")}`;
  const source = ts.createSourceFile(indexPath, content, ts.ScriptTarget.Latest, true);
  // Text edits that turn a type-only re-export of this schema into nothing (a value export of the same
  // name also exports its type); keeping both would be a duplicate-identifier error.
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let hasValueExport = false;
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const exportedPath = statement.moduleSpecifier.text.replace(/\.(ts|js)$/, "");
    if (exportedPath !== modulePath) continue;
    if (!statement.exportClause) {
      if (!statement.isTypeOnly) hasValueExport = true;
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const elements = statement.exportClause.elements;
    const matches = elements.filter((element) =>
      element.name.text === schemaName && (element.propertyName?.text ?? element.name.text) === schemaName);
    for (const element of matches) {
      if (!statement.isTypeOnly && !element.isTypeOnly) {
        hasValueExport = true;
      } else if (!statement.isTypeOnly) {
        // export { type Todo } -> export { Todo }
        edits.push({ start: element.getStart(source), end: element.getEnd(), text: schemaName });
        hasValueExport = true;
      } else if (elements.length === 1) {
        let end = statement.getEnd();
        if (content.slice(end, end + 2) === "\r\n") end += 2;
        else if (content[end] === "\n") end += 1;
        edits.push({ start: statement.getStart(source), end, text: "" });
      } else {
        const index = elements.indexOf(element);
        const start = index === 0 ? element.getStart(source) : elements[index - 1].getEnd();
        const end = index === 0 ? elements[index + 1].getStart(source) : element.getEnd();
        edits.push({ start, end, text: "" });
      }
    }
  }
  let updated = content;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    updated = `${updated.slice(0, edit.start)}${edit.text}${updated.slice(edit.end)}`;
  }
  if (hasValueExport && updated === content) return false;
  if (!hasValueExport) {
    const exportLine = `export { ${schemaName} } from '${modulePath}';`;
    updated = `${updated}${updated && !updated.endsWith("\n") ? "\n" : ""}${exportLine}\n`;
  }
  session.writeFile(indexPath, updated, {
    ownership: "extension-point",
    generator: CREATE_MODEL_GENERATOR,
    sourceModel,
  });
  return true;
}

export async function createModelOperation(options: CreateModelOperationOptions): Promise<CreateModelOperationResult> {
  ensureSwallowKitProject("create-model");

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

  const activeSession = getActiveFileSession();
  // jest 等の環境で path.resolve の内部 cwd キャッシュが process.chdir と食い違うことが
  // あるため、cwd を明示的に固定して絶対パスを組み立てる。
  const projectRoot = process.cwd();
  const session = new FileOperationSession("collect", projectRoot, activeSession?.generatedAt);
  const resolveFromRoot = (relativePath: string) =>
    path.isAbsolute(relativePath) ? relativePath : path.join(projectRoot, relativePath);

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];
  const infrastructureFiles: string[] = [];
  const generatedModels: Array<Awaited<ReturnType<typeof parseModelFile>>> = [];
  let updatedIndex = false;

  const existingModels = await getAllModels(modelsDir);

  for (const name of options.names) {
    const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const filePath = path.join(modelsDir, `${kebabName}.ts`);
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
    const temporaryDirectory = fs.mkdtempSync(path.join(projectRoot, ".swallowkit-create-model-"));
    let modelInfo: Awaited<ReturnType<typeof parseModelFile>>;
    try {
      const temporaryModelPath = path.join(temporaryDirectory, path.basename(filePath));
      fs.writeFileSync(temporaryModelPath, content, "utf-8");
      modelInfo = await parseModelFile(temporaryModelPath);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    modelInfo.filePath = resolveFromRoot(filePath);

    session.writeFile(resolveFromRoot(filePath), content, {
      ownership: "user-owned",
      generator: CREATE_MODEL_GENERATOR,
      sourceModel: modelInfo.name,
    });
    generatedModels.push(modelInfo);
    createdFiles.push(filePath.replace(/\\/g, "/"));

    if (updateSharedIndex(resolveFromRoot(filePath), modelInfo.schemaName, session, modelInfo.name)) {
      updatedIndex = true;
    }
    if (!modelInfo.connectorConfig) {
      generateModelContainerMigration(modelInfo, session);
      infrastructureFiles.push(
        ...session.operations
          .filter((operation) => operation.sourceModel === modelInfo.name && operation.path.startsWith("infra/") && operation.action !== "skip")
          .map((operation) => operation.path)
      );
    }
  }

  const targetSession = new FileOperationSession("collect", projectRoot, activeSession?.generatedAt);
  session.applyTo(targetSession);

  for (const modelInfo of generatedModels) {
    recordSessionOperations(
      targetSession.operations.filter((operation) => operation.sourceModel === modelInfo.name),
      { schemaHash: modelInfo.semanticFingerprint, sourceModel: modelInfo.name },
      projectRoot,
      targetSession
    );
  }
  const replacedModelPaths = new Set(generatedModels.map((modelInfo) => path.resolve(modelInfo.filePath)));
  const manifestModels = [
    ...existingModels.filter((modelInfo) => !replacedModelPaths.has(path.resolve(modelInfo.filePath))),
    ...generatedModels,
  ];
  await syncProjectManifest(projectRoot, manifestModels, targetSession);
  if (activeSession) {
    targetSession.applyTo(activeSession);
  } else {
    const commitSession = new FileOperationSession("commit", projectRoot, targetSession.generatedAt);
    targetSession.applyTo(commitSession);
  }

  return {
    createdFiles,
    skippedFiles,
    updatedIndex,
    infrastructureFiles: [...new Set(infrastructureFiles)].sort(),
    ...(connectorType ? { connectorType } : {}),
  };
}
