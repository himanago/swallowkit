# React フロントエンド

SSR や React Server Components が不要なアプリでは、Next.js の代わりに React を選択できます。
React + TypeScript の SPA を Vite、React Router、Tailwind CSS で生成します。
独立 Azure Functions、共有 Zod スキーマ、コネクタ、認可は従来と同じ構成です。

## 初期化

init の対話プロンプトで **Next.js** または **React** を選びます。非対話環境では次のように指定します。

```sh
npx swallowkit init my-app --frontend react --package-manager npm --cicd github --backend-language typescript --cosmos-db-mode freetier --vnet none --swa-plan free
```

pnpm の場合は `pnpm dlx swallowkit init ... --package-manager pnpm` を使い、
作成したプロジェクト内では `pnpm exec swallowkit ...` を実行します。
バックエンド言語は引き続き `typescript`、`csharp`、`python` から選べます。
マネージド BFF は常に TypeScript です。`--next-version` は Next.js 選択時だけ使われます。

選択内容は `swallowkit.config.js` に保存されます。

```js
module.exports = {
  frontend: { framework: 'react' },
  backend: { language: 'typescript' },
};
```

`frontend.framework` のない既存設定と、`--frontend` を省略した非対話 init は Next.js のままです。
既存 Next.js アプリの設定を変更しても、カスタムページが自動移行されるわけではありません。

## Functions を二層に分ける構成

```text
ブラウザー
  → SWA: React の静的ファイル
  → SWA /api: HTTP 専用マネージド Functions BFF（bff/）
  → 独立 Functions（functions/）
  → Cosmos DB / 外部コネクタ
```

**独立 Functions は SWA にリンクしません。** SWA が管理するのは BFF だけです。
バックエンドの独立デプロイ、言語、バインディング、マネージド ID、VNet 統合、
Cosmos DB アクセスは従来の構成を維持します。

BFF は共有スキーマで検証し、`BACKEND_FUNCTIONS_BASE_URL` と
`BACKEND_FUNCTIONS_KEY` を使ってバックエンドを呼び出します。
リモート呼び出しには HTTPS と Functions キーが必要です。
キーを省略できるのは、ローカル開発の HTTP ループバック接続だけです。
ブラウザーからは同一オリジンの `/api` を使い、独立 Functions を直接呼び出しません。
バックエンド設定を `VITE_*` に入れたり、サーバーヘルパーを SPA に import したりしないでください。

マネージド BFF は従来型の `function.json` による HTTP 登録と
`platform.apiRuntime: node:20` を使います。DB バインディング、非 HTTP トリガー、
マネージド ID は持ちません。共有スキーマと Zod を各ハンドラーにバンドルするため、
SWA の API ビルド環境でワークスペース参照を解決する必要はありません。

## 生成ファイルと CRUD

```text
src/
  main.tsx, App.tsx, Home.tsx
  pages/todo/               # 一覧・詳細・新規・編集、フォーム、routes.tsx
bff/
  src/todo/index.ts         # スキーマ検証とバックエンド呼び出し
  src/lib/call-function.ts  # サーバー専用の通信・認証情報転送
  todo/function.json       # /api/todo/{id?}
  build.cjs                # ハンドラーを明示列挙してバンドル
functions/                 # 独立バックエンド。SWA の API 配置先ではない
shared/models/             # Zod の単一の情報源
lib/scaffold-config.ts     # ホーム画面のナビゲーション
staticwebapp.config.json   # SPA フォールバック、セキュリティ、SWA 認証
infra/                     # 従来と同じ独立バックエンドのインフラ
```

通常のコマンドをそのまま使えます。

```sh
npx swallowkit create-model todo
npx swallowkit scaffold todo
npx swallowkit dev
```

SPA は生成された `routes.tsx` を自動検出します。独自のページやルートは管理対象外の場所に追加できます。
`--api-only` は UI だけを省略し、バックエンドとマネージド BFF は生成します。
`--api-dir` の既定値は React では `bff`、Next.js では従来の `app/api` です。

machine/MCP と plan/apply も同じ設定・生成処理を使います。inspect には
`frontendFramework: react` と実際の React/BFF のパスが現れます。
所有権、差分検出、承認の仕組みを迂回しないでください。

## ローカル開発

