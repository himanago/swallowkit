# 認証ガイド

## 概要

SwallowKit の **Authentication（認証）** 機能は、プロジェクトに完全な認証基盤を追加します — ユーザーログイン、JWT トークン管理、ロールベース認可、React 認証コンテキスト — すべてが設定から単一の CLI コマンドで生成されます。

3 つの認証プロバイダーモードをサポートしています：

| モード | 説明 | ステータス |
|-------|------|----------|
| `custom-jwt` | 外部 RDB ユーザーデータベース + JWT トークン | ✅ 利用可能（v1） |
| `swa` | Static Web Apps 組み込み認証 | 🔜 計画中 |
| `swa-custom` | ハイブリッド（SWA 認証 + カスタム拡張） | 🔜 計画中 |

💡 **ポイント**: `custom-jwt` は JWT（セッションではなく）を使用します。これは Azure Functions がステートレスであることが原則だからです。BFF レイヤーが Cookie 管理（トランスポート層の責務）を担い、Functions がトークンの発行と検証（セキュリティの責務）を担います。

⚠️ **SWA ルートルール**（`staticwebapp.config.json` の `allowedRoles`）は SWA 組み込み認証プロバイダーでのみ機能し、`custom-jwt` では**効きません**。

## アーキテクチャ

### ログインフロー（custom-jwt）

```
ブラウザ
  │
  ├─ POST /api/auth/login ──→ BFF（Next.js API Route）
  │                              │
  │                              └──→ Azure Functions（auth-login）
  │                                      │
  │                                      ├─ RDB ユーザーテーブルを検索
  │                                      ├─ パスワード検証（bcrypt）
  │                                      └─ JWT 生成
  │                                             │
  │                              ◄──────────────┘
  │                              httpOnly Cookie を設定
  ◄──────────────────────────────┘
```

### 認証済みリクエストフロー

```
ブラウザ（Cookie 付き）
  │
  ├──→ Next.js Middleware
  │       │
  │       ├─ Cookie の存在確認
  │       ├─ Base64 デコード → 有効期限チェックのみ（暗号化処理なし）
  │       ├─ 期限切れ/未設定 → /login にリダイレクト
  │       └─ Authorization ヘッダーをリクエストに追加
  │              │
  │              ▼
  │       BFF（Next.js API Route）
  │              │
  │              ▼
  │       Azure Functions
  │              │
  │              ├─ 完全な JWT 署名検証
  │              ├─ ロールベースアクセスチェック（authPolicy）
  │              └─ ビジネスロジックの実行
  │              │
  ◄──────────────┘
```

💡 **Defense in Depth（多層防御）**: Middleware は軽量な base64 有効期限チェックのみを行います。これは Edge Runtime にネイティブの暗号化 API がないためです。完全な JWT 署名検証は Azure Functions で実行されます。

## はじめに

### 1. ユーザーデータベース用の Connector を追加

ユーザーデータベースは RDB Connector として登録する必要があります。既に設定済みの場合、このステップはスキップしてください。

```bash
# npx
npx swallowkit add-connector userdb --type rdb --provider postgres

# pnpm
pnpm dlx swallowkit add-connector userdb --type rdb --provider postgres
```

これにより `swallowkit.config.js` に Connector エントリが追加されます。詳しくは [Connector ガイド](./connector-guide.md) をご覧ください。

### 2. swallowkit.config.js で認証を設定

ユーザーデータベースの Connector を指す `auth` セクションを追加します：

```javascript
// swallowkit.config.js
module.exports = {
  auth: {
    provider: 'custom-jwt',
    customJwt: {
      userConnector: 'userdb',
      userTable: 'users',
      loginIdColumn: 'login_id',
      passwordHashColumn: 'password_hash',
      rolesColumn: 'roles',
      jwtSecretEnv: 'JWT_SECRET',
      tokenExpiry: '24h',
    },
    authorization: {
      defaultPolicy: 'authenticated',
      policies: {
        'estimate': { roles: ['admin', 'estimator'] },
        'team': { roles: ['admin'] },
      },
    },
  },
  connectors: {
    userdb: {
      type: 'rdb',
      provider: 'postgres',
      connectionEnvVar: 'USERDB_CONNECTION_STRING',
    },
  },
};
```

