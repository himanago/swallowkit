# Authentication

Add user authentication and role-based authorization to a SwallowKit project. Both custom JWT with an external RDB user store and Static Web Apps built-in authentication are supported.

Current implementation status:

| Mode | Description | Status |
|------|-------------|--------|
| `custom-jwt` | External RDB user database + JWT tokens | ✅ Available (v1) |
| `swa` | Static Web Apps built-in authentication | ✅ Available |
| `swa-custom` | Hybrid (SWA auth + custom extensions) | 🔜 Planned |
| `external-token` | Bearer tokens issued by LIFF/Auth0/Firebase/etc. | ✅ Available |

> For SWA auth, run `npx swallowkit add-auth --provider swa`. The generated `/api/*` route requires the `authenticated` role and forwards the SWA client principal to Functions through the BFF.

In every mode, server-to-server calls from the BFF to Functions are protected by an automatically configured Functions host key in the `x-functions-key` header. The key is never exposed to the browser.

💡 **Key concept**: `custom-jwt` uses JWT (not sessions) because Azure Functions is stateless. The BFF layer manages cookies (transport concern), while Functions handle token generation and verification (security concern).

⚠️ **SWA route rules** (`allowedRoles` in `staticwebapp.config.json`) only work with the SWA built-in auth provider, **not** with `custom-jwt`.

## Architecture

### Login Flow (custom-jwt)

```
Browser
  │
  ├─ POST /api/auth/login ──→ BFF (Next.js API Route)
  │                              │
  │                              └──→ Azure Functions (auth-login)
  │                                      │
  │                                      ├─ Query RDB user table
  │                                      ├─ Verify password (bcrypt)
  │                                      └─ Generate JWT
  │                                             │
  │                              ◄──────────────┘
  │                              Set httpOnly Cookie
  ◄──────────────────────────────┘
```

### Authenticated Request Flow

```
Browser (Cookie)
  │
  ├──→ Next.js Middleware
  │       │
  │       ├─ Check cookie exists
  │       ├─ Base64 decode → expiry check only (no crypto)
  │       ├─ If expired/missing → redirect to /login
  │       └─ Add Authorization header to request
  │              │
  │              ▼
  │       BFF (Next.js API Route)
  │              │
  │              ▼
  │       Azure Functions
  │              │
  │              ├─ Full JWT signature verification
  │              ├─ Role-based access check (authPolicy)
  │              └─ Execute business logic
  │              │
  ◄──────────────┘
```

💡 **Defense in Depth**: Middleware only does a lightweight base64 expiry check because the Edge Runtime has no crypto API. Full JWT signature verification happens in Azure Functions.

## Getting Started

### 1. Add a Connector for the User Database

The user database must be registered as an RDB connector. If you already have one, skip this step.

::: code-group
```bash [npm]
npx swallowkit add-connector userdb --type rdb --provider postgres
```
```bash [pnpm]
pnpm swallowkit add-connector userdb --type rdb --provider postgres
```
:::

This adds a connector entry to `swallowkit.config.js`. See the [Connector Guide](./connector-guide.md) for details.

### 2. Configure Auth in swallowkit.config.js

Add the `auth` section pointing to your user database connector:

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

### 3. Run add-auth

Generate all auth infrastructure files:

::: code-group
```bash [npm]
npx swallowkit add-auth
```
```bash [pnpm]
pnpm swallowkit add-auth
```
:::

