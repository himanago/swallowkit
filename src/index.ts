/**
 * SwallowKit - Azure Static Web Apps向けReact Hooksベースフレームワーク
 * メインエクスポート
 */

// フック
export { useServerFn, useTypedServerFn, setRpcEndpoint, getRpcEndpoint, callServerFn } from "./hooks/useServerFn";
export { 
  useQuery, 
  useMutation, 
  useSchemaQuery, 
  useSchemaMutation,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationOptions,
  type UseMutationResult
} from "./hooks/useQuery";

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
