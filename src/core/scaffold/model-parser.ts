/**
 * Zod モデルファイルを解析して、スキーマ情報を抽出する
 */

import * as fs from "fs";
import { execFileSync } from "child_process";
import * as path from "path";
import * as ts from "typescript";

import { ModelConnectorConfig, ModelAuthPolicy } from "../../types";
import { MachineCommandError } from "../../machine/errors";
import { hashContent } from "../operations/file-session";

export type SchemaParserMode = "static-ast" | "dynamic";

export interface ModelParserOptions {
  executeNode?: typeof execFileSync;
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

export type FieldFormat = "date-time" | "date" | "time" | "email" | "uuid" | "uri";

/** Zod validation constraints that native backends can enforce. For arrays, length bounds are minItems/maxItems and other values apply to each element. */
export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternFlags?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  minItems?: number;
  maxItems?: number;
}

export interface FieldInfo {
  name: string;
  type: string; // "string" | "number" | "boolean" | "date" | "object" | "array"
  isOptional: boolean;
  isNullable?: boolean;
  isArray: boolean;
  enumValues?: string[]; // enum の場合の選択肢
  format?: FieldFormat; // 明示された文字列形式（z.iso.datetime() など）
  isInteger?: boolean; // z.number().int() / z.int()
  constraints?: FieldConstraints;
  objectFields?: FieldInfo[]; // インライン z.object({...}) の形
  isForeignKey?: boolean; // 外部キーかどうか
  referencedModel?: string; // 参照先のモデル名（例: "Category"）
  isNestedSchema?: boolean; // ネストしたスキーマ参照かどうか
  nestedSchemaName?: string; // 参照先のスキーマ名（例: "categorySchema"）
  nestedModelName?: string; // 参照先のモデル名（例: "Category"）
  nestedDisplayField?: string; // 参照先の表示フィールド（例: "name"）
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
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const content = fs.readFileSync(modelPath, "utf-8");
  const fileName = path.basename(modelPath, ".ts");
  
  // モデル名を推定（ファイル名を PascalCase に変換）
  const modelName = toPascalCase(fileName);
  
