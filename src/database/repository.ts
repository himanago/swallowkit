import { z } from "zod";
import { getDatabaseClient } from "./client";

/**
 * Zodスキーマベースのデータベース操作ヘルパー
 */
export class SchemaRepository<T extends Record<string, any>> {
  constructor(
    private containerName: string,
    private schema: z.ZodSchema<T>
  ) {}

  /**
   * ドキュメントを作成（バリデーション付き）
   */
  async create(data: T): Promise<T> {
    const validatedData = this.schema.parse(data);
    const client = getDatabaseClient();
    return client.createDocument(this.containerName, validatedData);
  }

  /**
   * ドキュメントを取得
   */
  async findById(id: string): Promise<T | null> {
    const client = getDatabaseClient();
    const document = await client.getDocument<T>(this.containerName, id);
    
    if (!document) return null;
    
    // データをバリデーション
    return this.schema.parse(document);
  }

  /**
   * ドキュメントを更新（バリデーション付き）
   */
  async update(data: T): Promise<T> {
    const validatedData = this.schema.parse(data);
    const client = getDatabaseClient();
    return client.updateDocument(this.containerName, validatedData);
  }

  /**
   * ドキュメントを削除
   */
  async delete(id: string): Promise<void> {
    const client = getDatabaseClient();
    return client.deleteDocument(this.containerName, id);
  }

  /**
   * 全てのドキュメントを取得
   */
  async findAll(): Promise<T[]> {
    const client = getDatabaseClient();
    const documents = await client.query<T>(
      this.containerName,
      "SELECT * FROM c"
    );
    
    // 全てのドキュメントをバリデーション
    return documents.map(doc => this.schema.parse(doc));
  }

  /**
   * 条件付きクエリ
   */
  async findWhere(condition: string, parameters?: any[]): Promise<T[]> {
    const client = getDatabaseClient();
    const query = `SELECT * FROM c WHERE ${condition}`;
    const documents = await client.query<T>(this.containerName, query, parameters);
    
    return documents.map(doc => this.schema.parse(doc));
  }
}

/**
 * 簡単なリポジトリ作成ヘルパー
 */
export function createRepository<T extends Record<string, any>>(
  containerName: string,
  schema: z.ZodSchema<T>
): SchemaRepository<T> {
  return new SchemaRepository(containerName, schema);
}

/**
 * よく使われるスキーマの例
 */
export const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type Todo = z.infer<typeof TodoSchema>;

/**
 * Todo専用リポジトリの例
 */
export const TodoRepository = createRepository("todos", TodoSchema);
