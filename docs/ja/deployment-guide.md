# Azure へのデプロイ

Next.js プロジェクトでは `next.config.ts` に `cacheComponents: false` を設定します。
生成ページの動的ルート設定は Cache Components と併用できません。
Cache Components に依存する `partialPrefetching` も、設定があれば無効化します。
既存プロジェクトの Next.js を更新する場合も、これらの設定を維持してください。

**React:** 生成ワークフローはビルド済みの `dist/` と `bff/` を SWA に配置し、
`skip_app_build` / `skip_api_build` を指定します。独立 `functions/` は別途デプロイし、
SWA にリンクしたり `api_location` に指定したりしません。
以下の Next.js / Oryx の例とは異なるため、[React のデプロイ](./react-guide.md#ビルド・検証・デプロイ)を参照してください。

pnpm 11/12 と npm の使い分けは[コマンドとトラブルシューティング](./package-managers.md)を参照してください。

SwallowKit プロジェクトの Azure リソースをプロビジョニングし、CI/CD を設定します。このガイドを完了すると、Azure Static Web Apps 上で Azure Functions バックエンドと Cosmos DB を使ったアプリケーションが動作する状態になります。

## 目次

- [前提条件](#前提条件)
- [クイックスタート](#クイックスタート)
- [生成されるリソース](#生成されるリソース)
- [CI/CD セットアップ](#cicd-セットアップ)
- [環境変数](#環境変数)
- [トラブルシューティング](#トラブルシューティング)

## 前提条件

- Azure アカウント
- Azure CLI (`az`) のインストールとサインイン（`az login`）。SwallowKit を実行するターミナルで `az --version` が動作する必要があります。Windows では MSI / winget でインストールした `az.cmd` に対応しています。
- GitHub アカウント（GitHub Actions を使用する場合）
- Azure DevOps アカウント（Azure Pipelines を使用する場合）

## クイックスタート

### 1. プロジェクト初期化

```bash
npx swallowkit init my-app
cd my-app
```

初期化時に CI/CD プロバイダーを選択:
- GitHub Actions
- Azure Pipelines

### 2. Azure リソースのプロビジョニング

```bash
npx swallowkit provision --resource-group my-app-rg \
  --location japaneast --swa-location eastasia
```

リージョンを省略した場合は対話式に選択します。通常の `provision` は実行すると Azure の状態を確認し、必要なデプロイを開始します。初回は `infra/main.bicep` をデプロイし、インフラの初期状態を baseline 0 として記録します。追加のコマンド承認や machine の plan／apply 操作は不要です。

成功後にはリソース名・URL と、CI/CD に必要な3つの値 `AZURE_STATIC_WEB_APPS_API_TOKEN`（SWA のデプロイトークン）、`AZURE_FUNCTIONAPP_NAME`、`AZURE_FUNCTIONAPP_PUBLISH_PROFILE`（発行プロファイルの XML）を表示します。これらはターミナルに表示するだけで、SwallowKit は保存しません。値を取得できなかった場合は取得用の `az` コマンドを表示します。この場合もリソースの provision 自体は成功として扱います。

実行状況は内部のチェックポイントと migration の記録で管理し、中断後の二重デプロイや既存アプリ設定の上書きを防ぎます。エージェント向けの machine／MCP でデプロイする場合は、保存済み plan と明示的な人の承認が必要です。

このコマンドは Bicep テンプレートを使用して以下を作成します:
- Azure Static Web Apps
- Azure Functions (Flex Consumption)
- Azure Cosmos DB（初期化時に選択した Free Tier または Serverless）
- マネージド ID（サービス間の安全な接続）

`az` が見つからないか起動できない場合は、確認を求めずに終了し、Azure には何も変更を加えません。`az-cli-not-found` は PATH に `az` がないこと、`az-cli-not-runnable` は見つかったものの起動できなかったことを示します。サインインしていない場合は `az login` の実行を案内します。原因を解消してから、もう一度 `provision` を実行してください。

非対話環境では `--location` と `--swa-location` を明示してください。`--approve` は互換性のためだけに残しており、通常の provision には不要です。CI/CD の secrets は後述の Azure CLI コマンドで取得します。

#### 待機の中断と部分完了

Bicep は `--no-wait` で一度だけ送信します。その後、通常の `provision` と `provision --resume` は同じ deployment の状態を確認し、`Succeeded`／`Failed`／`Canceled` になるまで待ちます。全体の待ち時間に上限はないため、10〜20分かかる deployment も1回の実行で完了まで待ち、その後にリソース情報と CI/CD の設定値を表示します。

個々の az 呼び出しには時間制限があり、一時的な状態照会エラーは再試行します。machine／MCP の apply はエージェントに応答を返すため、1回の待機を既定300秒で区切ります。`--wait-seconds` で0〜3600秒を指定できます。

az の終了コードが0なら、stderr の warning だけで失敗にはしません。大量の出力は読み捨て、出力上限で az を停止しません。診断には exit code、signal、timeout／通信エラー、経過時間、出力を省略した事実を含め、キーや token などを伏せます。

成功後の通常 CLI は、決められたリソース情報の outputs だけを読み、SWA のデプロイトークンと Functions の発行プロファイルを `az` で取得してターミナルに表示します。任意の outputs は表示しません。machine／MCP は deployment outputs を返しません。

Ctrl+C や状態を照会できない状態の継続で待機が途中で終わった場合、Azure が `Running`／`Accepted` なら進行中と表示し、`provision-failed` にはしません。照会できない場合や DeploymentNotFound は `unknown`（`blocked`）であり、Azure の失敗を意味しません。`Failed`／`Canceled` では、秘密を伏せた Azure のエラーと deployment operations の原因を示します。`Succeeded` でも migration tag とローカル ledger が未完了なら、全体は **partial** です。

`.swallowkit/state/provision/` を保存したまま、表示された run ID（元の plan ID）を使ってください。

```powershell
pnpm exec swallowkit provision --status <runId>
# 元の実行を続行し、完了まで待つ:
pnpm exec swallowkit provision --resume <runId>
```

status は読み取り専用です。再開では元の subscription、deployment ID／correlation、fingerprint、migration checksum を再確認し、送信済み deployment を再送しません。未実行の承認済み処理と tag／ledger 更新だけを続けます。Azure 成功後に記録処理が失敗しても、baseline を再デプロイせず、このチェックポイントから記録を完了してください。Ctrl+C や強制終了後も Azure が続く場合があります。自動でキャンセル・削除はしません。強制終了では終了結果を表示できませんが、書き込み前のチェックポイントから復旧できます。

MCP の provision リクエストをキャンセルした場合も、停止するのはローカルの machine 子プロセス／待機であり、Azure deployment ではありません。元の plan／run ID で状態を確認してから再開してください。MCP のキャンセルや応答の欠落は、Azure の失敗を意味しません。

#### 旧バージョンの未追跡 baseline を復旧する

実行チェックポイントがない版で bootstrap が中断した場合は、まず元の deployment を確認します。タグの修復だけのために新しい bootstrap や `--reconcile` を実行しないでください。

```powershell
az deployment group show --resource-group <original-rg> --name swallowkit-baseline --subscription <original-subscription> --query "{state:properties.provisioningState,error:properties.error}" -o json
pnpm exec swallowkit provision -g <original-rg> --subscription <original-subscription> --location japaneast --swa-location eastasia --resume-deployment swallowkit-baseline
```

この復旧オプションを含む修正版 CLI で、元のローカル Bicep／parameters と既存 deployment の ARM template／非 secret parameters の一致を確認し、照会と記録処理だけを進めます。deployment create は送りません。Running なら追跡を続け、Succeeded 後に tag／ledger を記録します。不一致、照会不能、secure parameters、legacy manifest、baseline 以外の未追跡 migration は推測せず停止します。元の確認済みファイルを復元し、manifest の置き換えやチェックの回避はしないでください。Azure の生のエラーを共有する前には、秘密がないか確認してください。

Azure が terminal `Failed` を返した場合は、ローカルの待機中断とは別の障害です。Cosmos module の失敗は Azure Portal でその module の deployment operations を確認してください。`NotFound: Request url is invalid` だけでは原因を特定できません。Cosmos DB アカウント名と Function App 名は Azure 全体で一意である必要があります。このバージョン以降に init したプロジェクトは `cosmos-<projectName>-<suffix>` と `func-<projectName>-<suffix>` を生成します。suffix は Resource Group から決まるため、Resource Group ごとに別の名前になり、同じ Resource Group への再デプロイでは同じ名前が維持されます。以前のバージョンで init したプロジェクトの `infra/main.bicep` は `cosmos-<projectName>` と `func-<projectName>` を使います。この場合は Resource Group だけ変えても名前は変わりません。また、アカウントや Resource Group を削除した後も、Azure がしばらく名前を保持することがあります（例: `database account ... state is not Online`）。再デプロイ前に既存アカウント名を確認し、再試行のためだけに稼働中アカウントを削除・改名しないでください。[Azure の命名規則](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftdocumentdb)も参照してください。

### 3. コードのプッシュ

コードをプッシュして CI/CD ワークフローをトリガーします：

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

> **注意**: このプッシュで CI/CD ワークフローが自動実行されますが、シークレットが未登録のため**失敗します**。これは想定内です——次のステップに進んでください。

### 4. キャンセル・シークレット登録・再実行

#### ステップ 4-1: 自動実行された CI/CD をキャンセル

初回プッシュでトリガーされた CI/CD はシークレットがないため成功しません。キャンセルしてください：

- **GitHub Actions**: Actions タブ → 実行中のワークフローをクリック → Cancel workflow
- **Azure Pipelines**: Pipelines → 実行中のパイプラインをクリック → Cancel

#### ステップ 4-2: secrets / variables を登録

`swallowkit provision` が「CI/CD settings」に表示した値を使います。自動取得できなかった値は、その横に表示された `az` コマンドで取得してください。

##### GitHub Actions の場合

1. GitHub リポジトリの Settings → Secrets and variables → Actions
2. 以下のシークレットを追加：
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

##### Azure Pipelines の場合

1. Azure DevOps → Pipelines → Library → Variable groups
2. `azure-deployment` という名前のグループを作成
3. 以下を追加：
  - `AZURE_STATIC_WEB_APPS_API_TOKEN`
  - `AZURE_FUNCTIONAPP_NAME`
  - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

#### ステップ 4-3: CI/CD ワークフローを手動で再実行

- **GitHub Actions**: Actions タブ → 失敗したワークフローを選択 → Re-run all jobs
- **Azure Pipelines**: Pipelines → 失敗したパイプラインを選択 → Run pipeline

### Cosmos DB の初期データ投入（GitHub Actions / TypeScript・C#・Python）

ローカルで作成・検証した `dev-seeds/<name>/` の JSON を使い、Azure Cosmos DB に初期データを投入できます。モデルの定義、CRUD の生成、seed の保存とローカル検証の流れは[ローカル開発ガイド](./dev-guide.md#dev-seeds)を参照してください。ここでは、検証済みの seed を Azure に投入し、必要に応じて内容を修正する手順を説明します。

TypeScript / C# / Python の生成プロジェクトには、手動で初期データを投入する `.github/workflows/initialize-cosmos-seeds.yml` が含まれます。通常の push デプロイでは seed を投入しません。

データ定義は既存の `dev-seeds/<name>/` をそのまま利用します。`npx swallowkit create-dev-seeds local` でテンプレートを作成するか、`npx swallowkit create-dev-seeds local --from-emulator` でローカル Emulator の内容をエクスポートします。JSON を確認・編集し、`npx swallowkit dev --seed-env local` でローカル検証してください。このローカルコマンドは Emulator の対象コンテナーを置き換えます。Azure では後述の通常モードと force モードで書き込み方法を選びます。Azure に投入するファイルだけをレビューしてコミットしてください。

#### 実行前の準備

Azure 上にデータベースと **seed が参照するすべてのコンテナーが存在すること**が前提です。モデルの追加・scaffold 後は、対象のリソースグループへ `swallowkit provision` で未適用のインフラ migration を適用してから seed を投入してください。通常モードも `force` も、データベースやコンテナーは作成しません。shared スキーマの検証や Functions のデプロイが成功していても、対応するコンテナーが Azure 上にあるとは限りません。

```bash
# 既存アプリのリソースグループと subscription を指定します。
npx swallowkit provision --resource-group <existing-resource-group> \
  --subscription <existing-subscription> \
  --location <existing-location> --swa-location <existing-swa-location>
```

provision の成功、対象データベース内のコンテナー名（大文字・小文字を区別）、Functions の接続先アカウント・データベースを確認します。seed の再試行だけを目的に `--reconcile`、リソース削除、別データベースの作成は行わないでください。provision はリソースをデプロイして費用が発生する場合があるため、プロジェクトの通常のインフラ承認手順に従ってください。

#### 実行と書き込みモードの選択

リポジトリの `main` から **Actions → Initialize Azure Cosmos DB seed data → Run workflow** を実行し、`seed_name` にディレクトリ名を入力します。`AZURE_FUNCTIONAPP_NAME` に設定済みの Function App 名も確認入力し、完全一致させてください。

ワークフローは、ビルド済みの shared Zod スキーマで seed を検証します。`main` 以外の ref、不正な名前、seed ディレクトリ／JSON の欠落、未知モデル、Zod 検証失敗、500 ドキュメントまたは合計 4 MiB を超える seed は拒否されます。

検証したデータは一時 Function のコードに埋め込み、デプロイ後に HTTP で呼び出して投入します。処理後は保存済みの通常版 Functions パッケージを再デプロイします。HTTP リクエストでは seed 名、任意 JSON、コンテナー名を指定できません。

| 入力 | 意味 |
|---|---|
| `seed_name` | `dev-seeds/` 内の既存ディレクトリ名（例：`local`） |
| `function_app_name` | `AZURE_FUNCTIONAPP_NAME` と完全一致する確認入力 |
| `force` | 既定はオフ。seed のアイテムを作成・上書きし、他のアイテムは削除しない場合だけ有効化 |

ワークフローはアプリ名からホスト名を組み立てず、デプロイ action の `app-url` 出力を使います。Flex Consumption のホスト名には固有の識別子やリージョンが含まれる場合があります。初期化 POST は1回だけ送信し、その前に同じ endpoint へ認証付きの読み取り専用 GET を最大12回送って起動を待ちます。各リクエストのタイムアウトは10秒、試行間隔は5秒です。GET は一時 Function の token と期限だけを確認し、Cosmos DB にはアクセスしません。準備完了チェックに失敗しても通常版への復元を試行します。404 が続く場合は実際のホスト名、デプロイされた Function の登録情報、起動ログを確認してください。既存プロジェクトではワークフローと `.github/scripts/prepare-cosmos-bootstrap.mjs` を一緒に更新してください。起動待ちを追加したワークフローには、新しい GET handler が必要です。

既定の Azure への投入は Create-only です。存在しないアイテムは作成し、内容が同じ既存アイテムは Cosmos システムプロパティを無視してスキップし、異なる場合は競合として失敗します。既存アイテムやコンテナーの置換・削除は行いません。失敗しても先行アイテムが書き込まれている場合があります。表示された件数・競合を確認してから再実行してください。同一 seed を再実行しても、既に作成済みの同一アイテムは変更しません。

seed の内容で明示的に上書きする場合は、手動実行時に `force` を選択します。既定値は `false` です。検証済み seed の各アイテムを upsert し、同じ `id`・パーティションキーのアイテムがなければ作成し、あれば全体を置き換えます。

置き換えたアイテムからは seed にないプロパティも除かれます。一方、seed に含まれないアイテムやコンテナーは削除しません。パーティションキーを変更すると別アイテムとして作成され、元のアイテムは残ります。

force の指定は一時パッケージに固定し、HTTP リクエストでは変更できません。`upserted` は作成・置き換えを合わせた成功件数で、このモードの `created` と `skipped` は0です。

各アイテムは順に書き込まれるため、途中で失敗しても先行する書き込みは残ります。seed と投入先を確認してから有効にしてください。既存プロジェクトではワークフローと生成スクリプトの両方を更新してください。

#### 結果の確認とトラブルシューティング

POST が成功すると件数が返ります。force 実行の例は `{"created":0,"upserted":44,"skipped":0,"conflicts":0,"failed":0}` です。初期化ステップと、その後の通常版への復元が**両方成功したこと**を確認してください。復元はコードを戻す処理であり、投入済みデータはロールバックしません。

| 結果 | 意味と対応 |
|---|---|
| 起動待ち GET が最初は404、その後成功 | 一時ルートの起動途中です。GET 中には seed を書き込みません。 |
| 起動待ちが最後まで失敗 | デプロイ先 URL、Function の登録・起動、token 期限、ネットワークを確認します。初期化 POST は未送信です。 |
| POST が409 / `data-conflict` | 通常モードで既存データとの差分を検出しました。seed の位置を確認し、seed を修正するか、意図して `force` を選びます。 |
| POST が503、C# の `cosmosStatusCode` が404 | 起動待ちの404とは別の Cosmos リソースエラーです。データベース・コンテナーと接続先を確認します。`upsert-item` の404 / 1003はコンテナー未作成の場合があるため、対象モデルの未適用 migration を provision してから再試行します。 |
| POST がタイムアウト、または `write-outcome-unknown` | 先行する書き込みは残り、失敗した書き込みも完了している可能性があります。診断情報と既存データを確認してから再試行します。外側の503だけで一時的な Cosmos 障害と判断しないでください。 |
| 通常版への復元が失敗 | デプロイの問題を解消してから、既存のデプロイワークフローで通常版を再デプロイします。 |

C# の初期化で例外が起きた場合は、失敗した処理、コンテナー名、seed 配列の0始まりの位置、経過時間、例外型も応答に含めます。Cosmos の例外では status / substatus、activity ID、再試行待ち時間も返します。外側の HTTP 503 だけでは Cosmos 側の原因は分かりません。例外メッセージ、ドキュメントの値、接続情報は含めません。`upserted` が1以上なら既に部分的な書き込みが発生しているため、診断結果を確認してから再試行の可否を判断してください。

データ競合時の応答には `containerName` と `seedDocumentIndex`（検証済み seed 配列内の0始まりの位置）を含めます。該当する seed アイテムを特定し、その `id` とパーティションキーに対応する Cosmos の既存アイテムと比較してください。エラーにドキュメントの値は含めません。409 は初期化の失敗であり、結果不明やスキップ成功ではありません。差分を確認するまでは既存データを変更しないでください。

一時 Function は `authLevel: anonymous` を明示し、さらに `Authorization: Bearer` ヘッダー内の暗号学的に安全な UUID v4 を要求します。GitHub Actions は UUID 生値をマスクし、一時パッケージには SHA-256 ハッシュと期限だけを埋め込みます。token は15分で期限切れになります。これは一時 bearer credential による認証であり、**GitHub の実行者 ID を確認するものではありません**。デプロイは既存の `Azure/functions-action` と `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` を継続利用します。Publish Profile は OIDC より制約があり、OIDC 移行は今回の対象外・将来の改善事項です。Subscription / Resource Group の照合も行いません。実行可能な主体は既存の GitHub Actions 実行権限、ブランチ保護、secret アクセス制御に依存します。本番では `main` とデプロイ実行者を適切に制限してください。

同期 Function の処理期限は180秒で、Azure Functions HTTP Trigger の230秒制限より短くしています。入力上限は500ドキュメント・合計4 MiBです。HTTP 呼び出しがタイムアウトしたり書き込み結果が不明になった場合、成功扱いにはせずワークフローは失敗しますが、通常版への復元は試行します。Create-only のためレビュー済み seed の再試行は安全ですが、先に部分結果と競合を確認してください。通常デプロイと初期化デプロイは同一の非キャンセル型 concurrency group で直列化されます。

この二段階デプロイは初回構築・アプリ公開前の初期化を基本用途としてください。稼働中の Flex Consumption Function App へのパッケージ再デプロイは、停止や実行中リクエストへの影響を生じる可能性があります。利用中のアプリに適用する場合は、停止時間と処理影響を事前評価してください。Cosmos DB のネットワークや firewall は緩和しません。Cosmos が Private Endpoint 限定の場合も、既存の VNet / Managed Identity 設定で Functions から接続できる必要があります。GitHub-hosted runner が Function App の HTTP endpoint に到達できない場合も失敗し、自動で公開設定を変更することはありません。

通常版への復元に失敗した場合、ワークフローは失敗し復旧エラーを表示します。既存 Publish Profile の問題を解消後、`main` から **Deploy Azure Functions** を実行して通常版を再デプロイしてください。タイムアウトは書き込み未実行を意味しません。再試行の前に部分結果を確認してください。

## 生成されるリソース

### Azure Static Web Apps

- **目的**: Next.js アプリケーションのホスティング
- **モード**: Standalone（最適化されたデプロイサイズ）
- **機能**:
  - グローバル CDN
  - 自動 HTTPS
  - カスタムドメイン対応

### Azure Functions

- **プラン**: Flex Consumption
- **ランタイム**: 初期化時に選択（TypeScript/Node.js 22、C#/.NET Isolated 10.0、Python 3.14）。ローカル Python の選択とは別なので、クラウド互換性の確認にはデプロイ先と同じバージョンを使ってください。
- **機能**:
  - HTTP トリガー
  - Cosmos DB バインディング
  - Zod スキーマ検証

### Azure Cosmos DB

- **モード**: 初期化時に選択した Free Tier または Serverless
- **機能**:
  - 自動スケーリング
  - グローバル分散
  - RBAC によるアクセス制御

### マネージド ID

- **種類**: システム割り当てマネージド ID
- **目的**: 接続文字列なしでサービス間を安全に接続
- **権限**: Cosmos DB への読み取り/書き込みアクセス

## CI/CD ワークフロー

### 生成されるファイル

```
.github/workflows/           # GitHub Actions の場合
├── static-web-app.yml       # SWA デプロイ
└── azure-functions.yml      # Functions デプロイ

pipelines/                   # Azure Pipelines の場合
├── static-web-app.yml
└── azure-functions.yml
```

### ワークフローの動作

**Static Web Apps ワークフロー:**
- トリガー: `main` ブランチへのプッシュ、`app/**`、`components/**`、`lib/**` の変更
- 処理:
  1. Next.js を standalone モードでビルド
  2. Azure Static Web Apps へデプロイ
  3. プレビュー環境を作成（PR の場合）

**Azure Functions ワークフロー:**
- トリガー: `main` ブランチへのプッシュ、`functions/**` の変更
- 処理:
  1. 依存関係のインストール
  2. TypeScript のビルド
  3. Azure Functions へデプロイ

### パスベーストリガー

効率的なデプロイのため、変更されたファイルに応じて適切なワークフローのみが実行されます:

- フロントエンド変更（`app/`, `components/`, `lib/`）→ SWA のみデプロイ
- バックエンド変更（`functions/`）→ Functions のみデプロイ
- 両方変更 → 両方デプロイ

## 環境変数

### ローカル開発（`.env.local`）

```bash
# Cosmos DB Emulator
COSMOS_DB_ENDPOINT=https://localhost:8081/
COSMOS_DB_KEY=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==

# Azure Functions (ローカル)
BACKEND_API_URL=http://localhost:7071
```

### 本番環境（Azure）

```bash
# Azure Functions
BACKEND_API_URL=https://<function-app-name>.azurewebsites.net

# Cosmos DB（マネージド ID 使用 - キー不要）
COSMOS_DB_ENDPOINT=https://<cosmosdb-account-name>.documents.azure.com:443/
```

**重要**: 本番環境では `COSMOS_DB_KEY` は不要です。マネージド ID が自動的に認証を処理します。

### Azure での環境変数設定

**Static Web Apps:**

```bash
az staticwebapp appsettings set \
  --name <swa-name> \
  --setting-names \
    BACKEND_API_URL=https://<function-name>.azurewebsites.net \
    COSMOS_DB_ENDPOINT=https://<cosmosdb-name>.documents.azure.com:443/
```

**Azure Functions:**

```bash
az functionapp config appsettings set \
  --name <function-name> \
  --resource-group my-app-rg \
  --settings \
    COSMOS_DB_ENDPOINT=https://<cosmosdb-name>.documents.azure.com:443/
```

## インフラストラクチャのカスタマイズ

### 差分 Infrastructure Migration

```
infra/
├── main.bicep               # メインオーケストレーション
├── main.parameters.json     # パラメータ
├── modules/                 # baseline リソース
└── migrations/
    ├── manifest.json        # version と checksum
    └── 0001-add-search/     # 追加リソース用の独立 Bicep
```

モデルを scaffold すると、新しい Cosmos DB コンテナーは migration として生成されます。任意の追加リソースは次のコマンドで作成します。

```bash
npx swallowkit create-migration add-search
# infra/migrations/0001-add-search/main.bicep を編集
npx swallowkit provision -g my-app-rg --location japaneast --swa-location eastasia
```

`provision` は Resource Group タグの version/checksum とローカル manifest を比較し、未適用 migration だけを昇順に実行します。各 migration の成功後にタグを進めます。待機や tag/ledger 更新が中断した場合は、新しい deployment を作らず、元の実行チェックポイントから再開してください。適用済み migration は編集せず、修正用の新しい migration を追加してください。

### 旧バージョンで作成したプロジェクト

```bash
npx swallowkit migrations init --legacy-baseline
npx swallowkit provision -g my-app-rg \
  --location japaneast --swa-location eastasia \
  --adopt-existing --baseline 0 --what-if
```

最初のコマンドは現在の `infra/` を baseline 0 として記録するだけで、Azure を変更しません。adoption も `main.bicep` をデプロイせず、確認後に状態タグだけを追加します。what-if に Create/Delete が含まれる場合は、未デプロイ変更を migration へ切り出すまで停止します。Modify は警告として表示されるため、Portal で追加した Functions 設定などを確認してください。

### Baseline の明示的な再適用

既存 baseline リソースを変更する必要がある場合だけ `--reconcile --what-if` を使います。

```bash
npx swallowkit provision -g my-app-rg \
  --location japaneast --swa-location eastasia \
  --reconcile --what-if
```

reconcile は `main.bicep` 全体を再デプロイし、Functions の app settings など template 管理プロパティを戻す可能性があります。通常の `provision` が自動的に reconcile へ切り替わることはありません。

## トラブルシューティング

### デプロイが失敗する

**症状**: CI/CD パイプラインがエラーで失敗

**解決策**:
1. GitHub/Azure DevOps のログを確認
2. シークレットが正しく設定されているか確認
3. Azure リソースが正常にプロビジョニングされているか確認

```bash
# リソースの確認
az resource list --resource-group my-app-rg --output table
```

### Functions に接続できない

**症状**: BFF から Functions への呼び出しが失敗

**解決策**:
1. `BACKEND_API_URL` が正しく設定されているか確認
2. CORS 設定を確認

```bash
az functionapp cors show \
  --name <function-name> \
  --resource-group my-app-rg
```

3. Functions が実行中か確認

```bash
az functionapp show \
  --name <function-name> \
  --resource-group my-app-rg \
  --query "state" -o tsv
```

### Cosmos DB 接続エラー

**症状**: "Unauthorized" または接続エラー

**解決策**:
1. マネージド ID が有効か確認

```bash
az functionapp identity show \
  --name <function-name> \
  --resource-group my-app-rg
```

2. RBAC ロールが割り当てられているか確認

```bash
az cosmosdb sql role assignment list \
  --account-name <cosmosdb-name> \
  --resource-group my-app-rg
```

3. エンドポイント URL が正しいか確認

### ビルドが遅い

**症状**: Next.js ビルドに時間がかかる

**解決策**:
1. `.next` キャッシュを使用

```yaml
# .github/workflows/static-web-app.yml
- uses: actions/cache@v3
  with:
    path: .next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}
```

2. `standalone` モードを確認（自動で有効）

## 次のステップ

- [CLI リファレンス](./cli-reference) - 全コマンドの詳細
- [Scaffold ガイド](./scaffold-guide) - CRUD コード生成
