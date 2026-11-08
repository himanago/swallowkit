---
layout: home

hero:
  name: "SwallowKit"
  text: "Zod スキーマからアプリを生成"
  tagline: "共有 Zod スキーマを中心に、Next.js / React フロントエンド・BFF・Azure Functions バックエンド・インフラ構成の整合性を保ちます。"
  image:
    src: /logo.png
    alt: SwallowKit
  actions:
    - theme: brand
      text: はじめる
      link: /ja/getting-started
    - theme: alt
      text: 基本概念
      link: /ja/concepts
    - theme: alt
      text: GitHub
      link: https://github.com/himanago/swallowkit

features:
  - title: 共有スキーマと契約の一元化
    details: モデルを Zod スキーマで定義し、その内容から型、画面、API、入力検証を生成します。モデルの変更後は再生成し、検証コマンドで定義と生成物のずれを確認できます。
  - title: 画面と CRUD API の生成
    details: "1 つのスキーマから Azure Functions、Next.js API Routes または SWA マネージド Functions BFF、React UI を生成します。init で Next.js / React + Vite SPA を選べます。"
  - title: Azure インフラとデプロイ
    details: Bicep テンプレート、CI/CD ワークフロー（GitHub Actions または Azure Pipelines）、Azure リソースのプロビジョニングがアプリケーションコードと一緒に生成されます。Static Web Apps、Functions、Cosmos DB は Managed Identity で構成されます。
  - title: AI エージェント対応の構造
    details: "生成される指示ファイル（<code>AGENTS.md</code>、<code>CLAUDE.md</code>、<code>.github/copilot-instructions.md</code>）と <code>swallowkit machine</code> CLI により、コーディングエージェントがプロジェクトの検査・生成・検証を明示的な境界の中で行えます。"
---

<div class="vp-doc" style="max-width: 960px; margin: 0 auto; padding: 48px 24px;">

## なぜ SwallowKit か

フルスタックアプリケーションでは、同じドメインモデルがフロントエンドフォーム、クライアントバリデーション、BFF 型、バックエンド DTO、API 契約、データベースエンティティ、インフラ構成にわたって繰り返されます。プロジェクトが大きくなるほど、これらの定義はずれていきます。

AI はコードをすばやく生成できますが、レイヤー間の整合性を自動で維持してはくれません。フレームワークは複雑さを隠せますが、本番アプリケーションには開発者が読み変更できる明示的なアーキテクチャが必要です。

SwallowKit は共有 Zod スキーマを中心に置き、その周辺のアプリケーション構造を生成することでこの問題に対処します。アプリケーションのひな形を生成するツールです。生成されたコードは読み、編集し、置き換えられます。

## 次のステップ

- [はじめる](/ja/getting-started)。プロジェクトを作成し、最初の CRUD フローを生成する
- [基本概念](/ja/concepts)。スキーマ中心のアーキテクチャを理解する
- [Scaffold ガイド](/ja/scaffold-guide)。CRUD 生成の詳細
- [Azure へのデプロイ](/ja/deployment-guide)。Bicep でプロビジョニングとデプロイ
- [AI / MCP ガイド](/ja/ai-mcp-guide)。コーディングエージェント向けの機械可読インターフェース

</div>
