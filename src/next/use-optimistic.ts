/**
 * Next.js の useOptimistic を内部で活用するラッパー
 * SwallowKit の公開 API として提供
 */

import { useState } from 'react';

export interface UseOptimisticResult<T> {
  optimisticData: T;
  addOptimistic: (update: T | ((current: T) => T)) => void;
}

/**
 * 楽観的更新のためのフック
 * 内部で Next.js の useOptimistic を使用（利用可能な場合）
 * 
 * @example
 * const [optimisticTodos, addOptimisticTodo] = useOptimistic(todos);
 * 
 * const handleAdd = async (text: string) => {
 *   addOptimisticTodo((prev) => [...prev, { id: 'temp', text }]);
 *   await addTodo(text);
 * };
 */
export function useOptimistic<T>(
  initialState: T,
  updateFn?: (currentState: T, optimisticValue: T) => T
): [T, (update: T | ((current: T) => T)) => void] {
  try {
    // Next.js の useOptimistic を動的インポート
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const React = require('react');
    
    if (React.useOptimistic) {
      const [optimisticState, addOptimistic] = React.useOptimistic(
        initialState,
        updateFn || ((_: T, newState: T) => newState)
      );

      return [optimisticState, addOptimistic];
    }
    
    throw new Error('useOptimistic not available');
  } catch (error) {
    // Next.js が利用できない場合は、シンプルな実装にフォールバック
    console.warn('SwallowKit: useOptimistic requires Next.js 14+. Using fallback implementation.');
    
    // フォールバック: 楽観的更新なしで通常の state として動作
    const [state, setState] = useState<T>(initialState);
    
    const addOptimistic = (update: T | ((current: T) => T)) => {
      if (typeof update === 'function') {
        setState((current: T) => (update as (current: T) => T)(current));
      } else {
        setState(update);
      }
    };

    return [state, addOptimistic];
  }
}
