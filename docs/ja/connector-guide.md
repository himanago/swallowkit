# Connector ガイド

## 概要

SwallowKit の **Connector** 機能は、Cosmos DB 以外の外部データソース — リレーショナルデータベース（MySQL、PostgreSQL、SQL Server）や SaaS REST API — との統合を可能にします。Connector を使うと、外部データを Cosmos DB モデルと同じように扱えます。Zod スキーマを定義して scaffold するだけで、型安全な UI、BFF ルート、Azure Functions がすべて自動生成されます。

💡 **ポイント**: Connector モデルは、通常の Zod モデルに `connectorConfig` というエクスポートを追加したものです。これにより SwallowKit が外部データソースへのアクセス方法を認識します。

## アーキテクチャ

Connector モデルは、標準の Cosmos DB モデルと同じアーキテクチャに組み込まれます。フロントエンドと BFF レイヤーはデータソースの違いを意識しません — 違いが生じるのは Functions レイヤーのみです。

### 標準モデル（Cosmos DB）

```
Frontend → BFF (Next.js API Routes) → Azure Functions → Cosmos DB
```

### Connector モデル

```
Frontend → BFF (Next.js API Routes) → Azure Functions → 外部データソース (RDB / API)
```

Connector モデルに対して生成される BFF ルートは、標準モデルと**まったく同じ**です。これは以下を意味します：

- フロントエンドはすべてのモデルを同一のインターフェースで利用できる
- フロントエンドを変更せずに、モデルを Cosmos DB から外部ソースへ（またはその逆へ）移行できる
- UI コンポーネントはデータソースに関係なく同じ方法で生成される

### ローカル開発時のモック Connector

```
Frontend → BFF → Mock Proxy (:7072) ──┬─ Connector ルート → インメモリ CRUD（Zod 生成データ）
                                      └─ その他のルート → Azure Functions (:7071)
```

モックプロキシは Connector モデルへのリクエストをインターセプトしてリアルなフェイクデータを返し、標準の Cosmos DB モデルへのリクエストは実際の Azure Functions ランタイムにプロキシします。

## はじめに

### 1. Connector を設定に追加

`add-connector` コマンドで新しい外部データソースを登録します：

```bash
# RDB Connector の追加（MySQL）
npx swallowkit add-connector mysql --type rdb --provider mysql

# API Connector の追加（Backlog）
npx swallowkit add-connector backlog --type api
```

