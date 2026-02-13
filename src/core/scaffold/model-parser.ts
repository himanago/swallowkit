/**
 * Zod モデルファイルを解析して、スキーマ情報を抽出する
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

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
}

export interface FieldInfo {
  name: string;
  type: string; // "string" | "number" | "boolean" | "date" | "object" | "array"
  isOptional: boolean;
  isArray: boolean;
  enumValues?: string[]; // enum の場合の選択肢
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
export async function parseModelFile(modelPath: string): Promise<ModelInfo> {
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }

  const content = fs.readFileSync(modelPath, "utf-8");
  const fileName = path.basename(modelPath, ".ts");
  
  // モデル名を推定（ファイル名を PascalCase に変換）
  const modelName = toPascalCase(fileName);
  
  // スキーマ変数名を抽出
  // パターン1: export const todoSchema = z.object({ ... })  (camelCase + Schema接尾辞)
  // パターン2: export const Todo = z.object({ ... })         (Zod公式パターン)
  let schemaMatch = content.match(/export\s+const\s+(\w+Schema)\s*=/);
  if (!schemaMatch) {
    schemaMatch = content.match(/export\s+const\s+(\w+)\s*=\s*z\.object\s*\(/);
  }
  if (!schemaMatch) {
    throw new Error(`Could not find exported schema in ${modelPath}. Expected patterns:\n  - export const xxxSchema = z.object({ ... })\n  - export const Xxx = z.object({ ... })`);
  }
  
  const schemaName = schemaMatch[1];
  
  // displayName を抽出（例: export const displayName = 'Task'）
  const displayNameMatch = content.match(/export\s+const\s+displayName\s*=\s*['"]([^'"]+)['"]/);  
  const displayName = displayNameMatch ? displayNameMatch[1] : modelName;
  
  // ネストしたスキーマ参照を検出
  const nestedSchemaRefs = detectNestedSchemaRefs(modelPath, content, schemaName);
  
  // フィールド情報を抽出（動的インポートを使用）
  const fields = await extractFieldsFromSchema(modelPath, schemaName);
  
  // ネストスキーマ情報をフィールドにマージ
  mergeNestedSchemaInfo(fields, nestedSchemaRefs);
  
  // id フィールドの存在確認
  const hasId = fields.some(f => f.name === "id");
  const hasCreatedAt = fields.some(f => f.name === "createdAt");
  const hasUpdatedAt = fields.some(f => f.name === "updatedAt");
  
  return {
    name: modelName,
    displayName,
    schemaName,
    filePath: modelPath,
    fields,
    hasId,
    hasCreatedAt,
    hasUpdatedAt,
    nestedSchemaRefs,
  };
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

/**
 * Zodスキーマから動的にフィールド情報を抽出
 */
