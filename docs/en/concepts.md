# Core concepts

SwallowKit supports Next.js and React frontends. React uses a Vite SPA and SWA
managed Functions as the BFF; the independent Functions backend is never linked
to SWA. See the [React architecture and workflow](./react-guide.md).
The Next.js-specific paths below describe the default variant.

This page explains SwallowKit's design decisions and the responsibilities of each layer.

## Schema as the source of truth

Every model in a SwallowKit project is defined once as a Zod schema in `shared/models/`. This single definition drives:

- TypeScript types (via `z.infer<>`)
- Frontend form validation
- BFF request/response validation
- TypeScript/C# backend validation and generated Python Pydantic types
- Cosmos DB document shape
- OpenAPI contracts (for C#/Python backends)
- UI component generation

When you change the schema, you re-run `swallowkit scaffold` to regenerate the affected layers. The schema is the authority; generated code follows it.

## BFF pattern

The Backend for Frontend (BFF) validates browser requests and forwards them to standalone Azure Functions. Next.js uses API routes; React uses SWA managed Functions.

```
Browser → Next.js API routes / SWA managed BFF → standalone Azure Functions → Cosmos DB
```

The BFF layer:
- Validates requests using the shared Zod schema
- Infers the Azure Functions endpoint URL from the model name
- Forwards requests to Azure Functions via HTTP
- Returns typed responses to the frontend

This separation means the frontend never calls Azure Functions directly. Backend services, authentication, and cloud resources can change without affecting client code.

## Generated code and ownership

SwallowKit generates code that you own. There is no hidden runtime layer.

Commit generated code to your repository and review it as ordinary source. Regeneration behavior depends on each file's ownership.
Prefer changes in models, configuration, or extension points. If you edit a managed file directly, use plan/apply to review the overwrite conflict before regenerating it.

### Ownership classes

Generated artifacts are recorded in `.swallowkit/artifacts.json` (the artifact ledger, tracked in Git) together with an ownership class.

| Ownership | Meaning | On regeneration |
| --- | --- | --- |
| `managed` | Fully managed by SwallowKit (Functions CRUD, BFF routes, UI pages, etc.) | Overwritten. Files hand-edited after generation are detected as conflicts and require approval (`--approve`) to overwrite |
| `generated-once` | Templates generated only on first run | Never overwritten |
| `user-owned` | Owned by the developer (e.g. model files) | SwallowKit only creates them; subsequent edits belong to you |
| `extension-point` | Append points (`shared/index.ts`, Python `function_app.py`, navigation config, etc.) | Follow path-specific rules. `shared/index.ts` allows manual exports with no markers; Python registrations use a marker. Existing content is preserved |
| `metadata` | Tooling metadata (under `.swallowkit/`) | Rebuilt entirely by SwallowKit |

Editing a `managed` file is possible, but the change will be lost on regeneration — prefer making permanent changes in models, configuration, or extension points. If you do edit one, `swallowkit status` / `swallowkit machine inspect drift` will detect the divergence, and the plan / apply flow will ask for approval before overwriting.

## Layer responsibilities

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Schema | `shared/models/` | Type definitions, validation rules |
| Frontend | `app/{model}/` or `src/pages/{model}/` | Pages, forms, user interaction |
| BFF | `app/api/{model}/` or `bff/` | Request validation, Functions proxy |
| Backend | `functions/` | Business logic, data access, authorization |
| Infrastructure | `infra/` | Azure resource definitions (Bicep) |
| Metadata | `.swallowkit/` | Project manifest for tooling |

Each layer has a clear boundary. The BFF does not contain business logic. The frontend does not access the database. The backend does not render UI.

## Project manifest

SwallowKit maintains a machine-readable manifest at `.swallowkit/project.json`. This file records:

- Backend language
- Registered models and their schemas
- Connectors
- Auth configuration
- Generated artifacts

The manifest is used by `swallowkit machine` commands and the MCP server for project inspection and validation. You do not edit it directly.

## Human CLI and machine CLI

SwallowKit provides two CLI interfaces:

**Human CLI** — interactive prompts, colored output, guidance messages:

::: code-group
```bash [npm]
npx swallowkit@beta init my-app
npx swallowkit scaffold todo
npx swallowkit dev
```
```bash [pnpm]
pnpm dlx swallowkit@beta init my-app
pnpm exec swallowkit scaffold todo
pnpm exec swallowkit dev
```
:::

**Machine CLI** — non-interactive, JSON-only stdout, deterministic:

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine validate project
npx swallowkit machine generate scaffold todo --api-only
```
```bash [pnpm]
pnpm exec swallowkit machine inspect project
pnpm exec swallowkit machine validate project
pnpm exec swallowkit machine generate scaffold todo --api-only
```
:::

The machine CLI is designed for coding agents (GitHub Copilot, Claude Code, OpenAI Codex) and the bundled MCP server (`swallowkit-mcp`). It exposes the same generators and validators as the human CLI but in a structured format.

## Scaffold vs. framework

SwallowKit generates files and exits. It does not:
- Run a custom server at runtime
- Intercept requests at runtime
- Replace the generated application request path with a SwallowKit-specific server
- Hide implementation details behind proprietary abstractions

The generated BFF routes are standard Next.js API routes. The generated Functions are standard Azure Functions. You can replace any piece without breaking the rest.

## Next steps

- [Getting started](/en/getting-started) — Create your first project
- [Scaffold guide](/en/scaffold-guide) — CRUD generation details
- [AI / MCP guide](/en/ai-mcp-guide) — Machine interface and coding agent integration
