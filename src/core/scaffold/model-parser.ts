/**
 * Zod モデルファイルを解析して、スキーマ情報を抽出する
 */

import * as fs from "fs";
import { execFileSync, ExecFileSyncOptionsWithStringEncoding } from "child_process";
import * as path from "path";
import * as ts from "typescript";

import { ModelConnectorConfig, ModelAuthPolicy } from "../../types";
import { MachineCommandError } from "../../machine/errors";
import { hashContent } from "../operations/file-session";
import { loadArtifactLedger } from "../project/artifacts";

export type SchemaParserMode = "static-ast" | "dynamic";

export interface ModelParserOptions {
  executeNode?: (file: string, args: readonly string[], options: ExecFileSyncOptionsWithStringEncoding) => string;
  sourceContent?: string;
}

export interface ModelInfo {
  name: string; // モデル名（例: "Todo"）
  displayName: string; // 表示名（例: "Todo" または "タスク"）
  schemaName: string; // スキーマ変数名（例: "todoSchema"）
  filePath: string; // モデルファイルの絶対パス
  fields: FieldInfo[]; // フィールド情報
  hasId: boolean; // id フィールドがあるか
  hasCreatedAt: boolean; // createdAt フィールドがあるか
  hasUpdatedAt: boolean; // updatedAt フィールドがあるか
  nestedSchemaRefs: NestedSchemaRef[]; // ネストしたスキーマ参照
  connectorConfig?: ModelConnectorConfig; // コネクタメタデータ（外部データソース用）
  authPolicy?: ModelAuthPolicy; // 認可ポリシー（ロールベースアクセス制御用）
  partitionKey: string; // Cosmos DB パーティションキーパス（デフォルト: "/id"）
  parserMode: SchemaParserMode;
  parserWarnings: string[];
  semanticFingerprint: string;
}

export interface FieldInfo {
  name: string;
  type: string; // "string" | "number" | "boolean" | "date" | "object" | "array"
  isOptional: boolean;
  isNullable?: boolean;
  isArray: boolean;
  enumValues?: string[]; // enum の場合の選択肢
  isForeignKey?: boolean; // 外部キーかどうか
  referencedModel?: string; // 参照先のモデル名（例: "Category"）
  isNestedSchema?: boolean; // ネストしたスキーマ参照かどうか
  nestedSchemaName?: string; // 参照先のスキーマ名（例: "categorySchema"）
  nestedModelName?: string; // 参照先のモデル名（例: "Category"）
  nestedDisplayField?: string; // 参照先の表示フィールド（例: "name"）
}

export function getManagedFieldMask(model: Pick<ModelInfo, "fields">): string {
  const keys = ["id", "createdAt", "updatedAt"].filter(name => model.fields.some(field => field.name === name));
  return `{ ${keys.map(key => `${key}: true`).join(", ")} }`;
}

function resolveSchemaDependencyPath(modelPath: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(modelPath), specifier);
  return [base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts"), base]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

export function getModelDependencyPaths(modelPath: string): string[] {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    const absolute = path.resolve(file);
    if (visited.has(absolute)) return;
    visited.add(absolute);
    const source = ts.createSourceFile(absolute, fs.readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
          !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !statement.moduleSpecifier.text.startsWith(".")) continue;
      const dependency = resolveSchemaDependencyPath(absolute, statement.moduleSpecifier.text);
      if (!dependency) {
        throw new MachineCommandError("schema-dependency-not-found", `Cannot resolve ${statement.moduleSpecifier.text} from ${absolute}.`,
          { filePath: absolute, specifier: statement.moduleSpecifier.text }, "blocked");
      }
      visit(dependency);
    }
  };
  visit(modelPath);
  return [...visited].sort();
}

/**
 * ネストしたスキーマ参照の情報
 */
export interface NestedSchemaRef {
  fieldName: string; // フィールド名（例: "category"）
  schemaName: string; // スキーマ変数名（例: "categorySchema"）
  modelName: string; // モデル名（例: "Category"）
  importPath: string; // インポートパス（例: "./category"）
  isArray: boolean; // 配列参照か
  isOptional: boolean; // オプショナルか
  displayField: string; // 表示用フィールド（例: "name"）
}

/**
 * モデルファイルを解析して ModelInfo を返す
 */