async function extractFieldsFromSchema(modelPath: string, schemaName: string): Promise<FieldInfo[]> {
  const fields: FieldInfo[] = [];
  
  try {
    // child_processでtsxを実行
    const { execSync } = require('child_process');
    const { tmpdir } = require('os');
    const { join } = require('path');
    const { writeFileSync, unlinkSync, readFileSync } = require('fs');
    
    // モデルファイルの内容を読み込む
    let modelContent = readFileSync(modelPath, 'utf8');
    const modelDir = path.dirname(path.resolve(modelPath));
    
    // ローカル相対インポートを絶対パスの .mjs import 文に変換して保持
    // パターン: import { categorySchema } from './category'
    const localImports: string[] = [];
    modelContent = modelContent.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]\s*;?/g,
      (_match: string, imports: string, importPath: string) => {
        // インポートされた変数名を取得
        const importedNames = imports.split(',').map(s => {
          const trimmed = s.trim();
          // 'as' エイリアスに対応
          return trimmed.split(/\s+as\s+/).pop()!.trim();
        }).filter(s => s.length > 0);
        
        // 相対パスを絶対パスに解決
        let resolvedPath = path.resolve(modelDir, importPath);
        if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.js')) {
          resolvedPath += '.ts';
        }
        if (fs.existsSync(resolvedPath)) {
          // インポート先の内容を読み込み、インライン化する
          let refContent = readFileSync(resolvedPath, 'utf8');
          // インポート先の import 文を除去
          refContent = refContent.replace(/import\s+.*?\s+from\s+['"](?!\.).*?['"];?\s*/g, '');
          refContent = refContent.replace(/import\s+.*?\s+from\s+['"]\..*?['"];?\s*/g, '');
          refContent = refContent.replace(/export\s+(const|type|interface|class|function)\s+/g, '$1 ');
          refContent = refContent.replace(/^type\s+\w+\s*=\s*[^;]+;/gm, '');
          refContent = refContent.replace(/^interface\s+\w+\s*\{[\s\S]*?\}/gm, '');
          refContent = refContent.replace(/\/\*[\s\S]*?\*\//g, '');
          refContent = refContent.replace(/\/\/.*/g, '');
          
          // インポートされていない const 宣言を除去（displayName 等の重複を防ぐ）
          const importedNameSet = new Set(importedNames);
          refContent = refContent.replace(/^const\s+(\w+)\s*=\s*[^;]+;/gm, (constMatch: string, varName: string) => {
            return importedNameSet.has(varName) ? constMatch : '';
          });
          
          localImports.push(refContent.trim());
        }
        return ''; // 元のインポート文は除去
      }
    );
    
    // zod 以外のパッケージインポートを除去
    modelContent = modelContent.replace(/import\s+.*?\s+from\s+['"].*?['"];?\s*/g, '');
    modelContent = modelContent.replace(/export\s+(const|type|interface|class|function)\s+/g, '$1 ');
    // type宣言を削除（ランタイムでは不要）
    modelContent = modelContent.replace(/^type\s+\w+\s*=\s*[^;]+;/gm, '');
    // interface宣言を削除（ランタイムでは不要、複数行対応）
    modelContent = modelContent.replace(/^interface\s+\w+\s*\{[\s\S]*?\}/gm, '');
    // コメントを削除
    modelContent = modelContent.replace(/\/\*[\s\S]*?\*\//g, '');
    modelContent = modelContent.replace(/\/\/.*/g, '');
    
    // インライン化したローカルインポートを先頭に追加
    const inlinedDeps = localImports.length > 0 ? localImports.join('\n\n') + '\n\n' : '';
    
    // プロジェクトルートを探す（package.jsonがある場所）
    let projectRoot = path.dirname(modelPath);
    while (projectRoot !== path.dirname(projectRoot)) {
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        break;
      }
      projectRoot = path.dirname(projectRoot);
    }
    
    // プロジェクトルート内に一時スクリプトファイルを作成
    const tempScript = path.join(projectRoot, `.swallowkit-parser-${Date.now()}.mjs`);
    const scriptCode = `
import { z } from 'zod/v4';

// インライン化した依存スキーマ
${inlinedDeps}
// モデルファイルの内容を評価
${modelContent}

const schema = ${schemaName};

// Zod v3とv4の両方に対応
const isObject = (schema && schema._def && 
  (schema._def.typeName === 'ZodObject' || schema.constructor?.name === 'ZodObject' || typeof schema._def.shape === 'function'));

if (isObject) {
  const shape = typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape;
  const fields = Object.keys(shape).map(key => {
    const field = shape[key];
    let type = 'string';
    let isOptional = false;
    let isArray = false;
    let enumValues = undefined;
    
    // ZodOptional, ZodDefault, ZodEffects を unwrap
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
      fieldDef = fieldDef._def.type || fieldDef._def.element;
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
    
    return { name: key, type, isOptional, isArray, enumValues, isForeignKey, referencedModel };
  });
  
  console.log(JSON.stringify(fields));
}
`;
    
    writeFileSync(tempScript, scriptCode, 'utf8');
    
    try {
      // プロジェクトルートでtsxを実行
      const result = execSync(`npx tsx "${tempScript}"`, {
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
        unlinkSync(tempScript);
      } catch (e) {
        // ファイル削除失敗は無視
      }
    }
  } catch (error) {
    // tsxが使えない場合は正規表現フォールバック
    console.warn('Failed to use dynamic import, falling back to regex parsing');
    console.warn('Error:', error);
    return extractFieldsWithRegex(modelPath, schemaName);
  }
  
  return fields;
}

/**
 * 正規表現でフィールド情報を抽出（フォールバック用）
 */
function extractFieldsWithRegex(modelPath: string, schemaName: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const content = fs.readFileSync(modelPath, "utf-8");
  
  // z.object({ ... }) の内容を抽出（ネストした括弧に対応）
  const objectContent = extractObjectContent(content, schemaName);
  
  if (!objectContent) {
    return fields;
  }
  
  // 各フィールドを解析
  const fieldRegex = /(\w+)\s*:\s*(z\.\w+)/g;
  let match;
  
  while ((match = fieldRegex.exec(objectContent)) !== null) {
    const fieldName = match[1];
    const zodDef = match[2];
    const zodType = zodDef.split('.')[1];
    
    const fieldStart = match.index;
    const fieldEnd = objectContent.indexOf(',', fieldStart);
    const fieldDef = fieldEnd > -1 
      ? objectContent.substring(fieldStart, fieldEnd) 
      : objectContent.substring(fieldStart);
    
    fields.push({
      name: fieldName,
      type: mapZodTypeToTs(zodType),
      isOptional: fieldDef.includes(".optional()"),
      isArray: fieldDef.includes(".array()"),
    });
  }
  
  return fields;
}

/**
 * Zod 型を TypeScript 型にマッピング
 */
function mapZodTypeToTs(zodType: string): string {
  const typeMap: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    date: "Date",
    object: "object",
    array: "array",
  };
  
  return typeMap[zodType] || "any";
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
 * 文字列を kebab-case に変換
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * models ディレクトリから全てのモデル情報を取得
 * @param modelsDir モデルディレクトリのパス（デフォルト: "lib/models"）
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
