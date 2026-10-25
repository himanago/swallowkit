# ローカル開発

React の `dev` は Vite（3000）、マネージド BFF（7073）、独立 Functions（7071）、
SWA CLI（4280）を起動します。Vite ではなく SWA ポートを開いてください。
`--bff-port` で BFF ポートを変更できます。`--no-functions` でも BFF は起動し、
`--no-swa` は同一オリジンのルーティングと認証エミュレーションを省略します。
設定と前提条件は [React のローカル開発](./react-guide.md#ローカル開発)を参照してください。
以下の Next.js 固有の手順は Next.js 構成が対象です。

pnpm 11/12 と npm の使い分けは[コマンドとトラブルシューティング](./package-managers.md)を参照してください。

このページでは `swallowkit dev` コマンド、ローカルシードデータ管理、バックエンド別のセットアップを説明します。

## 開発サーバーの起動

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm exec swallowkit dev
```
:::

通常は2つのサーバーが起動します：
- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

`auth.provider`が`swa`の場合は、SWA認証エミュレーターも http://localhost:4280 で起動します。認証付き画面には4280番ポートからアクセスしてください。SWA CLIが未導入の場合、`swallowkit dev`はプロジェクトに追加するコマンドを表示して、サーバー起動前に終了します。

### Next.js のスタイル

SwallowKit は Next.js の開発・ビルドに webpack を使います。
現在の `create-next-app` が Tailwind を Turbopack 専用に設定する場合にも対応するため、
新規プロジェクトには `@tailwindcss/postcss` と PostCSS 設定を明示的に追加します。
既存の PostCSS 設定ファイルは保持します。
既存プロジェクトで Tailwind のクラスがあるのにスタイルが反映されない場合は、
`@tailwindcss/postcss` を開発依存に追加し、PostCSS 設定で有効にしてください。
Turbopack 専用の CSS ローダーは webpack では動きません。

### Git worktree を使った並列開発

Git linked worktree 内で `swallowkit dev` を実行すると、その worktree のローカル Cosmos DB データは自動的に分離されます。Cosmos DB Emulator のプロセス自体は全 worktree で共有しますが、linked worktree では正規化した worktree root path の hash（8文字）が database name に付与されます。たとえば `MyAppDatabase` は `MyAppDatabase_a31f92c4` になります。

main worktree では suffix が付かず、従来の database name のままです。seed の置換と `create-dev-seeds --from-emulator` も解決済み database を使用するため、異なる linked worktree で並行動作する Coding Agent が互いの container やデータを削除・置換することはありません。起動ログには実際の database name と worktree isolation の有効状態が表示されます。

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
- インストール済みの `uv` を再利用し、未導入の場合だけ `.uv/bin` に導入（PATH は変更しません）
- インストール済み Python や Windows レジストリを含む通常の uv の探索、`.python-version`、`UV_PYTHON`、利用者の設定を使用。uv 管理版のダウンロード、キャッシュの場所、Python 3.11 を強制しません
- `functions/.venv` を Functions アプリ用に作成
- `functions/.codegen-venv` をスキーマ生成用に作成（`scaffold` が使用）

Python がなければ、uv は利用者の設定に従ってダウンロードできます。新規プロジェクトでは `.python-version` を生成しません。既存の指定は有効なままなので、別の Python を使う場合は明示的に更新してください。既存の仮想環境は再利用し、自動で消去しません。Python を切り替える際は、必要な内容を保全したうえで uv で環境を作り直してください。

Windows の Smart App Control は、未署名の Python や仮想環境の実行ファイルを拒否することがあります。公式 CPython など信頼できる実行ファイルを uv で明示的に選択し、アプリケーション制御を無効にしないでください。実行に失敗した場合はパスを表示し、環境を保持します。

ローカル Python の選択と、生成する Azure ランタイム・CI のバージョン（現在の GA 既定値は Python 3.14）は別です。Python 3.15 は現在 Azure Functions ではプレビューですが、Core Tools 4.14.0 が受け付けるのは現在 Python 3.10〜3.14 です。新しい Python で scaffold が通っても、`dev` には Core Tools が対応する Python を選んでください。Functions の起動が失敗した場合は、起動待ちとして続行せず dev を終了します。

スキーマ生成ツールのインストールでは、ソースからビルドする PyYAML の任意の高速化拡張を既定で無効にし、C コンパイラを不要にしています。`PYYAML_FORCE_LIBYAML` の明示指定は尊重します。

### C#

Azure Functions isolated worker（.NET 10）は `dotnet run` でビルドし、出力先から Core Tools を起動して拡張機能を正しく読み込みます。`--functions-port` の指定もホストに渡します。`swallowkit dev` は応答可能になるまで最大 90 秒待機します。

React/Vite は独立 `functions/`、マネージド `bff/`、`.uv/`、`.swallowkit/`、ビルド済み `shared/dist/` を監視しません。既存プロジェクトを `swallowkit dev` で起動する場合にも適用します。利用者の Vite 設定や追加の除外指定は保持し、フロントエンドと共有モデルのソースは引き続き監視します。

.NET 10 SDK と Azure Functions Core Tools 4.6.0 以上が必要です。

新規 C# プロジェクトは、バイナリ形式のクエリ応答に関する修正を含む Cosmos SDK 3.63.2 を使います。
既存の生成済みプロジェクトで 3.47.0 を使っている場合は、
`functions/*.csproj` の `Microsoft.Azure.Cosmos` 参照を 3.63.2 に更新し、`dotnet restore` を実行してください。
一覧取得や独自パーティションキーでの検索時に発生する `Unknown JsonNodeType: Unknown` 例外への対処です。
Emulator のリセットやデータ削除は不要です。

## Dev seeds

Dev seeds を使うと、サーバー起動前にローカルの Cosmos DB Emulator に既知のデータを投入できます。

### シードテンプレートの作成

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local
```
```bash [pnpm]
pnpm exec swallowkit create-dev-seeds local
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
pnpm exec swallowkit create-dev-seeds local --from-emulator --force
```
:::

現在の Cosmos DB Emulator のコンテナデータをシードファイルにエクスポートします。`_etag` などのシステムプロパティは自動的に除去されます。

### 起動時にシードを適用

::: code-group
```bash [npm]
npx swallowkit dev --seed-env local
```
```bash [pnpm]
pnpm exec swallowkit dev --seed-env local
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
pnpm exec swallowkit dev --mock-connectors
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
