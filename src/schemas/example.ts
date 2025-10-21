import { z } from 'zod';

// Todo スキーマの例
export const TodoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "テキストは必須です"),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Todo = z.infer<typeof TodoSchema>;

// User スキーマの例
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email("有効なメールアドレスを入力してください"),
  name: z.string().min(1, "名前は必須です"),
  avatar: z.string().url().optional(),
  role: z.enum(['user', 'admin']).default('user'),
  preferences: z.object({
    theme: z.enum(['light', 'dark']).default('light'),
    language: z.string().default('ja'),
    notifications: z.boolean().default(true),
  }).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

// Project スキーマの例（階層構造のデモ）
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "プロジェクト名は必須です"),
  description: z.string().optional(),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  ownerId: z.string(), // User.id への参照
  memberIds: z.array(z.string()).default([]), // User.id の配列
  settings: z.object({
    isPublic: z.boolean().default(false),
    allowComments: z.boolean().default(true),
    autoArchive: z.boolean().default(false),
  }).default({}),
  metrics: z.object({
    totalTasks: z.number().default(0),
    completedTasks: z.number().default(0),
    activeMembers: z.number().default(0),
  }).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

// API リクエスト/レスポンス スキーマの例
export const CreateTodoRequestSchema = z.object({
  text: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

export const UpdateTodoRequestSchema = z.object({
  text: z.string().min(1).optional(),
  completed: z.boolean().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

export const ListTodosRequestSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  status: z.enum(['all', 'active', 'completed']).default('all'),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'dueDate', 'priority']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const ListTodosResponseSchema = z.object({
  items: z.array(TodoSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});

// バリデーション関数の例
export function validateCreateTodoRequest(data: unknown) {
  return CreateTodoRequestSchema.parse(data);
}

export function validateTodo(data: unknown) {
  return TodoSchema.parse(data);
}

// スキーマメタデータ（API生成用）
export const SCHEMA_METADATA = {
  Todo: {
    schema: TodoSchema,
    tableName: 'todos',
    partitionKey: 'id',
    searchableFields: ['text', 'tags'],
    sortableFields: ['createdAt', 'updatedAt', 'dueDate', 'priority'],
    filterableFields: ['completed', 'priority', 'tags'],
    operations: {
      create: { requestSchema: CreateTodoRequestSchema },
      update: { requestSchema: UpdateTodoRequestSchema },
      list: { 
        requestSchema: ListTodosRequestSchema,
        responseSchema: ListTodosResponseSchema 
      },
    },
  },
  User: {
    schema: UserSchema,
    tableName: 'users',
    partitionKey: 'id',
    searchableFields: ['name', 'email'],
    sortableFields: ['createdAt', 'updatedAt', 'name'],
    filterableFields: ['role'],
  },
  Project: {
    schema: ProjectSchema,
    tableName: 'projects',
    partitionKey: 'ownerId', // パーティション分散を考慮
    searchableFields: ['name', 'description'],
    sortableFields: ['createdAt', 'updatedAt', 'name'],
    filterableFields: ['status', 'ownerId'],
    relationships: {
      owner: { schema: 'User', field: 'ownerId' },
      members: { schema: 'User', field: 'memberIds', type: 'array' },
    },
  },
} as const;
