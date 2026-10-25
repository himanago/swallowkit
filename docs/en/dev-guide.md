# Local development

For React, `dev` starts Vite (3000), managed BFF Functions (7073), independent
Functions (7071), and SWA CLI (4280). Open the SWA port, not Vite directly.
`--bff-port` changes the managed API port. `--no-functions` retains the BFF;
`--no-swa` removes same-origin routing/auth emulation.
See [React local development](./react-guide.md#local-development) for settings
and prerequisites. Next.js-specific steps below apply only to Next.js projects.

See [package manager commands and troubleshooting](./package-managers.md) for pnpm 11/12 and npm usage.

This page covers the `swallowkit dev` command, local seed data management, and backend-specific setup.

## Starting the dev server

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm exec swallowkit dev
```
:::

This normally starts both servers:
- Next.js at http://localhost:3000
- Azure Functions at http://localhost:7071

When `auth.provider` is `swa`, it also starts the SWA authentication emulator at http://localhost:4280. Use port 4280 for authenticated UI testing. If SWA CLI is not installed, `swallowkit dev` prints the project-local installation command and exits before starting any servers.

### Next.js styling

SwallowKit uses webpack for Next.js development and builds. New projects
explicitly include `@tailwindcss/postcss` and a PostCSS configuration, even
when the current `create-next-app` template configures Tailwind only for
Turbopack. Existing PostCSS configuration files are preserved.
If an existing project has Tailwind classes but no styled output, install
`@tailwindcss/postcss` as a dev dependency and enable it in your PostCSS
configuration; a Turbopack-only CSS loader does not run with webpack.

### Parallel development with Git worktrees

When `swallowkit dev` runs in a Git linked worktree, it automatically isolates that worktree's local Cosmos DB data. All worktrees share the same Cosmos DB Emulator process, but linked worktrees append an eight-character hash of the canonical worktree root path to the configured database name. For example, `MyAppDatabase` becomes `MyAppDatabase_a31f92c4`.

The main worktree keeps the existing database name without a suffix. Seed replacement and `create-dev-seeds --from-emulator` use the resolved database, so parallel coding agents in different linked worktrees do not delete or replace each other's containers or data. The startup log shows the resolved database name and whether worktree isolation is enabled.

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
- Reuses installed `uv`; bootstraps `.uv/bin` only if uv is missing, without changing PATH
- Uses normal uv interpreter discovery (including installed Python and the Windows registry), `.python-version`, `UV_PYTHON`, and user configuration; does not force a managed download, cache directory, or Python 3.11
- Creates `functions/.venv` for the Functions app
- Creates `functions/.codegen-venv` for schema generation (used by `scaffold`)

If Python is not installed, uv may download it according to your settings. New projects do not create a `.python-version` pin. An existing pin remains effective: update it explicitly if you want another interpreter. Existing environments are reused and are never automatically cleared. When switching Python, explicitly recreate the environment with uv after preserving anything you need.

On Windows with Smart App Control, an unsigned interpreter or venv executable may be blocked. Use a trusted interpreter (for example official CPython) and explicitly select it with uv; do not disable application-control policy. An execution failure reports the executable path and preserves the environment.

Local interpreter selection is separate from the generated Azure runtime and CI version (Python 3.14, the current GA default). Python 3.15 is currently in Azure Functions preview; Core Tools 4.14.0 currently accepts only Python 3.10–3.14. Use an interpreter supported by your Core Tools version for `dev`, even if scaffold works with a newer Python. A Functions startup failure stops dev rather than reporting the backend as still warming up.

Schema-tool installation defaults to PyYAML's pure-Python mode when building from source, avoiding a C compiler requirement for its optional accelerator. An explicit `PYYAML_FORCE_LIBYAML` setting is respected.

### C#

Azure Functions isolated worker (.NET 10) starts with `dotnet run`, which builds and launches Core Tools from the output directory so function extensions load correctly. The requested `--functions-port` is forwarded to the host. `swallowkit dev` waits up to 90 seconds for readiness.

React/Vite excludes standalone `functions/`, managed `bff/`, `.uv/`, `.swallowkit/`, and compiled `shared/dist/` from file watching, including when starting existing projects through `swallowkit dev`. Your Vite configuration and other ignore rules are retained, and frontend files and shared model sources remain watched.

Requires .NET 10 SDK and Azure Functions Core Tools 4.6.0 or later.

New C# projects use Cosmos SDK 3.63.2, including fixes for binary query
responses. In existing generated projects using 3.47.0, update the
`Microsoft.Azure.Cosmos` reference in `functions/*.csproj` to 3.63.2 and run
`dotnet restore`. This fixes the `Unknown JsonNodeType: Unknown` exception
when reading query results, including list endpoints and lookups with a
custom partition key; resetting the emulator or deleting data is unnecessary.

## Dev seeds

Dev seeds let you populate the local Cosmos DB Emulator with known data before starting the server.

### Create seed templates

::: code-group
```bash [npm]
npx swallowkit create-dev-seeds local
```
```bash [pnpm]
pnpm exec swallowkit create-dev-seeds local
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
pnpm exec swallowkit create-dev-seeds local --from-emulator --force
```
:::

This exports the current data from matching Cosmos DB Emulator containers into the seed files. System properties like `_etag` are stripped automatically.

### Apply seeds on startup

::: code-group
```bash [npm]
npx swallowkit dev --seed-env local
```
```bash [pnpm]
pnpm exec swallowkit dev --seed-env local
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
pnpm exec swallowkit dev --mock-connectors
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
