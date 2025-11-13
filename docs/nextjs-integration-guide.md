# SwallowKit - Next.js 標準実装ガイド

SwallowKit は Next.js の標準的な SSR、React Server Components、Server Actions パターンをそのまま使用し、それを Azure 向けに最適化されたアーキテクチャに変換します。

## 🎯 設計思想

- **Next.js の標準作法に従う**: SSR、RSC、Server Actions を通常通り実装
- **Azure 最適化を自動化**: CLI コマンドで個別 Azure Functions に自動分割
- **250MB 制限を回避**: Azure Static Web Apps のサイズ制限問題を解決
- **独立したバックエンド**: SWA とは別に Azure Functions にホスト可能

## 📦 インストール

```bash
# SwallowKit プロジェクトの初期化
npx swallowkit init my-app
cd my-app
npm install
```

または、既存の Next.js プロジェクトに追加:

```bash
npm install swallowkit
```

## 🚀 基本的な使い方

### 1. Zod スキーマの定義 (推奨)

まず、フロントエンド・バックエンド・データベース間で共有する型を Zod スキーマで定義します。

```typescript
// lib/schemas/todo.ts
import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string().min(1, 'Todo text is required'),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type Todo = z.infer<typeof TodoSchema>;
```

### 2. リポジトリの作成

Zod スキーマを使って型安全なリポジトリを作成します。

```typescript
// lib/server/todos.ts
import { createRepository } from 'swallowkit';
import { TodoSchema } from '../schemas/todo';

const todoRepo = createRepository('todos', TodoSchema);

export async function getTodos() {
  return todoRepo.findAll();
}

export async function getTodoById(id: string) {
  return todoRepo.findById(id);
}

export async function addTodo(text: string) {
  return todoRepo.create({
    id: crypto.randomUUID(),
    text,
    completed: false,
  });
}

export async function updateTodo(id: string, updates: { text?: string; completed?: boolean }) {
  const todo = await todoRepo.findById(id);
  if (!todo) throw new Error('Todo not found');
  
  return todoRepo.update({
    ...todo,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteTodo(id: string) {
  return todoRepo.delete(id);
}
```

### 3. Server Components (SSR) - データ取得

Next.js の標準的な Server Components パターンをそのまま使用します。

```typescript
// app/todos/page.tsx
import { getTodos } from '@/lib/server/todos';
import { TodoList } from '@/components/TodoList';
import { AddTodoForm } from '@/components/AddTodoForm';

// これは Server Component です
export default async function TodosPage() {
  // サーバーサイドで直接データ取得
  const todos = await getTodos();
  
  return (
    <div>
      <h1>Todos</h1>
      <TodoList todos={todos} />
      <AddTodoForm />
    </div>
  );
}
```

### 4. Server Actions - データ変更

Next.js の標準的な Server Actions をそのまま使用します。Zod スキーマで入力検証も行えます。

```typescript
// app/todos/actions.ts
'use server'

import { revalidatePath } from 'next/cache';
import { addTodo, updateTodo, deleteTodo } from '@/lib/server/todos';
import { TodoSchema } from '@/lib/schemas/todo';

export async function addTodoAction(formData: FormData) {
  // Zod で入力検証
  const result = TodoSchema.pick({ text: true }).safeParse({
    text: formData.get('text'),
  });
  
  if (!result.success) {
    return { error: result.error.errors[0].message };
  }
  
  await addTodo(result.data.text);
  revalidatePath('/todos');
  
  return { success: true };
}

export async function toggleTodoAction(id: string, completed: boolean) {
  await updateTodo(id, { completed });
  revalidatePath('/todos');
}

export async function deleteTodoAction(id: string) {
  await deleteTodo(id);
  revalidatePath('/todos');
}
```

### 5. Client Components - フォームと検証

Client Components から Server Actions を呼び出します。クライアント側でも同じ Zod スキーマで検証できます。

```typescript
// components/AddTodoForm.tsx
'use client'

import { addTodoAction } from '@/app/todos/actions';
import { TodoSchema } from '@/lib/schemas/todo';
import { useFormStatus } from 'react-dom';
import { useState } from 'react';

export function AddTodoForm() {
  const [error, setError] = useState('');
  
  const handleSubmit = async (formData: FormData) => {
    // クライアント側でも Zod で検証
    const result = TodoSchema.pick({ text: true }).safeParse({
      text: formData.get('text'),
    });
    
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }
    
    setError('');
    const response = await addTodoAction(formData);
    
    if (response?.error) {
      setError(response.error);
    }
  };
  
  return (
    <form action={handleSubmit}>
      <input name="text" required placeholder="New todo..." />
      {error && <p className="error">{error}</p>}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Adding...' : 'Add Todo'}
    </button>
  );
}
```

### 6. 楽観的更新 (useOptimistic)

Next.js の useOptimistic をそのまま使用できます。

```typescript
// components/TodoList.tsx
'use client'

import { useOptimistic } from 'react';
import { deleteTodoAction } from '@/app/todos/actions';

export function TodoList({ todos }: { todos: Todo[] }) {
  const [optimisticTodos, removeOptimisticTodo] = useOptimistic(
    todos,
    (state, removedId: string) => state.filter(todo => todo.id !== removedId)
  );

  async function handleDelete(id: string) {
    // UI を即座に更新
    removeOptimisticTodo(id);
    // サーバーで削除
    await deleteTodoAction(id);
  }

  return (
    <ul>
      {optimisticTodos.map(todo => (
        <li key={todo.id}>
          {todo.text}
          <button onClick={() => handleDelete(todo.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
```

