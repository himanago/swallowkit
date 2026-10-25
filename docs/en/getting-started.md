# Getting started

See [package manager commands and troubleshooting](./package-managers.md) for pnpm 11/12 and npm usage.

This page walks you through creating a SwallowKit project and generating your first CRUD flow.

By the end, you will have a Next.js or React application with typed BFF routes, Azure Functions backend handlers, and UI components — all generated from a single Zod schema.

Choose React for a Vite SPA with a SWA managed Functions BFF. The [React guide](./react-guide.md)
covers its generated paths, authentication, local development and deployment. The path examples below use Next.js unless stated otherwise.

## Prerequisites

- Node.js 22.14 or later
- **pnpm** (recommended) — run `corepack enable` or install with `npm install -g pnpm`
  - npm also works. SwallowKit uses the invoking package manager; `--package-manager npm|pnpm` overrides detection.
- Azure Functions Core Tools 4.x — required for local Functions development
- Azure Cosmos DB Emulator — required for local data storage
  - Windows: [Download](https://aka.ms/cosmosdb-emulator)
  - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 1. Create a project

::: code-group
```bash [npm]
npx swallowkit init my-app
cd my-app
```
```bash [pnpm]
pnpm dlx swallowkit init my-app
cd my-app
```
:::

For Next.js, the command runs `create-next-app`. For React, it generates a Vite + React Router SPA and a separate managed Functions BFF.

Interactive prompts ask for:

| Option | Values | Default |
|--------|--------|---------|
| Frontend | `nextjs`, `react` | `nextjs` (non-interactive default) |
| CI/CD provider | `github`, `azure`, `skip` | (prompted) |
| Backend language | `typescript`, `csharp`, `python` | (prompted) |
| Cosmos DB mode | `freetier`, `serverless` | (prompted) |
| Network | `outbound`, `none` | (prompted) |
| SWA plan | `free`, `standard` | (prompted) |

To skip prompts, pass flags directly:

::: code-group
```bash [npm]
npx swallowkit init my-app --frontend react --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none --swa-plan free
```
```bash [pnpm]
pnpm dlx swallowkit init my-app --frontend react --cicd github --backend-language typescript --cosmos-db-mode serverless --vnet none --swa-plan free
```
:::

## 2. Create a model

::: code-group
```bash [npm]
npx swallowkit create-model todo
```
```bash [pnpm]
pnpm exec swallowkit create-model todo
```
:::

This generates `shared/models/todo.ts` with a template schema. Edit it:

```typescript
// shared/models/todo.ts
import { z } from 'zod';

export const todo = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todo>;
```

The `id`, `createdAt`, and `updatedAt` fields are managed by the backend. Define them as `optional()` in the schema.

## 3. Generate CRUD code

::: code-group
```bash [npm]
npx swallowkit scaffold todo
```
```bash [pnpm]
pnpm exec swallowkit scaffold todo
```
:::

This generates:

| Layer | Generated files |
|-------|----------------|
| Azure Functions | `functions/src/todo.ts` (TypeScript backend) |
| BFF routes | `app/api/todo/route.ts`, `app/api/todo/[id]/route.ts` |
| UI pages | `app/todo/page.tsx`, `app/todo/[id]/page.tsx`, `app/todo/new/page.tsx`, `app/todo/[id]/edit/page.tsx` |
| UI components | `app/todo/_components/TodoForm.tsx` |
| Infrastructure | `infra/containers/todo-container.bicep` |

For C# backends, the Functions file is `functions/Crud/TodoCrudFunctions.cs`. For Python, it is `functions/blueprints/todo.py`.

React instead generates `bff/src/todo/index.ts`, `bff/todo/function.json`,
and pages/forms/route registrations under `src/pages/todo/`.

## 4. Start the development server

::: code-group
```bash [npm]
npx swallowkit dev
```
```bash [pnpm]
pnpm exec swallowkit dev
```
:::

This starts:
- Next.js at http://localhost:3000
- Azure Functions at http://localhost:7071

Open http://localhost:3000/todo to see the generated UI.

**For React**, dev also starts the managed BFF (7073) and SWA CLI (4280).
Open **http://localhost:4280/todo** so `/api` requests pass through the managed BFF.
Standalone Functions stay on 7071 and are never linked to SWA.

## 5. Verify the result

- Navigate to http://localhost:3000/todo/new and create a todo item
- The form submits to the BFF route, which forwards to Azure Functions
- The item is stored in the local Cosmos DB Emulator
- The list page shows the created item

## What was generated

After `init` and `scaffold`, the project structure looks like:

```
my-app/
├── app/
│   ├── api/todo/          # BFF routes (auto-validation, proxy to Functions)
│   └── todo/              # React pages and components
├── shared/models/
│   └── todo.ts            # Zod schema (source of truth)
├── functions/src/
│   └── todo.ts            # Azure Functions CRUD handlers
├── infra/
│   ├── main.bicep         # Azure resource definitions
│   └── containers/        # Cosmos DB container definitions
├── lib/
│   └── api/               # BFF helper (callFunction)
└── .swallowkit/           # Project metadata
```

## Next steps

- [Core concepts](/en/concepts) — Understand the schema-centric architecture and BFF pattern
- [Scaffold guide](/en/scaffold-guide) — Advanced scaffold options, nested schemas, multiple models
- [Local development](/en/dev-guide) — Dev seeds, mock connectors, backend-specific setup
- [Deploy to Azure](/en/deployment-guide) — Provision resources and set up CI/CD
