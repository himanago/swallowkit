import { useState, useEffect, useCallback } from "react";
import {
  ServerFunction,
  UseServerFnOptions,
  UseServerFnResult,
  RPCRequest,
  RPCResponse,
  ServerFnFactory,
} from "../types";
import { getServerFunctionName, isServerFunctionRegistered } from "./server-function-registry";
import { createCachedServerFunction, isNextJsAppRouter } from "../next/server-action-wrapper";

// 設定可能なRPCエンドポイント
let rpcEndpoint = "/api/_swallowkit";

/**
 * RPCエンドポイントを設定
 */
export function setRpcEndpoint(endpoint: string) {
  rpcEndpoint = endpoint;
}

/**
 * 現在のRPCエンドポイントを取得
 */
export function getRpcEndpoint(): string {
  return rpcEndpoint;
}

/**
 * サーバー関数を呼び出すためのReact Hook
 * SSRとCSRの両方に対応し、自動的に実行環境を判別する
 */
export function useServerFn<TArgs extends any[], TResult>(
  serverFn: ServerFunction<TArgs, TResult>,
  args: TArgs,
  options: UseServerFnOptions = {}
): UseServerFnResult<TResult> {
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const { mode = "auto", enabled = true } = options;

  const executeServerFn = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    // 開発時の警告: 関数が登録されているかチェック
    if (process.env.NODE_ENV === 'development' && !isServerFunctionRegistered(serverFn)) {
      console.warn(
        `SwallowKit: Server function "${serverFn.name || 'anonymous'}" is not registered. ` +
        `Consider using defineServerFunction() or registerServerFunction() for better reliability.`
      );
    }

    setLoading(true);
    setError(null);

    try {
      const isServer = typeof window === "undefined";
      let result: TResult;

      if ((mode === "auto" && isServer) || mode === "force-server") {
        // サーバーサイドで直接実行
        // Next.js のキャッシュ機能が利用可能な場合は活用
        if (isNextJsAppRouter() && options.cache !== false) {
          const cachedFn = createCachedServerFunction(serverFn, {
            revalidate: options.revalidate,
            tags: options.tags,
          });
          result = await Promise.resolve(cachedFn(...args));
        } else {
          result = await Promise.resolve(serverFn(...args));
        }
      } else {
        // クライアントサイドでRPC呼び出し
        result = await callServerFnRPC(serverFn, args);
      }

      setData(result);
    } catch (err) {
      setError(err);
      console.error("SwallowKit: Server function execution failed:", err);
    } finally {
      setLoading(false);
    }
  }, [serverFn, JSON.stringify(args), mode, enabled]);

  const refetch = useCallback(() => {
    executeServerFn();
  }, [executeServerFn]);

  useEffect(() => {
    executeServerFn();
  }, [executeServerFn]);

  return { data, loading, error, refetch };
}

/**
 * 型安全なサーバー関数フック（defineServerFunction で定義された関数用）
 */
export function useTypedServerFn<TArgs extends any[], TResult>(
  serverFn: ServerFnFactory<TArgs, TResult>,
  args: TArgs,
  options: UseServerFnOptions = {}
): UseServerFnResult<TResult> {
  return useServerFn(serverFn, args, options);
}

/**
 * サーバー関数をRPC経由で呼び出す（v4 API対応）
 */
async function callServerFnRPC<TArgs extends any[], TResult>(
  serverFn: ServerFunction<TArgs, TResult>,
  args: TArgs
): Promise<TResult> {
  const fnName = getServerFunctionName(serverFn);
  
  const request: RPCRequest = {
    fnName,
    args,
  };

  // v4 API エンドポイントに対応（設定可能）
  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  // v4 APIは直接結果を返すため、レスポンス形式を調整
  try {
    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error("Failed to parse server response");
  }
}

/**
 * サーバー関数を直接呼び出す（ミューテーション用）
 * useServerFnと異なり、状態管理なしで即座に実行される
 * 
 * @example
 * await callServerFn(addTodo, { text: "New task" });
 */
export async function callServerFn<TArgs extends any[], TResult>(
  serverFn: ServerFunction<TArgs, TResult>,
  ...args: TArgs
): Promise<TResult> {
  return callServerFnRPC(serverFn, args);
}
