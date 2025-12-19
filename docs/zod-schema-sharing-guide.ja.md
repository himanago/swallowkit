# Zod スキーマ共有ガイド

SwallowKit の中核機能は **Zod スキーマ共有** です。これにより、フロントエンドから BFF レイヤー、Azure Functions、データベースストレージまで、スタック全体で型安全で検証されたデータフローが実現されます。

> **注意**: このガイドは Zod スキーマ共有の概念とメリットを説明します。実際の CRUD コード生成については、**[Scaffold ガイド](./scaffold-guide.md)** を参照してください。

## なぜ Zod スキーマ共有なのか？

### 課題

従来のフルスタック開発では、型と検証ロジックを複数回定義することがよくあります：

- **フロントエンド**: あるライブラリでフォーム検証
- **バックエンド API**: 別のライブラリでリクエスト検証
- **データベース**: ORM や別ファイルでスキーマ定義
- **TypeScript 型**: 手動でインターフェースをメンテナンス

これにより以下の問題が発生します：
- ❌ コードの重複
- ❌ 一貫性のない検証
- ❌ レイヤー間の型のずれ
- ❌ メンテナンスオーバーヘッド

### SwallowKit の解決策

Zod でスキーマを **一度だけ** 定義し、どこでも使用します：

```typescript
// lib/models/user.ts - 信頼できる唯一の情報源
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '名前は必須です'),
  email: z.string().email('無効なメールアドレスです'),
  age: z.number().min(18, '18歳以上である必要があります'),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type UserType = z.infer<typeof userSchema>;
```

この単一のスキーマが提供するもの：
- ✅ TypeScript 型 (`UserType`)
- ✅ ランタイム検証
- ✅ データベース統合 (scaffold 経由)
- ✅ エラーメッセージ
- ✅ デフォルト値

💡 **実践的な使い方**: SwallowKit で Zod スキーマから CRUD 操作を自動生成する方法については、**[Scaffold ガイド](./scaffold-guide.ja.md)** をご参照ください。

## レイヤー間での使用

### レイヤー 1: SwallowKit API クライアントを使ったフロントエンド

SwallowKit はバックエンド API を呼び出すためのシンプルな HTTP クライアントを提供します：

```typescript
// app/users/page.tsx
'use client'

import { api } from '@/lib/api/backend';
import type { UserType } from '@/lib/models/user';
import { useState, useEffect } from 'react';

export default function UsersPage() {
  const [users, setUsers] = useState<UserType[]>([]);
  const [error, setError] = useState('');
  
  useEffect(() => {
    // BFF エンドポイントから取得
    api.get<UserType[]>('/api/users')
      .then(setUsers)
      .catch(err => setError(err.message));
  }, []);
  
  const handleCreate = async (formData: FormData) => {
    try {
      // バックエンドで検証
      const newUser = await api.post<UserType>('/api/users', {
        id: crypto.randomUUID(),
        name: formData.get('name') as string,
        email: formData.get('email') as string,
        age: Number(formData.get('age')),
      });
      setUsers([...users, newUser]);
    } catch (err: any) {
      setError(err.message); // バックエンド検証エラー
    }
  };
  
  return (
    <div>
      {error && <div className="error">{error}</div>}
      {users.map(user => (
        <div key={user.id}>{user.name} - {user.email}</div>
      ))}
    </div>
  );
}
```

💡 **自動生成について**: `scaffold` コマンドを使用すると、フォーム検証を含む完全な UI コンポーネントが自動生成されます。詳細は **[Scaffold ガイド](./scaffold-guide.ja.md#生成されるファイル)** をご参照ください。

### レイヤー 2: Next.js BFF API Routes（自動生成）

SwallowKit の `scaffold` コマンドは、リクエストを検証する BFF API ルートを生成します：

```typescript
// 生成元: npx swallowkit scaffold user
// app/api/user/route.ts (Next.js BFF API)
import { NextRequest, NextResponse } from 'next/server';
import { userSchema } from '@/lib/models/user';

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  // Azure Functions に転送する前に Zod スキーマで検証
  const result = userSchema.safeParse(body);
  
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.errors[0].message },
      { status: 400 }
    );
  }
  
  // 検証済みデータを Azure Functions に転送
  const response = await fetch(`${FUNCTIONS_BASE_URL}/api/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.data),
  });
  
  const data = await response.json();
  return NextResponse.json(data);
}
```

📚 **参考情報**: 生成される API ルートの完全な例については、**[Scaffold ガイド](./scaffold-guide.ja.md)** をご参照ください。

### レイヤー 3: Azure Functions と Cosmos DB（自動生成）

バックエンドの Azure Functions も同じスキーマを使用します：

```typescript
// 生成元: npx swallowkit scaffold user
// functions/src/user.ts (Azure Functions)
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { userSchema } from './models/user';
import { CosmosClient } from '@azure/cosmos';

const cosmosClient = new CosmosClient(process.env.CosmosDBConnection!);
const database = cosmosClient.database('AppDatabase');
const container = database.container('Users');

export async function createUser(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const body = await request.json();
  
  // 共有 Zod スキーマでリクエストを検証
  const result = userSchema.safeParse(body);
  
  if (!result.success) {
    return {
      status: 400,
      jsonBody: { error: result.error.errors[0].message }
    };
  }
  
  // 検証済みデータを Cosmos DB に保存
  const { resource: created } = await container.items.create(result.data);
  
  return {
    status: 201,
    jsonBody: created
  };
}