This creates login/logout/me endpoints, BFF routes, middleware, a login page, and React auth context. See [Generated Files](#generated-files) for the full list.

### 4. Add authPolicy to Models

For models that require role-based access, export an `authPolicy`:

```typescript
// shared/models/estimate.ts
export const authPolicy = { roles: ['admin', 'estimator'] };
```

### 5. Re-scaffold Models with Auth Policies

::: code-group
```bash [npm]
npx swallowkit scaffold shared/models/estimate.ts
```
```bash [pnpm]
pnpm swallowkit scaffold shared/models/estimate.ts
```
:::

Scaffold detects the `authPolicy` export and injects role guards into the generated Functions. See [Scaffold Integration](#scaffold-integration) for details.

### 6. Start Dev with Mock Connectors

::: code-group
```bash [npm]
npx swallowkit dev --mock-connectors --seed-env local
```
```bash [pnpm]
pnpm swallowkit dev --mock-connectors --seed-env local
```
:::

`--mock-connectors` mocks all RDB connector data in-memory — including the user table referenced by `auth.customJwt.userTable`. This means the auth login endpoint works against mock user data without a real database. Define user seed data in `dev-seeds/<env>/user.json` just like any other connector model:

```json
[
  {
    "id": "1",
    "login_id": "admin",
    "password_hash": "password123",
    "name": "Administrator",
    "email": "admin@example.com",
    "roles": ["admin", "estimator"]
  }
]
```

The field names must match the column names configured in `auth.customJwt` (`loginIdColumn`, `passwordHashColumn`, `rolesColumn`).

⚠️ **Passwords in seed files are plaintext** — these files are for local development only. Never commit real credentials.

## Configuration Reference

### auth.provider

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `provider` | `'custom-jwt'` | ✅ | Auth provider mode currently implemented in v1 |

### auth.customJwt

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `userConnector` | `string` | ✅ | Connector name from the `connectors` section (must be an RDB connector) |
| `userTable` | `string` | ✅ | Database table containing user records |
| `loginIdColumn` | `string` | ✅ | Column used as the login identifier (e.g., username, email) |
| `passwordHashColumn` | `string` | ✅ | Column storing the bcrypt-hashed password |
| `rolesColumn` | `string` | ✅ | Column storing user roles (JSON array or comma-separated string) |
| `jwtSecretEnv` | `string` | ✅ | Environment variable name holding the JWT signing secret |
| `tokenExpiry` | `string` | ✅ | Token expiration duration (e.g., `'1h'`, `'24h'`, `'7d'`) |

### auth.authorization

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `defaultPolicy` | `'authenticated'` \| `'public'` | ❌ | Default access policy for models without an explicit `authPolicy`. Defaults to `'authenticated'` |
| `policies` | `Record<string, { roles: string[] }>` | ❌ | Named policies mapping model names to required roles |

```javascript
authorization: {
  defaultPolicy: 'authenticated',
  policies: {
    'estimate': { roles: ['admin', 'estimator'] },
    'team': { roles: ['admin'] },
  },
},
```

💡 **Tip**: `defaultPolicy: 'authenticated'` means any logged-in user can access models that don't have a specific policy. Set it to `'public'` only if most of your endpoints are unauthenticated.

## Model Auth Policy

Models can export an `authPolicy` to control role-based access at the model level. When `scaffold` detects this export, it injects role guards into the generated Functions.

### Basic Usage

Require specific roles for all operations on a model:

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

### Read/Write Differentiation

Apply different roles for read vs write operations:

```typescript
// shared/models/report.ts
export const authPolicy = {
  read: ['admin', 'estimator', 'viewer'],
  write: ['admin'],
};
```

| Format | Read Operations (GET) | Write Operations (POST/PUT/DELETE) |
|--------|----------------------|-----------------------------------|
| `{ roles: [...] }` | All listed roles | All listed roles |
| `{ read: [...], write: [...] }` | Read roles only | Write roles only |

### Interaction with Config Policies

Auth policies can be defined in two places:

1. **In the model file** — `export const authPolicy = { ... }`
2. **In swallowkit.config.js** — `auth.authorization.policies`

If both are present for the same model, the **model-level export takes precedence**. Config-level policies are useful as a centralized overview or for models you don't want to modify directly.

## Generated Files

The `add-auth` command generates the following files:

| File | Description |
|------|-------------|
| `shared/models/auth.ts` | LoginRequest, AuthUser, and LoginResponse Zod schemas |
| `app/api/auth/login/route.ts` | BFF route — forwards credentials to Functions, sets httpOnly cookie on success |
| `app/api/auth/logout/route.ts` | BFF route — clears the auth cookie |
| `app/api/auth/me/route.ts` | BFF route — returns the current user from the JWT |
| `proxy.ts` | Next.js proxy middleware — checks cookie, validates expiry, adds Authorization header, redirects to /login if unauthenticated |
| `app/login/page.tsx` | Login page with form UI |
| `lib/auth/auth-context.tsx` | React context provider and `useAuth` hook |

### Backend-Specific Files

Functions files vary by backend language:

| Backend | Auth Endpoints | JWT Helper |
|---------|---------------|------------|
| **TypeScript** | `functions/src/auth.ts` | `functions/src/auth/jwt-helper.ts` |
| **C#** | `functions/Auth/AuthFunctions.cs` | `functions/Auth/JwtHelper.cs` |
| **Python** | `functions/auth_functions.py` | `functions/auth/jwt_helper.py` |

### Modified Files

| File | Change |
|------|--------|
| `lib/api/call-function.ts` | Updated to forward the Authorization header from BFF routes to Azure Functions |

## Scaffold Integration

When `scaffold` processes a model that has an `authPolicy` (either exported from the model file or defined in `auth.authorization.policies`), it automatically:

1. **Injects role guards** into the generated Azure Functions code (backend)
2. **Generates role-aware UI** with conditional rendering of write actions (frontend)
3. **Selects the auth-aware `callFunction`** helper that forwards Authorization headers from middleware to Functions

### Backend Guards

For a model with `authPolicy = { roles: ['admin', 'estimator'] }`:

- **All generated endpoints** include JWT verification and role checking before executing business logic
- Unauthorized requests receive a `403 Forbidden` response

For a model with read/write differentiation:

- **GET endpoints** check against the `read` roles
- **POST / PUT / DELETE endpoints** check against the `write` roles

This applies to both Cosmos DB models and connector (RDB/API) models.

### Frontend Role Controls

When auth is configured and a model has an `authPolicy` with `write` roles, scaffold generates UI pages with role-aware rendering:

| Page | Behavior |
|------|----------|
| **List page** | "Create New" button and "Edit" / "Delete" actions are hidden for users without write roles |
| **Detail page** | "Edit" and "Delete" buttons are hidden for users without write roles |
| **New / Edit pages** | Redirect to the list page if the user lacks write roles |

The generated code uses the `useAuth()` hook and `hasAnyRole()` from the auth context:

```tsx
// Generated by scaffold (example from list page)
const { hasAnyRole } = useAuth();
const canWrite = hasAnyRole(["admin"]);

// "Create New" button only renders when canWrite is true
{canWrite && <Link href="/employee/new">Create New</Link>}
```

💡 **Note**: Frontend role checks are a UX convenience, not a security boundary. The real enforcement happens at the Azure Functions layer. Even if a user bypasses the UI, the backend will reject unauthorized requests with 401/403.

### Auth Enforcement with `--mock-connectors`

When running with `--mock-connectors`, the mock server enforces the same auth rules as production for all connector model routes:

- Requests without a valid JWT token receive `401 Unauthorized`
- Requests with insufficient roles receive `403 Forbidden`
- Auth enforcement respects each model's `authPolicy` and the `auth.authorization.defaultPolicy`

Since the user table is mocked as regular RDB data, users can log in with seed data and receive real JWTs. This ensures the development experience matches production behavior — no surprises when deploying.

### Default Policy Behavior

Models **without** an explicit `authPolicy` follow the `auth.authorization.defaultPolicy`:

| `defaultPolicy` | Behavior |
|-----------------|----------|
| `'authenticated'` | Any valid JWT is required (no specific role check) |
| `'public'` | No auth guard is injected — endpoints are publicly accessible |

💡 **Tip**: Use `'authenticated'` as the default and explicitly mark public endpoints. This follows the principle of least privilege.

## Security Considerations

## External token authentication with LINE Login

```bash
npx swallowkit add-auth --provider external-token
```

SwallowKit generates Bearer-token transport, mandatory Functions verification, normalized principals, and `authPolicy` authorization. Implement IdP-specific behavior in `lib/auth/external-token-adapter.ts` and the language-specific `external-token-verifier`. Both generated stubs fail closed.

With LIFF, send only the ID token, not client-provided profile data or a user ID:

```typescript
import liff from '@line/liff';
const liffId = process.env.NEXT_PUBLIC_LIFF_ID!;
async function ready() { await liff.init({ liffId }); }
export async function getToken() { await ready(); return liff.isLoggedIn() ? liff.getIDToken() : null; }
export async function login() { await ready(); if (!liff.isLoggedIn()) liff.login(); }
export async function logout() { await ready(); if (liff.isLoggedIn()) liff.logout(); }
```

TypeScript verifier example:

```typescript
export async function verifyExternalToken(token: string) {
  const body = new URLSearchParams({ id_token: token, client_id: process.env.LINE_CHANNEL_ID! });
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new ExternalTokenVerificationError(401, 'Invalid LINE ID token');
  const value = await response.json();
  return { userId: value.sub, userDetails: value.name || '', roles: ['authenticated'] };
}
```

For C#, POST the same form with `HttpClient` and map `sub` to `UserId`. For Python, use `requests.post(..., data={"id_token": token, "client_id": channel_id}, timeout=5)` and raise `ExternalTokenVerificationError(401, ...)` when LINE rejects it. Treat timeouts and provider outages as 503 and never continue business processing. Keep the Channel ID in environment settings and never log tokens or verification responses. Include the expected nonce when the login flow uses one.

For access tokens, use LINE's token verification endpoint, require a matching `client_id` and positive `expires_in`, and retrieve the profile server-side. The recommended example uses an OpenID Connect ID token.

### JWT Design

- Tokens are signed with a secret stored in the `JWT_SECRET` environment variable
- Tokens contain the user ID, login ID, and roles — **never** store API keys, passwords, or other sensitive data in the JWT payload
- Token expiry is configurable via `tokenExpiry` (default: `'24h'`)

### Cookie Settings

- The BFF sets cookies with `httpOnly`, `secure`, and `sameSite: 'strict'` flags
- `httpOnly` prevents JavaScript access (XSS protection)
- `secure` ensures cookies are only sent over HTTPS (except localhost)
- `sameSite: 'strict'` prevents CSRF attacks

### Defense in Depth

The auth flow uses a two-layer verification strategy:

| Layer | What It Checks | Why |
|-------|---------------|-----|
| **Next.js Middleware** (Edge Runtime) | Base64-decoded expiry timestamp only | Edge Runtime has no native crypto API — cannot verify JWT signatures |
| **Azure Functions** | Full JWT signature verification + role-based access | Functions have full Node.js/C#/Python runtime with crypto support |

This means an expired token is rejected early at the edge (fast, low cost), while a tampered token is caught at the Functions layer (full verification).

### What NOT to Put in JWT

- ❌ Backlog API keys or third-party tokens
- ❌ Passwords or password hashes
- ❌ Personally identifiable information beyond what's needed for auth
- ❌ Large data payloads (JWTs are sent with every request)

✅ **Safe to include**: user ID, login ID, roles, token expiry.

## Best Practices

### Local development with SWA authentication

`add-auth --provider swa` automatically wraps the application with `AuthProvider`. On Azure SWA, it obtains user information and roles from `/.auth/me`.

When SWA CLI is installed, `swallowkit dev` starts its authentication emulator. Configure a local user and roles at http://localhost:4280/.auth/login/aad, then use port 4280 to test authenticated pages and APIs. If SWA CLI is missing, install it in the project with the command shown by `swallowkit dev` and retry. With `--no-swa`, failure of `/.auth/me` is handled safely and the UI is rendered with an anonymous user.

### Choosing a Provider Mode

- ✅ Use `custom-jwt` when you have an existing user database and need full control over the auth flow
- ✅ Use `swa` for simple projects using SWA built-in authentication with Microsoft Entra ID
- ⏳ `swa-custom` is planned for cases where you need SWA convenience with custom extensions

### Secret Management

- Store `JWT_SECRET` in Azure App Settings (production) and `.env.local` (development)
- Use a strong, random secret — at least 256 bits (32+ characters)
- Rotate secrets periodically and redeploy
- Never commit secrets to source control

```bash
# .env.local (for local development)
JWT_SECRET=your-strong-random-secret-at-least-32-characters
USERDB_CONNECTION_STRING=postgres://user:pass@localhost:5432/mydb
```

### Role Naming

- Use lowercase, descriptive role names: `admin`, `estimator`, `viewer`
- Keep the number of roles small — prefer composing roles over creating fine-grained permissions
- Document your roles and what each one grants access to

### Auth Context Usage

Wrap your app with the auth provider and use the `useAuth` hook in components:

```typescript
// app/layout.tsx
import { AuthProvider } from '@/lib/auth/auth-context';

export default function RootLayout({ children }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```

```typescript
// In any component
import { useAuth } from '@/lib/auth/auth-context';

function Dashboard() {
  const { user, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;
  return <div>Welcome, {user.name}</div>;
}
```

## Limitations

The following are current limitations of the auth feature in v1:

- **No refresh tokens**: Tokens expire after the configured `tokenExpiry` period. Users must re-login when the token expires
- **No `swa-custom` mode**: SWA custom extensions are not implemented. Use built-in `swa` or `custom-jwt` authentication
- **No token revocation**: Issued JWTs cannot be invalidated before expiry. For immediate access revocation, rotate the `JWT_SECRET` (invalidates all tokens)
- **No Edge Runtime crypto**: Next.js Middleware (Edge Runtime) cannot verify JWT signatures — only expiry is checked at the middleware layer
- **No password reset flow**: The `add-auth` command does not generate password reset or account recovery endpoints
- **No multi-factor authentication**: MFA is not supported in the generated auth flow
- **No session management UI**: There is no admin interface for viewing or managing active sessions/tokens

💡 **Reference**: For CLI command details, see the **[CLI Reference](./cli-reference.md)**. For connector setup, see the **[Connector Guide](./connector-guide.md)**. For model scaffolding, see the **[Scaffold Guide](./scaffold-guide.md)**.
# Named authentication schemes

SwallowKit supports multiple authentication mechanisms without trying them in an implicit order. Define named schemes separately from authorization policies:

```js
auth: {
  schemes: {
    admin: { provider: 'swa', swa: { allowedProviders: ['github'], roleSource: 'swa-roles' } },
    lineUser: { provider: 'external-token' },
  },
  authorization: {
    defaultPolicy: 'anonymous',
    policies: {
      adminOnly: { schemes: ['admin'], roles: ['authenticated'] },
      lineUserOnly: { schemes: ['lineUser'], roles: ['authenticated'] },
    },
  },
}
```

Models may use `authPolicy = { read: 'adminOnly', write: 'adminOnly' }` or `{ policy: 'adminOnly' }`. Custom Functions use `await requireAuth(request, 'lineUserOnly')`. A policy accepts only its listed schemes. Multiple schemes are allowed only when their credential sources are distinguishable; ambiguous Bearer schemes are rejected during validation.

The canonical principal is `{ subject, scheme, issuer, roles, claims }`. Use `scheme + ':' + subject` for a global identity key. Compatibility `userId` and `userDetails` fields are deprecated. Never trust identity, roles, or profiles supplied by an unverified client.

The BFF remains a proxy: it forwards Bearer or SWA credentials and adds `x-functions-key`, but Functions perform final authentication and authorization. Credentials must not be logged. External-token verifiers are generated fail-closed and must validate signature, issuer, audience, and expiry while distinguishing invalid credentials (401) from IdP outages (503).

Legacy `auth.provider` is normalized to a `default` scheme. Legacy role arrays remain supported. `public` is accepted as a deprecated alias; the canonical value is `anonymous`.

## SWA administration and LINE-style user APIs

Use `adminOnly` for Campaign/Coupon management models and `lineUserOnly` for survey or coupon-claim models. Keep health models anonymous by omitting `authPolicy` while `defaultPolicy` is `anonymous`. Run:

```bash
swallowkit add-auth --scheme admin --provider swa
swallowkit add-auth --scheme lineUser --provider external-token
```

Implement `functions/src/auth/schemes/line-user/verifier.ts`; the generated stub rejects every token until then. Scope the generated providers from `lib/auth/schemes/admin/auth-context` and `lib/auth/schemes/line-user/auth-context` in the relevant route-group layouts. The line-user UI imports its scheme-specific authenticated fetch. UI role checks only improve UX—Functions remain the security boundary.

An admin SWA principal cannot select `lineUserOnly`, and a LINE Bearer token cannot select `adminOnly`. No provider fallback occurs after a failed verification. `swa-custom` remains reserved and is rejected for named schemes; combine `swa` with a separate custom or external scheme instead.