export async function parseModelFile(modelPath: string, options: ModelParserOptions = {}): Promise<ModelInfo> {
  if (options.sourceContent === undefined && !fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const content = options.sourceContent ?? fs.readFileSync(modelPath, "utf-8");
  const fileName = path.basename(modelPath, ".ts");
  
  // モデル名を推定（ファイル名を PascalCase に変換）
  const modelName = toPascalCase(fileName);
  
  const schemaName = resolveModelSchemaExport(modelPath, content);
  
  // displayName を抽出（例: export const displayName = 'Task'）
  const displayNameMatch = content.match(/export\s+const\s+displayName\s*=\s*['"]([^'"]+)['"]/);  
  const displayName = displayNameMatch ? displayNameMatch[1] : modelName;

  // connectorConfig を抽出（外部データソース用メタデータ）
  const connectorConfig = parseConnectorConfig(content);

  // authPolicy を抽出（ロールベースアクセス制御用メタデータ）
  const authPolicy = parseAuthPolicy(content);

  // partitionKey を抽出（Cosmos DB パーティションキー）
  const partitionKey = parsePartitionKey(content);
  
  // ネストしたスキーマ参照を検出
  const nestedSchemaRefs = detectNestedSchemaRefs(modelPath, content, schemaName);
  
  // フィールド情報を抽出（動的インポートを使用）
  const parsedSchema = await extractFieldsFromSchema(modelPath, schemaName, options.executeNode ?? execFileSync, content);
  const fields = parsedSchema.fields;
  
  // ネストスキーマ情報をフィールドにマージ
  mergeNestedSchemaInfo(fields, nestedSchemaRefs);
  
  // id フィールドの存在確認
  const hasId = fields.some(f => f.name === "id");
  const hasCreatedAt = fields.some(f => f.name === "createdAt");
  const hasUpdatedAt = fields.some(f => f.name === "updatedAt");

  // パーティションキーのバリデーション
  if (partitionKey !== '/id') {
    if (!partitionKey.startsWith('/')) {
      console.warn(`⚠️  [${modelName}] partitionKey should start with '/': got '${partitionKey}'`);
    }
    const pkField = partitionKey.startsWith('/') ? partitionKey.slice(1) : partitionKey;
    if (fields.length > 0 && !fields.some(f => f.name === pkField)) {
      console.warn(`⚠️  [${modelName}] partitionKey field '${pkField}' not found in schema fields`);
    }
  }

  function resolveModelSchemaExport(modelPath: string, content: string): string {
    const source = ts.createSourceFile(modelPath, content, ts.ScriptTarget.Latest, true);
    const declarations = new Map<string, ts.Expression>();
    const exports: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        declarations.set(declaration.name.text, declaration.initializer);
        if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
          exports.push(declaration.name.text);
        }
      }
    }
    const isObjectSchema = (expression: ts.Expression, seen = new Set<string>()): boolean => {
      if (ts.isIdentifier(expression)) {
        if (seen.has(expression.text)) return false;
        seen.add(expression.text);
        const value = declarations.get(expression.text);
        return value ? isObjectSchema(value, seen) : false;
      }
      if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) return isObjectSchema(expression.expression, seen);
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
      const receiver = expression.expression.expression;
      return ts.isIdentifier(receiver) && receiver.text === "z"
        ? expression.expression.name.text === "object"
        : isObjectSchema(receiver, seen);
    };
    const modelName = toPascalCase(path.basename(modelPath, ".ts"));
    const candidates = exports.filter(name => isObjectSchema(declarations.get(name)!));
    const preferred = [modelName, `${toCamelCase(modelName)}Schema`].find(name => candidates.includes(name));
    if (preferred) return preferred;
    if (candidates.length === 1) return candidates[0];
    throw new MachineCommandError(
      candidates.length ? "schema-selection-ambiguous" : "schema-export-not-found",
      `Cannot select a unique exported object schema in ${modelPath}. Use ${modelName} or ${toCamelCase(modelName)}Schema.`,
      { modelPath, filePath: modelPath, candidates, expectedExports: [modelName, `${toCamelCase(modelName)}Schema`] },
      "blocked"
    );
  }

  const modelInfo: ModelInfo = {
    name: modelName,
    displayName,
    schemaName,
    filePath: modelPath,
    fields,
    hasId,
    hasCreatedAt,
    hasUpdatedAt,
    nestedSchemaRefs,
    partitionKey,
    ...(connectorConfig ? { connectorConfig } : {}),
    ...(authPolicy ? { authPolicy } : {}),
    parserMode: parsedSchema.mode,
    parserWarnings: parsedSchema.warnings,
    semanticFingerprint: "",
  };
  modelInfo.semanticFingerprint = createModelSemanticFingerprint(modelInfo);
  return modelInfo;
}

export function createModelSemanticFingerprint(model: Omit<ModelInfo, "semanticFingerprint" | "filePath">): string {
  return hashContent(JSON.stringify({
    name: model.name,
    displayName: model.displayName,
    schemaName: model.schemaName,
    fields: model.fields,
    nestedSchemaRefs: model.nestedSchemaRefs,
    partitionKey: model.partitionKey,
    connectorConfig: model.connectorConfig,
    authPolicy: model.authPolicy,
  }));
}

/**
 * import文とフィールド定義を解析し、ネストしたスキーマ参照を検出
 */
