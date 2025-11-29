import { z } from "zod";
import { getDatabaseClient } from "./client.js";
import { ensureServerSide } from "./runtime-check.js";

/**
 * BaseModel 抽象クラス
 * Cosmos DB ドキュメントのモデルを定義するための基底クラス
 * 
 * @example
 * ```typescript
 * export class User extends BaseModel {
 *   static schema = z.object({
 *     id: z.string(),
 *     email: z.string().email(),
 *     name: z.string(),
 *   });
 *   
 *   static container = "Users";
 *   static partitionKey = "/email";
 *   
 *   static async findByEmail(email: string) {
 *     const users = await this.find('c.email = @email', [email]);
 *     return users[0] || null;
 *   }
 * }
 * ```
 */
export abstract class BaseModel {
  /**
   * Zod スキーマ（サブクラスで定義）
   */
  static schema: z.ZodObject<any>;

  /**
   * Cosmos DB コンテナ名（サブクラスで定義）
   */
  static container: string;

  /**
   * パーティションキー（サブクラスで定義）
   * @example "/email" or "/id"
   */
  static partitionKey: string;

  /**
   * データベースクライアントを取得
   */
  protected static getClient() {
    return getDatabaseClient();
  }

  /**
   * ドキュメントを作成
   * @param data ドキュメントデータ
   * @returns 作成されたドキュメント
   */
  static async create<T = any>(data: T): Promise<T> {
    ensureServerSide(`${this.name}.create`);

    // Zodスキーマでバリデーション
    const validated = this.schema.parse(data);

    const client = this.getClient();
    const result = await client.createDocument(this.container, validated);
    
    return result as T;
  }

  /**
   * ID でドキュメントを取得
   * @param id ドキュメントID
   * @returns ドキュメント（見つからない場合は null）
   */
  static async findById<T = any>(id: string): Promise<T | null> {
    ensureServerSide(`${this.name}.findById`);

    const client = this.getClient();
    const result = await client.getDocument(this.container, id);
    
    if (!result) {
      return null;
    }

    // Zodスキーマでバリデーション
    return this.schema.parse(result) as T;
  }

  /**
   * クエリでドキュメントを検索
   * @param query SQL クエリの WHERE 句部分（省略時は全件取得）
   * @param parameters クエリパラメータ
   * @returns ドキュメントの配列
   */
  static async find<T = any>(query?: string, parameters?: any[]): Promise<T[]> {
    ensureServerSide(`${this.name}.find`);

    const client = this.getClient();
    
    const fullQuery = query 
      ? `SELECT * FROM c WHERE ${query}`
      : `SELECT * FROM c`;
    
    const results = await client.query(this.container, fullQuery, parameters);
    
    // 各ドキュメントをZodスキーマでバリデーション
    return results.map((result) => this.schema.parse(result)) as T[];
  }

  /**
   * ドキュメントを更新
   * @param data 更新するドキュメントデータ（id フィールド必須）
   * @returns 更新されたドキュメント
   */
  static async update<T = any>(data: T): Promise<T> {
    ensureServerSide(`${this.name}.update`);

    // Zodスキーマでバリデーション
    const validated = this.schema.parse(data);

    if (!(validated as any).id) {
      throw new Error(`${this.name}.update requires an 'id' field`);
    }

    const client = this.getClient();
    const result = await client.updateDocument(this.container, validated);
    
    return result as T;
  }

  /**
   * ドキュメントを削除
   * @param id ドキュメントID
   */
  static async delete(id: string): Promise<void> {
    ensureServerSide(`${this.name}.delete`);

    const client = this.getClient();
    await client.deleteDocument(this.container, id);
  }

  /**
   * カスタムクエリを実行
   * @param query 完全な SQL クエリ
   * @param parameters クエリパラメータ
   * @returns ドキュメントの配列
   */
  static async query<T = any>(query: string, parameters?: any[]): Promise<T[]> {
    ensureServerSide(`${this.name}.query`);

    const client = this.getClient();
    const results = await client.query(this.container, query, parameters);
    
    // 各ドキュメントをZodスキーマでバリデーション
    return results.map((result) => this.schema.parse(result)) as T[];
  }
}
