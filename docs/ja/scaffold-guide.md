# SwallowKit Scaffold ガイド

## 概要

SwallowKit Scaffold は、Zod スキーマ定義から完全な CRUD（Create, Read, Update, Delete）操作を自動生成する強力なコード生成ツールです。Azure Functions、Next.js API ルート、型安全な UI コンポーネントを最小限の設定で生成します。さらに、Functions バックエンドに C# または Python を選んだ場合は、共有 Zod モデルから OpenAPI を出力し、各言語向けのバックエンド用スキーマ資産も生成します。

💡 **参考情報**: スキーマ共有の概念やメリットについては、**[Zod スキーマ共有ガイド](./zod-schema-sharing-guide)** もご参照ください。

## クイックスタート

### 1. モデルの雛形を作成

`create-model` コマンドで、`id`、`createdAt`、`updatedAt` を含むモデルの雛形を生成します：

```bash
npx swallowkit create-model product
```

これにより `shared/models/product.ts` が生成されます：

```typescript
import { z } from 'zod';

// Product model
export const product = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Product = z.infer<typeof product>;
```

💡 **複数のモデルを一度に作成**することもできます：

```bash
npx swallowkit create-model user post comment
```

### 2. モデルをカスタマイズ

生成されたファイルを編集して、必要なフィールドを追加します：

```typescript
// shared/models/product.ts
import { z } from 'zod';

export const product = z.object({
  id: z.string(),
  name: z.string().min(1, "商品名は必須です"),
  price: z.number().min(0, "価格は正の値である必要があります"),
  category: z.enum(["electronics", "clothing", "books", "other"]),
  isActive: z.boolean().default(true),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Product = z.infer<typeof product>;
```

⚠️ **重要**: `id`、`createdAt`、`updatedAt` フィールドは必ず含めてください。これらはバックエンドで自動管理されます。

#### SwallowKit 管理フィールドの仕様

これらのフィールドは以下のように動作します：

- **モデル定義**: `optional()` として定義（必須ではない）
- **フロントエンド**: フォームから送信されず、バックエンドで自動設定される
- **バックエンド（作成時）**: 
  - クライアントから送られた値は無視される
  - `id`: UUID が自動生成される（クライアントから送られた場合はそれを使用）
  - `createdAt`: 現在時刻が自動設定される
  - `updatedAt`: 現在時刻が自動設定される
- **バックエンド（更新時）**:
  - クライアントから送られた値は無視される
  - `createdAt`: 既存の値が保持される（変更されない）
  - `updatedAt`: 現在時刻に更新される

これにより、タイムスタンプの整合性が保証され、クライアント側で誤った値を設定する心配がありません。

### 3. Scaffold コマンドを実行

```bash
npx swallowkit scaffold shared/models/product.ts
```

### 4. 生成されるファイル

scaffold コマンドは以下のファイルを生成します：

**Azure Functions（バックエンド）:**
- TypeScript バックエンド: `functions/src/product.ts` - CRUD Azure Functions
- C# バックエンド: `functions/Crud/ProductFunctions.cs` - CRUD スターターハンドラー
- Python バックエンド: `functions/blueprints/product.py` - CRUD スターターブループリント

**Next.js BFF API Routes:**
- `app/api/product/route.ts` - GET（一覧）と POST（作成）エンドポイント
- `app/api/product/[id]/route.ts` - GET、PUT、DELETE エンドポイント（単一アイテム）

**UI コンポーネント:**
- `app/product/page.tsx` - テーブルビューの一覧ページ
- `app/product/[id]/page.tsx` - 詳細ページ
- `app/product/new/page.tsx` - 新規作成ページ
- `app/product/[id]/edit/page.tsx` - 編集ページ
- `app/product/_components/ProductForm.tsx` - 再利用可能なフォームコンポーネント

**設定:**
- `lib/scaffold-config.ts` - ナビゲーションメニュー設定

**C#/Python バックエンド向け OpenAPI ブリッジ:**
- `functions/openapi/product.openapi.json` - Zod モデルグラフから出力された OpenAPI
- `functions/generated/csharp-models/` または `functions/generated/python-models/` - 生成されたバックエンド用スキーマ資産

