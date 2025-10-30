import { useState, useEffect, useCallback } from "react";
import { z } from "zod";

/**
 * 高度なクエリフックのオプション
 */
export interface UseQueryOptions<T> {
  enabled?: boolean;
  refetchOnMount?: boolean;
  refetchInterval?: number;
  staleTime?: number;
  cacheTime?: number;
  retry?: number;
  onSuccess?: (data: T) => void;
  onError?: (error: any) => void;
}

/**
 * クエリの状態
 */
export interface UseQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: any;
  refetch: () => void;
  isStale: boolean;
  isFetching: boolean;
}

/**
 * 高度なデータ取得フック
 */
export function useQuery<T>(
  queryKey: string[],
  queryFn: () => Promise<T>,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<any>(null);
  const [isStale, setIsStale] = useState(false);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const {
    enabled = true,
    refetchOnMount = true,
    refetchInterval,
    staleTime = 0,
    retry = 3,
    onSuccess,
    onError,
  } = options;

  const executeQuery = useCallback(async (retryCount = 0) => {
    if (!enabled) return;

    setIsFetching(true);
    setError(null);

    try {
      const result = await queryFn();
      setData(result);
      setLastFetch(Date.now());
      setIsStale(false);
      onSuccess?.(result);
    } catch (err) {
      if (retryCount < retry) {
        setTimeout(() => executeQuery(retryCount + 1), 1000 * (retryCount + 1));
      } else {
        setError(err);
        onError?.(err);
        console.error(`SwallowKit Query Error [${queryKey.join(",")}]:`, err);
      }
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  }, [queryFn, enabled, retry, onSuccess, onError, queryKey]);

  const refetch = useCallback(() => {
    setLoading(true);
    executeQuery();
  }, [executeQuery]);

  // 初回実行
  useEffect(() => {
    if (enabled && refetchOnMount) {
      executeQuery();
    }
  }, [executeQuery, enabled, refetchOnMount]);

  // インターバル実行
  useEffect(() => {
    if (refetchInterval && enabled) {
      const interval = setInterval(() => {
        executeQuery();
      }, refetchInterval);

      return () => clearInterval(interval);
    }
  }, [refetchInterval, enabled, executeQuery]);

  // staleness check
  useEffect(() => {
    if (staleTime > 0 && lastFetch > 0) {
      const timeout = setTimeout(() => {
        setIsStale(true);
      }, staleTime);

      return () => clearTimeout(timeout);
    }
  }, [staleTime, lastFetch]);

  return {
    data,
    loading,
    error,
    refetch,
    isStale,
    isFetching,
  };
}

// useMutation は hooks/useMutation.ts に移動されました
// 互換性のために型のみ再エクスポート
import type { UseMutationOptions as NewUseMutationOptions, UseMutationResult as NewUseMutationResult } from './useMutation';

/**
 * @deprecated Use UseMutationOptions from 'swallowkit' instead
 */
export interface UseMutationOptions<TVariables, TData> {
  onSuccess?: (data: TData, variables?: TVariables) => void;
  onError?: (error: any, variables?: TVariables) => void;
  onMutate?: (variables?: TVariables) => void;
}

/**
 * @deprecated Use UseMutationResult from 'swallowkit' instead
 */
export interface UseMutationResult<TVariables, TData> {
  mutate: (variables: TVariables) => Promise<TData>;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  loading: boolean;
  error: any;
  data: TData | undefined;
  reset: () => void;
}

/**
 * Zodスキーマ付きのクエリフック
 */
export function useSchemaQuery<T>(
  queryKey: string[],
  queryFn: () => Promise<unknown>,
  schema: z.ZodSchema<T>,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const schemaQueryFn = useCallback(async (): Promise<T> => {
    const result = await queryFn();
    return schema.parse(result);
  }, [queryFn, schema]);

  return useQuery(queryKey, schemaQueryFn, options);
}

/**
 * Zodスキーマ付きのミューテーションフック
 * @deprecated Use useMutation with schema validation instead
 */
export function useSchemaMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  responseSchema: z.ZodSchema<TData>,
  options: UseMutationOptions<TVariables, TData> = {}
): UseMutationResult<TVariables, TData> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [data, setData] = useState<TData | undefined>(undefined);

  const { onSuccess, onError, onMutate } = options;

  const mutateAsync = useCallback(async (variables: TVariables): Promise<TData> => {
    setLoading(true);
    setError(null);
    
    try {
      onMutate?.(variables);
      const result = await mutationFn(variables);
      const validated = responseSchema.parse(result);
      setData(validated);
      onSuccess?.(validated, variables);
      return validated;
    } catch (err) {
      setError(err);
      onError?.(err, variables);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutationFn, responseSchema, onMutate, onSuccess, onError]);

  const mutate = useCallback((variables: TVariables) => {
    return mutateAsync(variables);
  }, [mutateAsync]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(undefined);
  }, []);

  return {
    mutate,
    mutateAsync,
    loading,
    error,
    data,
    reset,
  };
}
