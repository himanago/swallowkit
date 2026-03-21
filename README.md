# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

English | [日本語](./README.ja.md)

**Type-safe schema-driven development toolkit for Next.js applications on Azure**

SwallowKit enables developers to build full-stack Next.js applications with external Azure Functions backends while maintaining end-to-end type safety through shared Zod schemas.

Deploy your Next.js app to Azure Static Web Apps using standalone mode, and connect to independent Azure Functions for backend operations.

Next.js API routes are restricted to use only as BFF (Backend For Frontend), offloading business logic to Azure Functions to provide clear separation between client and server.

Featuring Scaffold functionality to automatically generate CRUD operations from Zod schemas, achieving type-safe integration with Cosmos DB and consistent type definitions and validation.

> **Note**: This project is in active development. APIs may change in future versions.

## ✨ Key Features

- **🔄 Zod Schema Sharing** - Keep Zod as the source of truth across frontend, BFF, Azure Functions, and Cosmos DB
- **⚡ CRUD Code Generation** - Auto-generate Azure Functions + Next.js code with `swallowkit scaffold`
- **🌐 Multi-language Functions Backends** - Choose TypeScript, C#, or Python for Azure Functions during `init`
- **🧬 OpenAPI Schema Bridge** - For C#/Python backends, `scaffold` exports OpenAPI from Zod and generates backend schema assets
- **🛡️ Contract Safety** - Keep frontend/BFF contracts aligned with backend implementations through shared Zod or generated OpenAPI-derived models
- **🎯 BFF Pattern** - Next.js API Routes as BFF layer with auto-validation and resource inference
- **☁️ Azure Optimized** - Minimal-cost architecture with Static Web Apps + Functions + Cosmos DB
- **🚀 Easy Deployment** - Auto-generated Bicep IaC + CI/CD workflows
- **🤖 AI-Friendly** - Auto-generated instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) and layer-specific rules help GitHub Copilot, Claude Code, and OpenAI Codex follow project conventions

## 📚 Documentation

