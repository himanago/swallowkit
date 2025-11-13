# Azure 最適化ガイド - SwallowKit

## 🎯 概要

このガイドでは、SwallowKit を使用して Next.js アプリを Azure に最適化してデプロイする方法を説明します。

## 🚨 Azure Static Web Apps の課題

### 250MB デプロイサイズ制限

Azure Static Web Apps には、デプロイパッケージのサイズが **250MB** までという制限があります。

**問題点:**

1. **Next.js の SSR バンドル**: Server Components や Server Actions を含む Next.js アプリは大きくなりがち
2. **最適化の欠如**: SWA に付属する Azure Functions は自動的に最適化されない
3. **依存関係の肥大化**: `node_modules` が含まれると簡単に制限を超える
4. **デプロイ失敗**: 250MB を超えるとデプロイが失敗し、アプリが公開できない

### 実際の例

```
典型的な Next.js アプリのサイズ:
├── .next/                  150MB
├── node_modules/          180MB
├── api/ (Functions)        50MB
└── その他                   20MB
─────────────────────────────
合計:                      400MB ❌ (制限超過)
```

## ✅ SwallowKit による解決策

### 個別関数への自動分割

SwallowKit は、Next.js アプリを分析し、各 Server Component と Server Action を **個別の最適化された Azure Function** に自動変換します。

```
┌─────────────────────────┐
│ Next.js アプリ          │
│ (1つの大きなバンドル)   │
└─────────────────────────┘
            ↓
    swallowkit generate
            ↓
┌─────────────────────────┐
│ 複数の小さな関数        │
│ ├── page-root/     5MB  │
│ ├── page-about/    3MB  │
│ ├── page-todos/    7MB  │
│ └── action-add/    2MB  │
└─────────────────────────┘
合計: 17MB ✅ (制限内)
```

### メリット

1. **サイズ制限回避**: 各関数は小さく、250MB 制限に引っかからない
2. **Tree-Shaking**: 各関数に必要なコードのみを含む
3. **独立デプロイ**: 変更した関数のみを更新可能
4. **個別スケーリング**: 負荷に応じて各関数を独立してスケール

## 🛠️ 使用方法

### 1. プロジェクトのセットアップ

```bash
# 新規プロジェクト
npx swallowkit init my-app
cd my-app

# または既存プロジェクトに追加
npm install swallowkit
```

### 2. 標準的な Next.js コードを書く

```typescript
// app/page.tsx - Server Component
export default async function HomePage() {
  const data = await fetchData();
  return <div>{data}</div>;
}

// app/actions.ts - Server Actions
'use server'

export async function createItem(formData: FormData) {
  const name = formData.get('name') as string;
  await db.items.create({ name });
  revalidatePath('/');
}
```

### 3. Azure Functions を生成

```bash
npx swallowkit generate
```

**出力:**

```
✓ Next.js アプリを分析しました
✓ 3つの Server Components を検出しました
✓ 2つの Server Actions を検出しました
✓ 5つの Azure Functions を生成しました

生成されたファイル:
  azure-functions/
  ├── page-root/
  │   ├── function.json (設定)
  │   └── index.ts (最適化済み)
  ├── page-about/
  │   ├── function.json
  │   └── index.ts
  ├── page-todos/
  │   ├── function.json
  │   └── index.ts
  ├── action-createItem/
  │   ├── function.json
  │   └── index.ts
  └── host.json

合計サイズ: 18MB
```

### 4. デプロイ前の確認

```bash
# サイズを確認
npx swallowkit analyze

# 出力例:
# ✓ Static assets: 12MB
# ✓ Azure Functions: 18MB
# ✓ Total: 30MB (250MB 制限内)
```

### 5. Azure へデプロイ

```bash
# Azure にログイン
az login

# デプロイ
npx swallowkit deploy \
  --swa-name my-app \
  --functions-name my-app-functions \
  --resource-group my-resource-group
```

## 🔧 最適化オプション

### swallowkit.config.js

```javascript
module.exports = {
  // 出力ディレクトリ
  outputDir: './azure-functions',
  
  // 分割戦略
  splitting: {
    // 各 Server Component を個別関数に
    perComponent: true,
    
    // 各 Server Action を個別関数に
    perAction: true,
    
    // 共通コードを抽出して共有ライブラリに
    extractCommon: true,
    
    // 最小関数サイズ (これ以下は統合)
    minFunctionSize: '1MB',
  },
  
  // ビルド最適化
  optimization: {
    // Tree-Shaking を有効化
    treeShaking: true,
    
    // 未使用の依存関係を削除
    removeUnusedDeps: true,
    
    // コードを圧縮
    minify: true,
    
    // ソースマップを生成しない (本番環境)
    sourceMaps: false,
  },
  
  // Azure Functions 設定
  functions: {
    // ランタイムバージョン
    runtime: 'node',
    version: '20',
    
    // メモリ制限
    memorySize: 512,
    
    // タイムアウト
    timeout: 300,
  },
};
```

