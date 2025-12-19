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

- **🔄 Zod Schema Sharing** - Same schema across frontend, BFF, Azure Functions, and Cosmos DB
- **⚡ CRUD Code Generation** - Auto-generate Azure Functions + Next.js code with `swallowkit scaffold`
- **🛡️ Full Type Safety** - End-to-end TypeScript from client to database
- **🎯 BFF Pattern** - Next.js API Routes as BFF layer with auto-validation and resource inference
- **☁️ Azure Optimized** - Minimal-cost architecture with Static Web Apps + Functions + Cosmos DB
- **🚀 Easy Deployment** - Auto-generated Bicep IaC + CI/CD workflows

## 📚 Documentation

- **[CLI Reference](./docs/cli-reference.md)** - All commands in detail
- **[Scaffold Guide](./docs/scaffold-guide.md)** - CRUD code generation
- **[Zod Schema Sharing Guide](./docs/zod-schema-sharing-guide.md)** - Schema design
- **[Deployment Guide](./docs/deployment-guide.md)** - Deploy to Azure

## 🚀 Quick Start

### 1. Create Project

```bash
npx swallowkit init my-app
cd my-app
```

### 2. Create Model

```bash
npx swallowkit create-model todo
```

This generates `lib/models/todo.ts`. Customize it by adding your required fields:

```typescript
// lib/models/todo.ts
import { z } from 'zod';

export const todoSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(200),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof todoSchema>;
```

### 3. Generate CRUD Code

```bash
npx swallowkit scaffold lib/models/todo.ts
```

This auto-generates:
- ✅ Azure Functions (CRUD endpoints + Cosmos DB bindings)
- ✅ Next.js BFF API Routes (auto-validation + resource inference)
- ✅ React Components (type-safe forms)

### 4. Start Development Server

```bash
npx swallowkit dev
```

- Next.js: http://localhost:3000
- Azure Functions: http://localhost:7071

### 5. Use from Frontend

```typescript
import { api } from '@/lib/api/backend';
import type { Todo } from '@/lib/models/todo';

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
- **Shared Schemas**: Zod schemas used across frontend, BFF, Functions, and DB
- **Type Safety**: TypeScript types auto-inferred from Zod
- **Managed Identity**: Secure service connections (no connection strings)

## 📦 Prerequisites

- Node.js 22.x
- Azure Cosmos DB Emulator (local development)
  - [Official documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator)
    - Windows: [Download](https://aka.ms/cosmosdb-emulator)
    - Docker: `docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`

## 🚀 Deploy to Azure

Deploy your Next.js app to Azure Static Web Apps using standalone mode, and connect to independent Azure Functions for backend operations.

```bash
# 1. Provision resources (Bicep IaC)
npx swallowkit provision --resource-group my-app-rg --location japaneast

# 2. Configure CI/CD secrets (see deployment guide for details)

# 3. Push code for auto-deploy
git push origin main
```

See **[Deployment Guide](./docs/deployment-guide.md)** for details.

##  License

MIT

## 🔗 Related Links

- [Azure Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/)
- [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/)
- [Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)
