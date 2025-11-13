# SwallowKit - 新アーキテクチャ設計

## 🎯 アーキテクチャの変更点

### 従来のアプローチ (v0.1)

- 独自の `useServerFn` フックで SSR/CSR を自動判別
- 独自の API を提供
- Next.js の機能を内部で活用

### 新しいアプローチ (v0.2+)

- **Next.js の標準作法をそのまま使用**
- Server Components、Server Actions、React Server Components
- SwallowKit CLI で Azure 向けに自動最適化

## 🚨 解決する問題

### Azure Static Web Apps の 250MB 制限

Next.js アプリを Azure Static Web Apps にデプロイする際、以下の問題があります:

1. **SSR バックエンドのサイズ**: Next.js の SSR 機能を含むと、バンドルサイズが大きくなる
2. **最適化の欠如**: SWA に付属する Azure Functions は最適化されない
3. **デプロイ失敗**: 250MB を超えるとデプロイが失敗する

### SwallowKit の解決策

**個別 Azure Functions への自動分割**

```
Next.js App (1つの大きなバンドル)
        ↓
SwallowKit CLI で分析・分割
        ↓
複数の最適化された Azure Functions
(各関数は独立してデプロイ可能)
```

各 Server Component と Server Action を個別の Azure Function に変換:

- **Tree-Shaking**: 各関数に必要なコードのみを含む
- **独立デプロイ**: 個別に更新・スケール可能
- **サイズ制限回避**: 各関数は小さいため制限に引っかからない

## 🏗️ 新しいアーキテクチャ

### 開発時

標準的な Next.js アプリケーションとして開発:

```typescript
// app/page.tsx - Server Component
export default async function HomePage() {
  const data = await fetchData();
  return <div>{data}</div>;
}

// app/actions.ts - Server Actions
'use server'
export async function createItem(formData: FormData) {
  // ...
}
```

### ビルド時

SwallowKit CLI が自動的に変換:

```bash
npx swallowkit generate
```

生成される構造:

```
azure-functions/
├── page-root/              # ルートページの Server Component
│   ├── function.json
│   └── index.ts
├── page-about/             # /about ページ
│   ├── function.json
│   └── index.ts
├── action-createItem/      # Server Action
│   ├── function.json
│   └── index.ts
└── host.json
```

### デプロイ時

```
┌─────────────────────┐
│ Azure Static Web    │
│ Apps                │
│                     │
│ - Static Assets     │
│ - Client JS/CSS     │
│ - HTML              │
└─────────────────────┘
          │
          │ API 呼び出し
          ↓
┌─────────────────────┐
│ Azure Functions     │
│ (独立デプロイ)      │
│                     │
│ - page-root/        │
│ - page-about/       │
│ - action-createItem/│
└─────────────────────┘
```

## 📋 CLI コマンド

### 1. プロジェクト初期化

```bash
npx swallowkit init my-app
```

生成される構造:

```
my-app/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── actions.ts
├── lib/
│   └── database.ts
├── swallowkit.config.js
├── package.json
└── next.config.js
```

### 2. Azure Functions 生成

```bash
npx swallowkit generate
```

実行内容:
1. Next.js アプリを分析
2. Server Components を検出
3. Server Actions を検出
4. 各コンポーネント/アクションを個別の Azure Function に変換
5. `azure-functions/` ディレクトリに出力

### 3. ビルド

```bash
npx swallowkit build
```

実行内容:
1. Next.js アプリをビルド
2. Azure Functions をビルド
3. デプロイ用にパッケージング

### 4. デプロイ

```bash
npx swallowkit deploy
```

実行内容:
1. Azure Static Web Apps にフロントエンドをデプロイ
2. Azure Functions にバックエンドをデプロイ
3. 環境変数を設定

## 🔧 設定ファイル

### swallowkit.config.js