  // スキーマ変数名を抽出
  // コメント内のコードパターンを誤認識しないよう、先にコメントを除去してから正規表現を適用する
  // パターン1: export const todoSchema = z.object({ ... })  (camelCase + Schema接尾辞)
  // パターン2: export const Todo = z.object({ ... })         (Zod公式パターン)
  const contentWithoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')  // ブロックコメントを除去
    .replace(/\/\/.*/g, '');           // 行コメントを除去
  let schemaMatch = contentWithoutComments.match(/export\s+const\s+(\w+Schema)\s*=/);
  if (!schemaMatch) {
    schemaMatch = contentWithoutComments.match(/export\s+const\s+(\w+)\s*=\s*z\.object\s*\(/);
  }
  if (!schemaMatch) {
    throw new Error(`Could not find exported schema in ${modelPath}. Expected patterns:\n  - export const xxxSchema = z.object({ ... })\n  - export const Xxx = z.object({ ... })`);
  }
  
  const schemaName = schemaMatch[1];
  
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
  const parsedSchema = await extractFieldsFromSchema(modelPath, schemaName, options.executeNode ?? execFileSync);
  const fields = parsedSchema.fields;
  const parserWarnings = [...parsedSchema.warnings];

  // 外部キーは参照先モデルが shared/models に実在する場合だけ推測する
  applyForeignKeys(fields, modelName, modelPath, parseReferences(content), parserWarnings);
  
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
    parserWarnings,
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

const STRING_FORMATS: Record<string, FieldFormat> = {
  email: "email",
  url: "uri",
  uuid: "uuid",
  guid: "uuid",
  datetime: "date-time",
  date: "date",
  time: "time",
};

function staticParseFields(modelPath: string, schemaName: string): FieldInfo[] | null {
  const source = ts.createSourceFile(modelPath, fs.readFileSync(modelPath, "utf-8"), ts.ScriptTarget.Latest, true);
  const constants = new Map<string, ts.Expression>();
  const importedObjectSchemas = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith(".") && statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)) {
      const base = path.resolve(path.dirname(modelPath), statement.moduleSpecifier.text);
      const targetPath = [base, `${base}.ts`, path.join(base, "index.ts")].find(candidate => fs.existsSync(candidate));
      if (targetPath) {
        const targetContent = fs.readFileSync(targetPath, "utf-8");
        for (const element of statement.importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (new RegExp(`(?:export\\s+)?const\\s+${importedName}\\s*=\\s*z\\.object\\s*\\(`).test(targetContent)) {
            importedObjectSchemas.add(element.name.text);
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

  type ParsedField = Omit<FieldInfo, "name">;

  const numericArgument = (expression: ts.Expression | undefined): number | null => {
    if (!expression) return null;
    if (ts.isNumericLiteral(expression)) return Number(expression.text);
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) {
      return -Number(expression.operand.text);
    }
    if (ts.isIdentifier(expression)) {
      const resolved = constants.get(expression.text);
      return resolved ? numericArgument(resolved) : null;
    }
    return null;
  };

  const withConstraints = (field: ParsedField, update: FieldConstraints): ParsedField => ({
    ...field,
    constraints: { ...(field.constraints ?? {}), ...update },
  });

  const lowerBound = (field: ParsedField, key: "minLength" | "minimum" | "minItems", value: number, exclusive = false): ParsedField => {
    const current = field.constraints?.[key];
    if (current !== undefined && current > value) return field;
    const constraints: FieldConstraints = { ...(field.constraints ?? {}), [key]: value };
    if (key === "minimum") {
      if (exclusive) constraints.exclusiveMinimum = true;
      else delete constraints.exclusiveMinimum;
    }
    return { ...field, constraints };
  };

  const upperBound = (field: ParsedField, key: "maxLength" | "maximum" | "maxItems", value: number, exclusive = false): ParsedField => {
    const current = field.constraints?.[key];
    if (current !== undefined && current < value) return field;
    const constraints: FieldConstraints = { ...(field.constraints ?? {}), [key]: value };
    if (key === "maximum") {
      if (exclusive) constraints.exclusiveMaximum = true;
      else delete constraints.exclusiveMaximum;
    }
    return { ...field, constraints };
  };

  const applyCheck = (inner: ParsedField, method: string, args: ts.NodeArray<ts.Expression>): ParsedField | null => {
    const lengthTarget = inner.isArray ? "items" : inner.type === "string" ? "length" : inner.type === "number" ? "value" : null;
    const value = numericArgument(args[0]);
    switch (method) {
      case "optional":
      case "default":
        return { ...inner, isOptional: true };
      case "nullable":
        return { ...inner, isNullable: true };
      case "nullish":
        return { ...inner, isOptional: true, isNullable: true };
      case "describe":
      case "trim":
      case "toLowerCase":
      case "toUpperCase":
      case "strict":
      case "strip":
      case "passthrough":
      case "loose":
        return inner;
      case "int":
        return inner.type === "number" && !inner.isArray ? { ...inner, isInteger: true } : null;
      case "positive":
        return inner.type === "number" && !inner.isArray ? lowerBound(inner, "minimum", 0, true) : null;
      case "nonnegative":
        return inner.type === "number" && !inner.isArray ? lowerBound(inner, "minimum", 0) : null;
      case "negative":
        return inner.type === "number" && !inner.isArray ? upperBound(inner, "maximum", 0, true) : null;
      case "nonpositive":
        return inner.type === "number" && !inner.isArray ? upperBound(inner, "maximum", 0) : null;
      case "gt":
      case "gte":
        return inner.type === "number" && !inner.isArray && value !== null ? lowerBound(inner, "minimum", value, method === "gt") : null;
      case "lt":
      case "lte":
        return inner.type === "number" && !inner.isArray && value !== null ? upperBound(inner, "maximum", value, method === "lt") : null;
      case "min":
        if (value === null || !lengthTarget) return null;
        return lowerBound(inner, lengthTarget === "items" ? "minItems" : lengthTarget === "length" ? "minLength" : "minimum", value);
      case "max":
        if (value === null || !lengthTarget) return null;
        return upperBound(inner, lengthTarget === "items" ? "maxItems" : lengthTarget === "length" ? "maxLength" : "maximum", value);
      case "length":
        if (value === null || (lengthTarget !== "items" && lengthTarget !== "length")) return null;
        return lengthTarget === "items"
          ? upperBound(lowerBound(inner, "minItems", value), "maxItems", value)
          : upperBound(lowerBound(inner, "minLength", value), "maxLength", value);
      case "nonempty":
        if (lengthTarget !== "items" && lengthTarget !== "length") return null;
        return lowerBound(inner, lengthTarget === "items" ? "minItems" : "minLength", 1);
      case "regex": {
        const literal = args[0];
        if (!literal || !ts.isRegularExpressionLiteral(literal) || inner.type !== "string" || inner.isArray) return null;
        const text = literal.text;
        const separator = text.lastIndexOf("/");
        return withConstraints(inner, {
          pattern: text.slice(1, separator),
          ...(text.slice(separator + 1) ? { patternFlags: text.slice(separator + 1) } : {}),
        });
      }
      case "email":
      case "url":
      case "uuid":
      case "guid":
      case "datetime":
      case "date":
      case "time":
        if (inner.type !== "string" || inner.isArray) return null;
        return { ...inner, format: STRING_FORMATS[method] };
      default:
        return null;
    }
  };

  const parseObjectFields = (literal: ts.ObjectLiteralExpression): FieldInfo[] | null => {
    const objectFields: FieldInfo[] = [];
    for (const property of literal.properties) {
      if (!ts.isPropertyAssignment(property)) return null;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
      if (!name) return null;
      const parsed = parseExpression(property.initializer);
      if (!parsed) return null;
      objectFields.push({ name, ...parsed });
    }
    return objectFields;
  };

  function parseExpression(expression: ts.Expression): ParsedField | null {
    if (ts.isIdentifier(expression)) {
      const resolved = constants.get(expression.text);
      if (resolved) return parseExpression(resolved);
      return importedObjectSchemas.has(expression.text)
        ? { type: "object", isOptional: false, isNullable: false, isArray: false }
        : null;
    }
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return null;
    const method = expression.expression.name.text;
    const receiver = expression.expression.expression;
    const base = (type: string, extra: Partial<ParsedField> = {}): ParsedField => ({ type, isOptional: false, isNullable: false, isArray: false, ...extra });

    // z.iso.datetime() / z.iso.date() / z.iso.time()
    if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression) && receiver.expression.text === "z" && receiver.name.text === "iso") {
      return method === "datetime" || method === "date" || method === "time" ? base("string", { format: STRING_FORMATS[method] }) : null;
    }
    if (!(ts.isIdentifier(receiver) && receiver.text === "z")) {
      const inner = parseExpression(receiver);
      return inner ? applyCheck(inner, method, expression.arguments) : null;
    }
    if (["string", "boolean", "date"].includes(method)) return base(method);
    if (method === "number") return base("number");
    if (method === "int") return base("number", { isInteger: true });
    if (method === "email" || method === "url" || method === "uuid" || method === "guid") return base("string", { format: STRING_FORMATS[method] });
    if (method === "object") {
      const literal = expression.arguments[0];
      if (!literal || !ts.isObjectLiteralExpression(literal)) return null;
      // Unsupported members keep the previous untyped-object behavior instead of failing the whole model.
      const objectFields = parseObjectFields(literal);
      return objectFields ? base("object", { objectFields }) : base("object");
    }
    if (method === "array" && expression.arguments[0]) {
      const element = parseExpression(expression.arguments[0]);
      return element ? { ...element, isArray: true } : null;
    }
    if (method === "enum" && expression.arguments[0]) {
      const enumValues = literalValues(expression.arguments[0]);
      return enumValues ? base("string", { enumValues }) : null;
    }
    if (method === "literal" && expression.arguments[0]) {
      const value = expression.arguments[0];
      if (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) {
        return base(ts.isNumericLiteral(value) ? "number" : "string", { enumValues: [value.text] });
      }
      if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
        return base("boolean", { enumValues: [value.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false"] });
      }
    }
    return null;
  }

  return parseObjectFields(schema.arguments[0] as ts.ObjectLiteralExpression);
}

async function extractFieldsFromSchema(
  modelPath: string,
  schemaName: string,
  executeNode: typeof execFileSync
): Promise<ParsedSchemaFields> {
  const staticFields = staticParseFields(modelPath, schemaName);
  if (staticFields) return { fields: staticFields, mode: "static-ast", warnings: [] };
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

// Zod v3 (_def.typeName) と v4 (_zod.def.type) の両方に対応
const FORMATS = { email: 'email', url: 'uri', uuid: 'uuid', guid: 'uuid', datetime: 'date-time', date: 'date', time: 'time' };
const v4 = (s) => (s && s._zod && s._zod.def) || null;
const v3Name = (s) => (s && s._def && s._def.typeName) || '';

function lower(c, key, value, exclusive) {
  if (typeof value !== 'number' || (c[key] !== undefined && c[key] > value)) return;
  c[key] = value;
  if (key === 'minimum') { if (exclusive) c.exclusiveMinimum = true; else delete c.exclusiveMinimum; }
}
function upper(c, key, value, exclusive) {
  if (typeof value !== 'number' || (c[key] !== undefined && c[key] < value)) return;
  c[key] = value;
  if (key === 'maximum') { if (exclusive) c.exclusiveMaximum = true; else delete c.exclusiveMaximum; }
}

function unwrap(s, info) {
  for (;;) {
    const d = v4(s);
    if (d) {
      if (d.type === 'optional' || d.type === 'default' || d.type === 'prefault') { info.isOptional = true; s = d.innerType; continue; }
      if (d.type === 'nullable') { info.isNullable = true; s = d.innerType; continue; }
      if (d.type === 'readonly' || d.type === 'nonoptional' || d.type === 'catch') { s = d.innerType; continue; }
      return s;
    }
    const name = v3Name(s);
    if (name === 'ZodOptional' || name === 'ZodDefault') { info.isOptional = true; s = s._def.innerType; continue; }
    if (name === 'ZodNullable') { info.isNullable = true; s = s._def.innerType; continue; }
    if (name === 'ZodEffects') { s = s._def.schema; continue; }
    if (name === 'ZodReadonly' || name === 'ZodCatch') { s = s._def.innerType; continue; }
    return s;
  }
}

function describe(key, input) {
  const info = { name: key, type: undefined, isOptional: false, isNullable: false, isArray: false };
  const constraints = {};
  let s = unwrap(input, info);

  const arrayDef = v4(s);
  if ((arrayDef && arrayDef.type === 'array') || v3Name(s) === 'ZodArray') {
    info.isArray = true;
    if (arrayDef) {
      for (const check of arrayDef.checks || []) {
        const cd = check._zod.def;
        if (cd.check === 'min_length') lower(constraints, 'minItems', cd.minimum);
        if (cd.check === 'max_length') upper(constraints, 'maxItems', cd.maximum);
        if (cd.check === 'length_equals') { lower(constraints, 'minItems', cd.length); upper(constraints, 'maxItems', cd.length); }
      }
      s = arrayDef.element;
    } else {
      const ad = s._def;
      if (ad.minLength) lower(constraints, 'minItems', ad.minLength.value);
      if (ad.maxLength) upper(constraints, 'maxItems', ad.maxLength.value);
      if (ad.exactLength) { lower(constraints, 'minItems', ad.exactLength.value); upper(constraints, 'maxItems', ad.exactLength.value); }
      s = ad.type;
    }
    s = unwrap(s, {});
  }

  const d = v4(s);
  const name = v3Name(s);
  let enumValues;
  if (d) {
    if (d.type === 'string') {
      info.type = 'string';
      if (d.format && FORMATS[d.format]) info.format = FORMATS[d.format];
      if (d.format === 'regex' && d.pattern) { constraints.pattern = d.pattern.source; if (d.pattern.flags) constraints.patternFlags = d.pattern.flags; }
    } else if (d.type === 'number') {
      info.type = 'number';
      if (d.format && /int/.test(d.format)) info.isInteger = true;
    } else if (d.type === 'boolean') info.type = 'boolean';
    else if (d.type === 'date') info.type = 'date';
    else if (d.type === 'object') {
      info.type = 'object';
      const shape = typeof d.shape === 'function' ? d.shape() : d.shape;
      info.objectFields = Object.keys(shape).map((child) => describe(child, shape[child]));
    } else if (d.type === 'enum') {
      info.type = 'string';
      enumValues = Object.values(d.entries || {}).map(String);
    } else if (d.type === 'literal') {
      const values = Array.isArray(d.values) ? d.values : Array.from(d.values || []);
      if (values.length > 0) {
        info.type = typeof values[0] === 'number' ? 'number' : typeof values[0] === 'boolean' ? 'boolean' : 'string';
        enumValues = values.map(String);
      }
    }
    for (const check of d.checks || []) {
      const cd = check._zod.def;
      const lengthKey = info.type === 'string';
      if (cd.check === 'min_length' && lengthKey) lower(constraints, 'minLength', cd.minimum);
      if (cd.check === 'max_length' && lengthKey) upper(constraints, 'maxLength', cd.maximum);
      if (cd.check === 'length_equals' && lengthKey) { lower(constraints, 'minLength', cd.length); upper(constraints, 'maxLength', cd.length); }
      if (cd.check === 'greater_than') lower(constraints, 'minimum', Number(cd.value), !cd.inclusive);
      if (cd.check === 'less_than') upper(constraints, 'maximum', Number(cd.value), !cd.inclusive);
      if (cd.check === 'number_format' && /int/.test(cd.format || '')) info.isInteger = true;
      if (cd.check === 'string_format') {
        if (cd.format === 'regex' && cd.pattern) { constraints.pattern = cd.pattern.source; if (cd.pattern.flags) constraints.patternFlags = cd.pattern.flags; }
        else if (FORMATS[cd.format]) info.format = FORMATS[cd.format];
      }
    }
  } else {
    const def = s && s._def;
    if (name === 'ZodString') {
      info.type = 'string';
      for (const check of def.checks || []) {
        if (check.kind === 'min') lower(constraints, 'minLength', check.value);
        if (check.kind === 'max') upper(constraints, 'maxLength', check.value);
        if (check.kind === 'length') { lower(constraints, 'minLength', check.value); upper(constraints, 'maxLength', check.value); }
        if (check.kind === 'regex') { constraints.pattern = check.regex.source; if (check.regex.flags) constraints.patternFlags = check.regex.flags; }
        if (FORMATS[check.kind]) info.format = FORMATS[check.kind];
      }
    } else if (name === 'ZodNumber') {
      info.type = 'number';
      for (const check of def.checks || []) {
        if (check.kind === 'int') info.isInteger = true;
        if (check.kind === 'min') lower(constraints, 'minimum', check.value, !check.inclusive);
        if (check.kind === 'max') upper(constraints, 'maximum', check.value, !check.inclusive);
      }
    } else if (name === 'ZodBoolean') info.type = 'boolean';
    else if (name === 'ZodDate') info.type = 'date';
    else if (name === 'ZodObject') {
      info.type = 'object';
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      info.objectFields = Object.keys(shape).map((child) => describe(child, shape[child]));
    } else if (name === 'ZodEnum' || name === 'ZodNativeEnum') {
      info.type = 'string';
      const values = s.options || def.values || def.entries;
      enumValues = (Array.isArray(values) ? values : Object.values(values || {})).map(String);
    } else if (name === 'ZodLiteral') {
      const value = def.value;
      info.type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
      enumValues = [String(value)];
    }
  }

  const typeLabel = (d && d.type) || name || 'unknown';
  if (!info.type || ((typeLabel === 'enum' || name === 'ZodEnum' || name === 'ZodNativeEnum') && (!enumValues || enumValues.length === 0))) {
    throw new Error('Unsupported or ambiguous Zod field "' + key + '" (' + typeLabel + ')');
  }
  if (enumValues) info.enumValues = enumValues;
  if (Object.keys(constraints).length > 0) info.constraints = constraints;
  return info;
}

const root = unwrap(schema, {});
const rootDef = v4(root);
const rootShape = rootDef && rootDef.type === 'object'
  ? (typeof rootDef.shape === 'function' ? rootDef.shape() : rootDef.shape)
  : v3Name(root) === 'ZodObject' ? (typeof root._def.shape === 'function' ? root._def.shape() : root._def.shape) : null;
if (rootShape) {
  const fields = Object.keys(rootShape).map((key) => describe(key, rootShape[key]));
  console.log(JSON.stringify(fields));
} else {
  throw new Error('Exported schema is not a Zod object');
}
`;
    
    fs.writeFileSync(tempScript, scriptCode, 'utf8');
    
    try {
      const result = executeNode(process.execPath, [tempScript], {
        encoding: 'utf8',
        cwd: projectRoot,
      });
      
      const stdout = result;
      
      if (stdout) {
        const parsedFields = JSON.parse(stdout.trim());
        fields.push(...parsedFields);
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
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EPERM" || nodeError.code === "EACCES" || nodeError.code === "ENOENT") {
      throw new MachineCommandError(
        "schema-evaluation-unavailable",
        `Schema evaluation could not start: ${nodeError.message}`,
        {
          command: process.execPath,
          reason: nodeError.code,
          modelPath,
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
 * `export const references = { userId: 'User', legacyId: false }` を静的に抽出する。
 * 値が false / null の場合は名前からの推測を無効にする。
 */
export function parseReferences(content: string): Record<string, string | false> {
  const source = ts.createSourceFile("model.ts", content, ts.ScriptTarget.Latest, true);
  const references: Record<string, string | false> = {};
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "references" || !declaration.initializer) continue;
      let initializer = declaration.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (!ts.isObjectLiteralExpression(initializer)) continue;
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
        if (!key) continue;
        const value = property.initializer;
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) references[key] = value.text;
        else if (value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword) references[key] = false;
      }
    }
  }
  return references;
}

function listModelNames(modelPath: string): Set<string> {
  const directory = path.dirname(modelPath);
  const names = new Set<string>();
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts") || entry === "index.ts") continue;
    names.add(toPascalCase(path.basename(entry, ".ts")));
  }
  return names;
}

function applyForeignKeys(
  fields: FieldInfo[],
  modelName: string,
  modelPath: string,
  references: Record<string, string | false>,
  warnings: string[]
): void {
  const models = listModelNames(modelPath);
  for (const field of fields) {
    delete field.isForeignKey;
    delete field.referencedModel;
  }

  for (const [fieldName, target] of Object.entries(references)) {
    const field = fields.find((candidate) => candidate.name === fieldName);
    if (!field) {
      warnings.push(`reference-field-not-found: ${modelName}.references declares ${fieldName}, but the schema has no such field.`);
    } else if (target !== false && (field.type !== "string" || field.isArray || field.enumValues?.length)) {
      warnings.push(`reference-field-unsupported: ${modelName}.${fieldName} must be a single string id to reference ${target}.`);
    } else if (target !== false && !models.has(target)) {
      warnings.push(`reference-model-not-found: ${modelName}.${fieldName} references ${target}, but shared/models has no ${target} model; it is treated as a plain field.`);
    }
  }

  for (const field of fields) {
    if (field.type !== "string" || field.isArray || field.enumValues?.length || field.isNestedSchema) continue;
    const declared = references[field.name];
    if (declared === false) continue;
    const inferred = field.name.length > 2 && field.name.endsWith("Id")
      ? field.name.slice(0, -2).replace(/^./, (char) => char.toUpperCase())
      : undefined;
    const target = declared ?? inferred;
    if (target && models.has(target)) {
      field.isForeignKey = true;
      field.referencedModel = target;
    }
  }
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
  const modelFiles = files.filter(file => file.endsWith('.ts'));
  
  const models: ModelInfo[] = [];
  
  for (const file of modelFiles) {
    try {
      const modelPath = path.join(fullModelsDir, file);
      const modelInfo = await parseModelFile(modelPath);
      models.push(modelInfo);
    } catch (error: any) {
      console.warn(`⚠️  Failed to parse model file ${file}: ${error.message}`);
    }
  }
  
  return models;
}