### 3. add-auth を実行

すべての認証基盤ファイルを生成します：

```bash
# npx
npx swallowkit add-auth

# pnpm
pnpm dlx swallowkit add-auth
```

これにより login/logout/me エンドポイント、BFF ルート、ミドルウェア、ログインページ、React 認証コンテキストが作成されます。生成されるファイルの一覧は[生成されるファイル](#生成されるファイル)をご覧ください。

### 4. モデルに authPolicy を追加

ロールベースアクセスが必要なモデルに `authPolicy` をエクスポートします：

```typescript
// shared/models/estimate.ts
export const authPolicy = { roles: ['admin', 'estimator'] };
```

### 5. 認証ポリシー付きモデルを再 Scaffold

```bash
# npx
npx swallowkit scaffold shared/models/estimate.ts

# pnpm
pnpm dlx swallowkit scaffold shared/models/estimate.ts
```

Scaffold は `authPolicy` エクスポートを検出し、生成される Functions にロールガードを注入します。詳しくは [Scaffold 連携](#scaffold-連携)をご覧ください。

### 6. モックコネクタで開発サーバーを起動

```bash
# npx
npx swallowkit dev --mock-connectors

# pnpm
pnpm dlx swallowkit dev --mock-connectors
```

`--mock-connectors` はすべての RDB コネクタデータをインメモリでモック化します — `auth.customJwt.userTable` で参照されるユーザーテーブルも含まれます。つまり、実際のデータベースなしでもモックのユーザーデータに対してログインが動作します。他のコネクタモデルと同様に、`dev-seeds/<env>/user.json` でユーザーのシードデータを定義してください：

```json
[
  {
    "id": "1",
    "login_id": "admin",
    "password_hash": "password123",
    "name": "管理者",
    "email": "admin@example.com",
    "roles": ["admin", "estimator"]
  }
]
```

フィールド名は `auth.customJwt` で設定されたカラム名（`loginIdColumn`、`passwordHashColumn`、`rolesColumn`）と一致する必要があります。

⚠️ **シードファイルのパスワードはプレーンテキストです** — これらのファイルはローカル開発専用です。実際の認証情報をコミットしないでください。

## 設定リファレンス

### auth.provider

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `provider` | `'custom-jwt'` \| `'swa'` \| `'swa-custom'` | ✅ | 認証プロバイダーモード。v1 では `custom-jwt` のみ利用可能 |

### auth.customJwt

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `userConnector` | `string` | ✅ | `connectors` セクションの Connector 名（RDB Connector である必要あり） |
| `userTable` | `string` | ✅ | ユーザーレコードを格納するデータベーステーブル |
| `loginIdColumn` | `string` | ✅ | ログイン識別子として使用するカラム（例：ユーザー名、メールアドレス） |
| `passwordHashColumn` | `string` | ✅ | bcrypt ハッシュ化されたパスワードを格納するカラム |
| `rolesColumn` | `string` | ✅ | ユーザーロールを格納するカラム（JSON 配列またはカンマ区切り文字列） |
| `jwtSecretEnv` | `string` | ✅ | JWT 署名シークレットを保持する環境変数名 |
| `tokenExpiry` | `string` | ✅ | トークンの有効期限（例：`'1h'`、`'24h'`、`'7d'`） |

### auth.authorization

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `defaultPolicy` | `'authenticated'` \| `'public'` | ❌ | 明示的な `authPolicy` のないモデルに適用されるデフォルトアクセスポリシー。デフォルト値は `'authenticated'` |
| `policies` | `Record<string, { roles: string[] }>` | ❌ | モデル名から必要なロールへの名前付きポリシーマッピング |

```javascript
authorization: {
  defaultPolicy: 'authenticated',
  policies: {
    'estimate': { roles: ['admin', 'estimator'] },
    'team': { roles: ['admin'] },
  },
},
```

💡 **ヒント**: `defaultPolicy: 'authenticated'` は、特定のポリシーを持たないモデルにログイン済みの任意のユーザーがアクセスできることを意味します。ほとんどのエンドポイントが未認証の場合にのみ `'public'` に設定してください。

## モデル認証ポリシー

モデルは `authPolicy` をエクスポートすることで、モデルレベルでのロールベースアクセス制御を設定できます。`scaffold` がこのエクスポートを検出すると、生成される Functions にロールガードが注入されます。

### 基本的な使い方

モデルのすべてのオペレーションに特定のロールを要求します：

```typescript
// shared/models/estimate.ts
import { z } from 'zod/v4';

export const Estimate = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number(),
});

export type Estimate = z.infer<typeof Estimate>;
export const displayName = 'Estimate';

export const authPolicy = { roles: ['admin', 'estimator'] };
```

### 読み取り・書き込みの分離

読み取りと書き込みで異なるロールを適用します：

```typescript
// shared/models/report.ts
export const authPolicy = {
  read: ['admin', 'estimator', 'viewer'],
  write: ['admin'],
};
```

| 形式 | 読み取りオペレーション（GET） | 書き込みオペレーション（POST/PUT/DELETE） |
|-----|--------------------------|--------------------------------------|
| `{ roles: [...] }` | 一覧に含まれるすべてのロール | 一覧に含まれるすべてのロール |
| `{ read: [...], write: [...] }` | read のロールのみ | write のロールのみ |

### 設定ポリシーとの関係

認証ポリシーは 2 つの場所で定義できます：

1. **モデルファイル内** — `export const authPolicy = { ... }`
2. **swallowkit.config.js 内** — `auth.authorization.policies`

同一モデルに両方が存在する場合、**モデルレベルのエクスポートが優先**されます。設定レベルのポリシーは、一元的な概要の確認や、直接変更したくないモデルに対して有用です。

## 生成されるファイル

`add-auth` コマンドは以下のファイルを生成します：

| ファイル | 説明 |
|---------|------|
| `shared/models/auth.ts` | LoginRequest、AuthUser、LoginResponse の Zod スキーマ |
| `app/api/auth/login/route.ts` | BFF ルート — 認証情報を Functions に転送し、成功時に httpOnly Cookie を設定 |
| `app/api/auth/logout/route.ts` | BFF ルート — 認証 Cookie をクリア |
| `app/api/auth/me/route.ts` | BFF ルート — JWT から現在のユーザー情報を返却 |
| `middleware.ts` | Next.js ミドルウェア — Cookie チェック、有効期限検証、Authorization ヘッダー追加、未認証時は /login にリダイレクト |
| `app/login/page.tsx` | フォーム UI 付きログインページ |
| `lib/auth/auth-context.tsx` | React コンテキストプロバイダーと `useAuth` フック |

### バックエンド言語別ファイル

Functions ファイルはバックエンド言語によって異なります：

| バックエンド | 認証エンドポイント | JWT ヘルパー |
|------------|-----------------|-------------|
| **TypeScript** | `functions/src/auth.ts` | `functions/src/auth/jwt-helper.ts` |
| **C#** | `functions/Auth/AuthFunctions.cs` | `functions/Auth/JwtHelper.cs` |
| **Python** | `functions/auth_functions.py` | `functions/auth/jwt_helper.py` |

### 変更されるファイル

| ファイル | 変更内容 |
|---------|---------|
| `lib/api/call-function.ts` | BFF ルートから Azure Functions への Authorization ヘッダー転送を追加 |

## Scaffold 連携

`scaffold` がモデルを処理する際、`authPolicy`（モデルファイルからエクスポートされたもの、または `auth.authorization.policies` で定義されたもの）が存在すると、以下が自動的に行われます：

1. **ロールガードを注入** — 生成される Azure Functions コード（バックエンド）
2. **ロール対応 UI を生成** — 書き込みアクションの条件付きレンダリング（フロントエンド）
3. **認証対応 `callFunction`** を選択 — Middleware から Functions への Authorization ヘッダー転送

### バックエンドガード

`authPolicy = { roles: ['admin', 'estimator'] }` を持つモデルの場合：

- **すべての生成エンドポイント**にビジネスロジック実行前の JWT 検証とロールチェックが含まれる
- 認可されていないリクエストには `403 Forbidden` レスポンスが返される

読み取り・書き込み分離のモデルの場合：

- **GET エンドポイント**は `read` ロールに対してチェックされる
- **POST / PUT / DELETE エンドポイント**は `write` ロールに対してチェックされる

Cosmos DB モデルとコネクタ（RDB / API）モデルの両方に適用されます。

### フロントエンドロール制御

認証が設定されており、モデルの `authPolicy` に `write` ロールがある場合、scaffold はロール対応のレンダリングを含む UI ページを生成します：

| ページ | 動作 |
|-------|------|
| **一覧ページ** | 「Create New」ボタンと「Edit」/「Delete」アクションは、write ロールを持たないユーザーには非表示 |
| **詳細ページ** | 「Edit」と「Delete」ボタンは、write ロールを持たないユーザーには非表示 |
| **新規作成・編集ページ** | write ロールがない場合、一覧ページにリダイレクト |

生成コードは認証コンテキストの `useAuth()` フックと `hasAnyRole()` を使用します：

```tsx
// scaffold が生成するコード（一覧ページの例）
const { hasAnyRole } = useAuth();
const canWrite = hasAnyRole(["admin"]);

// canWrite が true の場合のみ "Create New" ボタンをレンダリング
{canWrite && <Link href="/employee/new">Create New</Link>}
```

💡 **注意**: フロントエンドのロールチェックは UX の利便性であり、セキュリティ境界ではありません。実際の認可は Azure Functions レイヤーで行われます。ユーザーが UI をバイパスしても、バックエンドは 401/403 で不正なリクエストを拒否します。

### `--mock-connectors` 時の認証制御

`--mock-connectors` で実行する場合、モックサーバーは本番環境と同じ認証ルールをすべてのコネクタモデルのルートに適用します：

- 有効な JWT トークンのないリクエストには `401 Unauthorized` が返される
- ロールが不足しているリクエストには `403 Forbidden` が返される
- 認証制御は各モデルの `authPolicy` と `auth.authorization.defaultPolicy` を尊重する

ユーザーテーブルも通常の RDB データとしてモック化されるため、シードデータのユーザーでログインし、実際の JWT を受け取ることができます。これにより開発時の動作が本番環境と一致します — デプロイ時に驚くことはありません。

### デフォルトポリシーの動作

明示的な `authPolicy` を持たないモデルは、`auth.authorization.defaultPolicy` に従います：

| `defaultPolicy` | 動作 |
|-----------------|------|
| `'authenticated'` | 有効な JWT が必須（特定のロールチェックなし） |
| `'public'` | 認証ガードは注入されない — エンドポイントは公開アクセス可能 |

💡 **ヒント**: デフォルトは `'authenticated'` にして、公開エンドポイントを明示的にマークしましょう。これは最小権限の原則に従います。

## セキュリティに関する考慮事項

### JWT 設計

- トークンは `JWT_SECRET` 環境変数に格納されたシークレットで署名される
- トークンにはユーザー ID、ログイン ID、ロールが含まれる — API キー、パスワード、その他の機密データは JWT ペイロードに**絶対に格納しない**こと
- トークンの有効期限は `tokenExpiry` で設定可能（デフォルト：`'24h'`）

### Cookie 設定

- BFF は `httpOnly`、`secure`、`sameSite: 'strict'` フラグ付きで Cookie を設定する
- `httpOnly` は JavaScript からのアクセスを防止（XSS 対策）
- `secure` は HTTPS 経由でのみ Cookie が送信されることを保証（localhost を除く）
- `sameSite: 'strict'` は CSRF 攻撃を防止

### Defense in Depth（多層防御）

認証フローは二層検証戦略を採用しています：

| レイヤー | チェック内容 | 理由 |
|---------|------------|------|
| **Next.js Middleware**（Edge Runtime） | Base64 デコードした有効期限タイムスタンプのみ | Edge Runtime にはネイティブの暗号化 API がなく、JWT 署名を検証できない |
| **Azure Functions** | 完全な JWT 署名検証 + ロールベースアクセスチェック | Functions は完全な Node.js/C#/Python ランタイムを持ち、暗号化をサポート |

これにより、有効期限切れのトークンはエッジで早期に拒否（高速・低コスト）され、改ざんされたトークンは Functions レイヤーで検出（完全検証）されます。

### JWT に含めてはいけないもの

- ❌ API キーやサードパーティトークン
- ❌ パスワードやパスワードハッシュ
- ❌ 認証に必要な範囲を超える個人識別情報
- ❌ 大きなデータペイロード（JWT はすべてのリクエストで送信される）

✅ **含めて良いもの**: ユーザー ID、ログイン ID、ロール、トークン有効期限。

## ベストプラクティス

### プロバイダーモードの選択

- ✅ 既存のユーザーデータベースがあり、認証フローを完全に制御したい場合は `custom-jwt` を使用
- ✅ Azure AD / GitHub / ソーシャルログインで十分なシンプルなプロジェクトには `swa`（利用可能時）を使用
- ✅ SWA の利便性にカスタム拡張を加えたい場合は `swa-custom`（利用可能時）を使用

### シークレット管理

- `JWT_SECRET` は Azure App Settings（本番環境）と `.env.local`（開発環境）に保存する
- 強力なランダムシークレットを使用 — 最低 256 ビット（32 文字以上）
- 定期的にシークレットをローテーションし再デプロイする
- シークレットをソースコントロールにコミットしないこと

```bash
# .env.local（ローカル開発用）
JWT_SECRET=your-strong-random-secret-at-least-32-characters
USERDB_CONNECTION_STRING=postgres://user:pass@localhost:5432/mydb
```

### ロール命名規則

- 小文字の説明的なロール名を使用：`admin`、`estimator`、`viewer`
- ロール数は少なく保つ — 細かい権限を作成するよりもロールの組み合わせを推奨
- 各ロールがアクセスを許可する範囲をドキュメント化する

### 認証コンテキストの使い方

アプリを認証プロバイダーでラップし、コンポーネントで `useAuth` フックを使用します：

```typescript
// app/layout.tsx
import { AuthProvider } from '@/lib/auth/auth-context';

export default function RootLayout({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```

```typescript
// 任意のコンポーネント内
import { useAuth } from '@/lib/auth/auth-context';

function Dashboard() {
  const { user, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;
  return <div>Welcome, {user.name}</div>;
}
```

## 制限事項

認証機能の v1 における現時点での制限事項は以下のとおりです：

- **リフレッシュトークンなし**: トークンは設定した `tokenExpiry` の期間で失効します。トークンが切れた場合、ユーザーは再ログインする必要があります
- **`swa` および `swa-custom` モードなし**: `custom-jwt` のみが実装されています。SWA ベースの認証プロバイダーは今後のリリースで予定されています
- **トークン失効（リボケーション）なし**: 発行された JWT を有効期限前に無効化することはできません。即座にアクセスを取り消すには、`JWT_SECRET` をローテーション（全トークン無効化）してください
- **Edge Runtime に暗号化 API なし**: Next.js Middleware（Edge Runtime）では JWT 署名を検証できません — Middleware レイヤーでは有効期限チェックのみが行われます
- **パスワードリセットフローなし**: `add-auth` コマンドはパスワードリセットやアカウント復旧のエンドポイントを生成しません
- **多要素認証（MFA）なし**: 生成される認証フローでは MFA はサポートされていません
- **セッション管理 UI なし**: アクティブなセッション/トークンを表示・管理するための管理画面はありません

💡 **参考情報**: CLI コマンドの詳細は **[CLI リファレンス](./cli-reference.md)** を、Connector の設定については **[Connector ガイド](./connector-guide.md)** を、モデルの Scaffold については **[Scaffold ガイド](./scaffold-guide.md)** をご参照ください。
