# SwallowKit (暫定版)

Azure Static Web Apps + Cosmos DB 専用フレームワーク

> **注意**: これは暫定版のドキュメントです。API や機能は今後変更される可能性があります。

## 🚀 特徴

- **Cosmos DB 標準搭載**: Cosmos DB をデフォルトデータベースとして採用
- **React Hooks ベース**: `useServerFn` / `callServerFn` でサーバー関数を簡単に呼び出し
- **型安全**: TypeScript による完全な型安全性
- **自動セットアップ**: 開発環境起動時に Cosmos DB を自動セットアップ
- **Azure 最適化**: Azure Static Web Apps + Azure Functions v4 に最適化
- **開発者体験**: シンプルなコマンドで開発開始

## 📋 前提条件

- Node.js 22.x
- Azure Cosmos DB Emulator (ローカル開発用)
  - Windows: [公式サイト](https://aka.ms/cosmosdb-emulator)からインストール
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 📦 インストール

```bash
npm install swallowkit
```

## 🛠️ クイックスタート

### 1. プロジェクトの初期化

```bash
npx swallowkit init my-todo-app
cd my-todo-app
npm install
```

これにより以下が生成されます:
- `src/` - React アプリケーション (Vite + React + TypeScript)
- `src/serverFns.ts` - サーバー関数の型定義 (クライアント側スタブ)
- `swallowkit.config.json` - SwallowKit 設定ファイル

### 2. Cosmos DB Emulator の起動

```bash
# Windowsの場合: スタートメニューから起動
# Dockerの場合:
docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator
```

### 3. 開発環境の起動

```bash
npx swallowkit dev
```

このコマンドは:
1. Cosmos DB Emulator の起動確認
2. Cosmos DB のデータベース・コンテナの自動作成 (冪等性あり)
3. Azure Functions API の自動ビルド
4. Vite 開発サーバーの起動
5. SWA CLI による統合環境の起動

開発サーバーが起動したら、`http://localhost:4280` でアプリにアクセスできます。

## 📝 サーバー関数の実装

### クライアント側の型定義 (`src/serverFns.ts`)

```typescript
// クライアント側のスタブ - ブラウザでは実行されない
interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export async function getTodos(): Promise<Todo[]> {
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function addTodo({ text }: { text: string }): Promise<Todo> {
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function deleteTodo({ id }: { id: string }): Promise<{ success: boolean }> {
  throw new Error("This is a server function and should be called via useServerFn");
}

export async function toggleTodo({ id }: { id: string }): Promise<Todo | null> {
  throw new Error("This is a server function and should be called via useServerFn");
}
```

### API の生成

```bash
npx swallowkit generate
```

これにより `api/` ディレクトリに以下が生成されます:
- `api/src/shared/server-functions.ts` - Cosmos DB を使った実装
- `api/src/functions/rpc.ts` - RPC エンドポイント (`/api/_swallowkit`)
- Azure Functions v4 の設定ファイル

**重要**: `server-functions.ts` は自動生成されますが、**ビジネスロジックを実装するファイル**です。
初回生成後はテンプレートをカスタマイズして使用してください。

### サーバー側の実装例 (`api/src/shared/server-functions.ts`)

```typescript
import { CosmosClient } from '@azure/cosmos';

// Cosmos DB クライアントの初期化
const endpoint = process.env.COSMOS_ENDPOINT || 'http://localhost:8081';
const key = process.env.COSMOS_KEY || 'C2y6yDjf5/R+...'; // Emulator key
const client = new CosmosClient({ endpoint, key });

const database = client.database('swallowkit-db');
const container = database.container('todos');

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export async function getTodos(): Promise<Todo[]> {
  const { resources } = await container.items.query('SELECT * FROM c').fetchAll();
  return resources as Todo[];
}

export async function addTodo({ text }: { text: string }): Promise<Todo> {
  const newTodo: Todo = {
    id: Date.now().toString(),
    text,
    completed: false,
  };
  const { resource } = await container.items.create(newTodo);
  return resource as Todo;
}

export async function deleteTodo({ id }: { id: string }): Promise<{ success: boolean }> {
  await container.item(id, id).delete();
  return { success: true };
}

export async function toggleTodo({ id }: { id: string }): Promise<Todo | null> {
  const { resource: todo } = await container.item(id, id).read<Todo>();
  if (todo) {
    todo.completed = !todo.completed;
    const { resource } = await container.item(id, id).replace(todo);
    return resource as Todo;
  }
  return null;
}
```

## 🎯 React での使用

### クエリ用: `useServerFn`

データ取得など、状態管理が必要な操作に使用:

```tsx
import { useServerFn } from "swallowkit";
import { getTodos } from "./serverFns";

function TodoList() {
  const { data: todos, loading, error, refetch } = useServerFn(getTodos, []);

  if (loading) return <div>読み込み中...</div>;
  if (error) return <div>エラー: {error.message}</div>;

  return (
    <div>
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
      <button onClick={refetch}>再読み込み</button>
    </div>
  );
}
```

### ミューテーション用: `callServerFn`

追加・更新・削除など、状態管理が不要な操作に使用:

```tsx
import { useServerFn, callServerFn } from "swallowkit";
import { getTodos, addTodo, deleteTodo, toggleTodo } from "./serverFns";

function TodoApp() {
  const [newTodoText, setNewTodoText] = useState("");
  const { data: todos, loading, error, refetch } = useServerFn(getTodos, []);

  const handleAddTodo = async () => {
    if (!newTodoText.trim()) return;
    
    await callServerFn(addTodo, { text: newTodoText });
    setNewTodoText("");
    refetch(); // クエリを再実行して最新データを取得
  };

  const handleToggleTodo = async (id: string) => {
    await callServerFn(toggleTodo, { id });
    refetch();
  };

  const handleDeleteTodo = async (id: string) => {
    await callServerFn(deleteTodo, { id });
    refetch();
  };

  // ... レンダリング
}
```

## 📚 API リファレンス

### `useServerFn<TResult>(serverFn, args, options?)`

**パラメータ:**
- `serverFn`: サーバー関数
- `args`: 関数の引数の配列
- `options?`: オプション設定

**戻り値:**
```typescript
{
  data: TResult | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
```

**使用例:**
```typescript
const { data, loading, error, refetch } = useServerFn(getTodos, []);
```

### `callServerFn<TArgs, TResult>(serverFn, ...args)`

**パラメータ:**
- `serverFn`: サーバー関数
- `...args`: 関数の引数

**戻り値:**
- `Promise<TResult>`: サーバー関数の実行結果

**使用例:**
```typescript
const result = await callServerFn(addTodo, { text: "新しいTodo" });
```

## 🔧 CLI コマンド

### `swallowkit init <project-name>`

新しい SwallowKit プロジェクトを作成します。

```bash
npx swallowkit init my-app
```

### `swallowkit dev`

統合開発環境を起動します:
- Cosmos DB の自動セットアップ
- Azure Functions の自動ビルド
- Vite + SWA CLI の統合サーバー起動

```bash
npx swallowkit dev
```

**オプション:**
- `--port <port>`: SWA CLI のポート (デフォルト: 4280)
- `--api-port <port>`: Azure Functions のポート (デフォルト: 7071)
- `--host <host>`: ホスト名 (デフォルト: localhost)
- `--open`: ブラウザを自動で開く

### `swallowkit generate`

`src/serverFns.ts` から Azure Functions API を生成します。

```bash
npx swallowkit generate
```

**オプション:**
- `--output <dir>`: 出力ディレクトリ (デフォルト: ./api)
- `--force`: 既存ファイルを上書き

### `swallowkit setup`

開発環境の依存関係をチェックします:
- Azure CLI
- Azure Static Web Apps CLI
- Cosmos DB Emulator

```bash
npx swallowkit setup
```

## 🔧 設定ファイル

## 🔧 設定ファイル

### `swallowkit.config.json`

```json
{
  "database": {
    "type": "cosmos",
    "endpoint": "http://localhost:8081",
    "key": "C2y6yDjf5/R+...",
    "databaseName": "swallowkit-db"
  },
  "api": {
    "endpoint": "/api/_swallowkit"
  },
  "functions": {
    "outputDir": "api"
  }
}
```

**プロパティ:**
- `database.type`: データベースタイプ (現在は `"cosmos"` のみ)
- `database.endpoint`: Cosmos DB エンドポイント
- `database.key`: Cosmos DB アクセスキー
- `database.databaseName`: データベース名
- `api.endpoint`: RPC エンドポイントのパス
- `functions.outputDir`: Azure Functions の出力ディレクトリ

### 環境変数 (`api/local.settings.json`)

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "FUNCTIONS_WORKER_RUNTIME_VERSION": "~22",
    "AzureWebJobsStorage": "",
    "COSMOS_ENDPOINT": "http://localhost:8081",
    "COSMOS_KEY": "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
  },
  "Host": {
    "CORS": "*",
    "LocalHttpPort": 7071
  }
}
```

## 🏗️ アーキテクチャ

### クライアント・サーバー分離

```
┌─────────────────────────────────────────────────────────────┐
│ クライアント (Browser)                                        │
│                                                              │
│  src/App.tsx                                                 │
│    ↓ import                                                  │
│  src/serverFns.ts (型定義スタブ)                              │
│    ↓ useServerFn / callServerFn                             │
│  swallowkit (hooks/useServerFn.ts)                          │
│    ↓ POST /api/_swallowkit                                  │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP Request
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ サーバー (Azure Functions v4)                                │
│                                                              │
│  api/src/functions/rpc.ts                                   │
│    ↓ import                                                  │
│  api/src/shared/server-functions.ts (Cosmos DB実装)         │
│    ↓ @azure/cosmos                                          │
│  Cosmos DB                                                   │
└─────────────────────────────────────────────────────────────┘
```

### データフロー

1. **クエリ (useServerFn)**
   - コンポーネントマウント時に自動実行
   - ローディング状態を管理
   - データをキャッシュ
   - `refetch()` で再実行可能

2. **ミューテーション (callServerFn)**
   - イベントハンドラから明示的に呼び出し
   - 状態管理なし
   - 完了後に `refetch()` を呼び出してクエリを更新

### Cosmos DB 自動セットアップ

`swallowkit dev` コマンド実行時:

```typescript
// dev コマンドの処理フロー
1. Cosmos DB Emulator の起動確認
2. CosmosClient で接続
3. database.createIfNotExists('swallowkit-db')
4. container.createIfNotExists('todos', {
     partitionKey: {
       paths: ['/id'],
       kind: PartitionKeyKind.Hash
     }
   })