## 📊 サイズ削減テクニック

### 1. 依存関係の最適化

**Before:**
```json
{
  "dependencies": {
    "lodash": "^4.17.21",  // 500KB
    "moment": "^2.29.4"     // 300KB
  }
}
```

**After:**
```json
{
  "dependencies": {
    "lodash-es": "^4.17.21",  // Tree-Shakable
    "date-fns": "^2.30.0"      // 軽量
  }
}
```

### 2. Dynamic Import

```typescript
// ❌ 全体をインポート
import { Chart } from 'chart.js';

// ✅ 動的インポート
const Chart = dynamic(() => import('chart.js'), {
  ssr: false,
  loading: () => <div>Loading...</div>
});
```

### 3. 画像最適化

```typescript
// next.config.js
module.exports = {
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
};
```

## 🏗️ デプロイアーキテクチャ

### 構成

```
┌──────────────────────────────────┐
│ ユーザー                          │
└──────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────┐
│ Azure Static Web Apps            │
│ - 静的アセット (HTML/CSS/JS)     │
│ - クライアントサイドルーティング │
└──────────────────────────────────┘
              │
              │ API コール
              ↓
┌──────────────────────────────────┐
│ Azure Functions (独立デプロイ)   │
│ ├── page-root/                   │
│ ├── page-about/                  │
│ ├── page-todos/                  │
│ └── action-createItem/           │
└──────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────┐
│ Azure Cosmos DB                  │
└──────────────────────────────────┘
```

### 通信フロー

1. **初回アクセス**: SWA から静的 HTML を配信
2. **クライアント読み込み**: JavaScript バンドルを読み込み
3. **データ取得**: Azure Functions を呼び出してデータ取得
4. **レンダリング**: クライアントで React コンポーネントをレンダリング
5. **アクション実行**: フォーム送信時に Server Action (Azure Function) を呼び出し

## 📈 パフォーマンス比較

| 指標 | 標準 SWA デプロイ | SwallowKit |
|------|------------------|------------|
| **デプロイサイズ** | 250MB+ (失敗) | 30-80MB (成功) |
| **ビルド時間** | 5-10分 | 3-5分 |
| **デプロイ時間** | 失敗 | 2-3分 |
| **コールドスタート** | 3-5秒 | 0.5-1秒 |
| **関数起動時間** | 500-1000ms | 100-300ms |
| **月額コスト** | - | $5-20 |

## 🔍 トラブルシューティング

### デプロイサイズが大きい

```bash
# サイズ分析
npx swallowkit analyze --verbose

# 大きなファイルを特定
npx swallowkit analyze --top 10

# 不要なファイルを除外
# .swallowkitignore
node_modules/
*.test.ts
*.spec.ts
.git/
```

### 関数が多すぎる

```javascript
// swallowkit.config.js
module.exports = {
  splitting: {
    // 小さな関数を統合
    minFunctionSize: '5MB',
    
    // 関数数の上限
    maxFunctions: 50,
  },
};
```

### ビルドエラー

```bash
# 詳細ログを有効化
npx swallowkit generate --verbose

# キャッシュをクリア
npx swallowkit clean
npx swallowkit generate
```

## ✅ ベストプラクティス

### 1. 定期的なサイズチェック

```json
// package.json
{
  "scripts": {
    "analyze": "swallowkit analyze",
    "prebuild": "npm run analyze"
  }
}
```

### 2. CI/CD での自動チェック

```yaml
# .github/workflows/deploy.yml
- name: Check deployment size
  run: |
    npx swallowkit analyze
    if [ $(swallowkit analyze --json | jq '.total') -gt 200000000 ]; then
      echo "Deployment size exceeds 200MB"
      exit 1
    fi
```

### 3. 段階的なデプロイ

```bash
# ステージング環境
npx swallowkit deploy --env staging

# 検証後、本番環境
npx swallowkit deploy --env production
```

## 🔗 関連リソース

- [Azure Static Web Apps の制限](https://docs.microsoft.com/azure/static-web-apps/quotas)
- [Azure Functions のベストプラクティス](https://docs.microsoft.com/azure/azure-functions/functions-best-practices)
- [Next.js 最適化ガイド](https://nextjs.org/docs/app/building-your-application/optimizing)
