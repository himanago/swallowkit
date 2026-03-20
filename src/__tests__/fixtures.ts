import { ModelInfo } from "../core/scaffold/model-parser";

/**
 * テスト用の基本的な ModelInfo フィクスチャ
 */
export function createBasicModelInfo(overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    name: "Todo",
    displayName: "Todo",
    schemaName: "todoSchema",
    filePath: "/models/todo.ts",
    fields: [
      { name: "id", type: "string", isOptional: false, isArray: false },
      { name: "title", type: "string", isOptional: false, isArray: false },
      { name: "description", type: "string", isOptional: true, isArray: false },
      { name: "completed", type: "boolean", isOptional: false, isArray: false },
      { name: "createdAt", type: "string", isOptional: false, isArray: false },
      { name: "updatedAt", type: "string", isOptional: false, isArray: false },
    ],
    hasId: true,
    hasCreatedAt: true,
    hasUpdatedAt: true,
    nestedSchemaRefs: [],
    ...overrides,
  };
}

/**
 * 外部キーを含む ModelInfo フィクスチャ
 */
export function createModelInfoWithForeignKey(): ModelInfo {
  return createBasicModelInfo({
    name: "Task",
    displayName: "Task",
    schemaName: "taskSchema",
    filePath: "/models/task.ts",
    fields: [
      { name: "id", type: "string", isOptional: false, isArray: false },
      { name: "title", type: "string", isOptional: false, isArray: false },
      {
        name: "categoryId",
        type: "string",
        isOptional: false,
        isArray: false,
        isForeignKey: true,
        referencedModel: "Category",
      },
      { name: "createdAt", type: "string", isOptional: false, isArray: false },
      { name: "updatedAt", type: "string", isOptional: false, isArray: false },
    ],
  });
}

/**
 * enum フィールドを含む ModelInfo フィクスチャ
 */
export function createModelInfoWithEnum(): ModelInfo {
  return createBasicModelInfo({
    name: "Issue",
    displayName: "Issue",
    schemaName: "issueSchema",
    filePath: "/models/issue.ts",
    fields: [
      { name: "id", type: "string", isOptional: false, isArray: false },
      { name: "title", type: "string", isOptional: false, isArray: false },
      {
        name: "status",
        type: "string",
        isOptional: false,
        isArray: false,
        enumValues: ["open", "in_progress", "closed"],
      },
      {
        name: "priority",
        type: "number",
        isOptional: true,
        isArray: false,
      },
      { name: "createdAt", type: "string", isOptional: false, isArray: false },
      { name: "updatedAt", type: "string", isOptional: false, isArray: false },
    ],
  });
}