5. Azure Functions API のビルド
6. Vite + SWA CLI の起動
```

## 📁 プロジェクト構造

```
my-app/
├── src/
│   ├── App.tsx                    # React アプリケーション
│   ├── serverFns.ts               # サーバー関数の型定義 (クライアント側)
│   ├── index.tsx                  # エントリーポイント
│   └── index.css                  # スタイル
├── api/                           # Azure Functions (自動生成)
│   ├── src/
│   │   ├── functions/
│   │   │   ├── rpc.ts            # RPC エンドポイント
│   │   │   └── crud.ts           # CRUD エンドポイント (未使用)
│   │   └── shared/
│   │       └── server-functions.ts # サーバー側実装 (Cosmos DB)
│   ├── host.json
│   ├── local.settings.json
│   ├── tsconfig.json
│   └── package.json
├── swallowkit.config.json        # SwallowKit 設定
├── staticwebapp.config.json      # Azure SWA 設定
├── package.json
└── vite.config.ts
```

## 🚨 重要な注意事項

### 1. サーバー関数の戻り値

**❌ NG: `Promise<void>`**
```typescript
export async function deleteTodo({ id }: { id: string }): Promise<void> {
  await container.item(id, id).delete();
  // JSON レスポンスがないため RPC 呼び出しが失敗
}
```

**✅ OK: 必ず値を返す**
```typescript
export async function deleteTodo({ id }: { id: string }): Promise<{ success: boolean }> {
  await container.item(id, id).delete();
  return { success: true }; // JSON レスポンスを返す
}
```

### 2. パーティションキーの指定

Cosmos DB Emulator では `kind: PartitionKeyKind.Hash` の明示が必須:

```typescript
await database.containers.createIfNotExists({
  id: 'todos',
  partitionKey: {
    paths: ['/id'],
    kind: PartitionKeyKind.Hash // 必須！
  }
});
```

### 3. クライアント・サーバーの分離

- `src/serverFns.ts` - **クライアント側の型定義のみ** (throw Error)
- `api/src/shared/server-functions.ts` - **サーバー側の実装** (Cosmos DB アクセス)

この2つは **別ファイル** です。混同しないでください。

### 4. generateコマンドの動作

`swallowkit generate` は:
- `src/serverFns.ts` がクライアントスタブ (throw Error を含む) の場合
  → デフォルトの Cosmos DB テンプレートを使用
- `src/serverFns.ts` が既に実装を含む場合
  → その実装を `api/src/shared/server-functions.ts` にコピー

## 🐛 トラブルシューティング

### Cosmos DB Emulator が起動しない

**Windows:**
```bash
# スタートメニューから "Azure Cosmos DB Emulator" を起動
# または、サービスから起動
```

**Docker:**
```bash
docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator
```

### パーティションキーエラー

`PartitionKeyKind.Hash` を指定してください:

```typescript
import { CosmosClient, PartitionKeyKind } from '@azure/cosmos';

await database.containers.createIfNotExists({
  id: 'your-container',
  partitionKey: {
    paths: ['/id'],
    kind: PartitionKeyKind.Hash
  }
});
```

### API が古い実装のまま

`generate --force` で強制的に再生成:

```bash
npx swallowkit generate --force
cd api
npm run build
```

## 🎯 今後の予定 (TODO)

- [ ] Zod スキーマ統合
- [ ] 認証・認可機能
- [ ] ファイルアップロード機能
- [ ] リアルタイム通信 (SignalR)
- [ ] デプロイコマンド (`swallowkit deploy`)
- [ ] テストユーティリティ
- [ ] 本番環境用の設定管理

## 🤝 コントリビューション

このプロジェクトは開発中です。フィードバックや提案を歓迎します！

## 📄 ライセンス

MIT

## 🔗 関連リンク

- [Azure Static Web Apps](https://azure.microsoft.com/ja-jp/services/app-service/static/)
- [Azure Functions](https://azure.microsoft.com/ja-jp/services/functions/)
- [Azure Cosmos DB](https://azure.microsoft.com/ja-jp/services/cosmos-db/)
- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)

