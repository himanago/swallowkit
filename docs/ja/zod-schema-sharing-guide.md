# Zod スキーマ共有

このコンテンツは再構成されました。以下を参照してください：

- [基本概念](/ja/concepts) — スキーマを中心とした設計、レイヤーの責任分担、BFF パターン
- [はじめる](/ja/getting-started) — スキーマの作成と実践的な利用
- [Scaffold ガイド](/ja/scaffold-guide) — スキーマからのコード生成、ネストスキーマ、複数モデル

## 概要

SwallowKit は `shared/models/` にある単一の Zod スキーマ定義をアプリケーション全体の唯一のソースとして使用します。このスキーマから以下が導出されます：

- `z.infer<>` による TypeScript 型
- フロントエンドのフォームバリデーション
- BFF のリクエスト・レスポンスバリデーション
- バックエンドハンドラーのバリデーション
- Cosmos DB ドキュメント構造
- OpenAPI 契約（C#/Python バックエンド）
- 生成される UI コンポーネント

スキーマはレイヤー間で重複しません。変更時には `swallowkit scaffold` で影響するコードを再生成します。

TypeScript バックエンドでは、Zod スキーマが Azure Functions で直接インポートされます。C#/Python バックエンドでは、`scaffold` が OpenAPI ドキュメントを出力し、`functions/generated/` にネイティブモデルを生成します。
