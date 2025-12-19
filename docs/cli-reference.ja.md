# CLI リファレンス

SwallowKit CLI の全コマンドとオプションの詳細リファレンスです。

## 目次

- [swallowkit init](#swallowkit-init)
- [swallowkit dev](#swallowkit-dev)
- [swallowkit scaffold](#swallowkit-scaffold)
- [swallowkit provision](#swallowkit-provision)

## swallowkit init

新しい SwallowKit プロジェクトを初期化します。

### 使用法

```bash
npx swallowkit init [project-name] [options]
```

### 引数

- `project-name` (オプション): プロジェクト名。省略時はカレントディレクトリに初期化

### オプション

現在、オプションはありません。対話的にプロジェクト設定を選択します。

### 対話的プロンプト

1. **CI/CD プロバイダー**: GitHub Actions または Azure Pipelines
2. **プロジェクト構成**: 自動的に最適な設定を適用

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
│   ├── src/functions/
│   │   └── greet.ts          # サンプル HTTP トリガー
│   ├── host.json
│   ├── local.settings.json
│   └── package.json
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
├── .env.local                # 環境変数
├── .env.example
├── next.config.js
├── swallowkit.config.js
├── staticwebapp.config.json
└── package.json
```

### 例

```bash
# カレントディレクトリに初期化
npx swallowkit init

# 新しいディレクトリに初期化
npx swallowkit init my-awesome-app

# 初期化後
cd my-awesome-app
npm install
```

## swallowkit dev

開発サーバーを起動します（Next.js + Azure Functions）。

### 使用法

```bash
npx swallowkit dev [options]
```

### オプション

| オプション | 短縮 | 説明 | デフォルト |
|----------|------|------|----------|
| `--port <port>` | `-p` | Next.js ポート | `3000` |
| `--functions-port <port>` | | Azure Functions ポート | `7071` |
| `--host <host>` | | ホスト名 | `localhost` |
| `--open` | `-o` | ブラウザを自動的に開く | `false` |
| `--no-functions` | | Functions をスキップ | `false` |
| `--verbose` | `-v` | 詳細ログを表示 | `false` |

### 動作

1. **Cosmos DB Emulator チェック**: ローカルエミュレーターの起動を確認
2. **Azure Functions 起動**: 
   - Azure Functions Core Tools の確認
   - 依存関係の自動インストール
   - `functions/` ディレクトリで Functions を起動
3. **Next.js 起動**: 開発サーバーを起動

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

# 詳細ログ付き
npx swallowkit dev --verbose
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
```

### 引数

- `model-file` (必須): Zodスキーマを含むモデルファイルのパス

### オプション

現在、オプションはありません。

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

詳しくは [Scaffold ガイド](./scaffold-guide.ja.md) を参照してください。

## swallowkit provision

Azure リソースを Bicep でプロビジョニングします。

### 使用法

```bash
npx swallowkit provision [options]
```

### オプション

| オプション | 短縮 | 説明 | 必須 |
|----------|------|------|------|
| `--resource-group <name>` | `-g` | リソースグループ名 | ✅ |
| `--location <location>` | `-l` | Azure リージョン | ✅ |
| `--subscription <id>` | | サブスクリプション ID | |

### Azure リージョン

推奨リージョン:
- `japaneast` - 東日本
- `japanwest` - 西日本
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
   - プラン: Consumption (従量課金)
   - ランタイム: Node.js 22
   - OS: Linux

3. **Azure Cosmos DB**
   - モード: Serverless
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
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast

# サブスクリプション指定
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast \
  --subscription "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 短縮オプション
npx swallowkit provision -g my-app-rg -l japaneast
```

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

### Bicep ファイルのカスタマイズ

プロビジョニング前に `infra/` の Bicep ファイルを編集できます:

```bicep
// infra/modules/functions.bicep

// Consumption → Premium に変更
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: functionAppName
  location: location
  sku: {
    name: 'EP1'  // Premium Elastic
    tier: 'ElasticPremium'
  }
}
```

編集後、`swallowkit provision` を再実行して変更を適用します。

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

- [デプロイガイド](./deployment-guide.ja.md) - Azure へのデプロイ
- [Scaffold ガイド](./scaffold-guide.ja.md) - CRUD コード生成の詳細
- [アーキテクチャガイド](./architecture.ja.md) - システム設計
