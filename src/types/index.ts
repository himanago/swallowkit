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

// CLI設定の型
export interface SwallowKitConfig {
  database?: {
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
}
