# React frontend

Choose React when you need a client-rendered application rather than Next.js
SSR or React Server Components. SwallowKit generates a React + TypeScript SPA
with Vite, React Router, and Tailwind CSS, while keeping the same independent
Azure Functions backend, shared Zod schemas, connectors, and authorization.

The home page uses the same presentation template as Next.js: the gradient
background, connection-test card and states, model cards, empty state, and
footer. CRUD and login pages also share their UI templates, with React Router
handling navigation. Global colors, body typography, and system light/dark
mode follow the Next.js defaults; React does not require the Next.js runtime.
These defaults apply to newly initialized projects and do not overwrite
customized pages or styles in existing applications.

## Initialize

The init wizard offers **Next.js** and **React**. For unattended initialization:

```sh
npx swallowkit init my-app --frontend react --package-manager npm --cicd github --backend-language typescript --cosmos-db-mode freetier --vnet none --swa-plan free
```

For pnpm, use `pnpm dlx swallowkit init ... --package-manager pnpm`, then
`pnpm exec swallowkit ...` in the project. Backend languages remain
`typescript`, `csharp`, and `python`; the managed BFF is always TypeScript.
`--next-version` applies only to Next.js.

The choice is stored in `swallowkit.config.js`:

```js
module.exports = {
  frontend: { framework: 'react' },
  backend: { language: 'typescript' },
};
```

Configurations without `frontend.framework`, and non-interactive init calls
without `--frontend`, retain Next.js. Changing the setting on an existing
Next.js application is **not** an automatic migration of its custom pages.

## Two separate Functions layers

```text
Browser
  → SWA: React static assets
  → SWA /api: managed HTTP-only Functions BFF (bff/)
  → standalone Functions (functions/)
  → Cosmos DB / external connectors
```

**Do not link the standalone Functions app to SWA.** SWA owns only the managed
BFF. Independent backend deployment, language, bindings, managed identity,
VNet integration, and Cosmos access remain unchanged.

The BFF validates shared schemas and forwards requests using
`BACKEND_FUNCTIONS_BASE_URL` and `BACKEND_FUNCTIONS_KEY`. Remote calls require
HTTPS and a Functions key. Only local HTTP loopback development permits no key.
The browser calls same-origin `/api`, never the backend directly. Do not use
`VITE_*` variables for backend settings or import server helpers into the SPA.

Managed BFF handlers use classic `function.json` HTTP registrations and
`platform.apiRuntime: node:20`. They have no database bindings, non-HTTP triggers,
or managed identity. Shared schemas and Zod are bundled into each handler, so
deploying the BFF does not depend on resolving workspace links inside Oryx.

## Generated paths and CRUD

```text
src/
  main.tsx, App.tsx, Home.tsx
  pages/todo/               # list/detail/new/edit, forms and routes.tsx
bff/
  src/todo/index.ts         # schema-validated BFF handler
  src/lib/call-function.ts  # server-only request/credential forwarding
  todo/function.json       # /api/todo/{id?}
  build.cjs                # explicit handler bundling
functions/                 # independent backend, not the SWA API location
shared/models/             # Zod source of truth
lib/scaffold-config.ts     # home navigation entries
staticwebapp.config.json   # SPA fallback, security, SWA auth
infra/                     # same independent-backend infrastructure
```

Use the normal commands:

```sh
npx swallowkit create-model todo
npx swallowkit scaffold todo
npx swallowkit dev
```

The SPA discovers generated `routes.tsx` modules automatically. Custom pages
and routes can live outside managed artifacts. `--api-only` skips UI but still
generates backend and managed BFF handlers. React's default `--api-dir` is
`bff`; Next.js retains `app/api`.

Machine/MCP generation and plan/apply use the same configuration and generators.
Inspection reports `frontendFramework: react` and the actual React/BFF paths.
Keep ownership, drift, and approval checks intact.

## Local development

| Service | Default port | Role |
| --- | --- | --- |
| SWA CLI | 4280 | Application entry point, same-origin API routing, SWA auth |
| Vite | 3000 | Frontend development server |
| Managed BFF Functions | 7073 | BFF only |
| Standalone Functions | 7071 | Backend |
| Connector mock (opt-in) | Functions port + 1 | Mock connector responses behind the BFF |

Open **http://localhost:4280**. Direct Vite access does not provide same-origin
`/api` or SWA authentication. Override ports with `--port`, `--bff-port`,
`--functions-port`, and `--swa-port`. Ports must be distinct.

`--no-functions` skips only the standalone backend; the BFF still starts.
`--no-swa` skips SWA routing/authentication, leaving the direct servers for
isolated frontend/BFF work. It is not an end-to-end app mode.
`--mock-connectors` sends BFF requests through the connector mock, not around
the BFF. Core Tools v4 is required even with `--no-functions`.

Backend local settings remain in `functions/local.settings.json`; managed BFF
local settings are in `bff/local.settings.json`. Both are gitignored.
`dev` passes the selected backend/mock URL to the BFF; do not change browser
environment variables to route API traffic.

Use an existing Cosmos DB Emulator. If it is unavailable, report the prerequisite
instead of starting/reconfiguring it automatically. Test with an isolated
database; `--seed-env` replaces data and must not target an existing user database.

## Authentication and connectors

The existing auth plan/apply workflow supports `swa`, `external-token`,
`custom-jwt`, and named schemes. React uses managed BFF handlers rather than
Next.js proxy or API route files.

- SWA authentication forwards the platform-injected, normalized principal.
- External-token forwards a bearer token; implement the generated verifier and
  client adapter before expecting successful authentication.
- Custom JWT login stores the token in an HttpOnly, SameSite cookie (Secure in
  production); the BFF converts it to a bearer token for backend verification.
- Credentials remain request-local. Backend Functions enforce model policies
  and roles; UI visibility is not authorization.

As with Next.js, generated CRUD does **not** implement per-user data ownership.
Add custom backend endpoints and scoping when required. Connector operations
remain limited to the operations declared on the model.

## Build, verify, deploy

```sh
npm run build
npx swallowkit machine verify project
npx swallowkit machine verify project --checks "structure,drift,typecheck,backend-build,build"
```

Build compiles shared schemas, typechecks/builds the SPA, copies SWA config to
`dist/`, and typechecks/bundles the BFF. Verification also checks the managed
BFF types. Build the standalone TypeScript backend separately with
`npm run --workspace=functions build`; C#/Python retain their native workflow.

Exercise list/create/read/update/delete, invalid input, authentication and
authorization failures through the SWA port. A green typecheck does not prove
runtime behavior, a verifier stub implementation, or Azure deployment.

Generated GitHub Actions and Azure Pipelines build with the selected package
manager, then deploy with:

```yaml
app_location: dist
api_location: bff
output_location: ''
skip_app_build: true
skip_api_build: true
```

The separate Functions workflow deploys `functions/`, as before. After approved
provisioning/backend deployment, apply the generated SWA appsettings module to
set the backend URL and host key. Never set `api_location: functions` or link
that app to SWA.

SPA deep links fall back to `/index.html`; `/api/*`, `/.auth/*`, and static assets
are excluded so missing API requests cannot turn into successful HTML responses.

Generated `AGENTS.md`, Claude/Copilot adapters, and path-specific instructions
describe the selected framework and the plan/apply/verify workflow. This
repository's own root `AGENTS.md` is a separate contributor contract.
