# はじめる

pnpm 11/12 と npm の使い分けは[コマンドとトラブルシューティング](./package-managers.md)を参照してください。

このページでは、SwallowKit プロジェクトを作成し、最初の CRUD フローを生成するまでの手順を説明します。

最終的に、1 つの Zod スキーマから生成された型付き BFF ルート、Azure Functions バックエンドハンドラー、UI を持つ Next.js / React アプリケーションが動作する状態になります。

React では Vite SPA と SWA マネージド Functions BFF を生成します。
生成パス、認証、開発、デプロイは [React ガイド](./react-guide.md)を参照してください。
以下のパス例は、特記しない限り Next.js 構成です。

## 前提条件

- Node.js 22.14 以上
- **pnpm**（推奨）— `corepack enable` を実行するか `npm install -g pnpm` でインストール
  - npm でも動作します。起動元のパッケージマネージャーを使います。`--package-manager npm|pnpm` で明示指定できます。
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

Next.js の場合は `create-next-app` を使います。React の場合は Vite + React Router SPA とマネージド Functions BFF を生成します。

対話プロンプトで以下を選択します：

| オプション | 値 | デフォルト |
|-----------|-----|----------|
| フロントエンド | `nextjs`, `react` | 非対話時は `nextjs` |
| CI/CD プロバイダー | `github`, `azure`, `skip` | （対話で選択） |
| バックエンド言語 | `typescript`, `csharp`, `python` | （対話で選択） |
| Cosmos DB モード | `freetier`, `serverless` | （対話で選択） |
| ネットワーク | `outbound`, `none` | （対話で選択） |
| SWA プラン | `free`, `standard` | （対話で選択） |

プロンプトをスキップするには、フラグで直接指定します：

::: code-group
```bash [npm]
npx swallowkit init my-app --frontend react --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none --swa-plan free
```
```bash [pnpm]
pnpm dlx swallowkit init my-app --frontend react --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none --swa-plan free
```
:::

## 2. モデルを作成する

::: code-group
```bash [npm]
npx swallowkit create-model todo
```
```bash [pnpm]
pnpm exec swallowkit create-model todo
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
pnpm exec swallowkit scaffold todo
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

React では BFF を `bff/src/todo/index.ts` と `bff/todo/function.json`、
UI・フォーム・ルート登録を `src/pages/todo/` に生成します。

## 4. 開発サーバーを起動する

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm exec swallowkit dev
```
:::

起動するサーバー：
- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

http://localhost:3000/todo を開くと生成された UI を確認できます。

**React の場合**はマネージド BFF（7073）と SWA CLI（4280）も起動します。
**http://localhost:4280/todo** を開き、`/api` をマネージド BFF に通してください。
独立 Functions は引き続き 7071 で動作し、SWA にはリンクしません。

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
