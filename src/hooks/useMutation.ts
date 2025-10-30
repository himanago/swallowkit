/**
 * ミューテーション用のフック
 * Next.js の useTransition を内部で活用
 */

import { useState, useTransition, useCallback } from 'react';
import { ServerFunction } from '../types';
import { getServerFunctionName } from './server-function-registry';

export interface UseMutationOptions<TResult> {
  onSuccess?: (data: TResult) => void;
  onError?: (error: any) => void;
  onSettled?: () => void;
}

export interface UseMutationResult<TArgs extends any[], TResult> {
  mutate: (...args: TArgs) => Promise<TResult>;
  mutateAsync: (...args: TArgs) => Promise<TResult>;
  data: TResult | null;
  error: any;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

/**
 * ミューテーション（データ変更）用のフック
 * Next.js の useTransition を内部で使用して、トランジション状態を管理
 * 
 * @example
 * const addTodoMutation = useMutation(addTodo, {
 *   onSuccess: (data) => {
 *     console.log('Todo added:', data);
 *     refetchTodos();
 *   },
 * });
 * 
 * // 使用
 * await addTodoMutation.mutateAsync({ text: 'New task' });
 */
export function useMutation<TArgs extends any[], TResult>(
  serverFn: ServerFunction<TArgs, TResult>,
  options: UseMutationOptions<TResult> = {}
): UseMutationResult<TArgs, TResult> {
  const [data, setData] = useState<TResult | null>(null);
  const [error, setError] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);

  const { onSuccess, onError, onSettled } = options;

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
    setIsSuccess(false);
    setIsError(false);
  }, []);

  const executeMutation = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setIsLoading(true);
      setError(null);
      setIsSuccess(false);
      setIsError(false);

      try {
        let result: TResult;

        // サーバーサイドかチェック
        const isServer = typeof window === 'undefined';

        if (isServer) {
          // サーバーサイドで直接実行
          result = await Promise.resolve(serverFn(...args));
        } else {
          // クライアントサイドでRPC呼び出し
          result = await callServerFnRPCTemp(serverFn, args);
        }

        setData(result);
        setIsSuccess(true);
        onSuccess?.(result);

        return result;
      } catch (err) {
        setError(err);
        setIsError(true);
        onError?.(err);
        throw err;
      } finally {
        setIsLoading(false);
        onSettled?.();
      }
    },
    [serverFn, onSuccess, onError, onSettled]
  );

  // mutate: トランジション付きで実行（UI更新を遅延）
  const mutate = useCallback(
    (...args: TArgs): Promise<TResult> => {
      return new Promise((resolve, reject) => {
        startTransition(() => {
          executeMutation(...args)
            .then(resolve)
            .catch(reject);
        });
      });
    },
    [executeMutation]
  );

  // mutateAsync: トランジションなしで即座に実行
  const mutateAsync = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      return executeMutation(...args);
    },
    [executeMutation]
  );

  return {
    mutate,
    mutateAsync,
    data,
    error,
    isLoading,
    isPending,
    isSuccess,
    isError,
    reset,
  };
}

/**
 * RPC 呼び出しの内部実装
 */
async function callServerFnRPCTemp<TArgs extends any[], TResult>(
  serverFn: ServerFunction<TArgs, TResult>,
  args: TArgs
): Promise<TResult> {
  const fnName = getServerFunctionName(serverFn);
  
  const response = await fetch('/api/_swallowkit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fnName,
      args,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  return await response.json();
}
