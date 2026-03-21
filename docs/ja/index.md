---
layout: home

hero:
  name: "SwallowKit"
  text: "型安全 Azure 開発ツールキット"
  tagline: Azure 上の Next.js アプリのためのスキーマ駆動フルスタック開発。Zod スキーマ共有でエンドツーエンド型安全を実現。
  image:
    src: /logo.png
    alt: SwallowKit
  actions:
    - theme: brand
      text: はじめる
      link: /ja/scaffold-guide
    - theme: alt
      text: CLI リファレンス
      link: /ja/cli-reference
    - theme: alt
      text: GitHub で見る
      link: https://github.com/himanago/swallowkit

features:
  - icon: 🔄
    title: Zod スキーマ共有
    details: スキーマを一度定義するだけで、フロントエンド・BFF・Azure Functions・Cosmos DB の全レイヤーで共有。重複なし、ずれなし。
  - icon: ⚡
    title: CRUD コード自動生成
    details: <code>swallowkit scaffold</code> を実行するだけで、Zod スキーマから Azure Functions・Next.js BFF ルート・React UI コンポーネントを自動生成。
  - icon: 🌐
    title: バックエンド多言語対応
    details: Azure Functions バックエンドは TypeScript・C#・Python から選択可能。同じスキーマ共有ワークフローをそのまま保てます。
  - icon: 🛡️
    title: 完全な型安全性
    details: React クライアントから Cosmos DB ドキュメントまで、エンドツーエンドで TypeScript。型は常にスキーマから推論され、手書き不要。
  - icon: 🎯
    title: BFF パターン
    details: Next.js API Routes が型付き BFF プロキシレイヤーとして機能。自動 Zod バリデーションと Azure Functions リソース名推論を内蔵。
  - icon: ☁️
    title: Azure 最適化
    details: Azure Static Web Apps・Azure Functions・Azure Cosmos DB を使ったコスト最小構成。マネージド ID でセキュアな接続。
  - icon: 🚀
    title: ゼロ設定デプロイ
    details: Bicep IaC で Azure リソースをプロビジョニングし、GitHub Actions または Azure Pipelines の CI/CD ワークフローを自動生成。
  - icon: 🤖
    title: AI フレンドリー
    details: 自動生成される指示ファイル（<code>AGENTS.md</code>、<code>CLAUDE.md</code>、<code>.github/copilot-instructions.md</code>）とレイヤー別ルールにより、GitHub Copilot・Claude Code・OpenAI Codex がプロジェクトのアーキテクチャと規約に従ってコードを生成・修正。
---

<div class="vp-doc" style="max-width: 960px; margin: 0 auto; padding: 48px 24px;">

## クイックスタート

```bash
npx swallowkit init my-app
cd my-app
```

### はじめてのモデルを作成

```bash
npx swallowkit create-model todo
```

```typescript
// shared/models/todo.ts
import { z } from 'zod';

export const todo = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todo>;
```

### CRUD を自動生成

```bash
npx swallowkit scaffold shared/models/todo.ts
```

Azure Functions・BFF API ルート・React コンポーネントが完全型付きで生成されます。

### 開発サーバーを起動

```bash
npx swallowkit dev
# Next.js → http://localhost:3000
# Azure Functions → http://localhost:7071
```

</div>