app.http('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: createUser
});
```

📚 **参考情報**: 完全な CRUD 操作を含む Azure Functions の生成例については、**[Scaffold ガイド](./scaffold-guide.ja.md)** をご参照ください。

## 高度なパターン

### 部分的なスキーマ

更新時に特定のフィールドのみを検証：

```typescript
// プロフィール更新時は name と email のみを検証
const updateProfileSchema = userSchema.pick({ 
  name: true, 
  email: true 
});
### ネストされたスキーマ

複雑なデータ構造を構成：

```typescript
const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
});

const userWithAddressSchema = userSchema.extend({
  address: addressSchema,
});

export type UserWithAddressType = z.infer<typeof userWithAddressSchema>;
```

### カスタム検証

ビジネスロジック検証を追加：

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().positive(),
  discount: z.number().min(0).max(100),
}).refine(
  (data) => {
    // カスタム検証: 割引後の価格が正である必要がある
    const finalPrice = data.price * (1 - data.discount / 100);
    return finalPrice > 0;
  },
  { message: '割引後の価格は 0 より大きい必要があります' }
);
```

### トランスフォーメーション

検証中にデータを変換：

```typescript
const userInputSchema = z.object({
  name: z.string().trim().toLowerCase(), // 名前を正規化
  email: z.string().email().toLowerCase(), // メールを正規化
  age: z.string().transform(Number), // 文字列を数値に変換
});
```

## ベストプラクティス

### 1. モデルファイルの構造

SwallowKit 推奨のモデルファイル構造に従ってください：

```typescript
// lib/models/user.ts
import { z } from 'zod';

// 1. Zod スキーマを定義（camelCase + 'schema' サフィックス）
export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '名前は必須です'),
  email: z.string().email('無効なメールアドレスです'),
  age: z.number().min(18, '18歳以上である必要があります'),
  createdAt: z.string().default(() => new Date().toISOString()),
});

// 2. TypeScript 型をエクスポート（PascalCase + 'Type' サフィックス）
export type UserType = z.infer<typeof userSchema>;
```

💡 **SwallowKit の規約**: 
- スキーマ名: `camelCase` + `schema` サフィックス（例: `userSchema`, `productSchema`）
- 型名: `PascalCase` + `Type` サフィックス（例: `UserType`, `ProductType`）

### 2. エラーハンドリングには safeParse() を使用

```typescript
// ✅ 良い例: エラーを適切に処理
const result = userSchema.safeParse(data);
if (!result.success) {
  console.error(result.error.errors);
  return { error: '検証に失敗しました' };
}

// ❌ 悪い例: 例外をスロー
const user = userSchema.parse(data); // 例外がスローされる可能性あり！
```

### 3. UX 向上のための検証メッセージ

明確でユーザーフレンドリーなエラーメッセージを提供：

```typescript
const productSchema = z.object({
  name: z.string().min(1, '商品名は必須です'),
  price: z.number().positive('価格は 0 より大きい必要があります'),
  category: z.enum(['electronics', 'clothing', 'books'], {
    errorMap: () => ({ message: '有効なカテゴリを選択してください' })
  }),
});
```

### 4. デフォルト値とオプショナルフィールド

```typescript
const todoSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'タイトルは必須です'),
  completed: z.boolean().default(false), // デフォルト値
  description: z.string().optional(), // オプショナルフィールド
  createdAt: z.string().default(() => new Date().toISOString()),
});
```

SwallowKit の scaffold コマンドは適切な UI を自動生成します：
- オプショナルフィールドはフォームで必須マークがつかない
- デフォルト値は事前入力される

📚 **参考情報**: 型に応じた UI 生成の詳細については、**[Scaffold ガイド](./scaffold-guide.ja.md#型に応じた-ui-生成)** をご参照ください。

### 5. 外部キーの命名規約

SwallowKit で自動的に外部キーを検出するため：

```typescript
const todoSchema = z.object({
  id: z.string(),
  categoryId: z.string().min(1, 'カテゴリは必須です'), // Category への FK として検出
  userId: z.string().min(1, 'ユーザーは必須です'), // User への FK として検出
});
```

**パターン**: `<モデル名>Id` → `<モデル名>` モデルを参照

📚 **参考情報**: 外部キーリレーションシップの詳細については、**[Scaffold ガイド](./scaffold-guide.ja.md#外部キーリレーションシップ)** をご参照ください。

## まとめ

SwallowKit の Zod スキーマ共有が提供するもの：

✅ **信頼できる唯一の情報源** - 一度定義すればどこでも使える  
✅ **型安全性** - コンパイル時とランタイムの検証  
✅ **一貫性** - すべてのレイヤーで同じ検証ロジック  
✅ **開発者体験** - IntelliSense、自動補完、エラーメッセージ  
✅ **保守性** - スキーマを一度変更すれば全体に反映  

このアプローチにより、型のずれを排除し、バグを削減し、スタック全体で開発者の生産性を向上させます。

## 次のステップ

- **[Scaffold ガイド](./scaffold-guide.md)** - Zod スキーマから完全な CRUD 操作を生成
- **[Zod ドキュメント](https://zod.dev/)** - Zod の高度な機能とパターンを学ぶ
- **[README](../README.ja.md)** - SwallowKit を始める
