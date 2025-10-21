/**
 * SwallowKit サーバー関数レジストリ
 * 関数名の動的取得とRPC呼び出しを管理
 * 型安全性とminify対応を強化
 */

import { ServerFunctionDefinition, ServerFnFactory } from "../types";

const serverFunctionRegistry = new Map<Function, ServerFunctionDefinition>();
const serverFunctionIdMap = new Map<string, Function>();

/**
 * サーバー関数を登録（基本版）
 */
export function registerServerFunction(fn: Function, name: string, id?: string): void {
  const functionId = id || `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const definition: ServerFunctionDefinition = {
    fn: fn as any,
    name,
    id: functionId,
  };
  
  serverFunctionRegistry.set(fn, definition);
  serverFunctionIdMap.set(functionId, fn);
}

/**
 * 型安全なサーバー関数ファクトリを作成
 */
export function defineServerFunction<TArgs extends any[], TResult>(
  name: string,
  implementation: (...args: TArgs) => Promise<TResult> | TResult
): ServerFnFactory<TArgs, TResult> {
  const id = `swk_${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const factory = (async (...args: TArgs) => {
    return await implementation(...args);
  }) as ServerFnFactory<TArgs, TResult>;
  
  factory.__swallowkit_id = id;
  factory.__swallowkit_name = name;
  
  // 自動登録
  registerServerFunction(factory, name, id);
  
  return factory;
}

/**
 * 複数のサーバー関数を一括登録
 */
export function registerServerFunctions(functions: Record<string, Function>): void {
  Object.entries(functions).forEach(([name, fn]) => {
    registerServerFunction(fn, name);
  });
}

/**
 * サーバー関数の登録情報を取得
 */
export function getServerFunctionDefinition(fn: Function): ServerFunctionDefinition | undefined {
  return serverFunctionRegistry.get(fn);
}

/**
 * サーバー関数の登録名を取得
 */
export function getServerFunctionName(fn: Function): string {
  const definition = serverFunctionRegistry.get(fn);
  if (definition) {
    return definition.name;
  }

  // SwallowKit ファクトリ関数の場合
  if (typeof fn === 'function' && '__swallowkit_name' in fn) {
    return (fn as any).__swallowkit_name;
  }

  // フォールバック: 関数の name プロパティを使用
  if (fn.name) {
    console.warn(
      `SwallowKit: Using function.name "${fn.name}" as fallback. ` +
      `Consider using defineServerFunction() or registerServerFunction() for better reliability.`
    );
    return fn.name;
  }

  throw new Error(
    "Server function name could not be determined. " +
    "Please use defineServerFunction() or registerServerFunction() to ensure reliable function identification."
  );
}

/**
 * サーバー関数が登録されているかチェック
 */
export function isServerFunctionRegistered(fn: Function): boolean {
  return serverFunctionRegistry.has(fn) || 
         (typeof fn === 'function' && '__swallowkit_id' in fn);
}

/**
 * 登録された関数の一覧を取得
 */
export function getRegisteredFunctions(): Array<{ name: string; function: Function; id: string }> {
  return Array.from(serverFunctionRegistry.entries()).map(([fn, definition]) => ({
    name: definition.name,
    function: fn,
    id: definition.id,
  }));
}

/**
 * すべての関数登録をクリア
 */
export function clearServerFunctionRegistry(): void {
  serverFunctionRegistry.clear();
  serverFunctionIdMap.clear();
}

/**
 * 自動登録ヘルパー: オブジェクトからサーバー関数を自動検出して登録
 */
export function autoRegisterServerFunctions(moduleExports: Record<string, any>): void {
  Object.entries(moduleExports).forEach(([name, value]) => {
    if (typeof value === 'function') {
      registerServerFunction(value, name);
    }
  });
}

/**
 * IDによってサーバー関数を取得
 */
export function getServerFunctionById(id: string): Function | undefined {
  return serverFunctionIdMap.get(id);
}

/**
 * サーバー関数のIDを取得
 */
export function getServerFunctionId(fn: Function): string | undefined {
  const definition = serverFunctionRegistry.get(fn);
  if (definition) {
    return definition.id;
  }

  // SwallowKit ファクトリ関数の場合
  if (typeof fn === 'function' && '__swallowkit_id' in fn) {
    return (fn as any).__swallowkit_id;
  }

  return undefined;
}

/**
 * 開発時のデバッグ情報を取得
 */
export function getRegistryDebugInfo(): {
  registeredCount: number;
  functions: Array<{ name: string; id: string; hasId: boolean; hasName: boolean }>;
} {
  const functions = Array.from(serverFunctionRegistry.entries()).map(([fn, definition]) => ({
    name: definition.name,
    id: definition.id,
    hasId: '__swallowkit_id' in fn,
    hasName: '__swallowkit_name' in fn,
  }));

  return {
    registeredCount: serverFunctionRegistry.size,
    functions,
  };
}
