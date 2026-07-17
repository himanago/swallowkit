# Local development

This page covers the `swallowkit dev` command, local seed data management, and backend-specific setup.

## Starting the dev server

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm swallowkit dev
```
:::

This normally starts both servers:
- Next.js at http://localhost:3000
- Azure Functions at http://localhost:7071

When `auth.provider` is `swa`, it also starts the SWA authentication emulator at http://localhost:4280. Use port 4280 for authenticated UI testing. If SWA CLI is not installed, `swallowkit dev` prints the project-local installation command and exits before starting any servers.

### Options

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Next.js server port |
| `-f, --functions-port <port>` | Azure Functions port |
| `--host <host>` | Server hostname |
| `--seed-env <name>` | Apply seed data before startup |
| `-o, --open` | Open browser automatically |
| `-v, --verbose` | Verbose logging |
| `--no-functions` | Skip Azure Functions startup |
| `--mock-connectors` | Use mock connector server |
| `--swa-port <port>` | SWA authentication emulator port (default: `4280`) |
| `--no-swa` | Skip the SWA authentication emulator |

## Backend-specific behavior

### TypeScript

No additional setup required. Functions start immediately with `func start`.

### Python

`swallowkit dev` uses **uv** for local Python environment management:
- Installs or reuses a project-local `uv` binary under `.uv/bin`
- Keeps uv-managed Python under `.uv/python`
- Creates `functions/.venv` for the Functions app
- Creates `functions/.codegen-venv` for schema generation (used by `scaffold`)

You do not need to install Python or create virtualenvs manually.

### C#

Azure Functions isolated worker (.NET 10) requires a build step before the host responds. `swallowkit dev` waits up to 90 seconds for the Functions host to become ready before printing the URL.

Requires .NET 10 SDK and Azure Functions Core Tools 4.6.0 or later.

## Dev seeds

Dev seeds let you populate the local Cosmos DB Emulator with known data before starting the server.

### Create seed templates

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local
```
```bash [pnpm]
pnpm swallowkit create-dev-seeds local
```
:::

This generates one JSON file per model under `dev-seeds/local/`:

```
dev-seeds/
  local/
    todo.json
    category.json
```

Each file corresponds to a schema in `shared/models/`. Edit the files to add your test data:

```json
[
  {
    "id": "seed-todo-001",
    "text": "First todo",
    "completed": false,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

Every document must include an `id` field.

### Export current emulator data

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local --from-emulator --force
```
```bash [pnpm]
pnpm swallowkit create-dev-seeds local --from-emulator --force
```
:::

This exports the current data from matching Cosmos DB Emulator containers into the seed files. System properties like `_etag` are stripped automatically.

### Apply seeds on startup

::: code-group
```bash [npm]
npx swallowkit dev --seed-env local
```
```bash [pnpm]
pnpm swallowkit dev --seed-env local
```
:::

This replaces the data in each matching container with the JSON documents from `dev-seeds/local/`. Containers without a matching file are left untouched.

If `--seed-env` is omitted, existing emulator data is preserved.

### Use cases

- Replay a known state for demos or bug reproduction
- Preserve realistic data registered during manual testing
- Reset the emulator to a consistent state before validation
- Share test data with team members via the repository

## Mock connectors

For models that use external data connectors (MySQL, PostgreSQL, REST APIs), you can develop locally without the real external service:

::: code-group
```bash [npm]
npx swallowkit dev --mock-connectors
```
```bash [pnpm]
pnpm swallowkit dev --mock-connectors
```
:::

This starts a mock proxy server on port 7072 that:
- Intercepts requests to connector model routes
- Returns realistic fake data generated from the Zod schema
- Proxies standard Cosmos DB model requests to the real Functions runtime on port 7071

The frontend and BFF layer behave identically regardless of whether real or mock data is used.

## Next steps

- [Scaffold guide](/en/scaffold-guide) — CRUD generation and model configuration
- [Deploy to Azure](/en/deployment-guide) — Move from local to cloud
- [External connectors](/en/connector-guide) — Connect to MySQL, PostgreSQL, REST APIs
