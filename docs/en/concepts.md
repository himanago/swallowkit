# Core concepts

This page explains SwallowKit's design decisions and the responsibilities of each layer.

## Schema as the source of truth

Every model in a SwallowKit project is defined once as a Zod schema in `shared/models/`. This single definition drives:

- TypeScript types (via `z.infer<>`)
- Frontend form validation
- BFF request/response validation
- Backend handler validation
- Cosmos DB document shape
- OpenAPI contracts (for C#/Python backends)
- UI component generation

When you change the schema, you re-run `swallowkit scaffold` to regenerate the affected layers. The schema is the authority; generated code follows it.

## BFF pattern

SwallowKit generates a Backend-For-Frontend layer using Next.js API routes. The BFF sits between the browser and Azure Functions:

```
Browser → Next.js BFF routes → Azure Functions → Cosmos DB
```

The BFF layer:
- Validates requests using the shared Zod schema
- Infers the Azure Functions endpoint URL from the model name
- Forwards requests to Azure Functions via HTTP
- Returns typed responses to the frontend

This separation means the frontend never calls Azure Functions directly. Backend services, authentication, and cloud resources can change without affecting client code.

## Generated code and ownership

SwallowKit generates code that you own. There is no hidden runtime layer.

- Generated files are committed to your repository
- You can edit any generated file
- Re-running `scaffold` overwrites previously generated files for that model
- If you need behavior that differs from the generator, edit the file directly

SwallowKit is a scaffolding tool, not a framework. It produces a starting point; you take it from there.

## Layer responsibilities

| Layer | Location | Responsibility |
|-------|----------|---------------|
| Schema | `shared/models/` | Type definitions, validation rules |
| Frontend | `app/{model}/` | Pages, forms, user interaction |
| BFF | `app/api/{model}/` | Request validation, Functions proxy |
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
npx swallowkit init my-app
npx swallowkit scaffold todo
npx swallowkit dev
```
```bash [pnpm]
pnpm dlx swallowkit init my-app
pnpm swallowkit scaffold todo
pnpm swallowkit dev
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
pnpm swallowkit machine inspect project
pnpm swallowkit machine validate project
pnpm swallowkit machine generate scaffold todo --api-only
```
:::

The machine CLI is designed for coding agents (GitHub Copilot, Claude Code, OpenAI Codex) and the bundled MCP server (`swallowkit-mcp`). It exposes the same generators and validators as the human CLI but in a structured format.

## Scaffold vs. framework

SwallowKit generates files and exits. It does not:
- Run a custom server at runtime
- Intercept requests at runtime
- Require a specific runtime dependency beyond Next.js and Azure Functions
- Hide implementation details behind proprietary abstractions

The generated BFF routes are standard Next.js API routes. The generated Functions are standard Azure Functions. You can replace any piece without breaking the rest.

## Next steps

- [Getting started](/en/getting-started) — Create your first project
- [Scaffold guide](/en/scaffold-guide) — CRUD generation details
- [AI / MCP guide](/en/ai-mcp-guide) — Machine interface and coding agent integration
