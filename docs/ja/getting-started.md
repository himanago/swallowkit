# はじめる

このページでは、SwallowKit プロジェクトを作成し、最初の CRUD フローを生成するまでの手順を説明します。

最終的に、1 つの Zod スキーマから生成された型付き BFF ルート、Azure Functions バックエンドハンドラー、React UI コンポーネントを持つ Next.js アプリケーションが動作する状態になります。

## 前提条件

- Node.js 20 以上
- **pnpm**（推奨）— `corepack enable` を実行するか `npm install -g pnpm` でインストール
  - npm でも動作します。SwallowKit はパッケージマネージャーを自動検出します（pnpm が利用可能なら優先）。
- Azure Functions Core Tools 4.x — ローカル Functions 開発に必要
- Azure Cosmos DB Emulator — ローカルデータストアに必要
  - Windows: [ダウンロード](https://aka.ms/cosmosdb-emulator)
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 1. プロジェクトを作成する

::: code-group
```bash [npm]
npx swallowkit init my-app
cd my-app
```
```bash [pnpm]
pnpm dlx swallowkit init my-app
cd my-app
```
:::

このコマンドは内部で `create-next-app` を実行し、その上に SwallowKit のプロジェクト構造を追加します。

対話プロンプトで以下を選択します：

| オプション | 値 | デフォルト |
|-----------|-----|----------|
| CI/CD プロバイダー | `github`, `azure`, `skip` | （対話で選択） |
| バックエンド言語 | `typescript`, `csharp`, `python` | （対話で選択） |
| Cosmos DB モード | `freetier`, `serverless` | （対話で選択） |
| ネットワーク | `outbound`, `none` | （対話で選択） |

プロンプトをスキップするには、フラグで直接指定します：

::: code-group
```bash [npm]
npx swallowkit init my-app --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none
```
```bash [pnpm]
pnpm dlx swallowkit init my-app --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none
```
:::

## 2. モデルを作成する

::: code-group
```bash [npm]
npx swallowkit create-model todo
```
```bash [pnpm]
pnpm swallowkit create-model todo
```
:::

`shared/models/todo.ts` にテンプレートスキーマが生成されます。編集してフィールドを追加します：

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

`id`、`createdAt`、`updatedAt` はバックエンドが管理するフィールドです。スキーマでは `optional()` として定義します。

## 3. CRUD コードを生成する

::: code-group
```bash [npm]
npx swallowkit scaffold todo
```
```bash [pnpm]
pnpm swallowkit scaffold todo
```
:::

生成されるファイル：

| レイヤー | 生成ファイル |
|---------|------------|
| Azure Functions | `functions/src/todo.ts`（TypeScript バックエンド） |
| BFF ルート | `app/api/todo/route.ts`、`app/api/todo/[id]/route.ts` |
| UI ページ | `app/todo/page.tsx`、`app/todo/[id]/page.tsx`、`app/todo/new/page.tsx`、`app/todo/[id]/edit/page.tsx` |
| UI コンポーネント | `app/todo/_components/TodoForm.tsx` |
| インフラ | `infra/containers/todo-container.bicep` |

C# バックエンドでは `functions/Crud/TodoCrudFunctions.cs`、Python では `functions/blueprints/todo.py` が生成されます。

## 4. 開発サーバーを起動する

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm swallowkit dev
```
:::

起動するサーバー：
- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

http://localhost:3000/todo を開くと生成された UI を確認できます。

## 5. 動作を確認する

- http://localhost:3000/todo/new にアクセスして todo を作成する
- フォームは BFF ルートに送信され、BFF が Azure Functions に転送する
- データはローカルの Cosmos DB Emulator に保存される
- 一覧ページに作成したアイテムが表示される

## 生成されたプロジェクト構成

`init` と `scaffold` の後、プロジェクトは次のような構成になります：

```
my-app/
├── app/
│   ├── api/todo/          # BFF ルート（自動バリデーション、Functions へプロキシ）
│   └── todo/              # React ページとコンポーネント
├── shared/models/
│   └── todo.ts            # Zod スキーマ（単一のソース）
├── functions/src/
│   └── todo.ts            # Azure Functions CRUD ハンドラー
├── infra/
│   ├── main.bicep         # Azure リソース定義
│   └── containers/        # Cosmos DB コンテナ定義
├── lib/
│   └── api/               # BFF ヘルパー（callFunction）
└── .swallowkit/           # プロジェクトメタデータ
```

## 次のステップ

- [基本概念](/ja/concepts) — スキーマ中心のアーキテクチャと BFF パターンを理解する
- [Scaffold ガイド](/ja/scaffold-guide) — 高度な scaffold オプション、ネストスキーマ、複数モデル
- [ローカル開発](/ja/dev-guide) — Dev seeds、モックコネクタ、バックエンド別のセットアップ
- [Azure へのデプロイ](/ja/deployment-guide) — リソースのプロビジョニングと CI/CD 設定
