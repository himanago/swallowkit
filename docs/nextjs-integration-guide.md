# SwallowKit with Next.js - 使用ガイド

SwallowKit は内部で Next.js の強力な機能を活用しながら、シンプルで使いやすい API を提供します。

## 🎯 設計思想

- **Next.js は隠蔽**: ユーザーは Next.js を意識する必要はありません
- **SSR/CSR 自動判別**: `useServerFn` が自動的に最適な実行方法を選択
- **Next.js の機能を活用**: 内部でキャッシュ、トランジション、楽観的更新を利用

## 📦 インストール

```bash
npm install swallowkit next react react-dom
```

SwallowKit は Next.js 14+ をピア依存として必要としますが、ユーザーコードで直接 Next.js の API を使う必要はありません。

## 🚀 基本的な使い方

### 1. サーバー関数の定義

```typescript
// server/functions.ts
import { defineServerFunction } from 'swallowkit';

export const getTodos = defineServerFunction('getTodos', async () => {
  // Cosmos DB などからデータ取得
  return await db.todos.findAll();
});

export const addTodo = defineServerFunction('addTodo', async (text: string) => {
  const newTodo = await db.todos.create({ text, completed: false });
  return newTodo;
});
```

### 2. useServerFn - データ取得（SSR/CSR 自動判別）

```typescript
// components/TodoList.tsx
import { useServerFn } from 'swallowkit';
import { getTodos } from '@/server/functions';

export function TodoList() {
  // SSR時: サーバーで直接実行（高速）
  // CSR時: RPC経由で呼び出し
  const { data: todos, loading, error, refetch } = useServerFn(getTodos, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h1>Todos</h1>
      <ul>
        {todos?.map(todo => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### 3. useMutation - データ変更

```typescript
import { useMutation } from 'swallowkit';
import { addTodo } from '@/server/functions';

export function AddTodoForm() {
  const addTodoMutation = useMutation(addTodo, {
    onSuccess: (newTodo) => {
      console.log('Todo added:', newTodo);
      // 必要に応じて refetch
    },
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get('text') as string;
    
    await addTodoMutation.mutateAsync(text);
    e.currentTarget.reset();
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="text" required />
      <button type="submit" disabled={addTodoMutation.isLoading}>
        {addTodoMutation.isLoading ? 'Adding...' : 'Add Todo'}
      </button>
      {addTodoMutation.isError && (
        <div>Error: {addTodoMutation.error.message}</div>
      )}
    </form>
  );
}
```

### 4. useOptimistic - 楽観的更新

```typescript
import { useServerFn, useMutation, useOptimistic } from 'swallowkit';
import { getTodos, addTodo } from '@/server/functions';

export function OptimisticTodoList() {
  const { data: todos = [] } = useServerFn(getTodos, []);
  
  // 楽観的更新（Next.js の useOptimistic を内部で使用）
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(todos);
  
  const addTodoMutation = useMutation(addTodo);

  const handleAdd = async (text: string) => {
    // まず UI を即座に更新
    addOptimisticTodo((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, text, completed: false }
    ]);
    
    // 実際のサーバー処理
    await addTodoMutation.mutateAsync(text);
  };

  return (
    <ul>
      {optimisticTodos.map(todo => (
        <li key={todo.id} style={{ opacity: todo.id.startsWith('temp') ? 0.5 : 1 }}>
          {todo.text}
        </li>
      ))}
    </ul>
  );
}
```

## 🎨 高度な機能

### Next.js キャッシュの活用（自動）

```typescript
// useServerFn は自動的に Next.js のキャッシュを活用
const { data } = useServerFn(getTodos, [], {
  cache: true,        // Next.js の React cache を使用（デフォルト）
  revalidate: 60,     // 60秒後に再検証
  tags: ['todos'],    // キャッシュタグ
});
```

### キャッシュの無効化

```typescript
import { revalidatePath, revalidateTag } from 'swallowkit';

// パスベースの無効化
await revalidatePath('/todos');

// タグベースの無効化
await revalidateTag('todos');
```

### トランジションによるスムーズな UI

```typescript
const mutation = useMutation(addTodo);

// mutate: トランジション付き（UI更新を遅延）
await mutation.mutate(text);

// mutateAsync: トランジションなし（即座に実行）
await mutation.mutateAsync(text);
```

## 🏗️ アーキテクチャ

```
ユーザーコード
    ↓
┌─────────────────────────────────┐
│   SwallowKit Public API         │
│   - useServerFn                 │  ← シンプルなインターフェース
│   - useMutation                 │
│   - useOptimistic               │
└─────────────────────────────────┘
         ↓ 内部実装
┌─────────────────────────────────┐
│   Next.js 統合レイヤー          │
│   - Server Actions              │  ← 隠蔽されている
│   - React cache                 │
│   - useTransition               │
│   - useOptimistic               │
└─────────────────────────────────┘
```

## ✅ メリット

1. **学習コストの削減**
   - Next.js の複雑な API を学ぶ必要なし
   - `useServerFn` だけで SSR/CSR 両対応

2. **パフォーマンス最適化**
   - SSR時: 直接実行（RPC なし）
   - Next.js のキャッシュ機能を自動活用

3. **最新機能の活用**
   - useOptimistic による楽観的更新
   - useTransition によるスムーズな UI
   - React cache によるデータキャッシュ

4. **Azure 最適化**
   - Azure Static Web Apps 向けに最適化
   - Cosmos DB との統合
   - Azure Functions との連携

## 🔄 Next.js との関係

| 機能 | Next.js | SwallowKit |
|------|---------|------------|
| Server Actions | `'use server'` ディレクティブ | `defineServerFunction` |
| データ取得 | `fetch` + キャッシュ設定 | `useServerFn` (自動) |
| ミューテーション | 手動で実装 | `useMutation` |
| 楽観的更新 | `useOptimistic` | `useOptimistic` (同じ) |
| SSR/CSR 判別 | 手動 | 自動 |

## 📋 チェックリスト

- [ ] Next.js 14+ をインストール
- [ ] `defineServerFunction` でサーバー関数を定義
- [ ] `useServerFn` でデータ取得（SSR/CSR 自動判別）
- [ ] `useMutation` でデータ変更
- [ ] 必要に応じて `useOptimistic` で楽観的更新
- [ ] `revalidatePath` / `revalidateTag` でキャッシュ制御

SwallowKit は Next.js の力を借りながら、よりシンプルで使いやすい開発体験を提供します！