| サービス | 既定ポート | 役割 |
| --- | --- | --- |
| SWA CLI | 4280 | アプリの入口。同一オリジンの API ルーティングと SWA 認証 |
| Vite | 3000 | フロントエンド開発サーバー |
| マネージド BFF Functions | 7073 | BFF 専用 |
| 独立 Functions | 7071 | バックエンド |
| コネクタモック（任意） | Functions ポート + 1 | BFF の後段でコネクタの応答をモック |

**http://localhost:4280** を開きます。Vite に直接接続しても、同一オリジンの
`/api` や SWA 認証は提供されません。`--port`、`--bff-port`、`--functions-port`、
`--swa-port` で変更できます。各ポートは重複しないように指定します。

`--no-functions` は独立バックエンドだけを省略し、BFF は起動します。
`--no-swa` は SWA のルーティングと認証を省略し、個別サーバーだけを起動する指定です。
アプリ全体の動作確認用ではありません。
`--mock-connectors` も BFF を経由し、その後段でコネクタの応答をモックします。
`--no-functions` の場合も Azure Functions Core Tools v4 が必要です。

バックエンドのローカル設定は `functions/local.settings.json`、BFF は
`bff/local.settings.json` に置きます。いずれも Git 管理対象外です。
dev は選択したバックエンドまたはモックの URL を BFF に渡します。
API の接続先を変えるためにブラウザーの環境変数を変更する必要はありません。

Cosmos DB Emulator は既存のものを使います。利用できなければ前提条件として報告し、
自動起動・再設定を試みないでください。検証用 DB は分離します。
`--seed-env` はデータを置換するため、利用者の既存 DB に向けて実行してはいけません。

## 認証とコネクタ

既存の認証 plan/apply で `swa`、`external-token`、`custom-jwt` と名前付きスキームを使えます。
React では Next.js の proxy/API Routes ではなく、マネージド BFF ハンドラーを生成します。

- SWA 認証では、プラットフォームが注入した principal を検証・正規化して転送します。
- external-token では bearer token を転送します。生成された verifier とクライアントアダプターの実装が必要です。
- custom-jwt のログインでは HttpOnly・SameSite Cookie にトークンを保持し、本番では Secure を付けます。BFF が bearer token に変換し、バックエンドが検証します。
- 認証情報はリクエストごとに処理します。モデルのポリシーとロールを強制するのはバックエンドです。UI の表示制御は認可の代わりになりません。

Next.js と同様、生成 CRUD は利用者ごとのデータ所有権までは制御しません。
必要な場合は独自のバックエンド API でデータ範囲を制限してください。
コネクタではモデルに指定された操作だけを許可します。

## ビルド・検証・デプロイ

```sh
npm run build
npx swallowkit machine verify project
npx swallowkit machine verify project --checks structure,drift,typecheck,build
```

build は共有スキーマ、SPA の型検査とビルド、SWA 設定の `dist/` へのコピー、
BFF の型検査とバンドルを行います。verify の型検査も BFF を含みます。
TypeScript の独立バックエンドは `npm run --workspace=functions build` で別途ビルドします。
C#/Python は従来のネイティブツールチェーンを使います。

SWA ポートから一覧・新規・詳細・更新・削除、不正入力、未認証・権限不足を確認してください。
型検査が成功しても、実行時の動作、verifier の実装、Azure デプロイの成功が保証されるわけではありません。

生成される GitHub Actions / Azure Pipelines は選択したパッケージマネージャーで
ビルドし、次の設定でデプロイします。

```yaml
app_location: dist
api_location: bff
output_location: ''
skip_app_build: true
skip_api_build: true
```

独立 Functions のワークフローは引き続き `functions/` を別途デプロイします。
承認済みのプロビジョニングとバックエンドデプロイ後、生成済みの SWA appsettings
モジュールでバックエンド URL とホストキーを設定します。
`api_location: functions` にしたり、独立 Functions を SWA にリンクしたりしないでください。

SPA の深い URL は `/index.html` にフォールバックしますが、`/api/*`、`/.auth/*`、
静的アセットは除外します。存在しない API が成功した HTML 応答に置き換わるのを防ぎます。

生成先の `AGENTS.md`、Claude/Copilot アダプター、パス別指示には、選択した構成と
plan/apply/verify の手順が反映されます。このリポジトリ自身の直下の `AGENTS.md` は、
それとは別の、SwallowKit の開発者向け指示です。
