# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/himanago.swallowkit-vscode?label=VS%20Code%20Extension)](https://marketplace.visualstudio.com/items?itemName=himanago.swallowkit-vscode)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

English | [日本語](./README.ja.md)

Schema-driven application scaffolding for Next.js and Azure.

SwallowKit helps you build maintainable full-stack applications on Azure by using shared Zod schemas as the source of truth. From one schema definition, it can generate frontend forms, BFF routes, Azure Functions backends, OpenAPI contracts, infrastructure templates, and AI-agent-friendly project metadata.

It is designed for developers who want to build Next.js applications on Azure without letting the frontend, backend, database model, validation rules, and deployment configuration drift apart.

## 🎯 Why SwallowKit?

AI can generate application code quickly. Frameworks can hide complexity nicely. But production applications still need explicit architecture.

In a typical full-stack application, the same domain model is repeated across many places:

- frontend form types
- client-side validation
- BFF request and response models
- backend DTOs
- API contracts
- database entities
- seed data
- infrastructure and deployment configuration

As the application grows, these layers often drift apart. SwallowKit reduces that drift by making the schema explicit and using it to generate the surrounding application structure.

**SwallowKit is not a full-stack framework that hides everything behind magic. It is a scaffolding toolkit that generates readable, editable, and replaceable code.**

## ✨ What it gives you

- **Shared Zod schemas** as the source of truth
- **CRUD scaffolding** for Next.js, BFF routes, Azure Functions, and UI components
- **Azure-ready infrastructure** using Bicep
- **Multi-language Azure Functions** backends (TypeScript, C#, Python)
- **Local development helpers** and seed data
- **AI/MCP-friendly** project metadata and commands
- **VS Code extension** support

## 🏗️ Typical architecture

SwallowKit is optimized for applications built with:

- Next.js
- Azure Static Web Apps
- Azure Functions
- Azure Cosmos DB
- Azure Bicep
- GitHub Actions or Azure Pipelines

The default architecture follows a BFF pattern:

```
Browser
  |
Next.js frontend
  |
Next.js BFF routes
  |
Azure Functions API
  |
Azure Cosmos DB
```

The BFF layer keeps frontend code simple while allowing backend services, authentication, authorization, and cloud resources to evolve independently.

> **Note**: This project is in active development. APIs may change in future versions.

## 📚 Documentation

Visit the **[SwallowKit Documentation](https://himanago.github.io/swallowkit/)** for the full docs (also available in [日本語](https://himanago.github.io/swallowkit/ja/)).

- **[Getting Started](https://himanago.github.io/swallowkit/en/getting-started)** - First project setup
- **[Core Concepts](https://himanago.github.io/swallowkit/en/concepts)** - Schema-centric architecture
- **[Scaffold Guide](https://himanago.github.io/swallowkit/en/scaffold-guide)** - CRUD code generation
- **[Local Development](https://himanago.github.io/swallowkit/en/dev-guide)** - Dev server, seeds, mock connectors
- **[Deployment Guide](https://himanago.github.io/swallowkit/en/deployment-guide)** - Deploy to Azure
- **[AI / MCP Guide](https://himanago.github.io/swallowkit/en/ai-mcp-guide)** - AI-agent integration
- **[Authentication](https://himanago.github.io/swallowkit/en/auth-guide)** - Auth and authorization
- **[Connectors](https://himanago.github.io/swallowkit/en/connector-guide)** - External data sources

## 🚀 Quick start

Create a new project:

```bash
npx swallowkit init my-app
cd my-app
```

Create a model and customize the schema:

```bash
npx swallowkit create-model todo
```

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

Generate CRUD code and start the dev server:

```bash
npx swallowkit scaffold todo
npx swallowkit dev
```

This generates Azure Functions, Next.js BFF routes, and React UI components — all typed from the shared schema.

## 🤖 AI-agent-friendly development

SwallowKit provides machine-readable project metadata and command interfaces so coding agents can inspect the project structure, generate code through official commands, and validate changes without directly rewriting unrelated files.

The goal is to make AI-assisted development safer by giving agents explicit architectural boundaries.

## 📦 Generated project structure

```
.
├── app/                  # Next.js pages and BFF API routes
├── shared/
│   └── models/           # Shared Zod schemas (source of truth)
├── functions/            # Azure Functions backend
├── infra/                # Bicep templates
├── lib/                  # BFF helpers and scaffold config
└── .swallowkit/          # SwallowKit project metadata
```

## 🔗 Status

SwallowKit is under active development. The API, project structure, and generated output may change.

Feedback, issues, and small example use cases are welcome.

## 📄 License

MIT
