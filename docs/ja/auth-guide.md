# 認証

2.x の React 構成も `swa`、`custom-jwt`、`external-token` と名前付きスキームに対応します。マネージド BFF はリクエストごとに
SWA 認証済み利用者の情報と外部トークン専用ヘッダーを扱い、custom-jwt は `/api/auth/{action}` と
HttpOnly Cookie を使います。認可は独立 Functions が担当します。
Next.js の proxy / API Routes は生成しません。
パスと SWA ポートの使い方は [React の認証](./react-guide.md#認証とコネクタ)を参照してください。

SwallowKit プロジェクトにユーザー認証とロールベース認可を追加します。外部 RDB を使うカスタム JWT と Static Web Apps 組み込み認証に対応しています。

現時点の実装状況は次のとおりです：

| モード | 説明 | ステータス |
|-------|------|----------|
| `custom-jwt` | 外部 RDB ユーザーデータベース + JWT トークン | ✅ 利用可能（v1） |
| `swa` | Static Web Apps 組み込み認証 | ✅ 利用可能 |
| `swa-custom` | ハイブリッド（SWA 認証 + カスタム拡張） | 🔜 計画中 |
| `external-token` | LIFF/Auth0/Firebase等が発行するBearer トークン | ✅ 利用可能 |

> `swa` モードでは `npx swallowkit add-auth --provider swa` を実行します。`/api/*` は `authenticated` ロールに限定され、SWA の利用者の認証情報が BFF 経由で Functions に伝達されます。

すべてのモードで、BFF から Functions への通信はサーバー側の Functions ホストキー（`x-functions-key`）で保護されます。キーは Azure デプロイ時に自動設定され、ブラウザには公開されません。

**ポイント**: `custom-jwt` は JWT（セッションではなく）を使用します。これは Azure Functions がステートレスであることが原則だからです。BFF レイヤーが Cookie 管理（トランスポート層の責務）を担い、Functions がトークンの発行と検証（セキュリティの責務）を担います。

**SWA ルートルール**（`staticwebapp.config.json` の `allowedRoles`）は SWA 組み込み認証プロバイダーでのみ機能し、`custom-jwt` では**効きません**。

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
  ├──→ Next.js proxy.ts
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

Next.js の `proxy.ts` は Cookie と有効期限を事前に確認します。JWT の署名とロールの検証は独立 Azure Functions が担当します。事前確認に成功しただけで、API の呼び出しが許可されるわけではありません。

## はじめに

### 1. ユーザーデータベース用のコネクタを追加

ユーザーデータベースは RDB コネクタとして登録する必要があります。既に設定済みの場合、このステップはスキップしてください。

::: code-group
```bash [npm]
npx swallowkit add-connector userdb --type rdb --provider postgres
```
```bash [pnpm]
pnpm exec swallowkit add-connector userdb --type rdb --provider postgres
```
:::

これにより `swallowkit.config.js` にコネクタエントリが追加されます。詳しくは [コネクタガイド](./connector-guide.md) をご覧ください。

### 2. swallowkit.config.js で認証を設定

ユーザーデータベースのコネクタを指す `auth` セクションを追加します。

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

すべての認証基盤ファイルを生成します。

::: code-group
```bash [npm]
npx swallowkit add-auth
```
```bash [pnpm]
pnpm exec swallowkit add-auth
```
:::

これにより login/logout/me エンドポイント、BFF ルート、ミドルウェア、ログインページ、React 認証コンテキストが作成されます。生成されるファイルの一覧は[生成されるファイル](#生成されるファイル)をご覧ください。

### 4. モデルに authPolicy を追加

ロールベースアクセスが必要なモデルに `authPolicy` をエクスポートします。

明示的なポリシーを持つモデルを scaffold する前に認証を適用してください。認証未設定なら plan/apply/scaffold は書き込み前に `auth-policy-without-auth` で blocked になります。名前付き `auth.schemes` を使う場合は、スキームとロールを選択する名前付き認可ポリシーを定義し、`policy` または read/write のポリシー名で参照します。ロールのみの宣言は `auth-policy-requires-named-policy` で止め、存在しない単一プロバイダー用ヘルパーを参照するコードは生成しません。逆に、単一プロバイダーの `auth.provider` ではロールの配列だけを使えます。名前付きポリシーや名前付きの `defaultPolicy` は `auth-named-policy-requires-named-scheme` で blocked になります。

```typescript
// shared/models/estimate.ts
export const authPolicy = { roles: ['admin', 'estimator'] };
```

### 5. 認証ポリシー付きモデルを再 Scaffold

::: code-group
```bash [npm]
npx swallowkit scaffold shared/models/estimate.ts
```
```bash [pnpm]
pnpm exec swallowkit scaffold shared/models/estimate.ts
```
:::

Scaffold は `authPolicy` エクスポートを検出し、生成される Functions にロールガードを注入します。詳しくは [Scaffold 連携](#scaffold-連携)をご覧ください。

### 6. モックコネクタで開発サーバーを起動

::: code-group
```bash [npm]
npx swallowkit dev --mock-connectors --seed-env local
```
```bash [pnpm]
pnpm exec swallowkit dev --mock-connectors --seed-env local
```
:::

`--mock-connectors` はすべての RDB コネクタデータをインメモリでモック化します。`auth.customJwt.userTable` で参照されるユーザーテーブルも含まれます。つまり、実際のデータベースなしでもモックのユーザーデータに対してログインが動作します。他のコネクタモデルと同様に、`dev-seeds/<env>/user.json` でユーザーのシードデータを定義してください。

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

**シードファイルのパスワードはプレーンテキストです**。これらのファイルはローカル開発専用です。実際の認証情報をコミットしないでください。

## 設定リファレンス

### auth.provider

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `provider` | `'custom-jwt'` | ✅ | v1 で現在実装されている認証プロバイダーモード |

### auth.customJwt

| プロパティ | 型 | 必須 | 説明 |
|----------|-----|------|------|
| `userConnector` | `string` | ✅ | `connectors` セクションのコネクタ名（RDB コネクタである必要あり） |
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

**ヒント**: `defaultPolicy: 'authenticated'` は、特定のポリシーを持たないモデルにログイン済みの任意のユーザーがアクセスできることを意味します。ほとんどのエンドポイントが未認証の場合にのみ `'public'` に設定してください。

## モデル認証ポリシー

モデルは `authPolicy` をエクスポートすることで、モデルレベルでのロールベースアクセス制御を設定できます。`scaffold` がこのエクスポートを検出すると、生成される Functions にロールガードが注入されます。

### 基本的な使い方

モデルのすべての操作に特定のロールを要求します。

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

読み取りと書き込みで異なるロールを適用します。

```typescript
// shared/models/report.ts
export const authPolicy = {
  read: ['admin', 'estimator', 'viewer'],
  write: ['admin'],
};
```

| 形式 | 読み取り操作（GET） | 書き込み操作（POST/PUT/DELETE） |
|-----|--------------------------|--------------------------------------|
| `{ roles: [...] }` | 一覧に含まれるすべてのロール | 一覧に含まれるすべてのロール |
| `{ read: [...], write: [...] }` | read のロールのみ | write のロールのみ |

### 設定ポリシーとの関係

認証ポリシーは 2 つの場所で定義できます。

1. **モデルファイル内**。`export const authPolicy = { ... }`
2. **swallowkit.config.js 内**。`auth.authorization.policies`

同一モデルに両方が存在する場合、**モデルレベルのエクスポートが優先**されます。設定レベルのポリシーは、一元的な概要の確認や、直接変更したくないモデルに対して有用です。

## 生成されるファイル

`add-auth` コマンドは以下のファイルを生成します。

| ファイル | 説明 |
|---------|------|
| `shared/models/auth.ts` | LoginRequest、AuthUser、LoginResponse の Zod スキーマ |
| `app/api/auth/login/route.ts` | BFF ルート。認証情報を Functions に転送し、成功時に httpOnly Cookie を設定 |
| `app/api/auth/logout/route.ts` | BFF ルート。認証 Cookie をクリア |
| `app/api/auth/me/route.ts` | BFF ルート。JWT から現在のユーザー情報を返却 |
| `proxy.ts` | Next.js プロキシミドルウェア。Cookie チェック、有効期限検証、Authorization ヘッダー追加、未認証時は /login にリダイレクト |
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

1. **ロールガードを注入**。生成される Azure Functions コード（バックエンド）
2. **ロール対応 UI を生成**。書き込みアクションの条件付きレンダリング（フロントエンド）
3. **認証対応 `callFunction`** を選択。Next.js のプロキシから Functions への Authorization ヘッダー転送

### バックエンドガード

`authPolicy = { roles: ['admin', 'estimator'] }` を持つモデルの場合：

- **すべての生成エンドポイント**にビジネスロジック実行前の JWT 検証とロールチェックが含まれる
- 認可されていないリクエストには `403 Forbidden` レスポンスが返される

読み取り・書き込み分離のモデルの場合：

- **GET エンドポイント**は `read` ロールに対してチェックされる
- **POST / PUT / DELETE エンドポイント**は `write` ロールに対してチェックされる

Cosmos DB モデルとコネクタ（RDB / API）モデルの両方に適用されます。

### フロントエンドロール制御

認証が設定されており、モデルの `authPolicy` に `write` ロールがある場合、scaffold はロール対応のレンダリングを含む UI ページを生成します。

| ページ | 動作 |
|-------|------|
| **一覧ページ** | 「Create New」ボタンと「Edit」/「Delete」アクションは、write ロールを持たないユーザーには非表示 |
| **詳細ページ** | 「Edit」と「Delete」ボタンは、write ロールを持たないユーザーには非表示 |
| **新規作成・編集ページ** | write ロールがない場合、一覧ページにリダイレクト |

生成コードは認証コンテキストの `useAuth()` フックと `hasAnyRole()` を使用します。

```tsx
// scaffold が生成するコード（一覧ページの例）
const { hasAnyRole } = useAuth();
const canWrite = hasAnyRole(["admin"]);

// canWrite が true の場合のみ "Create New" ボタンをレンダリング
{canWrite && <Link href="/employee/new">Create New</Link>}
```

**注意**: フロントエンドのロールチェックは UX の利便性であり、セキュリティ境界ではありません。実際の認可は Azure Functions レイヤーで行われます。ユーザーが UI をバイパスしても、バックエンドは 401/403 で不正なリクエストを拒否します。

### `--mock-connectors` 時の認証制御

`--mock-connectors` で実行する場合、モックサーバーは本番環境と同じ認証ルールをすべてのコネクタモデルのルートに適用します。

- 有効な JWT トークンのないリクエストには `401 Unauthorized` が返される
- ロールが不足しているリクエストには `403 Forbidden` が返される
- 認証制御は各モデルの `authPolicy` と `auth.authorization.defaultPolicy` を尊重する

ユーザーテーブルも通常の RDB データとしてモック化されるため、シードデータのユーザーでログインし、実際の JWT を受け取ることができます。これにより開発時の動作が本番環境と一致します。デプロイ時に驚くことはありません。

### デフォルトポリシーの動作

明示的な `authPolicy` を持たないモデルは、`auth.authorization.defaultPolicy` に従います：

| `defaultPolicy` | 動作 |
|-----------------|------|
| `'authenticated'` | 有効な JWT が必須（特定のロールチェックなし） |
| `'public'` | 認証ガードは注入されない。エンドポイントは公開アクセス可能 |

**ヒント**: デフォルトは `'authenticated'` にして、公開エンドポイントを明示的にマークしましょう。これは最小権限の原則に従います。

## セキュリティに関する考慮事項

## 外部トークン認証と LINE Login

```bash
npx swallowkit add-auth --provider external-token
```

このモードではSwallowKitがBearer トークンの搬送、Functionsでの強制検証、認証済み利用者の情報の正規化、`authPolicy`認可を生成します。外部IdP固有処理は、生成される`lib/auth/external-token-adapter.ts`とバックエンド言語別の`external-token-verifier`へ実装します。初期実装は常に検証処理を実装するまですべて拒否する状態です。

LIFFではプロフィールや利用者 IDをクライアントから送らず、ID トークンだけを送ります：

```typescript
import liff from '@line/liff';
const liffId = process.env.NEXT_PUBLIC_LIFF_ID!;
async function ready() { await liff.init({ liffId }); }
export async function getToken() { await ready(); return liff.isLoggedIn() ? liff.getIDToken() : null; }
export async function login() { await ready(); if (!liff.isLoggedIn()) liff.login(); }
export async function logout() { await ready(); if (liff.isLoggedIn()) liff.logout(); }
```

TypeScript トークン検証処理例：

```typescript
export async function verifyExternalToken(token: string) {
  const body = new URLSearchParams({ id_token: token, client_id: process.env.LINE_CHANNEL_ID! });
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new ExternalTokenVerificationError(401, 'Invalid LINE ID token');
  const value = await response.json();
  return { userId: value.sub, userDetails: value.name || '', roles: ['authenticated'] };
}
```

C#では`HttpClient`で同じエンドポイントへ`FormUrlEncodedContent`をPOSTし、`sub`を`UserId`へ正規化します。Pythonでは`requests.post(..., data={"id_token": token, "client_id": channel_id}, timeout=5)`を使い、失敗時に`ExternalTokenVerificationError(401, ...)`を送出します。通信タイムアウトやLINE障害は503として扱い、業務処理を続行しないでください。Channel IDは環境変数で管理し、トークンや検証応答をログへ出さないでください。nonceを使用したログインでは検証要求にも期待値を渡します。

access トークンを使う場合はLINEのトークン検証エンドポイントで`client_id`一致と正の`expires_in`を確認し、プロフィールはサーバーから取得します。標準例はOpenID ConnectのID トークン方式です。

### JWT 設計

- トークンは `JWT_SECRET` 環境変数に格納されたシークレットで署名される
- トークンにはユーザー ID、ログイン ID、ロールが含まれる。API キー、パスワード、その他の機密データは JWT ペイロードに**絶対に格納しない**こと
- トークンの有効期限は `tokenExpiry` で設定可能（デフォルト：`'24h'`）

### Cookie 設定

- BFF は `httpOnly`、`secure`、`sameSite: 'strict'` フラグ付きで Cookie を設定する
- `httpOnly` は JavaScript による Cookie の読み取りを制限します。XSS 自体を防ぐ設定ではありません。
- `secure` は HTTPS 経由でのみ Cookie が送信されることを保証（localhost を除く）
- `sameSite: 'strict'` はサイトをまたぐリクエストで Cookie が送信されることを制限します。

### 多層防御

認証フローは二層検証戦略を採用しています：

| レイヤー | チェック内容 | 理由 |
|---------|------------|------|
| Next.js の `proxy.ts` | Cookie と、Base64 デコードした有効期限 | 画面へのアクセス前に確認する。最終的な認証・認可は Functions が担当 |
| **Azure Functions** | 完全な JWT 署名検証 + ロールベースアクセスチェック | Functions は完全な Node.js/C#/Python ランタイムを持ち、暗号化をサポート |

期限切れの Cookie は画面へのアクセス前に確認し、署名の改ざんやロールの不足は独立 Functions で検出します。React では Next.js の `proxy.ts` を生成せず、マネージド BFF と独立 Functions を経由します。

### JWT に含めてはいけないもの

- ❌ API キーやサードパーティトークン
- ❌ パスワードやパスワードハッシュ
- ❌ 認証に必要な範囲を超える個人識別情報
- ❌ 大きなデータペイロード（JWT はすべてのリクエストで送信される）

**含めて良いもの**: ユーザー ID、ログイン ID、ロール、トークン有効期限。

## ベストプラクティス

### SWA 認証のローカル開発

`add-auth --provider swa` はアプリを `AuthProvider` で自動的にラップします。Azure SWA 上では `/.auth/me` から利用者情報とロールを取得します。

`swallowkit dev` はSWA CLIが導入済みなら認証エミュレーターを起動します。http://localhost:4280/.auth/login/aad でローカル利用者とロールを設定し、4280番ポートから認証付き画面とAPIを確認できます。SWA CLIがない場合は、表示されるコマンドでプロジェクトへ追加してから再実行してください。`--no-swa`でエミュレーターを無効にした場合、`/.auth/me` の失敗は安全に処理され、UIは匿名ユーザーとして表示されます。

### プロバイダーモードの選択

- 既存のユーザーデータベースがあり、認証フローを完全に制御したい場合は `custom-jwt` を使用
- Microsoft Entra IDによるSWA組み込み認証を使用するシンプルなプロジェクトでは `swa` を使用
- ⏳ SWA の利便性にカスタム拡張を加える `swa-custom` は計画中です

### シークレット管理

- `JWT_SECRET` は Azure App Settings（本番環境）と `.env.local`（開発環境）に保存する
- 強力なランダムシークレットを使用。最低 256 ビット（32 文字以上）
- 定期的にシークレットをローテーションし再デプロイする
- シークレットをソースコントロールにコミットしないこと

```bash
# .env.local（ローカル開発用）
JWT_SECRET=your-strong-random-secret-at-least-32-characters
USERDB_CONNECTION_STRING=postgres://user:pass@localhost:5432/mydb
```

### ロール命名規則

- 小文字の説明的なロール名を使用：`admin`、`estimator`、`viewer`
- ロール数は少なく保つ。細かい権限を作成するよりもロールの組み合わせを推奨
- 各ロールがアクセスを許可する範囲をドキュメント化する

### 認証コンテキストの使い方

アプリを認証プロバイダーでラップし、コンポーネントで `useAuth` フックを使用します。

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

生成される `custom-jwt` 認証には、次の制限があります。外部 IdP を使う場合は、その IdP の機能と実装した検証処理に従います。

- **リフレッシュトークンなし**: トークンは設定した `tokenExpiry` の期間で失効します。トークンが切れた場合、ユーザーは再ログインする必要があります
- **`swa-custom` モードなし**: SWA のカスタム拡張モードは未実装です。組み込みの `swa` または `custom-jwt` を使用してください
- **トークン失効（リボケーション）なし**: 発行された JWT を有効期限前に無効化することはできません。即座にアクセスを取り消すには、`JWT_SECRET` をローテーション（全トークン無効化）してください
- **Next.js の画面保護**: 生成する `proxy.ts` は Cookie と有効期限の事前確認を行います。これだけで認証・認可は完結せず、独立 Functions が署名とポリシーを検証します。
- **パスワードリセットフローなし**: `add-auth` コマンドはパスワードリセットやアカウント復旧のエンドポイントを生成しません
- **多要素認証（MFA）なし**: 生成される認証フローでは MFA はサポートされていません
- **セッション管理 UI なし**: アクティブなセッション/トークンを表示・管理するための管理画面はありません

**参考情報**: CLI コマンドの詳細は **[CLI リファレンス](./cli-reference.md)** を、コネクタの設定については **[コネクタガイド](./connector-guide.md)** を、モデルの Scaffold については **[Scaffold ガイド](./scaffold-guide.md)** をご参照ください。
# 名前付き認証スキーム

SwallowKit は認証方式を暗黙の順番で試さず、名前付きスキームと認可ポリシーを分離します。

```js
auth: {
  schemes: {
    admin: { provider: 'swa' },
    lineUser: { provider: 'external-token' },
  },
  authorization: {
    defaultPolicy: 'anonymous',
    policies: {
      adminOnly: { schemes: ['admin'], roles: ['admin'] },
      lineUserOnly: { schemes: ['lineUser'], roles: ['authenticated'] },
    },
  },
}
```

モデルは `authPolicy = { read: 'adminOnly', write: 'adminOnly' }` または `{ policy: 'adminOnly' }`、カスタム Functions は `await requireAuth(request, 'lineUserOnly')` を使用します。ポリシーに列挙したスキームだけを受理し、Bearer スキーム同士など資格情報の取得元を区別できない構成は検証エラーです。

::: warning config の所有権
`auth.schemes` を手書きしてはいけません。`add-auth --scheme`（または `machine plan/apply auth`）が所有しており、先に手書きされたスキームは `already exists` で安全に停止します。apply 後に手で追記するのは `auth.authorization.policies` と `swa.allowedProviders` です。SWA スキームでは `--allowed-providers github,aad` を渡せば、生成されるログイン URL とプロバイダーチェックが最初から正しい認証プロバイダーを使用します。
:::

標準認証済み利用者の情報は `{ subject, scheme, issuer, roles, claims }` です。グローバルな利用者の識別子には `scheme + ':' + subject` を使用します。互換用 `userId` / `userDetails` は非推奨です。未検証のクライアント由来 ID、ロール、プロフィールは信用しません。

BFF は Bearer/SWA 資格情報を転送して `x-functions-key` を付与するだけで、最終判定は Functions が行います。資格情報はログへ出しません。External Token トークン検証処理は検証処理を実装するまですべて拒否する状態で生成され、署名・issuer・audience・期限を利用者実装で検証し、無効トークン (401) と IdP 障害 (503) を区別します。

旧 `auth.provider` は `default` スキームへ正規化され、旧ロール配列も維持されます。`public` は非推奨 alias として受理し、正規値は `anonymous` です。

## SWA管理画面＋LINE系ユーザーAPIの完全例

Campaign/Coupon 管理モデルには `adminOnly`、アンケート・クーポン受取モデルには `lineUserOnly` を指定します。`defaultPolicy: 'anonymous'` で `authPolicy` を省略したヘルスチェックは匿名になります。

```bash
swallowkit add-auth --scheme admin --provider swa --allowed-providers github
swallowkit add-auth --scheme lineUser --provider external-token
```

生成された `functions/src/auth/schemes/line-user/verifier.ts` を実装してください。初期ひな形は全トークンを拒否します。管理系・一般ユーザー系のルートグループのレイアウトで、それぞれ `lib/auth/schemes/admin/auth-context` と `lib/auth/schemes/line-user/auth-context` の Provider を適用します。LINE 側の UI はスキーム固有の認証付き fetch を使用します。UI のロールによる表示制御は操作性のためのもので、認証・認可は Functions が強制します。

管理者SWA 認証済み利用者の情報は`lineUserOnly`を選択できず、LINE Bearer トークンは`adminOnly`を選択できません。検証失敗後のプロバイダー代替処理はありません。`swa-custom`は予約扱いで名前付きスキームには使用できないため、`swa`と別の独自の/externalスキームを組み合わせてください。


### 外部トークンの転送と移行

| 経路 | ブラウザーからの資格情報 | 独立 Functions への転送 |
|---|---|---|
| React SPA → SWA マネージド BFF | 同一オリジンの `/api/*` に `x-swallowkit-external-token`（トークン値のみ） | `Authorization: Bearer …` とサーバー側の `x-functions-key` |
| Next.js API Routes | 通常の `Authorization: Bearer …`。ホストがヘッダーを保持することが前提 | `Authorization: Bearer …` とサーバー側の `x-functions-key` |
| SWA を介さない独立 Functions への直接通信 | 通常の `Authorization: Bearer …`。関数キーを使う直接テストはサーバー側で実施 | Functions が検証 |

SWA マネージド API で Authorization が置換された報告と、カスタムヘッダーによる回避例があります。リンク済みバックエンドも SWA のプロキシを経由しますが、マネージド API と同じヘッダー挙動かは個別に確認してください。SwallowKit の生成構成では独立 Functions をリンクしません。[Azure SWA #34](https://github.com/Azure/static-web-apps/issues/34)、[Azure SWA #275](https://github.com/Azure/static-web-apps/issues/275)、[リンク済み Functions の制約](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own)

React BFF は受信した Authorization を読みません。外部ヘッダーを優先し、ヘッダーがない場合に限り custom-jwt が有効なら既存の HttpOnly Cookie を使います。外部トークン用の Cookie はありません。SWA 認証済み利用者の情報は独立した入力です。名前付きポリシーは候補が一つのときだけ検証し、同じ資格情報源を使う複数スキームを一つのポリシーに設定できません。外部 IdP ごとにポリシーを分けます。外部トークンで利用する SWA ルートには SWA 組み込みログインを必須にするルールを適用しないでください。アダプターは毎回 SDK の現行セッションを参照し、更新後のトークンまたはログアウト後の null を返してください。トークンを URL、ログ、エラー、永続ストレージに残さないでください。

トークン検証処理は IdP の署名または検証 API、issuer、audience、期限、subject を確認し、サーバーで決めたロールを返します。名前付き認証・認可の検査は欠落・不正・期限切れを 401、検証先障害を 503、未設定を 500 に分類します。期限切れはトークン検証処理が明示します。C# は `ExternalTokenExpiredException`、TS は `ExternalTokenVerificationError` の第 3 引数 `expired_token`、Python は `expired=True` を使えます。BFF は既知の状態とコードの組だけを固定文言で返します。独自 API で同じ分類を返す場合は、このコード契約に合わせてください。

名前付き C# 認証・認可の検査は、スキーム別の `Func<string, CancellationToken, Task<ExternalPrincipal_<scheme>>>` を invocation DI から解決し、キャンセルを渡します。Program.cs で HttpClient、設定、テスト用ハンドラーを持つサービスのメソッドを登録できます。登録がなければ既存の static `VerifyAsync(string)` を呼びます。既存トークン検証処理の差し替えは任意です。単一プロバイダーの C# は `ExternalAuthPrincipal` のデリゲートと `ExternalAuthVerificationException` を使います。

名前付き AuthProvider を使う場合は `load-user.ts` を実装するか `loadUser` を渡します。必要ならスキームで保護したアプリ所有のエンドポイントを BFF と Functions に実装し、`authenticatedFetch` で呼びます。loader は検証済みの `{ id, loginId, name, email, roles: string[] }`、ログアウト時は null を返し、404、HTML、通信障害では例外を送出します。SDK の identity 変更時は `identityVersion` を更新するか `refresh()` を呼びます。単一プロバイダー構成には既存の `/api/auth/me` が生成されます。

beta.1 のプロジェクトルートで次を実行します。単一プロバイダーの場合は `--scheme line` を省略します。

```sh
swallowkit machine plan auth --provider external-token --scheme line --refresh
swallowkit machine apply auth --plan <plan-id>
swallowkit machine inspect boundaries
swallowkit machine verify project
```

`unknown-provenance` や `modified-after-generation` があれば、現行の BFF、fetch、context と生成内容を比較し、独自差分を退避してから必要な場合だけ `--approve` で適用してください。token-adapter とトークン検証処理は保持されます。生成 CRUD を使う場合は対象モデルを plan/apply scaffold で再生成して認証・認可の検査も更新します。独自 API のトークン検証処理やルートはアプリ側で管理します。

Azure 本番では、既存の許可済み検証環境で短命のテスト資格情報を使います。ブラウザー送信、マネージド BFF 受信、独立 Functions 受信の各境界でヘッダーの有無と検証分類だけを相関 ID で確認します。トークンやヘッダー値は採取しません。有効・欠落・不正・期限切れ・検証障害を試し、有効時だけ保護データが返ることを確認します。SWA CLI と machine verify の結果は、この本番検証の代わりにはなりません。