### バックエンド言語ごとの動作

- `typescript`: 生成された Functions ハンドラーは共有 Zod パッケージを直接 import します。
- `csharp` / `python`: フロントエンドと BFF は引き続き `shared/models/` の Zod を使い、バックエンドは OpenAPI 由来の生成資産を利用します。
- スキーマを変更したら、`functions/openapi/` と `functions/generated/` を同期させるために `swallowkit scaffold shared/models/<name>.ts` を再実行してください。

### 4. アプリケーションにアクセス

開発サーバーを起動します：

```bash
npx swallowkit dev
```

http://localhost:3000 を開いてアプリケーションを確認できます。

Cosmos DB Emulator をデバッグ用の決まったデータで起動したい場合は、seed 環境を生成して `dev` に渡します：

```bash
npx swallowkit create-dev-seeds local
# dev-seeds/local/*.json を編集
npx swallowkit dev --seed-env local
```

SwallowKit は `{schema}.json` を対応する Cosmos コンテナへマッピングし、Azure Functions を起動する前にそのコンテナのローカル Emulator データを置き換えます。

<!-- 画像: ホームページのスクリーンショット。scaffold-config.tsに登録されたモデル（Product, Category, Todoなど）がカード形式で表示されている様子 -->

## 型に応じた UI 生成

SwallowKit は、Zod スキーマの型に基づいて適切な UI コントロールを自動生成します：

### サポートされているフィールドタイプ

| Zod 型 | 生成される UI | 例 |
|----------|-------------|---------|
| `z.string()` | テキスト入力 | `<input type="text">` |
| `z.number()` | 数値入力 | `<input type="number">` |
| `z.boolean()` | チェックボックス | `<input type="checkbox">` |
| `z.string()`（日付形式） | テキスト入力 | `<input type="text">` (ISO 文字列) |
| `z.enum()` | セレクトドロップダウン | `<select>` とオプション |
| `z.array()` | カンマ区切りテキスト入力 | タグ: "tag1, tag2, tag3" |
| 外部キー | 関連データのドロップダウン | 下記参照 |
| ネストスキーマ（単一） | セレクトドロップダウン | `category: category` |
| ネストスキーマ（配列） | マルチセレクト | `tags: z.array(tag)` |

### Boolean フィールド

```typescript
isActive: z.boolean().default(true)
```

チェックボックスが生成されます：

```tsx
<input
  type="checkbox"
  checked={formData.isActive}
  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
/>
```

### Enum フィールド

```typescript
category: z.enum(["electronics", "clothing", "books", "other"])
```

ドロップダウンが生成されます：

```tsx
<select value={formData.category} onChange={...}>
  <option value="">選択してください</option>
  <option value="electronics">electronics</option>
  <option value="clothing">clothing</option>
  <option value="books">books</option>
  <option value="other">other</option>
</select>
```

### 配列フィールド

```typescript
tags: z.array(z.string()).optional()
```

カンマ区切り入力が生成されます：

```tsx
<input
  type="text"
  placeholder="例: item1, item2, item3"
  value={formData.tags}
  onChange={...}
/>
```

### オプショナルフィールド

`.optional()` でマークされたフィールドはフォームで必須ではなく、それ以外は `required` 属性が付きます。

## ネストスキーマ参照

SwallowKit は、他のスキーマを直接参照するフィールドを自動検出し、適切な UI を生成します。`categoryId: z.string()` のような外部キーパターンとは異なり、Zod スキーマオブジェクトを直接埋め込むパターンに対応しています。

> **推奨**: 親子関係を表現する場合は、ID による外部キー参照ではなく、ネスト型のスキーマ参照を使用してください。ネストにより型安全性が保たれ、関連データがドキュメント内にまとまるため、Cosmos DB のドキュメントモデルに自然に適合します。

### 検出されるパターン

```typescript
import { category } from './category';
import { tag } from './tag';

export const product = z.object({
  id: z.string(),
  name: z.string().min(1),
  // 単一オブジェクト参照（セレクトボックスが生成される）
  category: category.optional(),
  // 配列参照（マルチセレクトが生成される）
  tags: z.array(tag).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
```

### 生成される UI

#### 単一オブジェクト参照

