/**
 * Zod スキーマ（ModelInfo）からモックデータを自動生成する
 * フィールド名・型のヒューリスティクスで現実的な値を生成
 */

import { ModelInfo, FieldInfo, toCamelCase, toKebabCase } from "../scaffold/model-parser";

/**
 * 単一のモックドキュメントを生成
 */
export function generateMockDocument(
  model: ModelInfo,
  index: number,
  allModels: ModelInfo[] = [model],
  seenModels: Set<string> = new Set()
): Record<string, unknown> {
  const nextSeen = new Set(seenModels);
  nextSeen.add(model.name);

  const doc: Record<string, unknown> = {};
  for (const field of model.fields) {
    doc[field.name] = generateFieldValue(model, field, index, allModels, nextSeen);
  }
  return doc;
}

/**
 * 複数のモックドキュメントを生成
 */
export function generateMockDocuments(
  model: ModelInfo,
  count: number = 5,
  allModels: ModelInfo[] = [model]
): Record<string, unknown>[] {
  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    docs.push(generateMockDocument(model, i + 1, allModels));
  }
  return docs;
}

// ─── Field Value Generation ─────────────────────────────────

function generateFieldValue(
  model: ModelInfo,
  field: FieldInfo,
  index: number,
  allModels: ModelInfo[],
  seenModels: Set<string>
): unknown {
  // ネストされたスキーマ
  if (field.isNestedSchema && field.nestedModelName) {
    const nestedModel = allModels.find((m) => m.name === field.nestedModelName);
    if (nestedModel && !seenModels.has(nestedModel.name)) {
      const nested = generateMockDocument(nestedModel, index, allModels, seenModels);
      return field.isArray ? [nested] : nested;
    }
    const fallback = { id: `${toKebabCase(field.nestedModelName!)}-${padIndex(index)}` };
    return field.isArray ? [fallback] : fallback;
  }

  if (field.isArray) {
    return [generateScalarValue(model, field, index)];
  }

  return generateScalarValue(model, field, index);
}

function generateScalarValue(
  model: ModelInfo,
  field: FieldInfo,
  index: number
): unknown {
  const name = field.name.toLowerCase();
  const modelKebab = toKebabCase(model.name);

  // id フィールド
  if (field.name === "id") {
    return `${modelKebab}-${padIndex(index)}`;
  }

  // enum フィールド — ラウンドロビン
  if (field.enumValues && field.enumValues.length > 0) {
    return field.enumValues[(index - 1) % field.enumValues.length];
  }

  // boolean フィールド
  if (field.type === "boolean") {
    return index % 2 === 0;
  }

  // number フィールド
  if (field.type === "number") {
    return generateNumberValue(name, index);
  }

  // date フィールド / *At パターン
  if (field.type === "date" || name.endsWith("at")) {
    return generateDateValue(index);
  }

  // object フィールド
  if (field.type === "object") {
    return {};
  }

  // string フィールド — 名前パターンで分岐
  return generateStringValue(model, field, index);
}

function generateStringValue(model: ModelInfo, field: FieldInfo, index: number): string {
  const name = field.name.toLowerCase();
  const modelKebab = toKebabCase(model.name);

  // email
  if (name.includes("email") || name.includes("mail")) {
    return `${modelKebab}-${padIndex(index)}@example.com`;
  }

  // URL / ウェブサイト
  if (name.includes("url") || name.includes("website") || name.includes("link") || name === "href") {
    return `https://example.com/${modelKebab}/${padIndex(index)}`;
  }

  // 電話番号
  if (name.includes("phone") || name.includes("tel")) {
    return `090-0000-${String(index).padStart(4, "0")}`;
  }

  // 名前系
  if (name === "name" || name === "displayname" || name === "fullname" || name === "username") {
    return `${model.name} ${index}`;
  }
  if (name === "firstname" || name === "givenname") {
    return `FirstName${index}`;
  }
  if (name === "lastname" || name === "familyname" || name === "surname") {
    return `LastName${index}`;
  }

  // タイトル / 件名
  if (name === "title" || name === "subject" || name === "summary") {
    return `Sample ${model.displayName || model.name} ${index}`;
  }

  // 説明 / 本文
  if (name === "description" || name === "body" || name === "content" || name === "text") {
    return `This is a sample ${toCamelCase(model.name)} description for item ${index}.`;
  }

  // コード / キー
  if (name.includes("code") || name.includes("key") && !name.includes("api")) {
    return `${modelKebab.toUpperCase().replace(/-/g, "_")}-${String(index).padStart(3, "0")}`;
  }

  // ステータス
  if (name === "status") {
    const statuses = ["active", "inactive", "pending"];
    return statuses[(index - 1) % statuses.length];
  }

  // タイプ / カテゴリ
  if (name === "type" || name === "category") {
    return `type-${((index - 1) % 3) + 1}`;
  }

  // 住所
  if (name.includes("address") || name.includes("city") || name.includes("country")) {
    return `Address ${index}`;
  }

  // 部署
  if (name === "department" || name === "team" || name === "group") {
    const depts = ["Engineering", "Sales", "Marketing", "Support", "HR"];
    return depts[(index - 1) % depts.length];
  }

  // *Id パターン（外部キー）
  if (name.endsWith("id") && name !== "id") {
    const refName = field.name.replace(/Id$/, "");
    return `${toKebabCase(refName)}-${padIndex(((index - 1) % 3) + 1)}`;
  }

  // デフォルト
  return `${modelKebab}-${toKebabCase(field.name)}-${index}`;
}

function generateNumberValue(name: string, index: number): number {
  if (name.includes("age")) return 20 + index;
  if (name.includes("price") || name.includes("cost") || name.includes("amount")) return index * 1000;
  if (name.includes("count") || name.includes("quantity") || name.includes("qty")) return index * 5;
  if (name.includes("priority") || name.includes("order") || name.includes("sort")) return index;
  if (name.includes("rating") || name.includes("score")) return Math.min(index, 5);
  return index;
}

function generateDateValue(index: number): string {
  const baseDate = new Date("2026-01-01T00:00:00.000Z");
  baseDate.setDate(baseDate.getDate() + index);
  return baseDate.toISOString();
}

function padIndex(index: number): string {
  return String(index).padStart(3, "0");
}
