import { CosmosClient, Database, Container } from "@azure/cosmos";
import { SwallowKitConfig } from "../types/index.js";
import { ensureServerSide } from "./runtime-check.js";

/**
 * Cosmos DB クライアントの管理
 */
export class DatabaseClient {
  private client: CosmosClient | null = null;
  private database: Database | null = null;
  private containers: Map<string, Container> = new Map();

  constructor(private config: SwallowKitConfig) {}

  /**
   * データベースに接続
   */
  async connect(): Promise<void> {
    ensureServerSide('Database connection');

    if (!this.config.database?.connectionString) {
      throw new Error("Cosmos DB connection string が設定されていません");
    }

    this.client = new CosmosClient(this.config.database.connectionString);
    
    const databaseName = this.config.database.databaseName || "SwallowKitDB";
    const { database } = await this.client.databases.createIfNotExists({
      id: databaseName,
    });
    
    this.database = database;
    console.log(`📦 Cosmos DB に接続しました: ${databaseName}`);
  }

  /**
   * コンテナを取得
   */
  async getContainer(containerName: string): Promise<Container> {
    ensureServerSide('Get container');

    if (!this.database) {
      await this.connect();
    }

    if (!this.containers.has(containerName)) {
      const { container } = await this.database!.containers.createIfNotExists({
        id: containerName,
        partitionKey: "/id",
      });
      this.containers.set(containerName, container);
    }

    return this.containers.get(containerName)!;
  }

  /**
   * ドキュメントを作成
   */
  async createDocument<T extends Record<string, any>>(containerName: string, document: T): Promise<T> {
    ensureServerSide('Create document');

    const container = await this.getContainer(containerName);
    const { resource } = await container.items.create(document as any);
    return resource as T;
  }

  /**
   * ドキュメントを取得
   */
  async getDocument<T extends Record<string, any>>(containerName: string, id: string): Promise<T | null> {
    ensureServerSide('Get document');

    const container = await this.getContainer(containerName);
    
    try {
      const { resource } = await container.item(id, id).read();
      return resource as T || null;
    } catch (error: any) {
      if (error.code === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * ドキュメントを更新
   */
  async updateDocument<T extends Record<string, any>>(containerName: string, document: T): Promise<T> {
    ensureServerSide('Update document');

    const container = await this.getContainer(containerName);
    const { resource } = await container.items.upsert(document as any);
    return resource as unknown as T;
  }

  /**
   * ドキュメントを削除
   */
  async deleteDocument(containerName: string, id: string): Promise<void> {
    ensureServerSide('Delete document');

    const container = await this.getContainer(containerName);
    await container.item(id, id).delete();
  }

  /**
   * クエリを実行
   */
  async query<T>(containerName: string, query: string, parameters?: any[]): Promise<T[]> {
    ensureServerSide('Query');

    const container = await this.getContainer(containerName);
    const { resources } = await container.items.query<T>({
      query,
      parameters,
    }).fetchAll();
    
    return resources;
  }
}

/**
 * グローバルデータベースクライアント
 */
let globalDatabaseClient: DatabaseClient | null = null;

export function getDatabaseClient(config?: SwallowKitConfig): DatabaseClient {
  if (!globalDatabaseClient) {
    if (!config) {
      throw new Error(
        "DatabaseClient is not initialized. " +
        "Please provide a config or initialize it first."
      );
    }
    globalDatabaseClient = new DatabaseClient(config);
  }
  return globalDatabaseClient;
}