`category: category.optional()` のようなフィールドは、セレクトボックスとして生成されます：

```tsx
<select
  id="category"
  value={formData.categoryId}
  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
>
  <option value="">選択してください</option>
  {categoryOptions.map((option) => (
    <option key={option.id} value={option.id}>{option.name}</option>
  ))}
</select>
```

フォーム送信時に、選択された ID はオブジェクトに自動変換されます。

#### 配列参照

`tags: z.array(tag)` のようなフィールドは、マルチセレクトとして生成されます：

```tsx
<select
  id="tags"
  multiple
  value={formData.tagsIds}
  onChange={(e) => {
    const selected = Array.from(e.target.selectedOptions, option => option.value);
    setFormData({ ...formData, tagsIds: selected });
  }}
>
  {tagOptions.map((option) => (
    <option key={option.id} value={option.id}>{option.name}</option>
  ))}
</select>
```

#### 一覧・詳細での表示

- **単一参照**: `item.category?.name || '-'` として表示名をレンダリング
- **配列参照**: `item.tags.map(ref => ref.name).join(', ')` としてカンマ区切りで表示

### 表示フィールドの自動検出

SwallowKit は参照先スキーマのファイルを自動的に読み取り、表示用フィールドを以下の優先順位で検出します：

1. `name` フィールド
2. `title` フィールド
3. `label` フィールド
4. デフォルト: `name`

## 外部キーリレーションシップ

SwallowKit は、命名規約パターンを使用して外部キーリレーションシップを自動検出します。

### 規約

`Id` で終わり、`string` 型を持つフィールドは外部キーとして扱われます：

```typescript
// フィールド名: categoryId -> 参照先: Category モデル
categoryId: z.string().min(1, "カテゴリは必須です")
```

**パターン:** `<モデル名>Id` → `<モデル名>` モデルを参照

### 例: Category 参照を持つ Todo

```typescript
// lib/models/category.ts
import { z } from 'zod';

export const category = z.object({
  id: z.string(),
  name: z.string().min(1, "カテゴリ名は必須です"),
  color: z.enum(["red", "blue", "green", "yellow", "purple"]).optional(),
});

export type Category = z.infer<typeof category>;

// lib/models/todo.ts
import { z } from 'zod';

export const todo = z.object({
  id: z.string(),
  title: z.string().min(1, "タイトルは必須です"),
  categoryId: z.string().min(1, "カテゴリは必須です"), // 外部キー
  completed: z.boolean().default(false),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export type Todo = z.infer<typeof todo>;
```

### 生成される外部キー UI

外部キーが検出されると、SwallowKit は以下を生成します：

1. **フォーム内のドロップダウンセレクト:**

```tsx
<select
  id="categoryId"
  name="categoryId"
  value={formData.categoryId}
  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
  required
>
  <option value="">選択してください</option>
  {categoryOptions.map((option) => (
    <option key={option.id} value={option.id}>
      {option.name}
    </option>
  ))}
</select>
```

2. **useEffect でのデータ取得:**

```tsx
const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

useEffect(() => {
  fetch('/api/category')
    .then(res => res.json())
    .then((data: any[]) => {
      const options = data.map(item => ({
        id: item.id,
        name: item.name || item.title || item.id
      }));
      setCategoryOptions(options);
    })
    .catch(err => console.error('Failed to fetch categorys:', err));
}, []);
```

<!-- 画像: Todoフォームのスクリーンショット。categoryIdフィールドがドロップダウンになっており、作成済みのCategoryが選択肢として表示されている様子 -->

3. **一覧ビューでの表示名:**

`"abc123"` のような生の ID を表示する代わりに、一覧ビューでは参照先アイテムの名前を表示します：

| title | Category | completed |
|-------|----------|-----------|
| 買い物リスト | ショッピング | ☐ |
| バグ修正 | 仕事 | ☑ |

<!-- 画像: Todo一覧画面のスクリーンショット。categoryIdカラムに「Category」というヘッダーがあり、値として実際のカテゴリー名（例: "仕事", "ショッピング"）が表示されている様子 -->

4. **詳細ビューでの表示名:**

```tsx
<dt>Category</dt>
<dd>{categoryMap[todo.categoryId] || todo.categoryId}</dd>
```

