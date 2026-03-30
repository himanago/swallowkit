# Authentication Guide

## Overview

SwallowKit's **Authentication** feature adds a complete auth infrastructure to your project — user login, JWT token management, role-based authorization, and React auth context — all generated from config with a single CLI command.

Three auth provider modes are supported:

| Mode | Description | Status |
|------|-------------|--------|
| `custom-jwt` | External RDB user database + JWT tokens | ✅ Available (v1) |
| `swa` | Static Web Apps built-in authentication | 🔜 Planned |
| `swa-custom` | Hybrid (SWA auth + custom extensions) | 🔜 Planned |

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

```bash
# npx
npx swallowkit add-connector userdb --type rdb --provider postgres

# pnpm
pnpm dlx swallowkit add-connector userdb --type rdb --provider postgres
```

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

```bash
# npx
npx swallowkit add-auth

# pnpm
pnpm dlx swallowkit add-auth
```

This creates login/logout/me endpoints, BFF routes, middleware, a login page, and React auth context. See [Generated Files](#generated-files) for the full list.

### 4. Add authPolicy to Models

For models that require role-based access, export an `authPolicy`:

```typescript
// shared/models/estimate.ts
export const authPolicy = { roles: ['admin', 'estimator'] };
```

### 5. Re-scaffold Models with Auth Policies

```bash
# npx
npx swallowkit scaffold shared/models/estimate.ts

# pnpm
pnpm dlx swallowkit scaffold shared/models/estimate.ts
```

Scaffold detects the `authPolicy` export and injects role guards into the generated Functions. See [Scaffold Integration](#scaffold-integration) for details.

### 6. Start Dev with Mock Connectors

```bash
# npx
npx swallowkit dev --mock-connectors

# pnpm
pnpm dlx swallowkit dev --mock-connectors
```

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
| `provider` | `'custom-jwt'` \| `'swa'` \| `'swa-custom'` | ✅ | Auth provider mode. Only `custom-jwt` is available in v1 |

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
| `middleware.ts` | Next.js middleware — checks cookie, validates expiry, adds Authorization header, redirects to /login if unauthenticated |
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

### Choosing a Provider Mode

- ✅ Use `custom-jwt` when you have an existing user database and need full control over the auth flow
- ✅ Use `swa` (when available) for simple projects where Azure AD / GitHub / social login is sufficient
- ✅ Use `swa-custom` (when available) when you need SWA convenience with custom extensions

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
- **No `swa` or `swa-custom` modes**: Only `custom-jwt` is implemented. SWA-based auth providers are planned for a future release
- **No token revocation**: Issued JWTs cannot be invalidated before expiry. For immediate access revocation, rotate the `JWT_SECRET` (invalidates all tokens)
- **No Edge Runtime crypto**: Next.js Middleware (Edge Runtime) cannot verify JWT signatures — only expiry is checked at the middleware layer
- **No password reset flow**: The `add-auth` command does not generate password reset or account recovery endpoints
- **No multi-factor authentication**: MFA is not supported in the generated auth flow
- **No session management UI**: There is no admin interface for viewing or managing active sessions/tokens

💡 **Reference**: For CLI command details, see the **[CLI Reference](./cli-reference.md)**. For connector setup, see the **[Connector Guide](./connector-guide.md)**. For model scaffolding, see the **[Scaffold Guide](./scaffold-guide.md)**.
