/**
 * SwallowKit の基本型定義
 */

// サーバー関数の実行モード
export type ServerFnMode = "auto" | "force-server" | "force-client";

// useServerFn のオプション
export interface UseServerFnOptions {
  mode?: ServerFnMode;
  refetchOnMount?: boolean;
  enabled?: boolean;
}

// useServerFn の戻り値
export interface UseServerFnResult<TResult> {
  data: TResult | null;
  loading: boolean;
  error: any;
  refetch: () => void;
}

// サーバー関数の型
export type ServerFunction<TArgs extends any[], TResult> = (
  ...args: TArgs
) => Promise<TResult> | TResult;

// サーバー関数の定義（型安全な関数名を含む）
export interface ServerFunctionDefinition<TArgs extends any[] = any[], TResult = any> {
  fn: ServerFunction<TArgs, TResult>;
  name: string;
  id: string; // 一意の識別子（minify時も保持）
}

// 型安全なサーバー関数ファクトリ
export interface ServerFnFactory<TArgs extends any[], TResult> {
  (...args: TArgs): Promise<TResult>;
  __swallowkit_id: string;
  __swallowkit_name: string;
}

// RPC リクエストの型
export interface RPCRequest {
  fnName: string;
  args: any[];
}

// RPC レスポンスの型
export interface RPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// CLI設定の型
export interface SwallowKitConfig {
  database?: {
    type?: "cosmos" | "mock";
    connectionString?: string;
    databaseName?: string;
  };
  api?: {
    endpoint?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
  };
  functions?: {
    outputDir?: string;
  };
}