カテゴリ ID の代わりに「仕事」と表示されます。

<!-- 画像: Todo詳細画面のスクリーンショット。Categoryフィールドに実際のカテゴリー名が表示されている様子 -->

### ToString 規約

外部キーの表示には、SwallowKit は以下の優先順位で表示文字列を決定します：

1. `item.name`（存在する場合）
2. `item.title`（存在する場合）
3. `item.id`（フォールバック）

つまり、参照先モデルには UX 向上のために `name` または `title` フィールドを含めるべきです。

## 生成されるコード例

### 一覧ページ（page.tsx）

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Todo } from '@/lib/models/todo';

export default function TodoListPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/todo')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch todos');
        return res.json();
      })
      .then((data) => {
        setTodos(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    // 外部キー参照データを取得
    fetch('/api/category')
      .then(res => res.json())
      .then((data: any[]) => {
        const map: Record<string, string> = {};
        data.forEach(item => {
          map[item.id] = item.name || item.title || item.id;
        });
        setCategoryMap(map);
      })
      .catch(err => console.error('Failed to fetch categorys:', err));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('本当にこのアイテムを削除しますか？')) return;

    try {
      const res = await fetch(`/api/todo/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete todo');

      setTodos(todos.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(`エラー: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-900 dark:text-gray-100">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600 dark:text-red-400">エラー: {error}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Todo</h1>
        <Link
          href="/todo/new"
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          新規作成
        </Link>
      </div>

      {todos.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          Todo が見つかりません。最初の Todo を作成しましょう！
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  completed
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {todos.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {String(item.title)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {categoryMap[item.categoryId] || item.categoryId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                    {String(item.completed)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Link
                      href={`/todo/${item.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 mr-4"
                    >
                      表示
                    </Link>
                    <Link
                      href={`/todo/${item.id}/edit`}
                      className="text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300 mr-4"
                    >
                      編集
                    </Link>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### フォームコンポーネント（TodoForm.tsx）

```tsx
'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { todo } from '@/lib/models/todo';
import { z } from 'zod';

interface TodoFormProps {
  initialData?: any;
  isEdit?: boolean;
}

export default function TodoForm({ initialData, isEdit = false }: TodoFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    categoryId: initialData?.categoryId || '',
    completed: initialData?.completed || false,
    priority: initialData?.priority || 'medium',
  });

  useEffect(() => {
    fetch('/api/category')
      .then(res => res.json())
      .then((data: any[]) => {
        const options = data.map(item => ({
          id: item.id,
          name: item.name || item.title || item.id
        }));
        setCategoryOptions(options);
      })
      .catch(err => console.error('Failed to fetch categorys:', err));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      // Zod で検証
      const validatedData = todo.parse({
        ...formData,
        id: initialData?.id || crypto.randomUUID(),
      });

      const url = isEdit ? `/api/todo/${initialData.id}` : '/api/todo';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validatedData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || '保存に失敗しました');
      }

      router.push('/todo');
      router.refresh();
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach((error) => {
          if (error.path) {
            fieldErrors[error.path[0]] = error.message;
          }
        });
        setErrors(fieldErrors);
      } else {
        alert(`エラー: ${err.message}`);
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          title *
        </label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          required
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.title}</p>
        )}
      </div>

      <div>
        <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Category *
        </label>
        <select
          id="categoryId"
          name="categoryId"
          value={formData.categoryId}
          onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          required
        >
          <option value="">選択してください</option>
          {categoryOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {errors.categoryId && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.categoryId}</p>
        )}
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="completed"
          name="completed"
          checked={formData.completed}
          onChange={(e) => setFormData({ ...formData, completed: e.target.checked })}
          className="h-4 w-4 text-blue-600 dark:text-blue-400 focus:ring-blue-500 dark:focus:ring-blue-400 border-gray-300 dark:border-gray-600 rounded"
        />
        <label htmlFor="completed" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
          completed
        </label>
        {errors.completed && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.completed}</p>
        )}
      </div>

      <div>
        <label htmlFor="priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          priority
        </label>
        <select
          id="priority"
          name="priority"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400"
        >
          <option value="">選択してください</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
        {errors.priority && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.priority}</p>
        )}
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
        >
          {loading ? '保存中...' : isEdit ? '更新' : '作成'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-600 text-white px-6 py-2 rounded"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
```

## ベストプラクティス

### 1. モデルの命名規約

- スキーマ名: `camelCase`（サフィックスなし）: `product`, `category`, `todo`
- 型名: `PascalCase`（サフィックスなし）: `Product`, `Category`, `Todo`
- クラス名: `PascalCase`: `Product`, `Category`, `Todo`
- スキーマと型をエクスポート：
  ```typescript
  export const product = z.object({...});
  export type Product = z.infer<typeof product>;
  ```

### 2. 外部キーの命名

- 外部キーフィールドは常に `Id` で終わらせる: `categoryId`, `userId`, `orderId`
- 外部キーには `z.string()` 型を使用（Cosmos DB は文字列 ID を使用）
- 検証メッセージを追加：
  ```typescript
  categoryId: z.string().min(1, "カテゴリは必須です")
  ```

### 3. 表示文字列フィールド

- 外部キーの表示を改善するため、モデルに `name` または `title` フィールドを含める
- 例：
  ```typescript
  export const category = z.object({
    id: z.string(),
    name: z.string().min(1, "名前は必須です"), // 表示に使用
    // ...その他のフィールド
  });
  
  export type Category = z.infer<typeof category>;
  ```

### 4. オプショナル vs 必須フィールド

- 空にできるフィールドには `.optional()` を使用
- デフォルト値を持つフィールドには `.default()` を追加
- 役立つ検証メッセージを提供：
  ```typescript
  name: z.string().min(1, "名前は必須です"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  ```

### 5. Enum 値

- 直接表示できる意味のある enum 値を使用：
  ```typescript
  // 良い例
  priority: z.enum(["low", "medium", "high"])
  
  // より良い例（表示に適した値）
  status: z.enum(["pending", "in_progress", "completed", "cancelled"])
  ```

## トラブルシューティング

### スキーマ解析エラー

"Failed to parse model file" が表示される場合、以下を確認してください：
- ファイルに Zod オブジェクトスキーマの有効なエクスポートがある
- ルートスキーマとして `z.object()` を使用している

### 外部キーが検出されない

以下を確認してください：
- フィールド名が `Id` で終わる（大文字小文字を区別）
- フィールド型が `z.string()`
- 参照先モデルが存在し、scaffold されている

### 表示名が表示されない

外部キーが名前の代わりに ID を表示する場合：
- 参照先モデルに `name` または `title` フィールドがあることを確認
- 参照先モデルが scaffold されていることを確認
- API エンドポイント `/api/<model>` がデータを返すことを確認

## ファクトリーパターン（CRUD コード重複の削減）

SwallowKit は**ファクトリーパターン**を使用して CRUD コードを生成します。これにより、エンティティごとのコード重複（約 94%）を排除し、保守性を大幅に向上させます。

### 仕組み

`scaffold` コマンドは以下のファクトリーファイルを生成します：

- `lib/api/crud-factory.ts` - Next.js BFF 用の汎用 CRUD ハンドラー
- `functions/src/lib/crud-factory.ts` - Azure Functions 用の汎用 CRUD ハンドラー

各エンティティのルートファイルは、ファクトリーを呼び出すだけの簡潔なコードになります：

**Next.js BFF ルート:**

```typescript
// app/api/todo/route.ts
import { createCrudHandlers } from '@/lib/api/crud-factory';
import { todo } from '@/lib/models/todo';

const handlers = createCrudHandlers({
  entityName: 'todo',
  schema: todo,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
```

**Azure Functions:**

```typescript
// functions/src/todo.ts
import { app } from '@azure/functions';
import { createCrudFunctions } from './lib/crud-factory';
import { todo } from './models/todo';

const crud = createCrudFunctions({
  schema: todo,
  containerName: 'Todos',
});

app.http('getTodos', { methods: ['GET'], route: 'todo', handler: crud.getAll });
app.http('getTodoById', { methods: ['GET'], route: 'todo/{id}', handler: crud.getById });
app.http('createTodo', { methods: ['POST'], route: 'todo', handler: crud.create });
app.http('updateTodo', { methods: ['PUT'], route: 'todo/{id}', handler: crud.update });
app.http('deleteTodo', { methods: ['DELETE'], route: 'todo/{id}', handler: crud.delete });
```

## コネクタモデル

Cosmos DB モデルに加えて、SwallowKit はリレーショナルデータベース（MySQL、PostgreSQL、SQL Server）や REST API などの外部データソースと統合する**コネクタモデル**をサポートします。

コネクタモデルも同じ `scaffold` コマンドを使い、BFF ルートや UI コンポーネントも同様に生成されます。違いは生成される Azure Functions コードとモデルのメタデータにあります。

### 仕組み

1. `add-connector` で `swallowkit.config.js` にコネクタを登録
2. `create-model --connector <name>` でモデルを作成
3. モデルがデータソースマッピングを記述する `connectorConfig` オブジェクトをエクスポート
4. `scaffold` がコネクタメタデータを検出し、適切な Functions コードを生成

### コネクタモデルで変わること

| 観点 | 標準モデル (Cosmos DB) | コネクタモデル |
|------|----------------------|--------------|
| Functions コード | Cosmos DB バインディング | SQL クエリ (RDB) または HTTP クライアント (API) |
| Functions 配置先 | `functions/src/functions/` (TS) | `functions/Connectors/` (C#) または同ディレクトリ (TS/Python) |
| BFF ルート | 標準 `callFunction()` | 同一 — 透過的 |
| UI コンポーネント | フル CRUD | 同一（`operations` を尊重） |
| Cosmos Bicep | 生成される | スキップ |
| 操作 | 全 CRUD | 設定可能（例: 読み取り専用） |

### 読み取り専用モデル

コネクタモデルの `operations` が `getAll` と `getById` のみを含む場合、scaffold は GET エンドポイントだけを生成します。POST・PUT・DELETE ハンドラーは省略されます。

### ローカル開発

`swallowkit dev --mock-connectors` を使うと、コネクタモデル向けに Zod 生成のモックデータを提供するプロキシサーバーが起動します。開発時に実際のデータベースや API 接続は不要です。詳しくは [Connector ガイド](./connector-guide) を参照してください。

## 認証連携

`swallowkit add-auth` で認証がセットアップされている場合、モデルから `authPolicy` をエクスポートすることで、scaffold 生成された Functions にロールベースのアクセス制御を追加できます：

```typescript
// shared/models/estimate.ts
import { z } from 'zod';

export const estimate = z.object({
  id: z.string(),
  title: z.string().min(1),
  amount: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Estimate = z.infer<typeof estimate>;
export const displayName = 'Estimate';

// ロールベースアクセス制御
export const authPolicy = { roles: ['admin', 'estimator'] };

// または読み取りと書き込みの権限を分離
// export const authPolicy = { read: ['admin', 'estimator'], write: ['admin'] };
```

`scaffold` が `authPolicy` を検出すると、生成される Functions ハンドラーに認証チェックとロールガードを自動的に注入します。

`swallowkit.config.js` で `auth.authorization.defaultPolicy` が `'authenticated'` に設定されている場合、明示的な `authPolicy` エクスポートがなくても、すべての scaffold 生成 Functions はデフォルトで認証が必須になります。

> 💡 セットアップ手順と設定の詳細については **[認証ガイド](./auth-guide)** をご参照ください。

## 次のステップ

- [Connector ガイド](./connector-guide) - 同じ Zod ワークフローで外部データソースを統合
- [認証ガイド](./auth-guide) - 認証とロールベースアクセス制御を追加
- [Zod スキーマ共有](./zod-schema-sharing-guide) - 型安全なスキーマ共有の概念を理解
- [デプロイガイド](./deployment-guide) - アプリケーションを Azure にデプロイ
- [CLI リファレンス](./cli-reference) - 利用可能なすべてのコマンドを学ぶ
- `functions/local.settings.json` で Azure Functions の設定を調べる
- 本番環境用の Cosmos DB 接続を設定
- 生成された UI コンポーネントをブランドに合わせてカスタマイズ
- より多くの SwallowKit 機能については [README](https://github.com/himanago/swallowkit#readme) に戻る
