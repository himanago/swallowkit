/**
 * Zod モデルファイルを解析して、スキーマ情報を抽出する
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

export interface ModelInfo {
  name: string; // モデル名（例: "Todo"）
  schemaName: string; // スキーマ変数名（例: "todoSchema"）
  filePath: string; // モデルファイルの絶対パス
  fields: FieldInfo[]; // フィールド情報
  hasId: boolean; // id フィールドがあるか
  hasCreatedAt: boolean; // createdAt フィールドがあるか
  hasUpdatedAt: boolean; // updatedAt フィールドがあるか
}

export interface FieldInfo {
  name: string;
  type: string; // "string" | "number" | "boolean" | "date" | "object" | "array"
  isOptional: boolean;
  isArray: boolean;
  enumValues?: string[]; // enum の場合の選択肢
  isForeignKey?: boolean; // 外部キーかどうか
  referencedModel?: string; // 参照先のモデル名（例: "Category"）
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
  
  // スキーマ変数名を抽出（例: export const todoSchema = z.object({ ... })）
  const schemaMatch = content.match(/export\s+const\s+(\w+Schema)\s*=/);
  if (!schemaMatch) {
    throw new Error(`Could not find exported schema in ${modelPath}. Expected pattern: export const xxxSchema = z.object({ ... })`);
  }
  
  const schemaName = schemaMatch[1];
  
  // フィールド情報を抽出（動的インポートを使用）
  const fields = await extractFieldsFromSchema(modelPath, schemaName);
  
  // id フィールドの存在確認
  const hasId = fields.some(f => f.name === "id");
  const hasCreatedAt = fields.some(f => f.name === "createdAt");
  const hasUpdatedAt = fields.some(f => f.name === "updatedAt");
  
  return {
    name: modelName,
    schemaName,
    filePath: modelPath,
    fields,
    hasId,
    hasCreatedAt,
    hasUpdatedAt,
  };
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
    
    // import文とexport文を除去（重複を防ぎ、スコープ内で評価できるようにする）
    modelContent = modelContent.replace(/import\s+.*?\s+from\s+['"].*?['"];?\s*/g, '');
    modelContent = modelContent.replace(/export\s+(const|type|interface|class|function)\s+/g, '$1 ');
    // type宣言を削除（ランタイムでは不要）
    modelContent = modelContent.replace(/^type\s+\w+\s*=\s*[^;]+;/gm, '');
    // interface宣言を削除（ランタイムでは不要、複数行対応）
    modelContent = modelContent.replace(/^interface\s+\w+\s*\{[\s\S]*?\}/gm, '');
    // コメントを削除
    modelContent = modelContent.replace(/\/\*[\s\S]*?\*\//g, '');
    modelContent = modelContent.replace(/\/\/.*/g, '');
    
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
import { z } from 'zod';

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
  const objectRegex = new RegExp(`${schemaName}\\s*=\\s*z\\.object\\(\\{`, "s");
  const objectStart = content.search(objectRegex);
  
  if (objectStart === -1) {
    return fields;
  }
  
  // 開始位置を { の位置まで進める
  const braceStart = content.indexOf('{', objectStart);
  let braceCount = 1;
  let objectEnd = braceStart + 1;
  
  // 対応する } を見つける
  while (braceCount > 0 && objectEnd < content.length) {
    if (content[objectEnd] === '{') braceCount++;
    if (content[objectEnd] === '}') braceCount--;
    objectEnd++;
  }
  
  const objectContent = content.substring(braceStart + 1, objectEnd - 1);
  
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
