# 基本概念

Next.js と React の両構成に対応します。React は Vite SPA と SWA マネージド Functions BFF を使い、
独立 Functions は SWA にリンクしません。[React の構成と手順](./react-guide.md)も参照してください。
以下の Next.js 固有のパスは既定構成の例です。

このページでは、SwallowKit の設計方針と各レイヤーの責任範囲を説明します。

## スキーマが唯一のソース

SwallowKit プロジェクトのすべてのモデルは、`shared/models/` に Zod スキーマとして一度だけ定義されます。この定義から以下が導出されます：

- TypeScript 型（`z.infer<>` 経由）
- フロントエンドのフォームバリデーション
- BFF のリクエスト・レスポンスバリデーション
- TypeScript／C# バックエンドの検証と、Python 向けの Pydantic 型
- Cosmos DB ドキュメントの形状
- OpenAPI 契約（C#/Python バックエンド用）
- UI コンポーネントの生成

スキーマを変更したら `swallowkit scaffold` を再実行して、影響するレイヤーを再生成します。モデルの定義元を更新し、その内容を生成コードに反映します。

## BFF パターン

BFF（Backend for Frontend）は、ブラウザのリクエストを検証して独立 Azure Functions に転送するサーバー側の処理です。Next.js では API ルート、React では SWA マネージド Functions として生成します。

```
ブラウザー → Next.js API ルート／SWA マネージド BFF → 独立 Azure Functions → Cosmos DB
```

BFF レイヤーの役割：
- 共有 Zod スキーマを使ってリクエストをバリデーション
- モデル名から Azure Functions のエンドポイント URL を推論
- HTTP 経由で Azure Functions にリクエストを転送
- 型付きレスポンスをフロントエンドに返却

この分離により、フロントエンドは Azure Functions を直接呼び出しません。バックエンドサービス、認証、クラウドリソースはクライアントコードに影響なく変更できます。

## 生成コードの所有権

SwallowKit が生成するコードは開発者のものです。隠されたランタイムレイヤーはありません。

生成コードはリポジトリにコミットし、内容を確認・変更できます。ただし、再生成時の扱いはファイルの所有権によって異なります。
業務上の変更は、まずモデルや設定、追記用のファイルで表現してください。管理対象の生成ファイルを直接編集した場合は、plan/apply で上書き前に競合を確認します。

### 所有権の分類

生成物は `.swallowkit/artifacts.json`（生成物台帳、Git 管理対象）に所有権付きで記録されます。

| 所有権 | 意味 | 再生成時の扱い |
| --- | --- | --- |
| `managed` | SwallowKit が全体を管理（Functions CRUD、BFF ルート、UI ページなど） | 上書き再生成される。生成後に手編集したファイルは競合として検出され、上書きには承認（`--approve`）が必要 |
| `generated-once` | 初回のみ生成されるテンプレート | 再生成で上書きされない |
| `user-owned` | 開発者が所有（モデルファイルなど） | SwallowKit は作成のみ。以後の編集は開発者に委ねられる |
| `extension-point` | 追記ポイント（`shared/index.ts`、Python の `function_app.py`、ナビゲーション設定など） | パスごとの規則に従う。`shared/index.ts` は手動追記可・マーカーなし。Python の登録はマーカーを使用。既存内容は保持される |
| `metadata` | ツール向けメタデータ（`.swallowkit/` 配下） | SwallowKit が全体を再構築する |

`managed` なファイルを編集すること自体は可能ですが、再生成すると失われるため、恒久的な変更はモデル・設定・拡張用のファイルで行うことを推奨します。編集した場合も、`swallowkit status` / `swallowkit machine inspect drift` が乖離を検出し、plan / apply フローが上書き前に承認を求めます。

## レイヤーの責任分担

| レイヤー | 場所 | 責任 |
|---------|------|------|
| スキーマ | `shared/models/` | 型定義、バリデーションルール |
| フロントエンド | `app/{model}/` または `src/pages/{model}/` | ページ、フォーム、ユーザーインタラクション |
| BFF | `app/api/{model}/` または `bff/` | リクエストバリデーション、Functions プロキシ |
| バックエンド | `functions/` | ビジネスロジック、データアクセス、認可 |
| インフラ | `infra/` | Azure リソース定義（Bicep） |
| メタデータ | `.swallowkit/` | ツール向けプロジェクト情報ファイル |

各レイヤーには明確な境界があります。BFF はビジネスロジックを持ちません。フロントエンドはデータベースにアクセスしません。バックエンドは UI をレンダリングしません。

## プロジェクト情報ファイル

SwallowKit は `.swallowkit/project.json` に機械可読なプロジェクト情報を保持します。次の内容を記録します。

- バックエンド言語
- 登録されたモデルとスキーマ
- コネクタ
- 認証設定
- 生成済みアーティファクト

プロジェクト情報ファイルは `swallowkit machine` コマンドと MCP サーバーがプロジェクトの検査・検証に使用します。直接編集する必要はありません。

## Human CLI と Machine CLI

SwallowKit は 2 つの CLI インターフェースを提供します。

**人間向け CLI（Human CLI）** は、対話プロンプト、カラー出力、ガイダンスメッセージを提供します。

::: code-group
```bash [npm]
npx swallowkit@beta init my-app
npx swallowkit scaffold todo
npx swallowkit dev
```
```bash [pnpm]
pnpm dlx swallowkit@beta init my-app
pnpm exec swallowkit scaffold todo
pnpm exec swallowkit dev
```
:::

**エージェント向け CLI（Machine CLI）** は非対話で実行し、結果を標準出力に JSON で返します。

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine validate project
npx swallowkit machine generate scaffold todo --api-only
```
```bash [pnpm]
pnpm exec swallowkit machine inspect project
pnpm exec swallowkit machine validate project
pnpm exec swallowkit machine generate scaffold todo --api-only
```
:::

Machine CLI は、コーディングエージェント（GitHub Copilot、Claude Code、OpenAI Codex）および同梱 MCP サーバー（`swallowkit-mcp`）向けに設計されています。Human CLI と同じジェネレーターとバリデーターを構造化された形式で公開します。

## Scaffold とフレームワークの違い

SwallowKit はファイルを生成して終了します。以下のことはしません：

- 実行時にカスタムサーバーを動かす
- 実行時にリクエストをインターセプトする
- 生成アプリのリクエスト処理を SwallowKit 独自のサーバーに置き換える
- 独自の抽象化の背後に実装を隠す

生成される BFF は標準的な Next.js API ルート、または SWA マネージド Functions です。独立バックエンドも標準的な Azure Functions として動作します。実装を置き換える際は、共有スキーマと通信・認可の契約を維持してください。

## 次のステップ

- [はじめる](/ja/getting-started)。最初のプロジェクトを作成する
- [Scaffold ガイド](/ja/scaffold-guide)。CRUD 生成の詳細
- [AI / MCP ガイド](/ja/ai-mcp-guide)。Machine インターフェースとコーディングエージェント統合
