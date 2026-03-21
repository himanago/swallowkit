# CLI Reference

Comprehensive reference for all SwallowKit CLI commands and options.

## Table of Contents

- [swallowkit init](#swallowkit-init)
- [swallowkit create-model](#swallowkit-create-model)
- [swallowkit dev](#swallowkit-dev)
- [swallowkit scaffold](#swallowkit-scaffold)
- [swallowkit create-dev-seeds](#swallowkit-create-dev-seeds)
- [swallowkit provision](#swallowkit-provision)

## swallowkit init

Initialize a new SwallowKit project.

### Usage

```bash
npx swallowkit init [project-name] [options]
# or
pnpm dlx swallowkit init [project-name] [options]
```

### Arguments

- `project-name` (optional): Project name. Initializes in current directory if omitted

### Options

| Option | Description | Values | Default |
|--------|-------------|--------|---------|
| `--template <template>` | Template to use | `default` | `default` |
| `--next-version <version>` | Next.js version | e.g. `16.0.7`, `latest` | `latest` |
| `--cicd <provider>` | CI/CD provider | `github`, `azure`, `skip` | *(prompt)* |
| `--backend-language <language>` | Azure Functions backend language | `typescript`, `csharp`, `python` | *(prompt)* |
| `--cosmos-db-mode <mode>` | Cosmos DB mode | `freetier`, `serverless` | *(prompt)* |
| `--vnet <option>` | Network security | `outbound`, `none` | *(prompt)* |

### Interactive vs Non-Interactive Mode

By default, `init` asks interactive prompts for CI/CD, Azure Functions backend language, Cosmos DB mode, and network settings.

You can skip prompts by passing flags directly:

```bash
# Fully non-interactive
npx swallowkit init my-app --cicd github --backend-language csharp --cosmos-db-mode serverless --vnet outbound

# Partially non-interactive (only --cicd specified; the rest will prompt)
npx swallowkit init my-app --cicd skip
```

This is especially useful when calling the CLI from VS Code extensions or scripts where stdin is not a TTY.

Invalid flag values produce a clear error:

```
❌ Invalid --cicd value: "invalid". Must be: github, azure, skip
```

### Interactive Prompts

When flags are not specified, the following prompts are shown:

1. **CI/CD Provider**: GitHub Actions, Azure Pipelines, or Skip
2. **Backend Language**: TypeScript, C#, or Python
3. **Cosmos DB Mode**: Free Tier or Serverless
4. **Network Security**: VNet Integration or None

### Backend Language Notes

- `typescript`: Functions consume the shared Zod package directly.
- `csharp` / `python`: `swallowkit scaffold` exports OpenAPI into `functions/openapi/` and generates backend schema assets into `functions/generated/`.

### Generated Files

``` 
my-app/
├── app/                      # Next.js App Router
│   ├── api/greet/            # BFF sample
│   ├── layout.tsx
│   └── page.tsx
├── components/               # React components
├── lib/
│   ├── api/backend.ts        # BFF client (api.get/post/put/delete)
│   ├── database/             # Cosmos DB client (optional)
│   │   ├── client.ts         # CosmosClient
│   │   └── repository.ts     # Repository pattern
│   ├── models/               # Data models
│   └── schemas/              # Zod schemas
├── functions/                # Azure Functions
│   ├── src/                  # TypeScript handlers
│   ├── Crud/                 # C# handlers
│   ├── blueprints/           # Python handlers
│   ├── generated/            # OpenAPI-derived schema assets for C#/Python
│   ├── openapi/              # Exported OpenAPI specs for C#/Python
│   ├── host.json
│   └── local.settings.json
├── infra/                    # Bicep IaC
│   ├── main.bicep
│   ├── main.parameters.json
│   └── modules/
│       ├── staticwebapp.bicep
│       ├── functions.bicep
│       └── cosmosdb.bicep
├── .github/workflows/        # CI/CD (GitHub Actions)
│   ├── static-web-app.yml
│   └── azure-functions.yml
├── .github/
│   ├── copilot-instructions.md   # GitHub Copilot instructions
│   └── instructions/             # Copilot layer-specific rules
│       ├── shared-models.instructions.md
│       ├── bff-routes.instructions.md
│       └── azure-functions.instructions.md
├── .env.local                # Environment variables
├── .env.example
├── next.config.js
├── swallowkit.config.js
├── staticwebapp.config.json
├── AGENTS.md                 # Coding agent instructions (Codex)
├── CLAUDE.md                 # Claude Code instructions
└── package.json
```

### AI Agent Instruction Files

The `init` command automatically generates instruction files for multiple AI coding agents. These files help AI agents (GitHub Copilot, Claude Code, OpenAI Codex, etc.) follow the project's architecture and conventions when generating or modifying code.

#### Generated Files

| File | Target Agent | Description |
|------|-------------|-------------|
| `AGENTS.md` | OpenAI Codex / generic agents | Full architecture spec, conventions, naming rules, CLI skills |
| `CLAUDE.md` | Claude Code | Quick reference + CLI commands (references `AGENTS.md` for full spec) |
| `.github/copilot-instructions.md` | GitHub Copilot | Summary of key rules (auto-loaded by Copilot) |
| `.github/instructions/shared-models.instructions.md` | GitHub Copilot | Layer-specific rules for `shared/models/**` |
| `.github/instructions/bff-routes.instructions.md` | GitHub Copilot | Layer-specific rules for `app/api/**` |
| `.github/instructions/azure-functions.instructions.md` | GitHub Copilot | Layer-specific rules for `functions/**` |

The full content of the generated `AGENTS.md` is shown below:

````markdown
# AGENTS.md

This project was generated by **SwallowKit**.
All coding agents **must** follow the architecture and conventions described below.

## Architecture Overview

This is a full-stack TypeScript application deployed on Azure with the following layers:

```
Frontend (React / Next.js App Router)
  ↓ fetch('/api/{model}', ...)
BFF Layer (Next.js API Routes)
  ↓ HTTP → Azure Functions
Backend (Azure Functions with Cosmos DB bindings)
  ↓
Azure Cosmos DB (Document Database)
```

### Project Structure

```
my-app/
├── app/                    # Next.js App Router
│   ├── api/               # BFF API routes (proxy to Azure Functions)
│   └── {model}/           # UI pages per model (list, detail, create, edit)
├── functions/             # Azure Functions (backend)
│   └── src/               # HTTP trigger handlers with Cosmos DB bindings
├── shared/                # Shared workspace package
│   ├── models/            # Zod schema definitions (single source of truth)
│   └── index.ts           # Re-exports all models
├── lib/
│   └── api/               # API client utilities (backend.ts, call-function.ts)
├── components/            # Shared React components
├── infra/                 # Bicep infrastructure-as-code files
│   ├── main.bicep
│   └── modules/
└── .github/workflows/     # CI/CD workflows (if configured)
```

## Critical Design Principles

### 1. Next.js API Routes Are Strictly a BFF (Backend for Frontend)

- `app/api/` routes exist **only** to proxy requests to Azure Functions.
- **Never** place business logic, database access, or direct Cosmos DB calls in Next.js API routes.
- The BFF layer may validate input/output with Zod schemas before forwarding to Functions.
- Use the `callFunction` helper (`lib/api/call-function.ts`) or the `api` client (`lib/api/backend.ts`) to call Azure Functions.

Example BFF route pattern:

```typescript
// app/api/{model}/route.ts
import { callFunction } from '@/lib/api/call-function';
import { ModelSchema } from '@my-app/shared';
import { z } from 'zod/v4';

export async function GET() {
  return callFunction({
    method: 'GET',
    path: '/api/{model}',
    responseSchema: z.array(ModelSchema),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return callFunction({
    method: 'POST',
    path: '/api/{model}',
    body,
    inputSchema: ModelSchema.omit({ id: true, createdAt: true, updatedAt: true }),
    responseSchema: ModelSchema,
    successStatus: 201,
  });
}
```

### 2. Zod Schemas Are the Single Source of Truth

- All data models are defined **once** as Zod schemas in `shared/models/`.
- TypeScript types are derived with `z.infer<typeof Schema>` — never define types separately.
- The same schema is used in **all three layers**: frontend (validation), BFF (input/output validation), and Azure Functions (request/response validation + Cosmos DB documents).
- The shared package (`@my-app/shared`) is consumed by both Next.js and Azure Functions as a workspace dependency.

Model definition pattern:

```typescript
// shared/models/{model}.ts
import { z } from 'zod/v4';

export const Todo = z.object({
  id: z.string(),
  name: z.string().min(1),
  // ... your fields
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof Todo>;
export const displayName = 'Todo';
```

Key rules:
- Use the **Zod official pattern**: the schema constant and the TypeScript type share the same name.
- `id`, `createdAt`, and `updatedAt` are auto-managed by the backend. Mark them as `optional()` in the schema.
- Always re-export models from `shared/index.ts`.

### 3. Azure Functions Own All Business Logic and Data Access

- All CRUD operations and business logic live in `functions/src/`.
- Use Azure Functions Cosmos DB **input/output bindings** (`extraInputs`/`extraOutputs`) for reads and writes.
- Use the Cosmos DB SDK client directly **only** for delete operations (bindings do not support delete).
- Validate all data against Zod schemas before writing to Cosmos DB.
- The backend auto-generates `id` (UUID), `createdAt`, and `updatedAt` — never trust client-sent values for these fields.

Azure Functions handler pattern:

```typescript
// functions/src/{model}.ts
import { app } from '@azure/functions';
import { ModelSchema } from '@my-app/shared';

const containerName = 'Models'; // PascalCase + 's'

app.http('{model}-get-all', {
  methods: ['GET'],
  route: '{model}',
  authLevel: 'anonymous',
  extraInputs: [{ type: 'cosmosDB', name: 'cosmosInput', containerName, ... }],
  handler: async (request, context) => {
    const documents = context.extraInputs.get('cosmosInput');
    const validated = z.array(ModelSchema).parse(documents);
    return { status: 200, jsonBody: validated };
  },
});
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|--------|
| Model schema file | `shared/models/{kebab-case}.ts` | `shared/models/todo.ts` |
| Schema/type name | PascalCase (same name for both) | `export const Todo = z.object({...}); export type Todo = z.infer<typeof Todo>;` |
| Functions handler file | `functions/src/{kebab-case}.ts` | `functions/src/todo.ts` |
| Functions handler name | `{camelCase}-{operation}` | `todo-get-all`, `todo-create` |
| API route path | `/api/{camelCase}` | `/api/todo`, `/api/todo/{id}` |
| BFF route file | `app/api/{kebab-case}/route.ts` | `app/api/todo/route.ts` |
| BFF detail route | `app/api/{kebab-case}/[id]/route.ts` | `app/api/todo/[id]/route.ts` |
| UI page directory | `app/{kebab-case}/` | `app/todo/page.tsx` |
| React component | PascalCase | `TodoForm.tsx` |
| Cosmos DB container | PascalCase + 's' | `Todos` |
| Cosmos DB partition key | `/id` | Always `/id` |
| Bicep container file | `infra/containers/{kebab-case}-container.bicep` | `infra/containers/todo-container.bicep` |

## Adding New Models (SwallowKit CLI Skills)

Use the SwallowKit CLI — do **not** manually create model files or CRUD boilerplate.

### Skill: Create a new data model

```bash
npx swallowkit create-model <name>
# Multiple models at once:
npx swallowkit create-model user post comment
```

Creates `shared/models/<name>.ts` with a Zod schema template including `id`, `createdAt`, `updatedAt`.
Edit the generated file to add your domain-specific fields, then run scaffold.

### Skill: Generate full CRUD from a model

```bash
npx swallowkit scaffold shared/models/<name>.ts
```

Generates:
- Azure Functions handlers (`functions/src/<name>.ts`)
- BFF API routes (`app/api/<name>/route.ts`, `app/api/<name>/[id]/route.ts`)
- UI pages (`app/<name>/page.tsx`, detail, create, edit pages)
- Cosmos DB Bicep container config (`infra/containers/<name>-container.bicep`)

### Skill: Start development servers

```bash
npx swallowkit dev
```

Runs Next.js (http://localhost:3000) and Azure Functions (http://localhost:7071) concurrently.
Checks for Cosmos DB Emulator availability.

### Skill: Provision Azure resources

```bash
npx swallowkit provision --resource-group <name> --location <region>
```

Deploys Bicep infrastructure: Static Web Apps, Functions, Cosmos DB, Storage, Managed Identity.

### Typical workflow for "add a new feature/model"

1. `npx swallowkit create-model <name>`
2. Edit `shared/models/<name>.ts` — add fields
3. `npx swallowkit scaffold shared/models/<name>.ts`
4. `npx swallowkit dev` — verify at http://localhost:3000/<name>

## Do NOT

- **Do not** put business logic or database calls in `app/api/` routes. They are BFF only.
- **Do not** define TypeScript interfaces/types separately from Zod schemas. Always derive types with `z.infer<>`.
- **Do not** manually duplicate model definitions across layers. Use the shared package.
- **Do not** manually create CRUD boilerplate. Use `swallowkit scaffold`.
- **Do not** hardcode Cosmos DB connection strings. Use Managed Identity (`CosmosDBConnection__accountEndpoint`) in production and emulator settings locally.
- **Do not** change the partition key strategy. All containers use `/id` as the partition key.

## Technology Stack

- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS
- **BFF**: Next.js API Routes (proxy only)
- **Backend**: Azure Functions (TypeScript, Node.js)
- **Database**: Azure Cosmos DB (NoSQL)
- **Schema**: Zod (shared across all layers via workspace package)
- **Infrastructure**: Bicep (IaC)
- **Hosting**: Azure Static Web Apps (frontend) + Azure Functions Flex Consumption (backend)
- **Auth**: Azure Managed Identity (no connection strings in production)
- **Monitoring**: Application Insights
````

#### CLAUDE.md (Claude Code)

`CLAUDE.md` is a concise quick-reference file for Claude Code. It references `AGENTS.md` for the full specification and includes a CLI command table and workflow summary.

```markdown
# CLAUDE.md

This file is for Claude Code. Read AGENTS.md in the project root for the full
architecture, conventions, and rules.

## Quick Reference

- **Architecture**: Next.js (frontend) → BFF (API routes, proxy only)
  → Azure Functions (backend) → Cosmos DB
- **Schema**: Zod schemas in `shared/models/` are the single source of truth.
  Never define types separately.
- **BFF rule**: `app/api/` routes must ONLY proxy to Azure Functions via
  `callFunction()`. No business logic.
- **Backend rule**: All business logic and Cosmos DB access lives in
  `functions/src/`.

## SwallowKit CLI Commands

| Task | Command |
|------|---------|
| Create model | `npx swallowkit create-model <name>` |
| Generate CRUD | `npx swallowkit scaffold shared/models/<name>.ts` |
| Dev servers | `npx swallowkit dev` |
| Provision Azure | `npx swallowkit provision -g <rg> -l <region>` |

## Workflow: Add a new model

1. `npx swallowkit create-model <name>`
2. Edit `shared/models/<name>.ts` — add your fields
3. `npx swallowkit scaffold shared/models/<name>.ts`
4. `npx swallowkit dev` — verify at http://localhost:3000/<name>
```

#### .github/copilot-instructions.md (GitHub Copilot)

This file is automatically loaded by GitHub Copilot in VS Code. It contains a summary of the architecture, key rules, naming conventions, and managed fields.

#### .github/instructions/*.instructions.md (GitHub Copilot — Layer-Specific)

These files provide context-specific rules that GitHub Copilot applies when editing files matching the `applyTo` glob pattern:

| File | Applies To | Key Rules |
|------|-----------|-----------|
| `shared-models.instructions.md` | `shared/models/**` | Zod schema conventions, `id`/`createdAt`/`updatedAt` management, re-export from `shared/index.ts` |
| `bff-routes.instructions.md` | `app/api/**` | Proxy-only rule, `callFunction()` usage, no business logic |
| `azure-functions.instructions.md` | `functions/**` | Cosmos DB bindings, Zod validation, UUID auto-generation |

### Package Manager Detection

SwallowKit automatically selects the package manager:

- If **pnpm** is installed on the system, pnpm is always preferred
- Otherwise, **npm** is used

The generated project (lockfiles, workspace config, CI/CD scripts) matches the detected package manager.

### Examples

```bash
# Initialize in new directory (interactive)
npx swallowkit init my-awesome-app

# Initialize in new directory (non-interactive)
npx swallowkit init my-awesome-app --cicd github --cosmos-db-mode serverless --vnet outbound

# Using pnpm
pnpm dlx swallowkit init my-awesome-app

# After initialization
cd my-awesome-app
```

## swallowkit create-model

Create one or more Zod model template files under `shared/models/`.

### Usage

```bash
npx swallowkit create-model <names...> [options]
# or
pnpm dlx swallowkit create-model <names...> [options]
```

### Arguments

- `names...`: One or more model names

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--models-dir <dir>` | Output directory for generated model files | `shared/models` |

### What it does

For each model name, the command:

- creates `shared/models/<name>.ts`
- normalizes the file name to kebab-case and the schema/type name to PascalCase
- adds a re-export to `shared/index.ts` when that file exists
- includes `id`, `name`, `createdAt`, and `updatedAt` in the starter schema

Example:

```bash
npx swallowkit create-model todo category
```

Generated template:

```typescript
import { z } from 'zod/v4';

export const Todo = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof Todo>;
export const displayName = 'Todo';
```

### Existing file behavior

If the target file already exists, the command asks whether it should overwrite that file. If you answer `no`, that model is skipped and the remaining models continue.

### Typical workflow

```bash
npx swallowkit create-model todo
# edit shared/models/todo.ts
npx swallowkit scaffold shared/models/todo.ts
```

Use `create-model` to create the initial schema stub, then customize the generated Zod model before running `scaffold`.

## swallowkit dev

Start development servers (Next.js + Azure Functions).

### Usage

```bash
npx swallowkit dev [options]
# or
pnpm dlx swallowkit dev [options]
```

### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--port <port>` | `-p` | Next.js port | `3000` |
| `--functions-port <port>` | | Azure Functions port | `7071` |
| `--host <host>` | | Host name | `localhost` |
| `--open` | `-o` | Auto-open browser | `false` |
| `--no-functions` | | Skip Functions | `false` |
| `--seed-env <environment>` | | Replace matching Cosmos Emulator containers from `dev-seeds/<environment>` before startup | *(disabled)* |
| `--verbose` | `-v` | Show detailed logs | `false` |

### Behavior

1. **Cosmos DB Emulator Check**: Verify local emulator is running
2. **Cosmos DB Initialization**:
   - Create database if needed
   - Create model containers if needed
   - If `--seed-env <environment>` is provided and `dev-seeds/<environment>/` exists, replace each matching container with the JSON documents from that environment
3. **Azure Functions Start**: 
   - Check Azure Functions Core Tools
   - Auto-install dependencies
   - Start Functions in `functions/` directory
4. **Next.js Start**: Launch development server

### Dev Seed Workflow

Use environment-specific seed data when you want reproducible emulator state for debugging:

```bash
npx swallowkit create-dev-seeds local
# edit dev-seeds/local/*.json
npx swallowkit dev --seed-env local
```

Rules:

- File naming follows your schema files, for example `shared/models/todo.ts` -> `dev-seeds/local/todo.json`
- Each matching seed file replaces the entire contents of the corresponding Cosmos container
- Containers without a matching seed file are not modified
- If `--seed-env` is omitted, or the environment directory does not exist, existing emulator data is preserved
- Each document must have a non-empty string `id`

Example:

```json
[
  {
    "id": "seed-todo-001",
    "name": "Seed todo one",
    "createdAt": "2026-03-21T00:00:00.000Z",
    "updatedAt": "2026-03-21T00:00:00.000Z"
  }
]
```

### Examples

```bash
# Start with default settings
npx swallowkit dev

# Start with custom ports
npx swallowkit dev --port 3001 --functions-port 7072

# Auto-open browser
npx swallowkit dev --open

# Next.js only (no Functions)
npx swallowkit dev --no-functions

# Start with a seed environment
npx swallowkit dev --seed-env local

# Verbose logging
npx swallowkit dev --verbose
```

### Troubleshooting

**Cosmos DB Emulator not found:**
```
Error: Cosmos DB Emulator is not running
```

Solution:
- Windows: Install from [official site](https://aka.ms/cosmosdb-emulator)
- Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

**Azure Functions Core Tools missing:**
```
Error: Azure Functions Core Tools not found
```

Solution:
```bash
npm install -g azure-functions-core-tools@4
# or
pnpm add -g azure-functions-core-tools@4
```

**Port in use:**
```
Error: Port 3000 is already in use
```

Solution:
```bash
npx swallowkit dev --port 3001
```

## swallowkit scaffold

Auto-generate CRUD operations from Zod schemas.

### Usage

```bash
npx swallowkit scaffold <model-file> [options]
# or
pnpm dlx swallowkit scaffold <model-file> [options]
```

### Arguments

- `model-file` (required): Path to model file containing Zod schema

### Options

Currently no options.

### Generated Code

**1. Azure Functions (CRUD endpoints)**

```typescript
// functions/src/functions/{resource}.ts
- GET    /api/{resource}       - Get all
- GET    /api/{resource}/{id}  - Get by ID
- POST   /api/{resource}       - Create
- PUT    /api/{resource}/{id}  - Update
- DELETE /api/{resource}/{id}  - Delete
```

Each endpoint includes:
- ✅ Cosmos DB input/output bindings
- ✅ Automatic Zod schema validation
- ✅ Error handling
- ✅ TypeScript type safety
- ✅ Factory pattern support (shared `crud-factory.ts`)

**2. Next.js BFF API Routes**

```typescript
// app/api/{resource}/route.ts
// app/api/{resource}/[id]/route.ts
```

Each route:
- ✅ Calls Azure Functions backend
- ✅ Automatic schema validation
- ✅ Error handling

**3. React Components (optional)**

```typescript
// components/{Resource}List.tsx
// components/{Resource}Form.tsx
```

### Prerequisites

**Model file requirements:**

```typescript
// lib/models/todo.ts
import { z } from 'zod';

// 1. Define Zod schema
export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  createdAt: z.string().default(() => new Date().toISOString()),
});

// 2. Infer type from schema
export type TodoType = z.infer<typeof todoSchema>;
```

### Examples

```bash
# Generate CRUD from Todo model
npx swallowkit scaffold lib/models/todo.ts

# Generate CRUD from Product model
npx swallowkit scaffold lib/models/product.ts

```

### Usage After Generation

**From frontend:**

```typescript
import { api } from '@/lib/api/backend';
import type { TodoType } from '@/lib/models/todo';

// Get all
const todos = await api.get<TodoType[]>('/api/todos');

// Create (validated by backend)
const created = await api.post<TodoType>('/api/todos', {
  text: 'Buy milk',
  completed: false
});

// Update (validated by backend)
const updated = await api.put<TodoType>('/api/todos/123', {
  completed: true
});

// Delete
await api.delete('/api/todos/123');
```

### Details

See [Scaffold Guide](./scaffold-guide.md) for more information.

## swallowkit create-dev-seeds

Generate JSON seed templates for a named local environment from the current schemas in `shared/models/`.

### Usage

```bash
npx swallowkit create-dev-seeds <environment> [options]
# or
pnpm dlx swallowkit create-dev-seeds <environment> [options]
```

### Arguments

- `environment` (required): Name of the seed environment directory under `dev-seeds/`

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--models-dir <dir>` | Models directory to read schemas from | `shared/models` |
| `--seeds-dir <dir>` | Base directory for generated seed environments | `dev-seeds` |
| `--force` | Overwrite existing JSON seed files | `false` |

### What It Generates

For every schema under `shared/models/`, SwallowKit generates a JSON file under `dev-seeds/<environment>/`:

```text
dev-seeds/
  local/
    todo.json
    category.json
```

Template values are inferred from schema field types:

- strings -> sample strings
- numbers -> `0`
- booleans -> `false`
- enums -> first enum value
- `...At`/date fields -> ISO timestamp sample
- nested schemas -> nested JSON objects

### Typical Workflow

```bash
npx swallowkit create-model todo
npx swallowkit scaffold shared/models/todo.ts
npx swallowkit create-dev-seeds local
# edit dev-seeds/local/todo.json
npx swallowkit dev --seed-env local
```

## swallowkit provision

Provision Azure resources using Bicep.

### Usage

```bash
npx swallowkit provision [options]
# or
pnpm dlx swallowkit provision [options]
```

### Options

| Option | Short | Description | Required |
|--------|-------|-------------|----------|
| `--resource-group <name>` | `-g` | Resource group name | ✅ |
| `--location <location>` | `-l` | Azure region | ✅ |
| `--subscription <id>` | | Subscription ID | |

### Azure Regions

Recommended regions:
- `japaneast` - Japan East
- `japanwest` - Japan West
- `eastus2` - East US 2
- `westeurope` - West Europe

List all regions:
```bash
az account list-locations --output table
```

### Generated Resources

1. **Azure Static Web Apps**
   - SKU: Free
   - Build config: standalone Next.js

2. **Azure Functions**
   - Plan: Consumption (pay-per-execution)
   - Runtime: Node.js 22
   - OS: Linux

3. **Azure Cosmos DB**
   - Mode: Serverless
   - API: NoSQL
   - Consistency: Session

4. **Azure Storage Account**
   - For Functions storage
   - SKU: Standard_LRS

5. **Managed Identity**
   - Type: System-assigned
   - Role: Cosmos DB Data Contributor

### Examples

```bash
# Basic usage
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast

# With subscription
npx swallowkit provision \
  --resource-group my-app-rg \
  --location japaneast \
  --subscription "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Short options
npx swallowkit provision -g my-app-rg -l japaneast
```

### After Provisioning

```bash
# List resources
az resource list --resource-group my-app-rg --output table

# Get Static Web Apps URL
az staticwebapp show \
  --name <swa-name> \
  --resource-group my-app-rg \
  --query "defaultHostname" -o tsv

# Get Functions URL
az functionapp show \
  --name <function-name> \
  --resource-group my-app-rg \
  --query "defaultHostName" -o tsv
```

### Customizing Bicep Files

Edit Bicep files in `infra/` before provisioning:

```bicep
// infra/modules/functions-flex.bicep

// Customize instance memory size
resource flexFunctionsServer 'Microsoft.Web/sites@2023-12-01' = {
  // Flex Consumption properties
}
```

After editing, run `swallowkit provision` again to apply changes.

### Troubleshooting

**Resource group doesn't exist:**
```bash
# Create it
az group create --name my-app-rg --location japaneast
```

**Resources unavailable in region:**
```bash
# Check available regions
az provider show --namespace Microsoft.Web \
  --query "resourceTypes[?resourceType=='staticSites'].locations" -o table
```

**Quota exceeded:**
```bash
# Check quota
az vm list-usage --location japaneast --output table
```

## Global Options

Available for all commands:

| Option | Description |
|--------|-------------|
| `--help` | Show help |
| `--version` | Show version |

## Environment Variables

Control CLI behavior with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `SWALLOWKIT_LOG_LEVEL` | Log level (debug/info/warn/error) | `info` |
| `COSMOS_DB_ENDPOINT` | Cosmos DB endpoint | `https://localhost:8081/` |
| `BACKEND_API_URL` | Functions URL | `http://localhost:7071` |

## Next Steps

- [Deployment Guide](./deployment-guide.md) - Deploy to Azure
- [Scaffold Guide](./scaffold-guide.md) - CRUD code generation details