```javascript
module.exports = {
  // Azure Functions の出力先
  outputDir: './azure-functions',
  
  // 分割戦略
  splitting: {
    // 各 Server Component を個別関数に
    perComponent: true,
    
    // 各 Server Action を個別関数に
    perAction: true,
    
    // 共通コードの抽出
    extractCommon: true,
  },
  
  // Azure 設定
  azure: {
    // Static Web Apps
    swa: {
      name: 'my-app',
      location: 'japaneast',
    },
    
    // Functions
    functions: {
      name: 'my-app-functions',
      runtime: 'node',
      version: '20',
    },
  },
  
  // データベース
  database: {
    type: 'cosmosdb',
    connectionString: process.env.COSMOS_DB_CONNECTION_STRING,
  },
};
```

## 🎨 開発フロー

### 1. ローカル開発

```bash
npm run dev
```

標準的な Next.js 開発サーバーが起動します。

### 2. Azure Functions のテスト

```bash
npx swallowkit dev
```

Azure Functions をローカルで実行し、Next.js アプリと連携します。

### 3. デプロイ前の確認

```bash
npx swallowkit generate --dry-run
```

実際に生成せず、どのような関数が生成されるかプレビューします。

## ✅ メリット

### 1. 開発者体験

- **標準的な Next.js**: 独自 API を学ぶ必要なし
- **公式ドキュメント**: Next.js の公式ドキュメントがそのまま使える
- **エコシステム**: Next.js のツールやライブラリがそのまま使える

### 2. Azure 最適化

- **250MB 制限回避**: 自動的に個別関数に分割
- **独立スケーリング**: 各関数が個別にスケール
- **コールドスタート最適化**: 小さな関数で高速起動

### 3. 保守性

- **ロックインなし**: 標準的な Next.js コード
- **移行容易**: 他のプラットフォームへの移行も可能
- **デバッグ簡単**: 標準的なツールで開発・デバッグ

### 4. パフォーマンス

- **Tree-Shaking**: 必要なコードのみを含む
- **並列実行**: 複数の関数が並列実行可能
- **キャッシュ活用**: Next.js のキャッシュ機能をフル活用

## 🔄 移行ガイド (v0.1 → v0.2)

### useServerFn の廃止

**Before (v0.1)**:
```typescript
import { useServerFn } from 'swallowkit';

const { data, loading } = useServerFn(getTodos, []);
```

**After (v0.2)**:
```typescript
// Server Component
export default async function TodosPage() {
  const todos = await getTodos();
  return <TodoList todos={todos} />;
}
```

### Server Actions の使用

**Before (v0.1)**:
```typescript
import { useMutation } from 'swallowkit';

const mutation = useMutation(addTodo);
await mutation.mutateAsync(text);
```

**After (v0.2)**:
```typescript
// actions.ts
'use server'
export async function addTodoAction(formData: FormData) {
  // ...
}

// Component
<form action={addTodoAction}>
  <input name="text" />
  <button>Add</button>
</form>
```

## 📊 パフォーマンス比較

| 指標 | SWA 標準デプロイ | SwallowKit |
|------|-----------------|------------|
| デプロイサイズ | 250MB+ (失敗) | 50-100MB (成功) |
| 関数サイズ | 1つの大きな関数 | 複数の小さな関数 |
| コールドスタート | 3-5秒 | 0.5-1秒 |
| スケーラビリティ | 制限あり | 高い |
| 更新時の影響範囲 | 全体 | 変更した関数のみ |

## 🚀 ロードマップ

- [x] v0.2.0: Next.js 標準実装への移行
- [ ] v0.3.0: 自動最適化の強化
- [ ] v0.4.0: エッジランタイム対応
- [ ] v0.5.0: Incremental Static Regeneration (ISR) 対応
- [ ] v1.0.0: プロダクション対応

## 📖 参考資料

- [Next.js Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [Azure Static Web Apps](https://docs.microsoft.com/azure/static-web-apps/)
- [Azure Functions](https://docs.microsoft.com/azure/azure-functions/)
