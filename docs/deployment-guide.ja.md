# デプロイガイド

このガイドでは、SwallowKit アプリケーションを Azure にデプロイする方法を説明します。

## 目次

- [前提条件](#前提条件)
- [クイックスタート](#クイックスタート)
- [生成されるリソース](#生成されるリソース)
- [CI/CD セットアップ](#cicd-セットアップ)
- [環境変数](#環境変数)
- [トラブルシューティング](#トラブルシューティング)

## 前提条件

- Azure アカウント
- Azure CLI (`az`) のインストール
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
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast
```

このコマンドは Bicep テンプレートを使用して以下を作成します:
- Azure Static Web Apps
- Azure Functions (Consumption プラン)
- Azure Cosmos DB (サーバーレス)
- マネージド ID（サービス間の安全な接続）

### 3. CI/CD シークレットの設定

#### GitHub Actions の場合

**Static Web Apps デプロイトークンを取得:**

```bash
az staticwebapp secrets list \
  --name <swa-name> \
  --resource-group my-app-rg \
  --query "properties.apiKey" -o tsv
```

**GitHub リポジトリにシークレットを追加:**
1. GitHub リポジトリの Settings → Secrets and variables → Actions
2. `AZURE_STATIC_WEB_APPS_API_TOKEN` を追加

**Functions 発行プロファイルを取得:**

```bash
az functionapp deployment list-publishing-profiles \
  --name <function-name> \
  --resource-group my-app-rg \
  --xml
```

**GitHub シークレットに追加:**
- `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` を追加

#### Azure Pipelines の場合

**変数グループを作成:**
1. Azure DevOps → Pipelines → Library → Variable groups
2. `azure-deployment` という名前のグループを作成
3. 以下を追加:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE`

### 4. デプロイ実行

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

CI/CD ワークフローが自動的に実行されます。

## 生成されるリソース

### Azure Static Web Apps

- **目的**: Next.js アプリケーションのホスティング
- **モード**: Standalone（最適化されたデプロイサイズ）
- **機能**:
  - グローバル CDN
  - 自動 HTTPS
  - カスタムドメイン対応

### Azure Functions

- **プラン**: Consumption（従量課金）
- **ランタイム**: Node.js 22
- **機能**:
  - HTTP トリガー
  - Cosmos DB バインディング
  - Zod スキーマ検証

### Azure Cosmos DB

- **モード**: Serverless
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

### Bicep ファイルの編集

```
infra/
├── main.bicep               # メインオーケストレーション
├── main.parameters.json     # パラメータ
└── modules/
    ├── staticwebapp.bicep   # SWA リソース
    ├── functions.bicep      # Functions + Storage
    └── cosmosdb.bicep       # Cosmos DB + RBAC
```

### 変更の適用

```bash
# Bicep ファイルを編集後
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast
```

### 一般的なカスタマイズ

**Functions のプランを変更:**

```bicep
// infra/modules/functions.bicep
resource functionApp 'Microsoft.Web/sites@2022-03-01' = {
  kind: 'functionapp'
  properties: {
    serverFarmId: appServicePlan.id
    // Premium プランに変更
  }
}
```

**Cosmos DB を有料プランに変更:**

```bicep
// infra/modules/cosmosdb.bicep
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  properties: {
    // serverless → provisioned
    capabilities: []
  }
}
```

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

- [アーキテクチャガイド](./architecture.ja.md) - システム設計の詳細
- [CLI リファレンス](./cli-reference.ja.md) - 全コマンドの詳細
- [Scaffold ガイド](./scaffold-guide.ja.md) - CRUD コード生成