これにより `swallowkit.config.js` の `connectors` セクションにエントリが追加されます。設定ファイルを手動で編集することも可能です — 詳しくは[設定リファレンス](#設定リファレンス)をご覧ください。

### 2. Connector モデルを作成

`create-model` コマンドに `--connector` フラグを付けて、`connectorConfig` 付きのモデル雛形を生成します：

```bash
# mysql Connector に紐づくモデルを作成
npx swallowkit create-model user --connector mysql

# backlog Connector に紐づくモデルを作成
npx swallowkit create-model backlog-issue --connector backlog
```

これにより `shared/models/user.ts`（または `backlog-issue.ts`）に Zod スキーマと、指定した Connector 用の `connectorConfig` エクスポートが生成されます。

### 3. モデルを編集

生成された Zod スキーマと `connectorConfig` を実際のデータソースに合わせてカスタマイズします：

**RDB の例** (`shared/models/user.ts`):

```typescript
import { z } from 'zod/v4';

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  department: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type User = z.infer<typeof User>;
export const displayName = 'User';

export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById'] as const,
  table: 'users',
  idColumn: 'id',
};
```

**API の例** (`shared/models/backlog-issue.ts`):

```typescript
import { z } from 'zod/v4';

export const BacklogIssue = z.object({
  id: z.string(),
  projectId: z.string(),
  issueKey: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  status: z.object({ id: z.number(), name: z.string() }),
  assignee: z.object({ id: z.number(), name: z.string() }).optional(),
  priority: z.object({ id: z.number(), name: z.string() }).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BacklogIssue = z.infer<typeof BacklogIssue>;
export const displayName = 'BacklogIssue';

export const connectorConfig = {
  connector: 'backlog',
  operations: ['getAll', 'getById', 'create', 'update'] as const,
  endpoints: {
    getAll: 'GET /issues',
    getById: 'GET /issues/{id}',
    create: 'POST /issues',
    update: 'PATCH /issues/{id}',
  },
};
```

### 4. Scaffold の実行

通常どおり `scaffold` を実行します — SwallowKit は `connectorConfig` エクスポートを検出し、Cosmos DB コードの代わりに Connector 固有の Functions コードを生成します：

```bash
npx swallowkit scaffold shared/models/user.ts
npx swallowkit scaffold shared/models/backlog-issue.ts
```

生成されるファイルはバックエンド言語によって異なります：

| コンポーネント | 標準モデル | Connector モデル |
|-------------|----------|----------------|
| **Functions (C#)** | `functions/` | `functions/Connectors/` |
| **Functions (TypeScript)** | `functions/src/functions/` | `functions/src/functions/` |
| **Functions (Python)** | `functions/` | `functions/` |
| **BFF ルート** | 同一 | 同一（フロントエンドに対して透過的） |
| **UI コンポーネント** | 同一 | 同一 |
| **Cosmos DB Bicep** | 生成される | **スキップされる** |

⚠️ **読み取り専用モデル**: `operations` に `getAll` や `getById` のみが含まれる場合、scaffold は POST、PUT、DELETE ハンドラを**生成しません**。そのモデルは読み取り専用として扱われます。

### 5. ローカル開発

`--mock-connectors` フラグ付きで dev サーバーを起動すると、実際の外部接続なしで開発できます：

```bash
npx swallowkit dev --mock-connectors
```

これにより、通常の開発環境（Cosmos Emulator + Azure Functions（ポート 7071）+ Next.js）に加えて、ポート 7072 でモックプロキシサーバーが起動します。詳しくは[モックサーバー](#モックサーバー)をご覧ください。

## 設定リファレンス

外部データソースは `swallowkit.config.js` の `connectors` セクションで定義します。各キーはモデルの `connectorConfig` で使用される一意の Connector 名です。

### 設定の全体例

```javascript
// swallowkit.config.js
module.exports = {
  backend: { language: 'csharp' },
  functions: {
    baseUrl: process.env.BACKEND_FUNCTIONS_BASE_URL || 'http://localhost:7071',
  },
  connectors: {
    mysql: {
      type: 'rdb',
      provider: 'mysql',
      connectionEnvVar: 'MYSQL_CONNECTION_STRING',
    },
    postgres: {
      type: 'rdb',
      provider: 'postgres',
      connectionEnvVar: 'POSTGRES_CONNECTION_STRING',
    },
    backlog: {
      type: 'api',
      baseUrlEnvVar: 'BACKLOG_API_BASE_URL',
      auth: {
        type: 'apiKey',
        envVar: 'BACKLOG_API_KEY',
        placement: 'query',
        paramName: 'apiKey',
      },
    },
    internal: {
      type: 'api',
      baseUrlEnvVar: 'INTERNAL_API_BASE_URL',
      auth: {
        type: 'bearer',
        envVar: 'INTERNAL_API_TOKEN',
      },
    },
  },
};
```

### RDB Connector のオプション

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `type` | `'rdb'` | ✅ | Connector タイプ |
| `provider` | `'mysql'` \| `'postgres'` \| `'sqlserver'` | ✅ | データベースプロバイダー |
| `connectionEnvVar` | `string` | ✅ | 接続文字列を格納する環境変数名 |

### API Connector のオプション

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `type` | `'api'` | ✅ | Connector タイプ |
| `baseUrlEnvVar` | `string` | ✅ | API のベース URL を格納する環境変数名 |
| `auth` | `object` | ✅ | 認証設定（以下参照） |

### API 認証タイプ

**API Key** (`type: 'apiKey'`):

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `type` | `'apiKey'` | ✅ | 認証タイプ |
| `envVar` | `string` | ✅ | API キーを格納する環境変数 |
| `placement` | `'query'` \| `'header'` | ✅ | API キーの送信先 |
| `paramName` | `string` | ✅ | クエリパラメータ名またはヘッダー名 |

**Bearer Token** (`type: 'bearer'`):

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `type` | `'bearer'` | ✅ | 認証タイプ |
| `envVar` | `string` | ✅ | Bearer トークンを格納する環境変数 |

**OAuth 2.0** (`type: 'oauth2'`):

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `type` | `'oauth2'` | ✅ | 認証タイプ |
| `tokenUrlEnvVar` | `string` | ✅ | トークンエンドポイント URL を格納する環境変数 |
| `clientIdEnvVar` | `string` | ✅ | クライアント ID を格納する環境変数 |
| `clientSecretEnvVar` | `string` | ✅ | クライアントシークレットを格納する環境変数 |

## モデルメタデータリファレンス

モデルファイルの `connectorConfig` エクスポートは、SwallowKit にどの Connector を使用し、外部データソースとどのようにやり取りするかを伝えます。

### 共通フィールド

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `connector` | `string` | ✅ | Connector 名（`connectors` 設定のキーと一致する必要あり） |
| `operations` | `readonly string[]` | ✅ | 有効なオペレーションの配列 |

### RDB 固有フィールド

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `table` | `string` | ✅ | データベーステーブル名 |
| `idColumn` | `string` | ✅ | 主キーカラム名 |

```typescript
export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById', 'create', 'update', 'delete'] as const,
  table: 'products',
  idColumn: 'id',
};
```

### API 固有フィールド

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `endpoints` | `object` | ✅ | オペレーション名から HTTP メソッド + パスへのマッピング |

```typescript
export const connectorConfig = {
  connector: 'backlog',
  operations: ['getAll', 'getById', 'create'] as const,
  endpoints: {
    getAll: 'GET /issues',
    getById: 'GET /issues/{id}',
    create: 'POST /issues',
  },
};
```

エンドポイントのパスでは、リソース識別子のプレースホルダーとして `{id}` を使用します。

## サポートされるオペレーション

| オペレーション | HTTP メソッド | RDB（生成される SQL） | API（生成される HTTP） | 説明 |
|-------------|-------------|---------------------|---------------------|------|
| `getAll` | GET | `SELECT * FROM {table}` | `GET {endpoint}` | 全レコードの取得 |
| `getById` | GET | `SELECT * FROM {table} WHERE {idColumn} = ?` | `GET {endpoint}/{id}` | 単一レコードの取得 |
| `create` | POST | `INSERT INTO {table} ...` | `POST {endpoint}` | 新規レコードの作成 |
| `update` | PUT | `UPDATE {table} SET ... WHERE {idColumn} = ?` | `PATCH {endpoint}/{id}` | 既存レコードの更新 |
| `delete` | DELETE | `DELETE FROM {table} WHERE {idColumn} = ?` | `DELETE {endpoint}/{id}` | レコードの削除 |

💡 **読み取り専用パターン**: 読み取り専用の統合を作成するには、`operations` 配列に `getAll` と `getById` のみを含めます。scaffold は書き込みハンドラをスキップし、モックサーバーは書き込みリクエストに対して 405 を返します。

## モックサーバー

`dev` コマンドの `--mock-connectors` フラグは、実際の外部接続なしで開発できるモックプロキシサーバーを起動します。

### 動作の仕組み

1. **起動**: モックプロキシがポート 7072 で起動し、BFF はこのプロキシを経由するよう設定される
2. **ルーティング**: Connector モデルへのリクエストはインターセプトされインメモリで処理される。その他のリクエストはポート 7071 の Azure Functions にプロキシされる
3. **データ生成**: 起動時に各 Connector モデルの Zod スキーマを読み取り、フィールド名のヒューリスティクスに基づいてリアルなフェイクデータを生成する（例：`email` フィールドにはメールアドレス風の値、`name` フィールドには名前風の値）
4. **インメモリ CRUD**: 生成されたデータはメモリに保存され、各モデルの `operations` 配列に応じた CRUD 操作をサポートする

### モックデータの生成

モックサーバーは Zod スキーマのフィールド名と型に基づいてリアルなデータを自動生成します：

| フィールドパターン | 生成される値 |
|----------------|------------|
| `email` | メールアドレス（例：`user@example.com`） |
| `name` | 人名またはエンティティ名 |
| `url`, `website` | URL 文字列 |
| `phone` | 電話番号 |
| `id` | UUID 文字列 |
| `createdAt`, `updatedAt` | ISO 8601 タイムスタンプ |
| `z.number()` | 制約内のランダムな数値 |
| `z.boolean()` | ランダムな真偽値 |
| `z.enum([...])` | enum からランダムに選択された値 |

### Dev Seeds との統合

Connector モデルに初期データを提供するには、dev-seeds JSON ファイルを使用します：

```bash
npx swallowkit create-dev-seeds shared/models/user.ts
```

これにより、自動生成データの代わりにモックサーバーが読み込む初期データの JSON シードファイルが作成されます。シードファイルの形式は標準の Cosmos DB モデルと同じです。

### サポートされていないオペレーション

モデルの `operations` 配列に含まれないオペレーションへのリクエストは、モックサーバーから **405 Method Not Allowed** が返されます。

```
# user モデルが ['getAll', 'getById'] のみの場合：
POST /api/users → 405 Method Not Allowed
DELETE /api/users/123 → 405 Method Not Allowed
```

## ベストプラクティス

### Connector を使うべきケース

- ✅ プロジェクトで既存のリレーショナルデータベースからデータが必要な場合
- ✅ サードパーティの SaaS API を SwallowKit アプリに統合したい場合
- ✅ Cosmos DB データと並行して外部データの読み取り専用ビューが必要な場合
- ✅ すべてのデータソースに対して一貫した型安全な UI と BFF レイヤーが必要な場合

### 読み取り専用パターン

変更すべきでない外部データソース（例：共有の社内データベース）には、読み取り専用の Connector を使用します：

```typescript
export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById'] as const,
  table: 'employees',
  idColumn: 'employee_id',
};
```

これにより以下が保証されます：
- GET エンドポイントのみが生成される
- 書き込み関連の UI コンポーネント（作成・編集フォーム）が生成されない
- モックサーバーが書き込みリクエストを 405 で拒否する

### 命名規則

- **Connector 名**（設定内）: 小文字の説明的な名前を使用（例：`mysql`、`backlog`、`salesforce`）
- **モデルファイル**: モデル名に合わせたケバブケースを使用（例：`backlog-issue.ts`）
- **環境変数**: 明確なプレフィックス付きの UPPER_SNAKE_CASE を使用（例：`BACKLOG_API_BASE_URL`、`MYSQL_CONNECTION_STRING`）

### 環境変数の管理

Connector の認証情報はすべて環境変数に格納し、接続文字列や API キーをハードコードしないでください：

```bash
# .env.local（ローカル開発用）
MYSQL_CONNECTION_STRING=mysql://user:pass@localhost:3306/mydb
BACKLOG_API_BASE_URL=https://your-space.backlog.com/api/v2
BACKLOG_API_KEY=your-api-key-here
```

### Cosmos DB モデルと Connector モデルの混在

同じプロジェクト内で標準の Cosmos DB モデルと Connector モデルを自由に混在させることができます。フロントエンドと BFF レイヤーはそれらを同一に扱います — 違いが生じるのは Functions レイヤーのみです。

## 制限事項

Connector 機能の現時点での制限事項は以下のとおりです：

- **キャッシュレイヤーなし**: Connector で生成された Functions にはキャッシュが含まれません。高トラフィックの外部 API 呼び出しには手動でキャッシュを追加してください
- **カスタム認証フローなし**: OAuth 2.0 はクライアントクレデンシャルフローのみをサポートしています。対話型・認可コードフローは未サポートです
- **ページネーションのパススルーなし**: `getAll` オペレーションはページネーションパラメータを外部ソースに渡しません。大規模なデータセットでは手動でページネーションを実装してください
- **JOIN / リレーションなし**: RDB Connector はモデルごとに単一テーブルで動作します。テーブル間クエリにはカスタム実装が必要です
- **スキーママイグレーションなし**: SwallowKit は RDB Connector 向けのデータベーステーブルの作成やマイグレーションは行いません — テーブルは事前に存在している必要があります
- **Webhook / イベントサポートなし**: Connector はリクエスト・レスポンス型のみです。プッシュ型の統合はサポートされていません
- **コネクションプーリング設定なし**: RDB のコネクションプーリングはドライバーのデフォルトに依存します。高度なプール設定は公開されていません

💡 **参考情報**: CLI コマンドの詳細は **[CLI リファレンス](./cli-reference)** を、標準の Cosmos DB モデルの scaffold については **[Scaffold ガイド](./scaffold-guide)** をご参照ください。
