/**
 * SwallowKit - Azure Static Web Apps向けReact Hooksベースフレームワーク
 * メインエクスポート
 */

// フック
export { useServerFn, useTypedServerFn, setRpcEndpoint, getRpcEndpoint, callServerFn } from "./hooks/useServerFn";
export { 
  useQuery, 
  useSchemaQuery, 
  useSchemaMutation,
  type UseQueryOptions,
  type UseQueryResult,
} from "./hooks/useQuery";

// ミューテーション・楽観的更新（Next.js統合）
export { useMutation, type UseMutationOptions, type UseMutationResult } from "./hooks/useMutation";
export { useOptimistic } from "./next/use-optimistic";

// Next.js 統合（内部で使用、高度なユーザー向けに公開）
export { revalidatePath, revalidateTag } from "./next/server-action-wrapper";

// サーバー関数レジストリ
export {
  registerServerFunction,
  registerServerFunctions,
  defineServerFunction,
  getServerFunctionName,
  getServerFunctionDefinition,
  getServerFunctionById,
  getServerFunctionId,
  isServerFunctionRegistered,
  getRegisteredFunctions,
  clearServerFunctionRegistry,
  autoRegisterServerFunctions,
  getRegistryDebugInfo,
} from "./hooks/server-function-registry";

// 型定義
export type {
  ServerFunction,
  ServerFunctionDefinition,
  ServerFnFactory,
  UseServerFnOptions,
  UseServerFnResult,
  ServerFnMode,
  RPCRequest,
  RPCResponse,
  SwallowKitConfig,
} from "./types";

// データベース
export { DatabaseClient, getDatabaseClient } from "./database/client";
export { SchemaRepository, createRepository, TodoSchema, TodoRepository } from "./database/repository";
export type { Todo } from "./database/repository";

// 設定
export { loadConfig, generateConfig, getFullConfig, validateConfig } from "./core/config";

// API自動生成
export { ApiGenerator } from "./generator/api-generator";
export { SchemaParser } from "./generator/schema-parser";
export { RpcHandler, defaultRpcHandler } from "./api/rpc-handler";

// スキーマ例
export * from "./schemas/example";
