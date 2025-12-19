# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

[English](./README.md) | 日本語

**Azure 上の Next.js アプリケーション向けの型安全なスキーマ駆動開発ツールキット**

SwallowKit は、Zod スキーマを通じてエンドツーエンドの型安全性を維持しながら、外部の Azure Functions バックエンドを持つフルスタック Next.js アプリケーションを Static Web Apps で構築するための統合キットです。

Next.js の API ルートを BFF（Backend For Frontend）としての使用のみに制限し、ビジネスロジックは独立した Azure Functions にオフロードすることでクライアント・サーバー間の明確な分離を提供します。

Zod スキーマから自動的に CRUD 操作を生成する Scaffold 機能を備え、一貫した型定義で Next.js (Azure Static Web Apps)、Azure Functions、Cosmos DB を組み合わせた構成で、CRUD コードの自動生成から本番デプロイ・CI/CD までをサポートします。

> **注意**: このプロジェクトは活発に開発中です。将来のバージョンでAPIが変更される可能性があります。

## ✨ 主な特徴

- **🔄 Zod スキーマ共有** - フロントエンド、BFF、Azure Functions、Cosmos DB で同じスキーマを使用
- **⚡ CRUD コード生成** - `swallowkit scaffold` で Azure Functions + Next.js コードを自動生成
- **🛡️ 完全な型安全性** - クライアントからデータベースまでエンドツーエンド TypeScript
- **🎯 BFF パターン** - Next.js API Routes が BFF レイヤーとして機能、自動検証・リソース名推論
- **☁️ Azure 最適化** - Static Web Apps + Functions + Cosmos DB で最小コスト構成
- **🚀 簡単デプロイ** - Bicep IaC + CI/CD ワークフローを自動生成


## 📚 ドキュメント

- **[CLI リファレンス](./docs/cli-reference.ja.md)** - 全コマンドの詳細
- **[Scaffold ガイド](./docs/scaffold-guide.ja.md)** - CRUD コード生成
- **[Zod スキーマ共有ガイド](./docs/zod-schema-sharing-guide.ja.md)** - スキーマ設計
- **[デプロイガイド](./docs/deployment-guide.ja.md)** - Azure へのデプロイ

## 🚀 クイックスタート

### 1. プロジェクト作成

```bash
npx swallowkit init my-app
cd my-app
```

### 2. モデルの作成

```bash
npx swallowkit create-model todo
```

これにより `lib/models/todo.ts` が生成されます。必要なフィールドを追加してカスタマイズ：

```typescript
// lib/models/todo.ts
import { z } from 'zod';

export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todoSchema>;
```

### 3. CRUD コード生成

```bash
npx swallowkit scaffold lib/models/todo.ts
```

これで以下が自動生成されます:
- ✅ Azure Functions (CRUD エンドポイント + Cosmos DB バインディング)
- ✅ Next.js BFF API Routes (自動検証・リソース名推論)
- ✅ React コンポーネント (型安全なフォーム)

### 4. 開発サーバー起動

```bash
npx swallowkit dev
```

- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

### 5. フロントエンドから使用

```typescript
import { api } from '@/lib/api/backend';
import type { Todo } from '@/lib/models/todo';

// 全件取得 - BFFエンドポイントを呼び出し
const todos = await api.get<Todo[]>('/api/todos');

// 作成 - バックエンドで検証
const created = await api.post<Todo>('/api/todos', {
  text: '牛乳を買う',
  completed: false
});

// 更新 - バックエンドで検証
const updated = await api.put<Todo>('/api/todos/123', { completed: true });

// 削除
await api.delete('/api/todos/123');
```

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                            │
│  - Client Components                                         │
│  - Server Components (SSR)                                   │
└──────────────────────────┬───────────────────────────────────┘
                           │ api.post('/api/todos', data)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  BFF Layer (Next.js API Routes)                              │
│  - Auto Schema Validation (Zod)                              │
│  - Error Handling                                            │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP Request
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Azure Functions (Backend)                                   │
│  - HTTP Triggers (CRUD)                                      │
│  - Zod Validation (Re-check)                                 │
│  - Business Logic                                            │
│  - Cosmos DB Bindings                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Azure Cosmos DB                                             │
│  - NoSQL Database                                            │
│  - Zod Schema Validation                                     │
└─────────────────────────────────────────────────────────────┘
```

**重要なパターン:**
- **BFF (Backend For Frontend)**: Next.js API Routes が Azure Functions へのプロキシ
- **共有スキーマ**: Zod スキーマをフロントエンド・BFF・Functions・DB で共有
- **型安全性**: Zod から TypeScript 型を自動推論
- **マネージド ID**: サービス間の安全な接続（接続文字列不要）

## 📦 前提条件

- Node.js 22.x
- Azure Cosmos DB Emulator (ローカル開発用)
  - [公式ドキュメント](https://learn.microsoft.com/ja-jp/azure/cosmos-db/emulator)
    - Windows: [ダウンロード](https://aka.ms/cosmosdb-emulator)
    - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 🚀 Azure へのデプロイ

Next.js アプリを standalone モードで Azure Static Web Apps にデプロイし、バックエンド操作のために独立した Azure Functions に接続します。

```bash
# 1. リソースをプロビジョニング (Bicep IaC)
npx swallowkit provision --resource-group my-app-rg --location japaneast

# 2. CI/CD シークレットを設定 (詳細はデプロイガイド参照)

# 3. コードをプッシュして自動デプロイ
git push origin main
```

詳細は **[デプロイガイド](./docs/deployment-guide.ja.md)** を参照してください。

##  ライセンス

MIT

## 🔗 関連リンク

- [Azure Static Web Apps](https://learn.microsoft.com/ja-jp/azure/static-web-apps/)
- [Azure Functions](https://learn.microsoft.com/ja-jp/azure/azure-functions/)
- [Azure Cosmos DB](https://learn.microsoft.com/ja-jp/azure/cosmos-db/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)
