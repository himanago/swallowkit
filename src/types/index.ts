/**
 * SwallowKit の基本型定義
 */

// サーバー関数の実行モード
export type ServerFnMode = "auto" | "force-server" | "force-client";

export type BackendLanguage = "typescript" | "csharp" | "python";

// useServerFn のオプション
export interface UseServerFnOptions {
  mode?: ServerFnMode;
  refetchOnMount?: boolean;
  enabled?: boolean;
  // Next.js キャッシュオプション（内部で使用）
  cache?: boolean;
  revalidate?: number | false;
  tags?: string[];
}

// useServerFn の戻り値
export interface UseServerFnResult<TResult> {
  data: TResult | null;
  loading: boolean;
  error: any;
  refetch: () => void;
}

// コネクタの操作種別
export type ConnectorOperation = "getAll" | "getById" | "create" | "update" | "delete";

// RDB コネクタ設定
export interface RdbConnectorConfig {
  type: "rdb";
  provider: "mysql" | "postgres" | "sqlserver";
  connectionEnvVar: string;
}

// API コネクタの認証設定
export interface ApiConnectorAuth {
  type: "apiKey" | "bearer" | "oauth2";
  envVar: string;
  placement?: "query" | "header";
  paramName?: string;
}

// API コネクタ設定
export interface ApiConnectorConfig {
  type: "api";
  baseUrlEnvVar: string;
  auth?: ApiConnectorAuth;
}

// コネクタ設定の共用型
export type ConnectorDefinition = RdbConnectorConfig | ApiConnectorConfig;

// モデルに付与するコネクタメタデータ（RDB用）
export interface RdbModelConnectorConfig {
  connector: string;
  operations: readonly ConnectorOperation[];
  table: string;
  idColumn?: string;
}

// モデルに付与するコネクタメタデータ（API用）
export interface ApiModelConnectorConfig {
  connector: string;
  operations: readonly ConnectorOperation[];
  endpoints?: Partial<Record<ConnectorOperation, string>>;
}

// モデルに付与するコネクタメタデータの共用型
export type ModelConnectorConfig = RdbModelConnectorConfig | ApiModelConnectorConfig;

// CLI設定の型
export interface SwallowKitConfig {
  database?: {
    connectionString?: string;
    databaseName?: string;
  };
  backend?: {
    language?: BackendLanguage;
  };
  api?: {
    endpoint?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
  };
  connectors?: Record<string, ConnectorDefinition>;
}
