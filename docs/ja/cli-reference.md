# CLI リファレンス

React でも同じコマンドを使い、BFF はマネージド Functions に生成します。
詳しくは [React ガイド](./react-guide.md)を参照してください。
以下の `app/` や Next.js API Routes の詳細例は Next.js 構成のものです。

pnpm 11/12 と npm の使い分けは[コマンドとトラブルシューティング](./package-managers.md)を参照してください。

SwallowKit CLI の全コマンドとオプションです。

::: tip パッケージマネージャー
以下の例は `npx` を使用しています。pnpm の場合は `npx swallowkit …` を `pnpm exec swallowkit …` に置き換えてください（`swallowkit init` の場合は `pnpm dlx`）。
:::

## 目次

- [swallowkit init](#swallowkit-init)
- [swallowkit machine](#swallowkit-machine)
- [swallowkit-mcp](#swallowkit-mcp)
- [swallowkit create-model](#swallowkit-create-model)
- [swallowkit add-connector](#swallowkit-add-connector)
- [swallowkit add-auth](#swallowkit-add-auth)
- [swallowkit dev](#swallowkit-dev)
- [swallowkit scaffold](#swallowkit-scaffold)
- [swallowkit status](#swallowkit-status)
- [swallowkit verify](#swallowkit-verify)
- [swallowkit create-dev-seeds](#swallowkit-create-dev-seeds)
- [swallowkit migrations init](#swallowkit-migrations-init)
- [swallowkit create-migration](#swallowkit-create-migration)
- [swallowkit migrations add-model](#swallowkit-migrations-add-model)
- [swallowkit configure-mcp](#swallowkit-configure-mcp)
- [swallowkit provision](#swallowkit-provision)

## swallowkit machine

AI / MCP 統合向けの machine-readable command group です。

### 使用法

```bash
npx swallowkit machine <command> <subcommand> [options]
```

### 利用可能なコマンド

| コマンド | 用途 |
|---------|------|
| `inspect project` | framework-owned project metadata を返す |
| `inspect entities` | entity / schema metadata を返す |
| `inspect routes` | BFF / Functions route metadata を返す |
| `inspect artifacts` | 生成物台帳（ownership 付き）を返す |
| `inspect boundaries` | AI 自由生成と決定論的生成の責任分界契約を返す |
| `inspect drift` | 生成物と現在状態の乖離を検出する |
| `inspect infra` | Bicep 資産（params / modules / outputs / container 配線）を Azure 呼び出しなしで解析する |
| `inspect capabilities` | framework の能力契約（model 宣言子と書式例・認証導入 workflow・生成 CRUD の守備範囲・seed 適用方法・コマンド一覧）を返す |
| `validate project` | 永続モデルの Cosmos コンテナー migration のローカルな不足・不一致を含む validation violation を返す |
| `generate model` | `create-model` を非対話 JSON モードで実行する |
| `generate scaffold` | `scaffold` を非対話 JSON モードで実行する |
| `plan model` | スキーマ、shared export、コンテナー migration、manifest、生成台帳の変更を、プロジェクトに書き込まず preview する |
| `plan model-infrastructure` | 既存スキーマの bytes を変更せずコンテナー migration の登録を preview する。pending refresh の Azure 確認は読み取り専用 |
| `apply model` | 入力 fingerprint と上書き承認を検証して model plan を適用する |
| `plan scaffold` | 書き込まずに scaffold の変更計画（planId 付き）を返す（複数 model 対応） |
| `apply scaffold` | plan の鮮度・承認を検証して scaffold を適用する（複数 model 対応） |
| `plan auth` | 書き込まずに add-auth の変更計画を返す（`--allowed-providers` で SWA identity provider を指定） |
| `apply auth` | plan の鮮度・承認を検証して認証コードを適用する |
| `plan provision` | ローカルのモデルコンテナー migration 完備性を確認し、Azure 状態を調べて bootstrap / adoption / migration / reconcile の plan を返す |
| `apply provision` | 承認済み plan を適用する（常に `--approve` 必須） |
| `verify project` | structure（ローカルのモデルコンテナー migration 完備性を含む）/ drift / typecheck / backend-build（+ 明示指定の build / lint / test とカスタム）を実行する。Azure プロビジョニング済みであることは証明しません（`--compact` で info-severity findings を抑制） |
| `explain failure` | 直近の verify 失敗の証拠と修復アクションを返す |

### 例

```bash
npx swallowkit machine inspect project
npx swallowkit machine validate project
npx swallowkit machine plan model todo --overwrite never
npx swallowkit machine apply model --plan <planId>
npx swallowkit machine plan model-infrastructure handwritten-model
npx swallowkit machine apply model --plan <planId>
npx swallowkit machine generate scaffold todo --api-only
npx swallowkit machine plan scaffold todo
npx swallowkit machine plan scaffold todo note learner
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine apply scaffold todo note learner
npx swallowkit machine apply scaffold todo --approve
npx swallowkit machine plan auth --provider custom-jwt
npx swallowkit machine plan auth --provider swa --scheme admin --allowed-providers github
npx swallowkit machine apply auth --plan <planId>
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect capabilities
npx swallowkit machine inspect infra
npx swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia
npx swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia --adopt-existing --baseline 0 --what-if
npx swallowkit machine apply provision --plan <planId> --approve
npx swallowkit machine verify project --checks structure,drift
npx swallowkit machine verify project --compact
npx swallowkit machine explain failure --check typecheck
```

### 出力契約

- stdout は常に 1 つの JSON
- 非対話
- 成功 / 失敗ともに構造化出力（`status` フィールドで `complete` / `in-progress` / `blocked` / `requires-human` / `failed` を返す）
- `generate model` は overwrite policy（`always` または `never`）を明示する
- 生成物は `.swallowkit/artifacts.json`（Git 管理対象）に台帳として記録される
- scaffold は対応する Zod object / enum / literal を TypeScript AST で先に解析し、情報欠落を伴う regex metadata を apply しない
- scaffold plan は parser mode、canonical model metadata、semantic fingerprint、diagnostics を保持し、apply 時の再解析が異なる場合は `schema-analysis-mismatch` で blocked になる
- schema / verify の子プロセスを起動できない場合は、diagnostics 付きの `schema-evaluation-unavailable` / `verification-command-unavailable` と `status: blocked` を返す

アーキテクチャやレスポンス例の詳細は [AI / MCP ガイド](./ai-mcp-guide.md) を参照してください。

## swallowkit-mcp

AI コーディングエージェント向けの同梱 MCP stdio server です。

### 使用法

```bash
npx swallowkit-mcp
```

### 公開される MCP Tools

- `swallowkit_inspect_project`
- `swallowkit_inspect_entities`
- `swallowkit_inspect_routes`
- `swallowkit_inspect_artifacts`
- `swallowkit_inspect_boundaries`
- `swallowkit_inspect_drift`
- `swallowkit_inspect_infra`
- `swallowkit_validate_project`
- `swallowkit_generate_model`
- `swallowkit_scaffold_model`
- `swallowkit_plan_scaffold`
- `swallowkit_apply_scaffold`
- `swallowkit_plan_auth`
- `swallowkit_apply_auth`
- `swallowkit_plan_provision`
- `swallowkit_apply_provision`
- `swallowkit_verify_project`
- `swallowkit_explain_failure`

MCP server は `swallowkit machine ...` の thin adapter であり、独自の framework ロジックは持ちません。

## swallowkit init

新しい SwallowKit プロジェクトを初期化します。

### 使用法

```bash
npx swallowkit init [project-name] [options]
# or
pnpm dlx swallowkit init [project-name] [options]
```

### 引数

- `project-name` (オプション): プロジェクト名。省略時はカレントディレクトリに初期化

### オプション

| オプション | 説明 | 値 | デフォルト |
|----------|------|-----|----------|
| `--template <template>` | 使用テンプレート | `default` | `default` |
| `--package-manager <manager>` | パッケージマネージャーを明示指定 | `npm`, `pnpm` | 起動元 |
| `--frontend <framework>` | フロントエンド | `nextjs`, `react` | 対話で選択。非対話時は `nextjs` |
| `--next-version <version>` | Next.js バージョン | 例: `16.0.7`, `latest` | `latest` |
| `--cicd <provider>` | CI/CD プロバイダー | `github`, `azure`, `skip` | *（プロンプト）* |
| `--backend-language <language>` | Azure Functions のバックエンド言語 | `typescript`, `csharp`, `python` | *（プロンプト）* |
| `--cosmos-db-mode <mode>` | Cosmos DB モード | `freetier`, `serverless` | *（プロンプト）* |
| `--vnet <option>` | ネットワークセキュリティ | `outbound`, `none` | *（プロンプト）* |
| `--swa-plan <plan>` | Azure Static Web Apps プラン | `free`, `standard` | *（プロンプト、初期選択は `standard`）* |

### 対話モードと非対話モード

デフォルトでは、`init` はフロントエンド、CI/CD、Azure Functions のバックエンド言語、Static Web Apps プラン、Cosmos DB モード、ネットワーク設定を対話プロンプトで質問します。

Free はこのツールの基本構成で利用できます。Standard は SLA、カスタム認証プロバイダー、Functions によるカスタムロール付与、Static Web Apps 自体の Private Endpoint、Free より大きいクォータが必要な場合に選択してください。`--vnet outbound` が作成する Functions/Cosmos DB 用 VNet は、SWA プランとは独立しています。

フラグで直接指定するとプロンプトをスキップできます：

```bash
# 完全非対話モード
npx swallowkit init my-app --cicd github --backend-language csharp --swa-plan free --cosmos-db-mode serverless --vnet outbound

# 部分指定（--cicd のみ指定、残りはプロンプト表示）
npx swallowkit init my-app --cicd skip
```

VS Code 拡張機能やスクリプトなど、stdin が TTY でない環境から CLI を呼び出す場合に特に便利です。

非対話環境（CI、コーディングエージェント、パイプ経由の実行など）を検出すると、`init` はプロンプトでハングする代わりに以下のように振る舞います：

- 設定フラグが不足している場合は、不足フラグの一覧をエラーとして即座に返します（ハングしません）。
- pnpm プロジェクトは `pnpm-workspace.yaml` にローカルの build script 方針を記録します。React のビルドに必要な `esbuild` は許可し、不要な `keytar`、`protobufjs`、`unrs-resolver` の script は拒否します。未知の script は自動承認しません。[パッケージマネージャーの切り分け](./package-managers#build-script-と-security-policy-の切り分け)も参照してください。

不正な値を指定するとエラーになります：

```
❌ Invalid --cicd value: "invalid". Must be: github, azure, skip
```

### 対話プロンプト

フラグが未指定の場合、以下のプロンプトが表示されます：

1. **CI/CD プロバイダー**: GitHub Actions、Azure Pipelines、またはスキップ
2. **バックエンド言語**: TypeScript、C#、または Python
3. **Cosmos DB モード**: Free Tier または Serverless
4. **ネットワークセキュリティ**: VNet Integration または None

### バックエンド言語ごとの補足

- `typescript`: Functions は共有された Zod パッケージをそのまま利用します。
- `csharp` / `python`: `swallowkit scaffold` が `functions/openapi/` に OpenAPI を出力し、`functions/generated/` にネイティブ生成されたバックエンド用スキーマ資産を生成します。

### 生成されるファイル

```
my-app/
├── app/                      # Next.js App Router
│   ├── api/greet/            # BFF サンプル
│   ├── layout.tsx
│   └── page.tsx
├── components/               # React コンポーネント
├── lib/
│   ├── api/backend.ts        # BFF クライアント (api.get/post/put/delete)
│   ├── database/             # Cosmos DB クライアント (オプション)
│   │   ├── client.ts         # CosmosClient
│   │   └── repository.ts     # リポジトリパターン
│   ├── models/               # データモデル
│   └── schemas/              # Zod スキーマ
├── functions/                # Azure Functions
│   ├── src/                  # TypeScript ハンドラー
│   ├── Crud/                 # C# ハンドラー
│   ├── blueprints/           # Python ハンドラー
│   ├── generated/            # C#/Python 向けネイティブ生成スキーマ資産
│   ├── openapi/              # C#/Python 向けに出力された OpenAPI
│   ├── host.json
│   └── local.settings.json
├── infra/                    # Bicep IaC
│   ├── main.bicep
│   ├── main.parameters.json
│   └── modules/
│       ├── staticwebapp.bicep
│       ├── functions.bicep
│       └── cosmosdb.bicep
├── .github/workflows/        # CI/CD (GitHub Actions の場合)
│   ├── static-web-app.yml
│   └── azure-functions.yml
├── .github/
│   ├── copilot-instructions.md   # GitHub Copilot 向け指示
│   └── instructions/             # Copilot レイヤー別ルール
│       ├── shared-models.instructions.md
│       ├── bff-routes.instructions.md
│       └── azure-functions.instructions.md
├── .env.local                # 環境変数
├── .env.example
├── next.config.js
├── swallowkit.config.js
├── staticwebapp.config.json
├── .mcp.json                # 起動ごとに SwallowKit を解決する project-scoped MCP bootstrap
├── AGENTS.md                 # コーディングエージェント向け指示書 (Codex)
├── CLAUDE.md                 # Claude Code 向け指示書
└── package.json
```

### AI エージェント bootstrap / 指示ファイル

`init` コマンドは、複数の AI コーディングエージェント向けの指示ファイルに加え、repository MCP 自動検出に対応した runtime 向けの project-scoped MCP bootstrap も自動生成します。これらにより、AI エージェント（GitHub Copilot、Claude Code、OpenAI Codex など）がコードを生成・修正する際に、プロジェクトのアーキテクチャと規約に従います。

#### 生成されるファイル一覧

| ファイル | 対象エージェント | 説明 |
|---------|----------------|------|
| `AGENTS.md` | OpenAI Codex / 汎用エージェント | アーキテクチャ全体仕様、規約、命名規則、CLI コマンド、自律ループ手順 |
| `CLAUDE.md` | Claude Code | canonical な `AGENTS.md` 規約を参照する adapter |
| `.mcp.json` | Claude Code / project MCP runtime | 起動ごとに `swallowkit-mcp` を解決し、`SWALLOWKIT_MCP_VERSION` で固定できる launcher |
| `.github/copilot-instructions.md` | GitHub Copilot | 主要ルールのサマリー（Copilot が自動読み込み） |
| `.github/instructions/shared-models.instructions.md` | GitHub Copilot | `shared/models/**` 向けレイヤー別ルール |
| `.github/instructions/bff-routes.instructions.md` | GitHub Copilot | Next.js: `app/api/**`、React: `bff/**` 向けレイヤー別ルール |
| `.github/instructions/azure-functions.instructions.md` | GitHub Copilot | `functions/**` 向けレイヤー別ルール |
| `.github/skills/*/SKILL.md` | Skills 対応エージェント（Copilot VS Code / CLI / cloud agent 等） | [Agent Skills](https://agentskills.io/) 標準のワークフロースキル（`swallowkit-add-model` / `swallowkit-modify-model` / `swallowkit-verify-repair` / `swallowkit-provision`）。関連タスク時に自動ロード |
| `.swallowkit/workflows/*.md` | 全エージェント（Skills 非対応含む） | エージェント非依存の自律ループランブック（Skills と同一内容） |

#### Canonical な AGENTS.md と Agent adapter

最新の `AGENTS.md`、`CLAUDE.md`、Copilot instructions の全文と日本語訳は
[Coding Agent ガイド](./coding-agent-guide.md) を参照してください。
永続化、seed、実動作の証拠、データ保護の規約は `AGENTS.md` にまとめ、
adapter と runbook は重複させず参照します。既存プロジェクトには差分レビュー後に
手動でマージします。`init` は既存ディレクトリを拒否するため、指示ファイルの更新には使いません。

#### .github/copilot-instructions.md（GitHub Copilot 向け）

このファイルは VS Code で GitHub Copilot が自動的に読み込みます。アーキテクチャの概要、主要ルール、命名規則、管理フィールドのサマリーに加え、framework 管理操作で使う MCP / machine-interface fallback も含みます。

#### .github/instructions/*.instructions.md（GitHub Copilot — レイヤー別）

これらのファイルは、`applyTo` glob パターンに一致するファイルを編集する際に GitHub Copilot が適用するコンテキスト固有のルールを提供します：

| ファイル | 適用対象 | 主要ルール |
|---------|---------|----------|
| `shared-models.instructions.md` | `shared/models/**` | Zod スキーマ規約、`id`/`createdAt`/`updatedAt` 管理、`shared/index.ts` からの再エクスポート |
| `bff-routes.instructions.md` | Next.js: `app/api/**`、React: `bff/**` | プロキシ専用ルール、`callFunction()` 使用、ビジネスロジック禁止 |
| `azure-functions.instructions.md` | `functions/**` | Cosmos DB bindings、Zod バリデーション、UUID 自動生成 |

### パッケージマネージャーの自動検出

SwallowKit はパッケージマネージャーを自動的に選択します：

- **pnpm** がインストール済みの場合 → 常に pnpm を優先
- それ以外の場合 → **npm** を使用

生成されるプロジェクト（ロックファイル、ワークスペース設定、CI/CD スクリプト）は検出されたパッケージマネージャーに合わせて生成されます。

### 例

```bash
# 新しいディレクトリに初期化（対話モード）
npx swallowkit init my-awesome-app

# 新しいディレクトリに初期化（非対話モード）
npx swallowkit init my-awesome-app --cicd github --swa-plan free --cosmos-db-mode serverless --vnet outbound

# pnpm で実行
pnpm dlx swallowkit init my-awesome-app

# 初期化後
cd my-awesome-app
```

## swallowkit create-model

`shared/models/` 配下に 1 つ以上の Zod モデル雛形を生成します。新規の
非 connector モデルでは Cosmos コンテナー用 migration も生成・登録します。
Azure の provisioning や CRUD の生成は行いません。

### 使用法

```bash
npx swallowkit create-model <names...> [options]
# or
pnpm dlx swallowkit create-model <names...> [options]
```

### 引数

- `names...`: 1 つ以上のモデル名

### オプション

| オプション | 説明 | デフォルト |
|----------|------|----------|
| `--models-dir <dir>` | 生成先のモデルディレクトリ | `shared/models` |
| `--connector <name>` | 指定した connector に紐づく connector 対応モデルを生成 | *（なし）* |

### このコマンドが行うこと

各モデル名について、次を行います：

- `shared/models/<name>.ts` を生成
- ファイル名は kebab-case、スキーマ名と型名は PascalCase に正規化
- `shared/index.ts` に不足する再エクスポートを追記（なければ作成）。既存内容は保持
- 初期スキーマに `id`、`name`、`createdAt`、`updatedAt` を含める
- コンテナー Bicep、migration manifest エントリ、生成ファイル所有権記録を生成

例:

```bash
npx swallowkit create-model todo category
```

生成される雛形:

```typescript
import { z } from 'zod/v4';

export const Todo = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof Todo>;
export const displayName = 'Todo';
```

### Connector モデル

`--connector` を指定すると、生成される雛形に connector 固有のメタデータを含む `connectorConfig` エクスポートが追加されます：

- **RDB connector**: `table` と `idColumn` フィールドを含む
- **API connector**: `endpoints` マッピングを含む
- いずれも `operations` 配列を含む（API はすべての操作、RDB は読み取り専用がデフォルト）
- Zod スキーマの雛形が変更される（バックエンドによる `createdAt`/`updatedAt` の自動管理なし）

例:

```bash
npx swallowkit create-model user --connector mysql
npx swallowkit create-model backlog-issue --connector backlog
```

### 既存ファイルがある場合

対象ファイルがすでに存在する場合は、上書きするかどうかを確認します。`no` を選ぶとそのモデルだけスキップされ、他のモデルの処理は続行されます。スキップしたモデルのインフラは backfill されません。手書きモデルのスキーマを変更せずに登録するには `migrations add-model <name>` を使います。

### 典型的な流れ

```bash
npx swallowkit create-model todo
# shared/models/todo.ts を編集
npx swallowkit migrations add-model todo --dry-run # 手書きまたはスキップしたモデルの場合のみ
npx swallowkit scaffold shared/models/todo.ts # CRUD が必要な場合のみ
```

`scaffold` や `provision` の前に生成された Zod モデルを編集します。migration が pending の状態で partition key を変更した場合は、`migrations add-model <name> --refresh-pending --resource-group <name> --dry-run` を明示して preview してください。読み取り専用のリモート確認を行い、適用済み・デプロイ試行済み・状態不明・手編集済みの migration は安全性を証明できなければ拒否します。

## swallowkit add-connector

外部データソースの connector を `swallowkit.config.js` に登録します。

### 使用法

```bash
npx swallowkit add-connector <name> --type=<type> [options]
# or
pnpm dlx swallowkit add-connector <name> --type=<type> [options]
```

### 引数

- `name` (必須): connector 名（config のキーとして使用）

### オプション

| オプション | 説明 | 必須 |
|----------|------|------|
| `--type <type>` | connector タイプ: `rdb` または `api` | はい |
| `--provider <provider>` | RDB プロバイダー: `mysql`, `postgres`, `sqlserver` | `--type rdb` の場合のみ |
| `--connection-env <var>` | 接続文字列の環境変数名 | `--type rdb` の場合のみ |
| `--base-url-env <var>` | API ベース URL の環境変数名 | `--type api` の場合のみ |
| `--auth-type <type>` | 認証タイプ: `apiKey`, `bearer`, `oauth2` | `--type api` の場合のみ |
| `--auth-env <var>` | 認証情報の環境変数名 | `--type api` の場合のみ |
| `--auth-placement <placement>` | 認証の配置先: `query` または `header` | `--type api` で `apiKey` の場合のみ |
| `--auth-param <name>` | API キーのパラメーター名 | `--type api` で `apiKey` の場合のみ |

### このコマンドが行うこと

- 既存の `swallowkit.config.js` を読み込む
- `connectors` セクションに connector 定義を追加
- `connectors` セクションが存在しない場合は新規作成

### 例

```bash
# MySQL RDB connector を追加
npx swallowkit add-connector mysql --type rdb --provider mysql --connection-env MYSQL_CONNECTION_STRING

# API キー認証の REST API connector を追加
npx swallowkit add-connector backlog --type api --base-url-env BACKLOG_API_BASE_URL --auth-type apiKey --auth-env BACKLOG_API_KEY --auth-placement query --auth-param apiKey

# Bearer トークン認証の REST API connector を追加
npx swallowkit add-connector github --type api --base-url-env GITHUB_API_BASE_URL --auth-type bearer --auth-env GITHUB_TOKEN
```

## swallowkit add-auth

SwallowKit プロジェクトに認証・認可の基盤を構築します。

### 使用法

```bash
npx swallowkit add-auth [options]
# or
pnpm dlx swallowkit add-auth [options]
```

### オプション

| オプション | 説明 | 値 | デフォルト |
|----------|------|-----|---------|
| `--provider <provider>` | 認証プロバイダー | `custom-jwt` | `custom-jwt`, `swa`, `external-token`, `none` |

> 注: `swa` と `swa-custom` は将来向けに予約された値で、現行の認証生成フローでは未実装です。

### このコマンドが行うこと

1. 共有認証モデルを生成（`shared/models/auth.ts` — LoginRequest, AuthUser, LoginResponse）
2. 認証用 Functions を生成（login, me, logout）— 設定されたバックエンド言語に対応（TS/C#/Python）
3. JWT ヘルパーユーティリティを生成（トークン検証・ロールチェック用）
4. BFF ルートを生成（`app/api/auth/login|logout|me/route.ts`）— httpOnly Cookie 管理
5. Next.js ミドルウェアを生成（`middleware.ts`）— Cookie ベースの認証チェックとリダイレクト
6. ログインページを生成（`app/login/page.tsx`）
7. 認証用 React コンテキストを生成（`lib/auth/auth-context.tsx`）— `useAuth` フック付き
8. `lib/api/call-function.ts` を更新 — `Authorization` ヘッダーの転送を追加
9. `swallowkit.config.js` に `auth` セクションを追加（未設定の場合）
10. バックエンドの依存パッケージをインストール（JWT ライブラリ + コネクタプロバイダーに対応する RDB ドライバー）

### 前提条件

- ユーザーデータベース用のコネクタが `swallowkit.config.js` に登録されていること（例: PostgreSQL・MySQL・SQL Server を指す RDB コネクタ）
- `auth.customJwt.userConnector` がそのコネクタ名を参照していること

### 例

```bash
# カスタム JWT 認証をセットアップ（デフォルト）
npx swallowkit add-auth

# プロバイダーを明示的に指定
npx swallowkit add-auth --provider custom-jwt
```

### 典型的なワークフロー

```bash
# 1. ユーザーデータベース用の RDB コネクタを追加
npx swallowkit add-connector userdb --type rdb --provider postgres --connection-env USERDB_CONNECTION_STRING

# 2. swallowkit.config.js に auth セクションを設定

# 3. add-auth を実行して認証基盤を一括生成
npx swallowkit add-auth

# 4. functions/local.settings.json に JWT_SECRET を設定

# 5. モデルに authPolicy を追加してロールベースアクセス制御を有効化
# 6. scaffold を再実行して Functions に認証ガードを注入
npx swallowkit scaffold shared/models/estimate.ts

# 7. モックコネクタで開発を開始（ユーザーデータもモック化される）
npx swallowkit dev --mock-connectors
```

> 💡 設定の詳細とアーキテクチャの概要については **[認証ガイド](./auth-guide)** をご参照ください。

## swallowkit dev

開発サーバーを起動します。Next.js + 独立 Functions、または React/Vite + マネージド BFF + 独立 Functions + SWA の構成です。

React の `dev` は、一時的な Vite ラッパーを `.swallowkit/vite-dev-*/config.mjs` に作成します。
作成前に `.swallowkit/.gitignore` へ `/vite-dev-*/` を設定するため、既存プロジェクトにも適用されます。
旧バージョンや強制終了で残ったラッパーも Git 除外対象になります。
ユーザーの他の除外ルールは保持し、`artifacts.json`、`project.json`、`workflows/` は共有・追跡対象のままです。
除外設定に失敗した場合は、そのファイルパスを含むエラーを出して起動を中止します。
正常終了時に削除するのは、その実行が作成した一時ディレクトリだけです。古いディレクトリや別の実行のディレクトリは削除しません。

### 使用法

```bash
npx swallowkit dev [options]
# or
pnpm dlx swallowkit dev [options]
```

### オプション

| オプション | 短縮 | 説明 | デフォルト |
|----------|------|------|----------|
| `--port <port>` | `-p` | フロントエンド（Next.js / Vite）ポート | `3000` |
| `--functions-port <port>` | | Azure Functions ポート | `7071` |
| `--bff-port <port>` | | React マネージド BFF Functions ポート | `7073` |
| `--host <host>` | | ホスト名 | `localhost` |
| `--open` | `-o` | ブラウザを自動的に開く | `false` |
| `--no-functions` | | Functions をスキップ | `false` |
| `--seed-env <environment>` | | 起動前に `dev-seeds/<environment>` から対応する Cosmos Emulator コンテナを置換 | *（無効）* |
| `--mock-connectors` | | connector モデル用のモックプロキシサーバーを起動 | `false` |
| `--swa-port <port>` | | SWA認証エミュレーターのポート | `4280` |
| `--no-swa` | | SWA認証エミュレーターをスキップ | `false` |
| `--verbose` | `-v` | 詳細ログを表示 | `false` |

### 動作

1. **Cosmos DB Emulator チェック**: ローカルエミュレーターの起動を確認
2. **Cosmos DB 初期化**:
   - 必要ならデータベースを作成
   - 必要ならモデル用コンテナを作成
   - `--seed-env <environment>` が指定され、`dev-seeds/<environment>/` が存在する場合は、対応する JSON で各コンテナを置換
3. **Connector Mock Server**（`--mock-connectors` 有効時）:
   - Functions ポート + 1（例: 7072）でプロキシサーバーを起動
   - connector モデルに一致するルート → Zod 生成のモックデータによるインメモリ CRUD
   - その他のルート → 実際の Azure Functions にプロキシ
   - dev-seeds JSON が利用可能な場合は初期データとして読み込み
   - BFF は設定変更なしで自動的にモックプロキシを経由
4. **Azure Functions 起動**:
    - Azure Functions Core Tools の確認
    - 依存関係の自動インストール
    - `functions/` ディレクトリで Functions を起動
    - **Python バックエンド**: 通常の Python 探索と利用者の設定に従って **uv** を使い、アプリ用の `functions/.venv` とスキーマ生成用の `functions/.codegen-venv` を作成。Python 3.11 の強制や既存環境の自動消去はしません
    - **C# バックエンド**: isolated worker のビルドが完了するまでコールドスタートが長めになるため、Functions URL は HTTP 応答できる状態になってから ready として表示
5. **Next.js 起動**: 開発サーバーを起動
6. **SWA認証エミュレーター起動**（`auth.provider: 'swa'`かつ`--no-swa`未指定時）:
   - プロジェクトローカルまたはPATH上のSWA CLIを確認し、未導入ならインストールコマンドを表示して終了
   - Next.jsをBFFとして維持したまま4280番ポートで認証プロキシを起動
   - ローカルログインURLと認証付きアプリURLを表示

### Dev Seed ワークフロー

Cosmos DB Emulator の状態をデバッグ用に再現したい場合は、環境ごとの seed データを使います：

```bash
npx swallowkit create-dev-seeds local
# dev-seeds/local/*.json を編集
npx swallowkit dev --seed-env local

# または、現在 Emulator に入っているデータをそのまま seed 化
npx swallowkit create-dev-seeds local --from-emulator --force
npx swallowkit dev --seed-env local
```

便利な用途:

- ローカルで手動登録したデータを、そのまま検証用 seed として保存
- デモや受け入れ確認のために、毎回同じデータ状態をすぐ再現
- 不具合調査時に「壊れるデータ状態」をチームで共有
- 新メンバー向けに、動作確認済みの初期データセットを配布

ルール:

- ファイル名はスキーマファイルに対応します。例: `shared/models/todo.ts` -> `dev-seeds/local/todo.json`
- 一致した seed ファイルは、対応する Cosmos コンテナの内容を丸ごと置き換えます
- 一致する seed ファイルがないコンテナは変更されません
- `--seed-env` を省略した場合、または環境ディレクトリが存在しない場合は、既存の Emulator データを保持します
- 各ドキュメントには空でない文字列の `id` が必要です

例:

```json
[
  {
    "id": "seed-todo-001",
    "name": "Seed todo one",
    "createdAt": "2026-03-21T00:00:00.000Z",
    "updatedAt": "2026-03-21T00:00:00.000Z"
  }
]
```

### 例

```bash
# デフォルト設定で起動
npx swallowkit dev

# カスタムポートで起動
npx swallowkit dev --port 3001 --functions-port 7072

# ブラウザを自動的に開く
npx swallowkit dev --open

# Functions なしで Next.js のみ起動
npx swallowkit dev --no-functions

# seed 環境を指定して起動
npx swallowkit dev --seed-env local

# 詳細ログ付き
npx swallowkit dev --verbose

# connector モックサーバー付きで起動
npx swallowkit dev --mock-connectors

# モック connector と seed データを併用
npx swallowkit dev --mock-connectors --seed-env local
```

### トラブルシューティング

**Cosmos DB Emulator が見つからない:**
```
Error: Cosmos DB Emulator is not running
```

解決策:
- Windows: [公式サイト](https://aka.ms/cosmosdb-emulator)からインストール
- Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

**Azure Functions Core Tools がない:**
```
Error: Azure Functions Core Tools not found
```

解決策:
```bash
npm install -g azure-functions-core-tools@4
# or
pnpm add -g azure-functions-core-tools@4
```

**ポートが使用中:**
```
Error: Port 3000 is already in use
```

解決策:
```bash
npx swallowkit dev --port 3001
```

## swallowkit scaffold

Zod スキーマから CRUD 操作を自動生成します。

### 使用法

```bash
npx swallowkit scaffold <model-file> [options]
# or
pnpm dlx swallowkit scaffold <model-file> [options]
```

### 引数

- `model-file` (必須): Zodスキーマを含むモデルファイルのパス

### オプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `--functions-dir <dir>` | Azure Functions ディレクトリ | `functions` |
| `--api-dir <dir>` | BFF ディレクトリ | Next.js: `app/api`、React: `bff` |
| `--api-only` | UI コンポーネントのみをスキップします。Functions、BFF ルート、OpenAPI、ネイティブスキーマ資産は更新されます。 | `false` |
| `--skip-infra` | この scaffold 操作では `infra/` 配下を作成・変更しません（`infra-skipped`）。既存のモデル migration は削除されません。未登録の場合は後から `migrations add-model` で追加できます。`machine plan/apply/generate scaffold` と MCP（`skipInfra`）でも使えます。 | `false` |
| `--dry-run` | 書き込まずに変更予定のファイル一覧と競合を表示します | `false` |

### Connector モデルの動作

モデルファイルに `connectorConfig` エクスポートが含まれている場合、scaffold は connector モデルとして検出します：

- **RDB connector モデル**: `functions/Connectors/`（C#）または同等のディレクトリに SQL ベースの CRUD ハンドラーを生成
- **API connector モデル**: HTTP クライアントハンドラーを生成
- BFF ルートと React UI は通常のモデルと同一に生成
- connector モデルでは Cosmos DB Bicep 生成をスキップ
- 読み取り専用モデル（operations が `getAll`/`getById` のみ）は GET エンドポイントのみ生成

### 生成されるコード

**1. Azure Functions (CRUD エンドポイント)**

```typescript
// functions/src/functions/{resource}.ts
- GET    /api/{resource}       - 全件取得
- GET    /api/{resource}/{id}  - ID で取得
- POST   /api/{resource}       - 作成
- PUT    /api/{resource}/{id}  - 更新
- DELETE /api/{resource}/{id}  - 削除
```

各エンドポイントは:
- ✅ Cosmos DB input/output bindings を使用
- ✅ Zod スキーマで自動検証
- ✅ エラーハンドリング付き
- ✅ TypeScript 型安全
- ✅ ファクトリーパターン対応（共有 `crud-factory.ts`）

**2. Next.js BFF API Routes**

```typescript
// app/api/{resource}/route.ts
// app/api/{resource}/[id]/route.ts
```

各ルートは:
- ✅ Azure Functions バックエンドを呼び出し
- ✅ 自動スキーマ検証
- ✅ エラーハンドリング

**3. React コンポーネント（オプション）**

```typescript
// components/{Resource}List.tsx
// components/{Resource}Form.tsx
```

### 前提条件

**モデルファイルの要件:**

```typescript
// lib/models/todo.ts
import { z } from 'zod';
import { BaseModel } from '@/lib/database/base-model';

// 1. Zod スキーマを定義
export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

// 2. 型を推論
export type TodoType = z.infer<typeof todoSchema>;

// 3. BaseModel を継承
export class Todo extends BaseModel<TodoType> {
  constructor() {
    super(
      'AppDatabase',      // データベース名
      'Todos',            // コンテナ名
      todoSchema          // スキーマ
    );
  }
}
```

### 例

```bash
# Todo モデルから CRUD を生成
npx swallowkit scaffold lib/models/todo.ts

# Product モデルから CRUD を生成
npx swallowkit scaffold lib/models/product.ts

```

### 生成後の使用

**フロントエンドから使用:**

```typescript
import { api } from '@/lib/api/backend';
import type { TodoType } from '@/lib/models/todo';

// 全件取得
const todos = await api.get<TodoType[]>('/api/todos');

// 作成（バックエンドで検証）
const created = await api.post<TodoType>('/api/todos', {
  text: '牛乳を買う',
  completed: false
});

// 更新（バックエンドで検証）
const updated = await api.put<TodoType>('/api/todos/123', {
  completed: true
});

// 削除
await api.delete('/api/todos/123');
```

### 詳細

詳しくは [Scaffold ガイド](./scaffold-guide) を参照してください。

## swallowkit status

生成物台帳（`.swallowkit/artifacts.json`）と現在のプロジェクト状態の乖離（drift）を表示します。

### 使用法

```bash
npx swallowkit status [options]
```

### オプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `--artifacts` | 追跡中の全生成物を ownership 付きで一覧表示します | `false` |

### 出力内容

- 追跡中の生成物数、生成後に変更されたファイル数、欠損ファイル数
- drift findings（schema-drift / artifact-modified / artifact-missing / generator-drift / manifest-drift）と修復アクション

## swallowkit verify

既定で structure / drift / typecheck / backend-build と設定済みのカスタムチェックを実行します。失敗があると exit code 1 を返します。

### 使用法

```bash
npx swallowkit verify [options]
```

### オプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `--checks <ids>` | カンマ区切りのチェック名。PowerShell では引用符で囲む（例：`"structure,drift,typecheck,backend-build,build"`） | 既定チェック + カスタムチェック |

### チェック内容

| チェック | 内容 |
| --- | --- |
| `structure` | プロジェクト構造規約（`validate project` と同等） |
| `drift` | 生成物と現在状態の乖離検出 |
| `typecheck` | TypeScript 型検査（`typecheck` script があればそれを、なければプロジェクトの package manager で `tsc --noEmit` を実行） |
| `backend-build` | 独立 `functions/` の検証。C# は `dotnet build`、TypeScript はプロジェクトの `tsc --noEmit`、Python 3 は `compileall`（構文のみ。import や型は検査しない）。Python は PATH より `functions/.venv` を優先 |
| `build` / `lint` / `test` | 明示指定した場合にルート package scripts を実行。script がなければ skip |

バックエンドのツールチェーンがなければ理由付きで `skip` になります。skip は検証成功ではありません。ツールチェーンを復元して再実行するまで、バックエンドを検証済みと扱わないでください。ルートの `build` は `backend-build` の代わりにはなりません。`machine explain failure` でファイル名・行番号を含むコンパイルエラーを確認できます。

結果は `.swallowkit/state/last-verify.json` に保存され、`swallowkit machine explain failure` で失敗の詳細を取得できます。

## swallowkit create-dev-seeds

`shared/models/` の現在のスキーマから JSON seed テンプレートを生成するか、ローカル Cosmos DB Emulator の現データを seed として書き出します。

### 使用法

```bash
npx swallowkit create-dev-seeds <environment> [options]
# or
pnpm dlx swallowkit create-dev-seeds <environment> [options]
```

### 引数

- `environment` (必須): `dev-seeds/` 配下に作成する seed 環境ディレクトリ名

### オプション

| オプション | 説明 | デフォルト |
|----------|------|----------|
| `--models-dir <dir>` | スキーマを読むモデルディレクトリ | `shared/models` |
| `--seeds-dir <dir>` | seed 環境を生成するベースディレクトリ | `dev-seeds` |
| `--force` | 既存の JSON seed ファイルを上書き | `false` |
| `--from-emulator` | ローカル Cosmos DB Emulator の現データを `dev-seeds/<environment>/` へ書き出す | `false` |

### 生成内容

通常モードでは、`shared/models/` 配下の各スキーマについて、`dev-seeds/<environment>/` に JSON ファイルを生成します：

```text
dev-seeds/
  local/
    todo.json
    category.json
```

テンプレート値はスキーマの型から推測されます：

- string -> サンプル文字列
- number -> `0`
- boolean -> `false`
- enum -> 最初の enum 値
- `...At` / date フィールド -> ISO 形式の時刻サンプル
- ネストスキーマ -> ネストした JSON オブジェクト

`--from-emulator` を付けた場合は、`functions/local.settings.json` の `CosmosDBConnection` と `COSMOS_DB_DATABASE_NAME` を使ってローカル Cosmos DB Emulator に接続し、対応するコンテナの現データを同じファイル配置で保存します。このとき `_etag` などの Cosmos システムプロパティは自動で除去されます。

この拡張の価値:

- アプリ操作で作った実データを seed として資産化できる
- 手で JSON を起こさなくても、リアルな確認データを繰り返し使える
- デバッグ・デモ・レビューで同一状態を再現しやすい
- 既存の `swallowkit dev --seed-env <environment>` フローにそのまま接続できる

### 典型的な流れ

```bash
npx swallowkit create-model todo
npx swallowkit scaffold shared/models/todo.ts
npx swallowkit create-dev-seeds local
# dev-seeds/local/todo.json を編集
npx swallowkit dev --seed-env local

# あるいは、現在 Emulator に入っているデータをそのまま seed 化
npx swallowkit create-dev-seeds local --from-emulator --force
npx swallowkit dev --seed-env local
```

## swallowkit migrations add-model

スキーマを上書きせず CRUD も生成せずに、モデルの Cosmos DB コンテナー migration を登録・backfill します。

```bash
npx swallowkit migrations add-model probe-item --dry-run
npx swallowkit migrations add-model probe-item
```

Machine/MCP では `machine plan model-infrastructure <model>` で preview し、
返された plan を `machine apply model --plan <planId>` で適用してください。
migration、manifest、生成台帳の書き込みを fingerprint 付きで確認できます。

`infra/migrations/<version>-create-<model>-container/main.bicep` を作成し、`infra/migrations/manifest.json` を更新して、生成ファイル所有権を記録します。コネクターモデルにはコンテナーがありません。

登録済みの場合も、現在の全モデルに合わせて `.swallowkit/project.json` を同期します。
このメタデータ更新と fingerprint は plan に含まれ、dry-run では書き込みません。
メタデータが最新なら、安全な pending 定義の更新を明示した場合を除いて、再実行しても変更はありません。

`manifest-out-of-date` または `manifest-drift` の修復だけが必要なら、既存モデルを指定して次を実行します。
CRUD やインフラは生成しません。

```bash
npx swallowkit machine plan model probe-item --overwrite never
npx swallowkit machine apply model --plan <planId>
```

既存スキーマの生成は skip されますが、project manifest は同期されます。
plan を確認してから適用してください。スキーマ、既存 migration、その checksum は保持されます。
この修復に Azure 接続や `--refresh-pending` は不要です。

migration が pending の間に partition key を変更した場合のみ、明示的な target と読み取り専用の状態確認を指定して更新します：

```bash
npx swallowkit migrations add-model probe-item --refresh-pending --resource-group <name> --dry-run
npx swallowkit migrations add-model probe-item --refresh-pending --resource-group <name>
```

Azure CLI の選択中 subscription 以外が対象なら `--subscription <id>` を追加してください。dry-run は書き込みません。適用済み・デプロイ試行済み・状態不明・手編集済みの migration は拒否します。デプロイされた可能性のある migration は編集しないでください。

## swallowkit configure-mcp

`.mcp.json` で起動する SwallowKit の版を選び直します。変更するのは `SWALLOWKIT_MCP_VERSION` だけです。

```bash
npx swallowkit configure-mcp                 # auto: プロジェクトのほうが新しい場合を除き latest
npx swallowkit configure-mcp --version latest
npx swallowkit configure-mcp --version 2.0.0-alpha.3
```

変更後は MCP サーバーを再起動してください。詳しくは [MCP のバージョン選択](./ai-mcp-guide.md#mcp-のバージョン選択)を参照してください。

## swallowkit provision

Azure の状態を確認し、初回構築または未適用の Infrastructure Migration を実行します。既存環境では通常 `main.bicep` を再デプロイしません。

### 使用法

```bash
npx swallowkit provision [options]
# or
pnpm dlx swallowkit provision [options]
```

### オプション

| オプション | 短縮 | 説明 | 必須 |
|----------|------|------|------|
| `--resource-group <name>` | `-g` | 新しいプレビューでは必須。チェックポイントの照会／再開では指定しない | |
| `--subscription <id>` | | サブスクリプション ID | |
| `--location <region>` | | Functions / Cosmos DB のリージョン。非対話実行では必須 | |
| `--swa-location <region>` | | Static Web Apps のリージョン。非対話実行では必須 | |
| `--what-if` | | Azure what-if の結果を確認内容に含める | |
| `--adopt-existing` | | タグなし既存環境を baseline として採用する | |
| `--baseline <version>` | | adoption の baseline。現在は `0` のみ | |
| `--reconcile` | | `main.bicep` 全体を明示的に再デプロイする | |
| `--approve` | | 互換性用。通常の provision はコマンド実行自体が実行指示になる | |
| `--status <runId>` | | 元の deployment と実行チェックポイントを読み取り専用で確認 | |
| `--resume <runId>` | | 元の承認済みチェックポイントから再開。送信済み deployment は再送しない | |
| `--resume-deployment <name>` | | 旧 baseline の ARM／非 secret parameters の一致を確認して復旧。create はしない | |
| `--wait-seconds <seconds>` | | 非表示。待機時間の上限（0〜3600秒）を明示する場合のみ指定。既定では provision と `--resume` は Azure の完了まで待ち、status は1回だけ確認 | |

### リージョン選択

このコマンドは実行時に以下を対話式に選択します:
- Functions / Cosmos DB 用のプライマリリージョン
- Static Web App のリージョン

推奨の組み合わせ:
- `japaneast` + `eastasia`
- `japanwest` + `eastasia`
- `eastus2` + `eastus2`
- `westeurope` + `westeurope`

プライマリリージョンの選択肢:
- `japaneast` - 東日本
- `japanwest` - 西日本
- `eastasia` - 東アジア
- `southeastasia` - 東南アジア
- `eastus` - 米国東部
- `eastus2` - 米国東部2
- `westus2` - 米国西部2
- `centralus` - 米国中部
- `westeurope` - 西ヨーロッパ

Static Web App リージョンの選択肢:
- `eastasia` - 日本向け推奨
- `westus2` - 米国西部2
- `centralus` - 米国中部
- `eastus2` - 米国東部2
- `westeurope` - 西ヨーロッパ

全リージョン一覧:
```bash
az account list-locations --output table
```

### 生成されるリソース

1. **Azure Static Web Apps**
   - SKU: Free
   - ビルド構成: standalone Next.js

2. **Azure Functions**
   - プラン: Flex Consumption
   - ランタイム: Node.js 22
   - OS: Linux

3. **Azure Cosmos DB**
   - モード: 初期化時に選択した Free Tier または Serverless
   - API: NoSQL
   - 一貫性: Session

4. **Azure Storage Account**
   - Functions 用ストレージ
   - SKU: Standard_LRS

5. **Managed Identity**
   - 種類: System-assigned
   - ロール: Cosmos DB Data Contributor

### 例

```bash
# 基本的な使用
npx swallowkit provision --resource-group my-app-rg

# サブスクリプション指定
npx swallowkit provision \
  --resource-group my-app-rg \
  --subscription "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
  --location japaneast --swa-location eastasia
```

### 状態別の動作

| Azure の状態 | 動作 |
|---|---|
| Resource Group が存在しない | `main.bicep` を初回デプロイし、baseline 0 タグを記録 |
| タグとローカル checksum が一致 | 未適用 migration のみを version 順に実行 |
| migration がない | `noop`。Azure リソースを変更しない |
| Resource Group はあるがタグがない | `adoption-required`。明示 adoption が必要 |
| Azure の version が先行、または checksum 不一致 | 安全のため停止 |

適用直前と各 migration の前にもタグを再確認します。別のデプロイが先に状態を進めた場合は `stale-azure-state` で停止します。

### 待機と復旧

`--no-wait` で送信した deployment を確認します。通常の `provision` と `provision --resume` は Azure の完了まで待ち、その後にリソース情報と CI/CD の設定値を表示します。machine／MCP の apply は時間を区切って確認します（既定300秒）。待機が途中で終わった場合、Running／Accepted は `in-progress`、照会不能／DeploymentNotFound は `blocked`／`outcome: "unknown"` であり、Azure の失敗を意味しません。Failed／Canceled では秘密を伏せた Azure の原因を示します。Succeeded でも tag／ledger 未完了なら `partial` で、記録まで完了したときだけ `complete` です。

```powershell
pnpm exec swallowkit provision --status <runId>
pnpm exec swallowkit provision --resume <runId>
# machine/MCP も同じ実行処理。runId は元の planId と同じ:
pnpm exec swallowkit machine inspect provision --plan <runId> --wait-seconds 300
pnpm exec swallowkit machine apply provision --plan <runId> --approve
```

`.swallowkit/state/provision/` のチェックポイントを保持してください。通常の `provision --resume` は続行の指示であり、追加の承認確認はありません。machine／MCP の再開には引き続き明示的な人の承認が必要です。どちらも fingerprint、subscription、deployment の識別子、migration checksum を再確認します。通常 CLI は成功後にリソース情報と CI/CD 設定手順を表示し、エラー時には machine ではなく通常の provision コマンドを案内します。Ctrl+C／強制終了後も Azure は続く場合があります。自動キャンセル・削除はしません。待機や記録の修復だけのために再計画／reconcile をしないでください。旧版の未追跡 baseline は[デプロイガイド](./deployment-guide.md)の `--resume-deployment` 手順を使います。

## swallowkit migrations init

旧バージョンで作成したプロジェクトの現在の `infra/` を、変更せずに baseline 0 として記録します。

```bash
npx swallowkit migrations init --legacy-baseline
```

生成される `infra/migrations/manifest.json` は Git にコミットしてください。このコマンドは Azure に接続せず、既存 manifest を上書きしません。続いて次の adoption を実行します。

```bash
npx swallowkit provision -g my-app-rg \
  --location japaneast --swa-location eastasia \
  --adopt-existing --baseline 0 --what-if
```

adoption は `main.bicep` を実行せず、Resource Group の既存タグを保持したまま SwallowKit の状態タグだけを追加します。what-if に Create/Delete がある場合は停止します。

## swallowkit create-migration

標準外の追加 Azure リソース用に、次の version の Bicep を生成します。

```bash
npx swallowkit create-migration add-search-service
# infra/migrations/0001-add-search-service/main.bicep を編集
```

生成した Bicep は `projectName` と `location` を受け取ります。既存リソースは `existing` で参照し、原則として追加的かつ再実行可能にしてください。適用済みファイルを編集すると checksum 不一致で停止するため、修正は新しい migration にします。

### プロビジョニング後の確認

```bash
# リソース一覧を表示
az resource list --resource-group my-app-rg --output table

# Static Web Apps の URL を取得
az staticwebapp show \
  --name <swa-name> \
  --resource-group my-app-rg \
  --query "defaultHostname" -o tsv

# Functions の URL を取得
az functionapp show \
  --name <function-name> \
  --resource-group my-app-rg \
  --query "defaultHostName" -o tsv
```

### Baseline Bicep のカスタマイズ

プロビジョニング前に `infra/` の Bicep ファイルを編集できます:

```bicep
// infra/modules/functions-flex.bicep

// インスタンスメモリサイズをカスタマイズ
resource flexFunctionsServer 'Microsoft.Web/sites@2023-12-01' = {
  // Flex Consumption プロパティ
}
```

baseline を意図的に変更した場合、通常の `provision` は `baseline-drift` で停止します。影響を Azure what-if で確認したうえで、`--reconcile --what-if` を指定してください。Functions app settings など template 管理プロパティが上書きされる可能性があります。追加リソースには `create-migration` を使用する方が安全です。

### トラブルシューティング

**リソースグループが存在しない:**
```bash
# 作成
az group create --name my-app-rg --location japaneast
```

**リージョンでリソースが利用できない:**
```bash
# 利用可能なリージョンを確認
az provider show --namespace Microsoft.Web \
  --query "resourceTypes[?resourceType=='staticSites'].locations" -o table
```

**クォータ超過:**
```bash
# クォータを確認
az vm list-usage --location japaneast --output table
```

## グローバルオプション

全コマンドで使用可能:

| オプション | 説明 |
|----------|------|
| `--help` | ヘルプを表示 |
| `--version` | バージョンを表示 |

## 環境変数

CLI の動作を環境変数で制御:

| 変数 | 説明 | デフォルト |
|------|------|----------|
| `SWALLOWKIT_LOG_LEVEL` | ログレベル (debug/info/warn/error) | `info` |
| `COSMOS_DB_ENDPOINT` | Cosmos DB エンドポイント | `https://localhost:8081/` |
| `BACKEND_API_URL` | Functions URL | `http://localhost:7071` |

## 次のステップ

- [デプロイガイド](./deployment-guide) - Azure へのデプロイ
- [Scaffold ガイド](./scaffold-guide) - CRUD コード生成の詳細
## 名前付きスキームの add-auth

`swallowkit add-auth --scheme admin --provider swa` と `swallowkit add-auth --scheme lineUser --provider external-token` はスキーム別ディレクトリへ生成します。同名スキームは安全に停止し、verifier/adapter は上書きしません。`--scheme` 省略時は従来の単一 provider フローです。