function detectNestedSchemaRefs(
  modelPath: string,
  content: string,
  schemaName: string
): NestedSchemaRef[] {
  const refs: NestedSchemaRef[] = [];
  
  // 1. import文を解析して外部スキーマ変数を収集
  //    パターン: import { categorySchema } from './category'
  //             import { tagSchema, Tag } from './tag'
  const importMap = new Map<string, string>(); // schemaVarName -> importPath
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let importMatch;
  while ((importMatch = importRegex.exec(content)) !== null) {
    const imports = importMatch[1].split(',').map(s => s.trim());
    const importPath = importMatch[2];
    for (const imp of imports) {
      // 'as' エイリアスに対応
      const name = imp.split(/\s+as\s+/).pop()!.trim();
      if (name.endsWith('Schema')) {
        importMap.set(name, importPath);
      } else {
        // Zod公式パターン: インポート先ファイルで z.object として定義されているか確認
        const dir = path.dirname(modelPath);
        let targetPath = path.resolve(dir, importPath);
        if (!targetPath.endsWith('.ts') && !targetPath.endsWith('.js')) {
          targetPath += '.ts';
        }
        if (fs.existsSync(targetPath)) {
          const targetContent = fs.readFileSync(targetPath, 'utf-8');
          const isZodSchema = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*z\\.object\\s*\\(`).test(targetContent);
          if (isZodSchema) {
            importMap.set(name, importPath);
          }
        }
      }
    }
  }
  
  if (importMap.size === 0) {
    return refs;
  }
  
  // 2. z.object({ ... }) の中身を取得
  const objectContent = extractObjectContent(content, schemaName);
  if (!objectContent) {
    return refs;
  }
  
  // 3. 各フィールドでインポートしたスキーマ変数が使われているか検出
  for (const [schemaVarName, importPath] of importMap) {
    // スキーマ名からモデル名を推定: categorySchema -> Category
    const modelName = schemaVarName.replace(/Schema$/, '');
    const pascalModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
    
    // フィールド定義内でこのスキーマが使われているパターンを検出
    // パターン1: fieldName: schemaVarName
    // パターン2: fieldName: schemaVarName.optional()
    // パターン3: fieldName: z.array(schemaVarName)
    // パターン4: fieldName: z.array(schemaVarName).optional()
    const patterns = [
      // 単一オブジェクト参照
      new RegExp(`(\\w+)\\s*:\\s*${schemaVarName}(?:\\.optional\\(\\))?`, 'g'),
      // 配列参照
      new RegExp(`(\\w+)\\s*:\\s*z\\.array\\(\\s*${schemaVarName}\\s*\\)(?:\\.optional\\(\\))?`, 'g'),
    ];
    
    for (let patIdx = 0; patIdx < patterns.length; patIdx++) {
      const pattern = patterns[patIdx];
      let fieldMatch;
      while ((fieldMatch = pattern.exec(objectContent)) !== null) {
        const fieldName = fieldMatch[1];
        const fullMatch = fieldMatch[0];
        const isArray = patIdx === 1;
        const isOptional = fullMatch.includes('.optional()');
        
        // 参照先スキーマの表示用フィールドを推定
        const displayField = detectDisplayField(modelPath, importPath);
        
        refs.push({
          fieldName,
          schemaName: schemaVarName,
          modelName: pascalModelName,
          importPath,
          isArray,
          isOptional,
          displayField,
        });
      }
    }
  }
  
  return refs;
}

/**
 * z.object({ ... }) の内容部分を抽出
 */
function extractObjectContent(content: string, schemaName: string): string | null {
  const objectRegex = new RegExp(`${schemaName}\\s*=\\s*z\\.object\\(\\{`, "s");
  const objectStart = content.search(objectRegex);
  
  if (objectStart === -1) {
    return null;
  }
  
  const braceStart = content.indexOf('{', objectStart);
  let braceCount = 1;
  let objectEnd = braceStart + 1;
  
  while (braceCount > 0 && objectEnd < content.length) {
    if (content[objectEnd] === '{') braceCount++;
    if (content[objectEnd] === '}') braceCount--;
    objectEnd++;
  }
  
  return content.substring(braceStart + 1, objectEnd - 1);
}

/**
 * 参照先スキーマファイルから主要な表示フィールドを推定
 */
function detectDisplayField(currentModelPath: string, importPath: string): string {
  try {
    const dir = path.dirname(currentModelPath);
    let targetPath = path.resolve(dir, importPath);
    
    // .ts 拡張子を補完
    if (!targetPath.endsWith('.ts')) {
      targetPath += '.ts';
    }
    
    if (!fs.existsSync(targetPath)) {
      return 'name';
    }
    
    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    
    // 'name' フィールドがあれば最優先
    if (/\bname\s*:\s*z\./.test(targetContent)) {
      return 'name';
    }
    // 'title' フィールドがあれば次点
    if (/\btitle\s*:\s*z\./.test(targetContent)) {
      return 'title';
    }
    // 'label' フィールドがあれば
    if (/\blabel\s*:\s*z\./.test(targetContent)) {
      return 'label';
    }
    
    return 'name';
  } catch {
    return 'name';
  }
}

/**
 * ネストスキーマ情報をフィールド情報にマージ
 */
function mergeNestedSchemaInfo(fields: FieldInfo[], nestedRefs: NestedSchemaRef[]): void {
  for (const ref of nestedRefs) {
    const field = fields.find(f => f.name === ref.fieldName);
    if (field) {
      if (field.isNestedSchema === false) continue;
      field.isNestedSchema = true;
      field.nestedSchemaName = ref.schemaName;
      field.nestedModelName = ref.modelName;
      field.nestedDisplayField = ref.displayField;
      // object/array 型のままにする（動的解析が 'object' を返す）
    } else {
      // 動的解析で検出されなかったフィールドを追加
      fields.push({
        name: ref.fieldName,
        type: ref.isArray ? 'array' : 'object',
        isOptional: ref.isOptional,
        isArray: ref.isArray,
        isNestedSchema: true,
        nestedSchemaName: ref.schemaName,
        nestedModelName: ref.modelName,
        nestedDisplayField: ref.displayField,
      });
    }
  }
}

function compileModelModule(modelPath: string, directory: string, modules = new Map<string, string>()): string {
  const sourcePath = path.resolve(modelPath);
  const existing = modules.get(sourcePath);
  if (existing) return existing;
  const outputPath = path.join(directory, `model-${modules.size}.mjs`);
  modules.set(sourcePath, outputPath);
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    transformers: {
      after: [context => source => {
        const visit: ts.Visitor = node => {
          if (ts.isStringLiteral(node) &&
              (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) &&
              node.text.startsWith(".")) {
            const base = path.resolve(path.dirname(sourcePath), node.text);
            const candidates = [base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts"), base];
            const dependency = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
            if (!dependency) throw new Error(`Cannot resolve ${node.text} from ${sourcePath}`);
            const compiled = compileModelModule(dependency, directory, modules);
            return context.factory.createStringLiteral(`./${path.basename(compiled)}`);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(source, visit) as ts.SourceFile;
      }],
    },
  });
  fs.writeFileSync(outputPath, output.outputText);
  return outputPath;
}

/**
 * Zodスキーマから動的にフィールド情報を抽出
 */
interface ParsedSchemaFields {
  fields: FieldInfo[];
  mode: SchemaParserMode;
  warnings: string[];
}

function staticParseFields(modelPath: string, schemaName: string, content: string): FieldInfo[] | null {
  const source = ts.createSourceFile(modelPath, content, ts.ScriptTarget.Latest, true);
  const constants = new Map<string, ts.Expression>();
  const importedObjectSchemas = new Map<string, boolean>();
  const objectHasId = (expression: ts.Expression): boolean | undefined => {
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) ||
        !ts.isIdentifier(expression.expression.expression) || expression.expression.expression.text !== "z" ||
        expression.expression.name.text !== "object" || !expression.arguments[0] ||
        !ts.isObjectLiteralExpression(expression.arguments[0]) ||
        expression.arguments[0].properties.some(property => !ts.isPropertyAssignment(property))) return undefined;
    return expression.arguments[0].properties.some(property =>
      property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "id");
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith(".") && statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)) {
      const targetPath = resolveSchemaDependencyPath(modelPath, statement.moduleSpecifier.text);
      if (targetPath) {
        const targetContent = fs.readFileSync(targetPath, "utf-8");
        const target = ts.createSourceFile(targetPath, targetContent, ts.ScriptTarget.Latest, true);
        for (const element of statement.importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          for (const declaration of target.statements.filter(ts.isVariableStatement)
            .flatMap(variable => [...variable.declarationList.declarations])) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== importedName || !declaration.initializer) continue;
            const hasId = objectHasId(declaration.initializer);
            if (hasId !== undefined) importedObjectSchemas.set(element.name.text, hasId);
          }
        }
      }
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
    }
  }

  const schema = constants.get(schemaName);
  if (!schema || !ts.isCallExpression(schema) || !ts.isPropertyAccessExpression(schema.expression) ||
      schema.expression.name.text !== "object" || schema.arguments.length === 0 || !ts.isObjectLiteralExpression(schema.arguments[0])) {
    return null;
  }

  const literalValues = (expression: ts.Expression): string[] | null => {
    let value = expression;
    if (ts.isAsExpression(value)) value = value.expression;
    if (ts.isIdentifier(value)) {
      const resolved = constants.get(value.text);
      return resolved ? literalValues(resolved) : null;
    }
    if (!ts.isArrayLiteralExpression(value)) return null;
    const values: string[] = [];
    for (const element of value.elements) {
      if (ts.isStringLiteral(element) || ts.isNumericLiteral(element)) values.push(element.text);
      else return null;
    }
    return values;
  };

  const parseExpression = (expression: ts.Expression): Omit<FieldInfo, "name"> | null => {
    if (ts.isIdentifier(expression)) {
      const resolved = constants.get(expression.text);
      if (resolved) return parseExpression(resolved);
      return importedObjectSchemas.has(expression.text)
        ? { type: "object", isOptional: false, isNullable: false, isArray: false,
          ...(importedObjectSchemas.get(expression.text) ? {} : { isNestedSchema: false }) }
        : null;
    }
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return null;
    const method = expression.expression.name.text;
    const receiver = expression.expression.expression;
    const wrappers = new Set(["optional", "nullable", "default", "min", "max", "int", "positive", "negative", "nonnegative", "nonpositive", "regex", "email", "url", "uuid", "trim"]);
    if (wrappers.has(method)) {
      const inner = parseExpression(receiver);
      if (!inner) return null;
      if (method === "optional" || method === "default") inner.isOptional = true;
      if (method === "nullable") inner.isNullable = true;
      return inner;
    }
    if (!ts.isIdentifier(receiver) || receiver.text !== "z") return null;
    if (["string", "number", "boolean", "date"].includes(method)) {
      return { type: method, isOptional: false, isNullable: false, isArray: false };
    }
    if (method === "object") {
      const hasId = objectHasId(expression);
      if (hasId === undefined) return null;
      return { type: "object", isOptional: false, isNullable: false, isArray: false,
        ...(hasId ? {} : { isNestedSchema: false }) };
    }
    if (method === "array" && expression.arguments[0]) {
      const element = parseExpression(expression.arguments[0]);
      return element ? { ...element, isArray: true } : null;
    }
    if (method === "enum" && expression.arguments[0]) {
      const enumValues = literalValues(expression.arguments[0]);
      return enumValues ? { type: "string", isOptional: false, isNullable: false, isArray: false, enumValues } : null;
    }
    if (method === "literal" && expression.arguments[0]) {
      const value = expression.arguments[0];
      if (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) {
        return { type: ts.isNumericLiteral(value) ? "number" : "string", isOptional: false, isNullable: false, isArray: false, enumValues: [value.text] };
      }
      if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
        return { type: "boolean", isOptional: false, isNullable: false, isArray: false, enumValues: [value.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false"] };
      }
    }
    return null;
  };

  const fields: FieldInfo[] = [];
  for (const property of schema.arguments[0].properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (!name) return null;
    const parsed = parseExpression(property.initializer);
    if (!parsed) return null;
    const isForeignKey = name.endsWith("Id") && name.length > 2 && parsed.type === "string";
    fields.push({
      name,
      ...parsed,
      ...(isForeignKey ? { isForeignKey: true, referencedModel: name.slice(0, -2).replace(/^./, char => char.toUpperCase()) } : {}),
    });
  }
  return fields;
}

async function extractFieldsFromSchema(
  modelPath: string,
  schemaName: string,
  executeNode: NonNullable<ModelParserOptions["executeNode"]>,
  content: string
): Promise<ParsedSchemaFields> {
  const staticFields = staticParseFields(modelPath, schemaName, content);
  if (staticFields && staticFields.length > 0) return { fields: staticFields, mode: "static-ast", warnings: [] };
  const fields: FieldInfo[] = [];
  let tempDirectory: string | undefined;
  
  try {
    // プロジェクトルートを探す（package.jsonがある場所）
    let projectRoot = path.dirname(modelPath);
    while (projectRoot !== path.dirname(projectRoot)) {
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        break;
      }
      projectRoot = path.dirname(projectRoot);
    }
    
    // プロジェクトルート内に一時スクリプトファイルを作成
    tempDirectory = fs.mkdtempSync(path.join(projectRoot, '.swallowkit-parser-'));
    const compiledModel = compileModelModule(modelPath, tempDirectory);
    const tempScript = path.join(tempDirectory, 'inspect.mjs');
    const scriptCode = `
  import { ${schemaName} as schema } from './${path.basename(compiledModel)}';

// Zod v3とv4の両方に対応
const isObject = (schema && schema._def && 
  (schema._def.typeName === 'ZodObject' || schema.constructor?.name === 'ZodObject' || typeof schema._def.shape === 'function'));

try {
if (isObject) {
  const shape = typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape;
  const fields = Object.keys(shape).map(key => {
    const field = shape[key];
    let type = undefined;
    let isOptional = false;
    let isNullable = false;
    let isArray = false;
    let enumValues = undefined;
    
    // ZodOptional, ZodNullable, ZodDefault, ZodEffects を unwrap
    let fieldDef = field;
    const getTypeName = (def) => def?._def?.typeName || def?.constructor?.name || '';
    
    // 繰り返し unwrap（複数のラッパーがある場合に対応）
    let unwrapped = false;
    do {
      unwrapped = false;
      const typeName = getTypeName(fieldDef);
      
      if (typeName === 'ZodOptional') {
        isOptional = true;
        fieldDef = fieldDef._def.innerType;
        unwrapped = true;
      } else if (typeName === 'ZodNullable') {
        isNullable = true;
        fieldDef = fieldDef._def.innerType;
        unwrapped = true;
      } else if (typeName === 'ZodDefault') {
        // .default() は optional と同様に扱う
        isOptional = true;
        fieldDef = fieldDef._def.innerType;
        unwrapped = true;
      } else if (typeName === 'ZodEffects') {
        // .min(), .max(), .regex() などの Effects を unwrap
        fieldDef = fieldDef._def.schema;
        unwrapped = true;
      }
    } while (unwrapped);
    
    // ZodArray をチェック
    if (getTypeName(fieldDef) === 'ZodArray') {
      isArray = true;
      fieldDef = fieldDef._def.element || fieldDef._def.type;
    }
    
    // 基本型を判定
    const typeName = getTypeName(fieldDef);
    if (typeName === 'ZodString') type = 'string';
    else if (typeName === 'ZodNumber') type = 'number';
    else if (typeName === 'ZodBoolean') type = 'boolean';
    else if (typeName === 'ZodDate') type = 'date';
    else if (typeName === 'ZodObject') type = 'object';
    else if (typeName === 'ZodEnum' || typeName === 'ZodNativeEnum') {
      type = 'string';
      // enum の選択肢を取得（複数のZodバージョンに対応）
      if (fieldDef.options) {
        // Zod v3.23+ では options プロパティを使用
        enumValues = Array.isArray(fieldDef.options) 
          ? fieldDef.options 
          : Object.values(fieldDef.options);
      } else if (fieldDef._def.values) {
        // 古いバージョンでは _def.values を使用
        enumValues = Array.isArray(fieldDef._def.values) 
          ? fieldDef._def.values 
          : Object.values(fieldDef._def.values);
      } else if (fieldDef._def.entries) {
        // さらに古いバージョンでは _def.entries を使用
        enumValues = Array.isArray(fieldDef._def.entries)
          ? fieldDef._def.entries
          : Object.values(fieldDef._def.entries);
      }
    } else if (typeName === 'ZodLiteral') {
      const rawLiteralValues = fieldDef.values || fieldDef._def.values ||
        (fieldDef._def.value !== undefined ? [fieldDef._def.value] : undefined);
      const literalValues = rawLiteralValues instanceof Set ? Array.from(rawLiteralValues) : rawLiteralValues;
      if (Array.isArray(literalValues) && literalValues.length > 0) {
        const literalValue = literalValues[0];
        type = typeof literalValue === 'number' ? 'number' : typeof literalValue === 'boolean' ? 'boolean' : 'string';
        enumValues = literalValues.map(value => String(value));
      }
    }

    if (!type || ((typeName === 'ZodEnum' || typeName === 'ZodNativeEnum') && (!enumValues || enumValues.length === 0))) {
      throw Object.assign(new Error('Unsupported or ambiguous Zod field "' + key + '" (' + (typeName || 'unknown') + ')'), { field: key, reason: typeName || 'unknown' });
    }
    
    // 外部キー検出: フィールド名が <ModelName>Id のパターンの場合
    let isForeignKey = false;
    let referencedModel = undefined;
    if (key.endsWith('Id') && key.length > 2 && type === 'string') {
      // categoryId -> Category, userId -> User など
      const modelName = key.slice(0, -2); // "Id" を除去
      referencedModel = modelName.charAt(0).toUpperCase() + modelName.slice(1); // 先頭を大文字に
      isForeignKey = true;
    }
    
    const nestedShape = type === 'object'
      ? (typeof fieldDef._def.shape === 'function' ? fieldDef._def.shape() : fieldDef._def.shape)
      : undefined;
    return { name: key, type, isOptional, isNullable, isArray, enumValues, isForeignKey, referencedModel,
      ...(nestedShape && !Object.prototype.hasOwnProperty.call(nestedShape, 'id') ? { isNestedSchema: false } : {}) };
  });
  
  if (!fields.length) throw new Error('Empty object schemas cannot define an entity');
  console.log(JSON.stringify(fields));
} else {
  throw new Error('Exported schema is not a Zod object');
}
} catch (error) {
  console.log(JSON.stringify({ error: { field: error.field, reason: error.reason || error.message } }));
}
`;
    
    fs.writeFileSync(tempScript, scriptCode, 'utf8');
    
    try {
      const result = executeNode(process.execPath, [tempScript], {
        encoding: 'utf8',
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      
      const stdout = result;
      
      if (stdout) {
        const parsedFields = JSON.parse(stdout.trim());
        if (parsedFields.error) {
          throw new MachineCommandError(
            "schema-analysis-unsupported",
            `Cannot analyze ${modelPath} (${schemaName})${parsedFields.error.field ? ` field ${parsedFields.error.field}` : ""}: ${parsedFields.error.reason}`,
            { modelPath, filePath: modelPath, schemaName, ...parsedFields.error, diagnostics: ["Lossy regex parsing was not used."] },
            "blocked"
          );
        }
        if (!Array.isArray(parsedFields) || parsedFields.length === 0) throw new Error("Schema analysis returned no fields.");
        fields.push(...parsedFields);
      } else {
        throw new Error("Schema analysis returned no output.");
      }
    } finally {
      // 一時ファイルを削除
      try {
        fs.unlinkSync(tempScript);
      } catch (e) {
        // ファイル削除失敗は無視
      }
    }
  } catch (error) {
    if (error instanceof MachineCommandError) throw error;
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EPERM" || nodeError.code === "EACCES" || nodeError.code === "ENOENT") {
      throw new MachineCommandError(
        "schema-evaluation-unavailable",
        `Schema evaluation could not start: ${nodeError.message}`,
        {
          command: process.execPath,
          reason: nodeError.code,
          modelPath,
          filePath: modelPath,
          schemaName,
          diagnostics: ["Dynamic schema evaluation requires permission to start a Node.js child process."],
          nextAction: "Re-run in an environment that permits normal Node.js child process execution.",
        },
        "blocked"
      );
    }
    throw new MachineCommandError(
      "schema-analysis-unsupported",
      `The model could not be analyzed safely without losing schema semantics: ${error instanceof Error ? error.message : String(error)}`,
      {
        command: process.execPath,
        modelPath,
        filePath: modelPath,
        schemaName,
        reason: error instanceof Error ? error.message : String(error),
        diagnostics: ["Lossy regex parsing was not used."],
        nextAction: "Use supported static Zod expressions or re-run where dynamic schema evaluation succeeds.",
      },
      "blocked"
    );
  } finally {
    if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
  
  return { fields, mode: "dynamic", warnings: [] };
}

/**
 * 文字列を PascalCase に変換
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * 文字列を camelCase に変換
 */
export function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * モデルファイルから connectorConfig エクスポートを静的解析で抽出する
 */
export function parseConnectorConfig(content: string): ModelConnectorConfig | undefined {
  // export const connectorConfig = { ... } を検出
  const connectorMatch = content.match(/export\s+const\s+connectorConfig\s*=\s*\{/);
  if (!connectorMatch) {
    return undefined;
  }

  // connectorConfig オブジェクトの内容を抽出
  const startIdx = content.indexOf('{', connectorMatch.index!);
  let braceCount = 1;
  let endIdx = startIdx + 1;
  while (braceCount > 0 && endIdx < content.length) {
    if (content[endIdx] === '{') braceCount++;
    if (content[endIdx] === '}') braceCount--;
    endIdx++;
  }

  const objectStr = content.substring(startIdx, endIdx);

  // connector 名を抽出
  const connectorNameMatch = objectStr.match(/connector\s*:\s*['"]([^'"]+)['"]/);
  if (!connectorNameMatch) {
    return undefined;
  }
  const connector = connectorNameMatch[1];

  // operations を抽出
  const opsMatch = objectStr.match(/operations\s*:\s*\[([^\]]*)\]/);
  const operations: string[] = [];
  if (opsMatch) {
    const opsStr = opsMatch[1];
    const opEntries = opsStr.match(/['"]([^'"]+)['"]/g);
    if (opEntries) {
      for (const entry of opEntries) {
        operations.push(entry.replace(/['"]/g, ''));
      }
    }
  }

  // table を抽出（RDB 固有）
  const tableMatch = objectStr.match(/table\s*:\s*['"]([^'"]+)['"]/);

  // idColumn を抽出（RDB 固有）
  const idColumnMatch = objectStr.match(/idColumn\s*:\s*['"]([^'"]+)['"]/);

  // endpoints を抽出（API 固有）— endpoint値に {id} 等のプレースホルダが含まれるためbrace-countingで抽出
  let endpoints: Record<string, string> | undefined;
  const endpointsStart = objectStr.match(/endpoints\s*:\s*\{/);
  if (endpointsStart) {
    const epStartIdx = objectStr.indexOf('{', endpointsStart.index!);
    let epBraceCount = 1;
    let epEndIdx = epStartIdx + 1;
    while (epBraceCount > 0 && epEndIdx < objectStr.length) {
      const ch = objectStr[epEndIdx];
      // 文字列内の波括弧をスキップ
      if (ch === "'" || ch === '"') {
        epEndIdx++;
        while (epEndIdx < objectStr.length && objectStr[epEndIdx] !== ch) {
          epEndIdx++;
        }
      } else if (ch === '{') {
        epBraceCount++;
      } else if (ch === '}') {
        epBraceCount--;
      }
      epEndIdx++;
    }
    const epStr = objectStr.substring(epStartIdx + 1, epEndIdx - 1);
    endpoints = {};
    const endpointEntries = epStr.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g);
    for (const entry of endpointEntries) {
      endpoints[entry[1]] = entry[2];
    }
  }

  if (tableMatch) {
    // RDB コネクタ
    return {
      connector,
      operations: operations as ModelConnectorConfig['operations'],
      table: tableMatch[1],
      ...(idColumnMatch ? { idColumn: idColumnMatch[1] } : {}),
    };
  }

  // API コネクタ
  return {
    connector,
    operations: operations as ModelConnectorConfig['operations'],
    ...(endpoints ? { endpoints } : {}),
  };
}

/**
 * authPolicy をモデルファイルから抽出
 * パターン: export const authPolicy = { roles: [...], read: [...], write: [...] }
 */
export function parseAuthPolicy(content: string): ModelAuthPolicy | undefined {
  const policyMatch = content.match(/export\s+const\s+authPolicy\s*=\s*\{/);
  if (!policyMatch) {
    return undefined;
  }

  const startIdx = content.indexOf('{', policyMatch.index!);
  let braceCount = 1;
  let endIdx = startIdx + 1;
  while (braceCount > 0 && endIdx < content.length) {
    if (content[endIdx] === '{') braceCount++;
    if (content[endIdx] === '}') braceCount--;
    endIdx++;
  }

  const objectStr = content.substring(startIdx, endIdx);

  const extractRoles = (key: string): string[] | undefined => {
    const match = objectStr.match(new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!match) return undefined;
    const entries = match[1].match(/['"]([^'"]+)['"]/g);
    if (!entries) return [];
    return entries.map(e => e.replace(/['"]/g, ''));
  };

  const roles = extractRoles('roles');
  const read = extractRoles('read');
  const write = extractRoles('write');

  const extractName = (key: string): string | undefined => objectStr.match(new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`))?.[1];
  const namedPolicy = extractName('policy');
  const namedRead = extractName('read');
  const namedWrite = extractName('write');

  if (!roles && !read && !write && !namedPolicy && !namedRead && !namedWrite) {
    return undefined;
  }

  return {
    ...(roles ? { roles } : {}),
    ...(namedRead ? { read: namedRead } : read ? { read } : {}),
    ...(namedWrite ? { write: namedWrite } : write ? { write } : {}),
    ...(namedPolicy ? { policy: namedPolicy } : {}),
  };
}

/**
 * パーティションキーを抽出する
 * export const partitionKey = '/tenantId' のようなエクスポートを検出
 * 未指定の場合はデフォルト '/id' を返す
 */
export function parsePartitionKey(content: string): string {
  const match = content.match(/export\s+const\s+partitionKey\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : '/id';
}

/**
 * 文字列を kebab-case に変換
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * models ディレクトリから全てのモデル情報を取得
 * @param modelsDir モデルディレクトリのパス（デフォルト: "shared/models"）
 * @returns モデル情報の配列
 */
export async function getAllModels(modelsDir: string = "shared/models"): Promise<ModelInfo[]> {
  const cwd = process.cwd();
  const fullModelsDir = path.join(cwd, modelsDir);
  
  if (!fs.existsSync(fullModelsDir)) {
    return [];
  }
  
  const files = fs.readdirSync(fullModelsDir);
  const modelFiles = files.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts') && file !== 'index.ts');
  
  const models: ModelInfo[] = [];
  const ledger = loadArtifactLedger(cwd);
  
  for (const file of modelFiles) {
    const modelPath = path.join(fullModelsDir, file);
    const relativePath = path.relative(cwd, modelPath).replace(/\\/g, "/");
    // Framework-owned authentication DTOs are not persistence entities.
    if (relativePath === "shared/models/auth.ts" && ledger?.artifacts.some(artifact =>
      artifact.path === relativePath && artifact.generator === "add-auth")) continue;
    models.push(await parseModelFile(modelPath));
  }

  const declaredPersistence = new Set(models.filter(model => model.connectorConfig || model.authPolicy ||
    /export\s+const\s+partitionKey\b/.test(fs.readFileSync(model.filePath, "utf8")) ||
    ledger?.artifacts.some(artifact => artifact.sourceModel === model.name &&
      ["create-model", "scaffold", "infrastructure-migration"].includes(artifact.generator)))
    .map(model => model.filePath));
  const embeddedFiles = new Set<string>();
  const visitReferences = (model: ModelInfo): void => {
    for (const reference of model.nestedSchemaRefs) {
      const file = resolveSchemaDependencyPath(model.filePath, reference.importPath);
      if (!file || embeddedFiles.has(file)) continue;
      embeddedFiles.add(file);
      const nested = models.find(candidate => candidate.filePath === file);
      if (nested) visitReferences(nested);
    }
  };
  models.filter(model => model.hasId || declaredPersistence.has(model.filePath)).forEach(visitReferences);
  return models.filter(model => {
    const id = model.fields.find(field => field.name === "id");
    const relativePath = path.relative(cwd, model.filePath).replace(/\\/g, "/");
    if (id || declaredPersistence.has(model.filePath)) {
      if (!id || id.type !== "string" || id.isOptional || id.isNullable || id.isArray) {
        throw new MachineCommandError("model-entity-id-required",
          `Persistent model ${model.name} must declare a required string id; it cannot be treated as an embedded helper.`,
          { filePath: model.filePath, schemaName: model.schemaName, field: "id", reason: "required-string-id" }, "blocked");
      }
      return true;
    }
    if (embeddedFiles.has(model.filePath)) return false;
    throw new MachineCommandError("model-classification-ambiguous",
      `Cannot classify ${relativePath}: no persistence id/metadata and no embedded schema reference. Move helper-only schemas outside shared/models or embed them explicitly; do not generate a container by guessing.`,
      { filePath: model.filePath, schemaName: model.schemaName, reason: "no-entity-id-or-embedded-reference" }, "blocked");
  });
}