Visit the **[SwallowKit Documentation](https://himanago.github.io/swallowkit/)** for the full docs (also available in [日本語](https://himanago.github.io/swallowkit/ja/)).

- **[CLI Reference](https://himanago.github.io/swallowkit/en/cli-reference)** - All commands in detail
- **[Scaffold Guide](https://himanago.github.io/swallowkit/en/scaffold-guide)** - CRUD code generation
- **[Zod Schema Sharing Guide](https://himanago.github.io/swallowkit/en/zod-schema-sharing-guide)** - Schema design
- **[Deployment Guide](https://himanago.github.io/swallowkit/en/deployment-guide)** - Deploy to Azure

## 🚀 Quick Start

### 1. Create Project

```bash
npx swallowkit init my-app
# or
pnpm dlx swallowkit init my-app
cd my-app
```

The interactive prompts ask for CI/CD provider, Azure Functions backend language, Cosmos DB mode, and network settings. You can also specify them as flags to skip prompts entirely:

```bash
# Non-interactive mode (useful for VS Code extensions or automation)
npx swallowkit init my-app --cicd github --backend-language python --cosmos-db-mode serverless --vnet outbound
```

| Flag | Values | Description |
|------|--------|-------------|
| `--cicd <provider>` | `github`, `azure`, `skip` | CI/CD provider |
| `--backend-language <language>` | `typescript`, `csharp`, `python` | Azure Functions backend language |
| `--cosmos-db-mode <mode>` | `freetier`, `serverless` | Cosmos DB pricing mode |
| `--vnet <option>` | `outbound`, `none` | Network security |

Omit any flag to be prompted for that value interactively.

### 2. Create Models

You can create multiple models at once:

```bash
npx swallowkit create-model category todo
# or
pnpm dlx swallowkit create-model category todo
```

This generates `shared/models/category.ts` and `shared/models/todo.ts`. Customize them by adding your required fields:

```typescript
// shared/models/category.ts
import { z } from 'zod';

export const category = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Category = z.infer<typeof category>;
```

For parent-child relationships, use **nested schemas** instead of ID references:

```typescript
// shared/models/todo.ts
import { z } from 'zod';
import { category } from './category';

export const todo = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  category: category.optional(),       // Nested object (not categoryId)
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todo>;
```

> **Tip**: Nesting preserves type safety and stores related data together in the document, which is natural for Cosmos DB's document model.

### 3. Generate CRUD Code

```bash
npx swallowkit scaffold shared/models/todo.ts
# or
pnpm dlx swallowkit scaffold shared/models/todo.ts
```

This auto-generates:
- ✅ Azure Functions (CRUD endpoints + Cosmos DB bindings)
- ✅ Next.js BFF API Routes (auto-validation + resource inference)
- ✅ React Components (type-safe forms)

If you selected `csharp` or `python` at `init` time, `swallowkit scaffold` also writes an OpenAPI document under `functions/openapi/` and generates backend schema assets under `functions/generated/`.

### 4. Start Development Server

```bash
npx swallowkit dev
# or
pnpm dlx swallowkit dev
```

- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

If you want to replace Cosmos DB Emulator data before startup, generate an environment template and then launch `dev` with that environment:

```bash
npx swallowkit create-dev-seeds local
# edit dev-seeds/local/*.json
npx swallowkit dev --seed-env local
```

This workflow is designed for local debugging against the Cosmos DB Emulator:

- `create-dev-seeds <environment>` generates one JSON template per schema under `dev-seeds/<environment>/`
- each file name maps to a schema/container, for example `shared/models/todo.ts` -> `dev-seeds/local/todo.json` -> `Todos`
- when you start `dev --seed-env <environment>`, SwallowKit replaces the existing data for each matching container with the JSON documents from that environment
- containers without a matching JSON file are left untouched
- if `--seed-env` is omitted, or `dev-seeds/<environment>/` does not exist, current emulator data is preserved

Example file layout:

```text
dev-seeds/
  local/
    todo.json
    category.json
  staging-debug/
    todo.json
```

Each `{schema}.json` file can contain either a single JSON object or an array of JSON objects. Every document must include an `id`:

```json
[
  {
    "id": "seed-todo-001",
    "name": "Seed todo one",
    "createdAt": "2026-03-21T00:00:00.000Z",
    "updatedAt": "2026-03-21T00:00:00.000Z"
  },
  {
    "id": "seed-todo-002",
    "name": "Seed todo two",
    "createdAt": "2026-03-21T00:00:01.000Z",
    "updatedAt": "2026-03-21T00:00:01.000Z"
  }
]
```

Recommended workflow:

```bash
npx swallowkit create-model todo
npx swallowkit scaffold shared/models/todo.ts
npx swallowkit create-dev-seeds local
# edit dev-seeds/local/todo.json
npx swallowkit dev --seed-env local
```

### 5. Use from Frontend

```typescript
import { api } from '@/lib/api/backend';
import type { Todo } from '@/shared/models/todo';

// Get all - call BFF endpoint
const todos = await api.get<Todo[]>('/api/todos');

// Create - validated by backend
const created = await api.post<Todo>('/api/todos', {
  text: 'Buy milk',
  completed: false
});

// Update - validated by backend
const updated = await api.put<Todo>('/api/todos/123', { completed: true });

// Delete
await api.delete('/api/todos/123');
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                            │
│  - Client Components                                         │
│  - Server Components (SSR)                                   │
└──────────────────────────┬───────────────────────────────────┘
                           │ api.post('/api/todos', data)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  BFF Layer (Next.js API Routes)                              │
│  - Auto Schema Validation (Zod)                              │
│  - Error Handling                                            │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP Request
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Azure Functions (Backend)                                   │
│  - HTTP Triggers (CRUD)                                      │
│  - Zod Validation (Re-check)                                 │
│  - Business Logic                                            │
│  - Cosmos DB Bindings                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Azure Cosmos DB                                             │
│  - NoSQL Database                                            │
│  - Zod Schema Validation                                     │
└─────────────────────────────────────────────────────────────┘
```

**Key Patterns:**
- **BFF (Backend For Frontend)**: Next.js API Routes proxy to Azure Functions
- **Shared Schemas**: Zod schemas stay in `shared/models/` as the source of truth
- **OpenAPI Bridge for C#/Python**: Non-TypeScript Functions consume generated assets under `functions/generated/`
- **Contract Safety**: BFF and backend stay aligned through shared Zod or generated backend models
- **Managed Identity**: Secure service connections (no connection strings)

## 📦 Prerequisites

- Node.js 22.x
- **pnpm** (recommended): `corepack enable` or `npm install -g pnpm`
  - npm also works — SwallowKit auto-detects the package manager (if pnpm is installed, it is always preferred)
- Azure Cosmos DB Emulator (local development)
  - [Official documentation (vNext recommended)](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux)
    - Windows: [Download](https://aka.ms/cosmosdb-emulator)
    - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 🚀 Deploy to Azure

Deploy your Next.js app to Azure Static Web Apps using standalone mode, and connect to independent Azure Functions for backend operations.

**1. Provision resources (Bicep IaC)**

```bash
npx swallowkit provision --resource-group my-app-rg --location japaneast
# or
pnpm dlx swallowkit provision --resource-group my-app-rg --location japaneast
```

After provisioning, the required CI/CD secret values are displayed in the terminal. Copy them.

**2. Push code**

```bash
git push origin main
```

**3. Cancel the auto-triggered CI/CD run** — it will fail because secrets are not registered yet.

**4. Register the displayed secret values** in GitHub (Settings → Secrets) or Azure DevOps (Pipelines → Library).

**5. Manually re-run the CI/CD workflow.**

See **[Deployment Guide](https://himanago.github.io/swallowkit/en/deployment-guide)** for details.

##  License

MIT

## 🔗 Related Links

- [Azure Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/)
- [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/)
- [Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)
