# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/himanago.swallowkit-vscode?label=VS%20Code%20Extension)](https://marketplace.visualstudio.com/items?itemName=himanago.swallowkit-vscode)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

[English](./README.md) | 日本語

Next.js と Azure のための、スキーマ駆動アプリケーション開発ツールキットです。

SwallowKit は、共有された Zod スキーマを中心にして、保守しやすいフルスタックアプリケーションを Azure 上に構築するための scaffolding ツールです。1 つのスキーマ定義から、フロントエンドフォーム、BFF ルート、Azure Functions バックエンド、OpenAPI、インフラ定義、AI エージェント向けのプロジェクトメタデータなどを生成できます。

フロントエンド、バックエンド、データベース、バリデーション、API 契約、デプロイ構成がばらばらになりがちな Next.js + Azure アプリケーション開発を、明示的な構成で整理することを目的としています。

## 🎯 なぜ SwallowKit か

AI はアプリケーションコードをすばやく生成できます。フレームワークは複雑さをうまく隠してくれます。しかし、本番で運用するアプリケーションには、依然として明示的なアーキテクチャが必要です。

一般的なフルスタックアプリケーションでは、同じドメインモデルが多くの場所に重複して現れます。

- フロントエンドのフォーム型
- クライアント側バリデーション
- BFF のリクエスト・レスポンス型
- バックエンド DTO
- API 契約
- データベースエンティティ
- シードデータ
- インフラ・デプロイ構成

アプリケーションが大きくなるほど、これらの定義は少しずつずれていきます。SwallowKit は、スキーマを明示的な中心に置き、その周辺に必要なアプリケーション構造を生成することで、このずれを減らします。

**SwallowKit は、すべてを隠蔽するフルスタックフレームワークではありません。生成されたコードを読み、編集し、必要なら置き換えられることを重視した scaffolding ツールです。**

## ✨ 主な機能

- **Zod スキーマを中心にした型定義** とバリデーション共有
- **Next.js、BFF ルート、Azure Functions、UI コンポーネントの CRUD scaffolding**
- **Bicep による Azure 向けインフラ定義**
- **複数言語の Azure Functions バックエンド対応**（TypeScript、C#、Python）
- **ローカル開発支援** とシードデータ
- **AI / MCP 向けのプロジェクトメタデータ** とコマンド
- **VS Code 拡張機能**

## 🏗️ 想定アーキテクチャ

SwallowKit は、次のような構成のアプリケーションを主な対象にしています。

- Next.js
- Azure Static Web Apps
- Azure Functions
- Azure Cosmos DB
- Azure Bicep
- GitHub Actions または Azure Pipelines

標準構成では、BFF パターンを採用します。

```
ブラウザー
  |
Next.js フロントエンド
  |
Next.js BFF ルート
  |
Azure Functions API
  |
Azure Cosmos DB
```

BFF レイヤーを置くことで、フロントエンドをシンプルに保ちながら、バックエンドサービス、認証・認可、クラウドリソースとの接続を整理しやすくします。

> **注意**: このプロジェクトは活発に開発中です。将来のバージョンでAPIが変更される可能性があります。

## 📚 ドキュメント

詳しい使い方はドキュメントサイトを参照してください（[English](https://himanago.github.io/swallowkit/en/) もあります）。

- **[はじめる](https://himanago.github.io/swallowkit/ja/getting-started)** - 最初のプロジェクトセットアップ
- **[基本概念](https://himanago.github.io/swallowkit/ja/concepts)** - スキーマ中心のアーキテクチャ
- **[Scaffold ガイド](https://himanago.github.io/swallowkit/ja/scaffold-guide)** - CRUD コード生成
- **[ローカル開発](https://himanago.github.io/swallowkit/ja/dev-guide)** - Dev サーバー、seeds、モックコネクタ
- **[デプロイガイド](https://himanago.github.io/swallowkit/ja/deployment-guide)** - Azure へのデプロイ
- **[AI / MCP ガイド](https://himanago.github.io/swallowkit/ja/ai-mcp-guide)** - AI エージェント統合
- **[認証](https://himanago.github.io/swallowkit/ja/auth-guide)** - 認証と認可
- **[コネクタ](https://himanago.github.io/swallowkit/ja/connector-guide)** - 外部データソース統合

## 🚀 クイックスタート

新しいプロジェクトを作成します。

```bash
npx swallowkit init my-app
cd my-app
```

モデルを作成し、スキーマを編集します。

```bash
npx swallowkit create-model todo
```

```typescript
// shared/models/todo.ts
import { z } from 'zod';

export const todo = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todo>;
```

CRUD コードを生成し、開発サーバーを起動します。

```bash
npx swallowkit scaffold todo
npx swallowkit dev
```

Azure Functions、Next.js BFF ルート、React UI コンポーネントが、共有スキーマから型付きで生成されます。

## 🤖 AI エージェントとの協調

SwallowKit は、AI コーディングエージェントがプロジェクト構造を理解し、公式の生成コマンドを通じて変更を行い、生成物を検証できるように、機械可読なプロジェクトメタデータとコマンドインターフェースを提供します。

目的は、AI に自由にファイルを書き換えさせることではなく、明示的なアーキテクチャ境界の中で安全に開発を支援させることです。

## 📦 生成されるプロジェクト構成

```
.
├── app/                  # Next.js ページと BFF API ルート
├── shared/
│   └── models/           # 共有 Zod スキーマ（単一のソース）
├── functions/            # Azure Functions バックエンド
├── infra/                # Bicep テンプレート
├── lib/                  # BFF ヘルパーと scaffold 設定
└── .swallowkit/          # SwallowKit プロジェクトメタデータ
```

## 🔗 ステータス

SwallowKit は現在開発中です。API、プロジェクト構成、生成されるコードは変更される可能性があります。

フィードバック、Issue、小さなサンプルユースケースの共有を歓迎します。

## 📄 ライセンス

MIT