## 🏗️ SwallowKit による Azure 最適化

### 問題: Azure Static Web Apps の 250MB 制限

Next.js アプリを Azure Static Web Apps にデプロイすると、SSR バックエンドが含まれるため、アプリサイズが 250MB を超えることがあります。これは SWA が Functions と統合される際に最適化が行われないためです。

### 解決策: 個別関数への自動分割

SwallowKit CLI は、あなたの Next.js アプリを分析し、各 Server Component と Server Action を個別の Azure Functions に自動分割します。

```bash
# Next.js アプリから Azure Functions を生成
npx swallowkit generate
```

### 生成される構造

```
あなたの Next.js アプリ          →    生成される Azure Functions
├── app/
│   ├── page.tsx (SSR)        →    azure-functions/
│   ├── todos/                     ├── page-root/
│   │   └── page.tsx (SSR)    →    │   └── index.ts
│   └── actions.ts            →    ├── page-todos/
│                                  │   └── index.ts
                                   └── action-addTodo/
                                       └── index.ts
```

各 Azure Function は:
- **独立してデプロイ可能**
- **最適化・Tree-Shaking 済み**
- **個別にスケール可能**
- **250MB 制限の影響を受けない**

### デプロイ

```bash
# ビルド
npx swallowkit build

# Azure にデプロイ
npx swallowkit deploy --swa-name my-app --functions-name my-app-functions
```

## 🎨 高度な機能

### Next.js キャッシュの活用

標準的な Next.js のキャッシュ機能をそのまま使用できます。

```typescript
// app/todos/page.tsx
export const revalidate = 60; // 60秒ごとに再検証

export default async function TodosPage() {
  const todos = await db.todos.findAll();
  return <TodoList todos={todos} />;
}
```

### キャッシュタグによる無効化

```typescript
// app/todos/page.tsx
export default async function TodosPage() {
  const todos = await fetch('...', {
    next: { tags: ['todos'] }
  }).then(r => r.json());
  
  return <TodoList todos={todos} />;
}

// app/todos/actions.ts
'use server'
import { revalidateTag } from 'next/cache';

export async function addTodoAction(formData: FormData) {
  // ...
  revalidateTag('todos'); // 'todos' タグのキャッシュを無効化
}
```

### ストリーミング SSR

```typescript
// app/todos/page.tsx
import { Suspense } from 'react';

export default function TodosPage() {
  return (
    <div>
      <h1>Todos</h1>
      <Suspense fallback={<TodosSkeleton />}>
        <TodosContent />
      </Suspense>
    </div>
  );
}

async function TodosContent() {
  const todos = await db.todos.findAll();
  return <TodoList todos={todos} />;
}
```

## 🏗️ アーキテクチャ

```
開発時: 標準的な Next.js
┌─────────────────────────────┐
│  Next.js App                │
│  - Server Components        │
│  - Server Actions           │
│  - Client Components        │
└─────────────────────────────┘

        ↓ swallowkit generate

デプロイ時: Azure 最適化
┌──────────────────┐     ┌──────────────────────┐
│ Azure SWA        │     │ Azure Functions      │
│ (Static Assets)  │────→│ (Individual funcs)   │
│ - Client JS      │     │ - page-root/         │
│ - HTML           │     │ - page-todos/        │
│ - CSS            │     │ - action-addTodo/    │
└──────────────────┘     └──────────────────────┘
```

## ✅ メリット

### 1. 標準的な Next.js 開発

- Next.js の公式ドキュメントに従って開発
- 独自の API を学ぶ必要なし
- コミュニティのベストプラクティスをそのまま適用

### 2. Azure 最適化

- 250MB 制限を自動的に回避
- 個別関数による柔軟なスケーリング
- SWA と Functions の独立したデプロイ

### 3. パフォーマンス

- Tree-Shaking による最小サイズ
- 個別関数のコールドスタート最適化
- 必要な機能のみをロード

### 4. 保守性

- 標準的な Next.js コード
- SwallowKit 特有のロックインなし
- 必要に応じて他のプラットフォームへの移行も容易

## 🔄 従来の方法との比較

| 項目 | 従来の SWA + Next.js | SwallowKit |
|------|---------------------|------------|
| デプロイサイズ | 250MB 超過のリスク | 個別関数で回避 |
| 開発方法 | 標準 Next.js | 標準 Next.js |
| バックエンド | SWA 付属 Functions | 独立 Azure Functions |
| スケーリング | 制限あり | 個別にスケール可能 |
| パフォーマンス | 最適化なし | 自動最適化 |

## 📋 チェックリスト

- [ ] Next.js 14+ をインストール
- [ ] SwallowKit をインストール
- [ ] 標準的な Next.js パターンで実装
- [ ] `swallowkit generate` で Azure Functions 生成
- [ ] `swallowkit build` でビルド
- [ ] `swallowkit deploy` で Azure にデプロイ

## 🔗 関連ドキュメント

- [Azure 最適化ガイド](./azure-optimization-guide.md)
- [Next.js 公式ドキュメント](https://nextjs.org/docs)
- [Azure Static Web Apps ドキュメント](https://docs.microsoft.com/azure/static-web-apps/)
- [Azure Functions ドキュメント](https://docs.microsoft.com/azure/azure-functions/)
