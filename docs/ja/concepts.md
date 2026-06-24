# 基本概念

このページでは、SwallowKit の設計方針と各レイヤーの責任範囲を説明します。

## スキーマが唯一のソース

SwallowKit プロジェクトのすべてのモデルは、`shared/models/` に Zod スキーマとして一度だけ定義されます。この定義から以下が導出されます：

- TypeScript 型（`z.infer<>` 経由）
- フロントエンドのフォームバリデーション
- BFF のリクエスト・レスポンスバリデーション
- バックエンドハンドラーのバリデーション
- Cosmos DB ドキュメントの形状
- OpenAPI 契約（C#/Python バックエンド用）
- UI コンポーネントの生成

スキーマを変更したら `swallowkit scaffold` を再実行して、影響するレイヤーを再生成します。スキーマが権威であり、生成コードはそれに従います。

## BFF パターン

SwallowKit は Next.js API ルートを使って Backend-For-Frontend レイヤーを生成します。BFF はブラウザと Azure Functions の間に位置します：

```
ブラウザー → Next.js BFF ルート → Azure Functions → Cosmos DB
```

BFF レイヤーの役割：
- 共有 Zod スキーマを使ってリクエストをバリデーション
- モデル名から Azure Functions のエンドポイント URL を推論
- HTTP 経由で Azure Functions にリクエストを転送
- 型付きレスポンスをフロントエンドに返却

この分離により、フロントエンドは Azure Functions を直接呼び出しません。バックエンドサービス、認証、クラウドリソースはクライアントコードに影響なく変更できます。

## 生成コードの所有権

SwallowKit が生成するコードは開発者のものです。隠されたランタイムレイヤーはありません。

- 生成ファイルはリポジトリにコミットされる
- どの生成ファイルも自由に編集できる
- `scaffold` を再実行すると、そのモデルの生成ファイルは上書きされる
- ジェネレーターと異なる動作が必要なら、ファイルを直接編集する

SwallowKit はフレームワークではなく scaffolding ツールです。出発点を提供し、そこから先は開発者が引き継ぎます。

## レイヤーの責任分担

| レイヤー | 場所 | 責任 |
|---------|------|------|
| スキーマ | `shared/models/` | 型定義、バリデーションルール |
| フロントエンド | `app/{model}/` | ページ、フォーム、ユーザーインタラクション |
| BFF | `app/api/{model}/` | リクエストバリデーション、Functions プロキシ |
| バックエンド | `functions/` | ビジネスロジック、データアクセス、認可 |
| インフラ | `infra/` | Azure リソース定義（Bicep） |
| メタデータ | `.swallowkit/` | ツール向けプロジェクト manifest |

各レイヤーには明確な境界があります。BFF はビジネスロジックを持ちません。フロントエンドはデータベースにアクセスしません。バックエンドは UI をレンダリングしません。

## プロジェクト manifest

SwallowKit は `.swallowkit/project.json` に機械可読な manifest を保持します。記録される内容：

- バックエンド言語
- 登録されたモデルとスキーマ
- コネクタ
- 認証設定
- 生成済みアーティファクト

manifest は `swallowkit machine` コマンドと MCP サーバーがプロジェクトの検査・検証に使用します。直接編集する必要はありません。

## Human CLI と Machine CLI

SwallowKit は 2 つの CLI インターフェースを提供します：

**Human CLI** — 対話プロンプト、カラー出力、ガイダンスメッセージ：

::: code-group
```bash [npm]
npx swallowkit init my-app
npx swallowkit scaffold todo
npx swallowkit dev
```
```bash [pnpm]
pnpm dlx swallowkit init my-app
pnpm swallowkit scaffold todo
pnpm swallowkit dev
```
:::

**Machine CLI** — 非対話、stdout は JSON のみ、決定的：

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine validate project
npx swallowkit machine generate scaffold todo --api-only
```
```bash [pnpm]
pnpm swallowkit machine inspect project
pnpm swallowkit machine validate project
pnpm swallowkit machine generate scaffold todo --api-only
```
:::

Machine CLI は、コーディングエージェント（GitHub Copilot、Claude Code、OpenAI Codex）および同梱 MCP サーバー（`swallowkit-mcp`）向けに設計されています。Human CLI と同じジェネレーターとバリデーターを構造化された形式で公開します。

## Scaffold とフレームワークの違い

SwallowKit はファイルを生成して終了します。以下のことはしません：

- 実行時にカスタムサーバーを動かす
- 実行時にリクエストをインターセプトする
- Next.js と Azure Functions 以外の特定のランタイム依存を要求する
- 独自の抽象化の背後に実装を隠す

生成された BFF ルートは標準的な Next.js API ルートです。生成された Functions は標準的な Azure Functions です。どの部分も他を壊すことなく置き換えられます。

## 次のステップ

- [はじめる](/ja/getting-started) — 最初のプロジェクトを作成する
- [Scaffold ガイド](/ja/scaffold-guide) — CRUD 生成の詳細
- [AI / MCP ガイド](/ja/ai-mcp-guide) — Machine interface とコーディングエージェント統合
