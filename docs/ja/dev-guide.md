# ローカル開発

このページでは `swallowkit dev` コマンド、ローカルシードデータ管理、バックエンド別のセットアップを説明します。

## 開発サーバーの起動

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm swallowkit dev
```
:::

通常は2つのサーバーが起動します：
- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

`auth.provider`が`swa`の場合は、SWA認証エミュレーターも http://localhost:4280 で起動します。認証付き画面には4280番ポートからアクセスしてください。SWA CLIが未導入の場合、`swallowkit dev`はプロジェクトに追加するコマンドを表示して、サーバー起動前に終了します。

### オプション

| フラグ | 説明 |
|-------|------|
| `-p, --port <port>` | Next.js サーバーポート |
| `-f, --functions-port <port>` | Azure Functions ポート |
| `--host <host>` | サーバーホスト名 |
| `--seed-env <name>` | 起動前にシードデータを適用 |
| `-o, --open` | ブラウザを自動で開く |
| `-v, --verbose` | 詳細ログ出力 |
| `--no-functions` | Azure Functions の起動をスキップ |
| `--mock-connectors` | モックコネクタサーバーを使用 |
| `--swa-port <port>` | SWA認証エミュレーターのポート（既定: `4280`） |
| `--no-swa` | SWA認証エミュレーターを起動しない |

## バックエンド別の動作

### TypeScript

追加セットアップ不要。`func start` ですぐに起動します。

### Python

`swallowkit dev` はローカルの Python 環境管理に **uv** を使います：
- `.uv/bin` にプロジェクトローカルの `uv` バイナリを導入または再利用
- `.uv/python` に uv 管理の Python を保持
- `functions/.venv` を Functions アプリ用に作成
- `functions/.codegen-venv` をスキーマ生成用に作成（`scaffold` が使用）

Python のインストールや virtualenv の手動作成は不要です。

### C#

Azure Functions isolated worker（.NET 10）はホスト応答前にビルドが必要です。`swallowkit dev` は Functions ホストが応答可能になるまで最大 90 秒待機してから URL を表示します。

.NET 10 SDK と Azure Functions Core Tools 4.6.0 以上が必要です。

## Dev seeds

Dev seeds を使うと、サーバー起動前にローカルの Cosmos DB Emulator に既知のデータを投入できます。

### シードテンプレートの作成

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local
```
```bash [pnpm]
pnpm swallowkit create-dev-seeds local
```
:::

`dev-seeds/local/` にモデルごとの JSON ファイルが生成されます：

```
dev-seeds/
  local/
    todo.json
    category.json
```

各ファイルは `shared/models/` のスキーマに対応します。テストデータを記述します：

```json
[
  {
    "id": "seed-todo-001",
    "text": "最初の todo",
    "completed": false,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

各ドキュメントには `id` フィールドが必須です。

### 現在の Emulator データをエクスポート

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local --from-emulator --force
```
```bash [pnpm]
pnpm swallowkit create-dev-seeds local --from-emulator --force
```
:::

現在の Cosmos DB Emulator のコンテナデータをシードファイルにエクスポートします。`_etag` などのシステムプロパティは自動的に除去されます。

### 起動時にシードを適用

::: code-group
```bash [npm]
npx swallowkit dev --seed-env local
```
```bash [pnpm]
pnpm swallowkit dev --seed-env local
```
:::

`dev-seeds/local/` の JSON ドキュメントで、対応するコンテナのデータを置き換えます。対応するファイルがないコンテナはそのまま残ります。

`--seed-env` を省略すると、既存の Emulator データは保持されます。

### ユースケース

- デモや障害再現のために既知の状態を再現する
- 手動テスト中に登録した現実的なデータを保存する
- 検証前に Emulator を一貫した状態にリセットする
- リポジトリ経由でチームメンバーとテストデータを共有する

## モックコネクタ

外部データコネクタ（MySQL、PostgreSQL、REST API）を使うモデルでは、実際の外部サービスなしでローカル開発できます：

::: code-group
```bash [npm]
npx swallowkit dev --mock-connectors
```
```bash [pnpm]
pnpm swallowkit dev --mock-connectors
```
:::

ポート 7072 にモックプロキシサーバーが起動し：
- コネクタモデルのルートへのリクエストをインターセプト
- Zod スキーマから生成されたリアルな偽データを返却
- 標準的な Cosmos DB モデルのリクエストはポート 7071 の実 Functions ランタイムにプロキシ

フロントエンドと BFF レイヤーは、実データかモックデータかに関係なく同一の動作をします。

## 次のステップ

- [Scaffold ガイド](/ja/scaffold-guide) — CRUD 生成とモデル設定
- [Azure へのデプロイ](/ja/deployment-guide) — ローカルからクラウドへ
- [外部コネクタ](/ja/connector-guide) — MySQL、PostgreSQL、REST API への接続
