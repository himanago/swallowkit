/**
 * Next.js Server Actions を内部で活用するためのラッパー
 * ユーザーからは隠蔽され、useServerFn から内部的に使用される
 */

import { ServerFunction } from "../types";

/**
 * Next.js の 'use server' ディレクティブをチェック
 */
export function isNextServerAction(fn: Function): boolean {
  // Next.js の Server Action かどうかを判定
  // Next.js は内部的に $$typeof シンボルを使用
  return (fn as any).$$typeof === Symbol.for('react.server.reference');
}

/**
 * 通常の関数を Next.js Server Action でラップ
 * この関数は内部的に使用され、ユーザーからは見えない
 */
export function wrapAsServerAction<TArgs extends any[], TResult>(
  fn: ServerFunction<TArgs, TResult>,
  name: string
): ServerFunction<TArgs, TResult> {
  // すでに Server Action の場合はそのまま返す
  if (isNextServerAction(fn)) {
    return fn;
  }

  // Next.js が利用可能な場合、Server Action として登録
  if (typeof (global as any).__next_server__ !== 'undefined') {
    // Next.js のランタイムが存在する場合
    const wrappedFn = async (...args: TArgs): Promise<TResult> => {
      'use server';
      return await fn(...args);
    };

    // 関数名を保持
    Object.defineProperty(wrappedFn, 'name', {
      value: name,
      configurable: true,
    });

    return wrappedFn;
  }

  // Next.js がない場合は元の関数をそのまま返す
  return fn;
}

/**
 * Next.js のキャッシュ機能を活用した関数ラッパー
 * React の cache() を内部で使用（利用可能な場合）
 */
export function createCachedServerFunction<TArgs extends any[], TResult>(
  fn: ServerFunction<TArgs, TResult>,
  options?: {
    revalidate?: number | false;
    tags?: string[];
  }
): ServerFunction<TArgs, TResult> {
  // React の cache が利用可能かチェック
  try {
    // Next.js 環境でのみ利用可能
    const { cache } = require('react');
    
    const cachedFn = cache(async (...args: TArgs) => {
      return await fn(...args);
    });

    // Next.js の fetch オプションをシミュレート
    if (options?.revalidate !== undefined) {
      (cachedFn as any).revalidate = options.revalidate;
    }
    if (options?.tags) {
      (cachedFn as any).tags = options.tags;
    }

    return cachedFn;
  } catch (error) {
    // React cache が利用できない場合は元の関数を返す
    return fn;
  }
}

/**
 * Next.js の revalidatePath を内部で使用
 */
export async function revalidatePath(path: string): Promise<void> {
  try {
    const { revalidatePath: nextRevalidatePath } = require('next/cache');
    await nextRevalidatePath(path);
  } catch (error) {
    // Next.js が利用できない場合は何もしない
    console.warn('SwallowKit: revalidatePath requires Next.js 14+');
  }
}

/**
 * Next.js の revalidateTag を内部で使用
 */
export async function revalidateTag(tag: string): Promise<void> {
  try {
    const { revalidateTag: nextRevalidateTag } = require('next/cache');
    await nextRevalidateTag(tag);
  } catch (error) {
    // Next.js が利用できない場合は何もしない
    console.warn('SwallowKit: revalidateTag requires Next.js 14+');
  }
}

/**
 * 環境チェック：Next.js App Router が利用可能か
 */
export function isNextJsAppRouter(): boolean {
  try {
    require('next/cache');
    return true;
  } catch {
    return false;
  }
}
