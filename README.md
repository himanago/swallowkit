# SwallowKit

[![npm version](https://img.shields.io/npm/v/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![npm downloads](https://img.shields.io/npm/dm/swallowkit.svg)](https://www.npmjs.com/package/swallowkit)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/himanago.swallowkit-vscode?label=VS%20Code%20Extension)](https://marketplace.visualstudio.com/items?itemName=himanago.swallowkit-vscode)
[![license](https://img.shields.io/npm/l/swallowkit.svg)](./LICENSE)

English | [日本語](./README.ja.md)

Schema-driven application scaffolding for Next.js or React on Azure.

SwallowKit helps you build maintainable full-stack applications on Azure by using shared Zod schemas as the source of truth. From one schema definition, it can generate frontend forms, BFF routes, Azure Functions backends, OpenAPI contracts, infrastructure templates, and AI-agent-friendly project metadata.

It is designed for developers who want to build Next.js or React applications on Azure without letting the frontend, backend, database model, validation rules, and deployment configuration drift apart.

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
- **CRUD scaffolding** for Next.js or React, BFF routes, Azure Functions, and UI components
- **Azure-ready infrastructure** using Bicep
- **Multi-language Azure Functions** backends (TypeScript, C#, Python)
- **Local development helpers** and seed data
- **AI/MCP-friendly** project metadata and commands
- **VS Code extension** support

## 🏗️ Typical architecture

SwallowKit is optimized for applications built with:

- Next.js, or React + Vite + React Router
- Azure Static Web Apps
- Azure Functions
- Azure Cosmos DB
- Azure Bicep
- GitHub Actions or Azure Pipelines

The default architecture follows a BFF pattern:

```
Browser
  |
Next.js or React frontend (SWA)
  |
Next.js API routes or SWA managed Functions BFF
  |
Independent Azure Functions API (not linked to SWA)
  |
Azure Cosmos DB
```

The BFF layer keeps frontend code simple while allowing backend services, authentication, authorization, and cloud resources to evolve independently.

> **Note**: This project is in active development. APIs may change in future versions.

## 📚 Documentation

Visit the **[SwallowKit Documentation](https://himanago.github.io/swallowkit/)** for the full docs (also available in [日本語](https://himanago.github.io/swallowkit/ja/)).

- **[Getting Started](https://himanago.github.io/swallowkit/en/getting-started)** - First project setup
- **[React frontend](docs/en/react-guide.md)** - React SPA, managed Functions BFF, development and deployment
- **[Core Concepts](https://himanago.github.io/swallowkit/en/concepts)** - Schema-centric architecture
- **[Scaffold Guide](https://himanago.github.io/swallowkit/en/scaffold-guide)** - CRUD code generation
- **[Local Development](https://himanago.github.io/swallowkit/en/dev-guide)** - Dev server, seeds, mock connectors
- **[Deployment Guide](https://himanago.github.io/swallowkit/en/deployment-guide)** - Deploy to Azure
- **[AI / MCP Guide](https://himanago.github.io/swallowkit/en/ai-mcp-guide)** - AI-agent integration
- **[Coding Agent Guide](https://himanago.github.io/swallowkit/en/coding-agent-guide)** - Lifecycle integration, ownership, and external process composition
- **[Authentication](https://himanago.github.io/swallowkit/en/auth-guide)** - Auth and authorization
- **[Connectors](https://himanago.github.io/swallowkit/en/connector-guide)** - External data sources

## 🚀 Quick start

Create a new project:

```bash
npx swallowkit init my-app
cd my-app
```

Choose Next.js or React in the wizard, or pass `--frontend react`.
React deploys static assets and an HTTP-only managed Functions BFF to SWA;
the standalone Functions backend remains separate and **is never linked to SWA**.
Existing configurations without a frontend setting retain Next.js.

For pnpm 11/12: bootstrap with `pnpm dlx swallowkit init my-app`, then use `pnpm exec swallowkit …` inside the project. `npx` selects npm; `--package-manager npm|pnpm` overrides detection. Node.js 22.14+ is required. MCP intentionally uses `latest` with the selected package manager. See [commands, workspace setup, and security troubleshooting](docs/en/package-managers.md).


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

## Publishing releases (maintainers)

Pushing a `v<version>` Git tag runs `.github/workflows/publish.yml`, including
the build, tests, and packed-consumer release gate. The tag, `package.json`,
and both version fields in `package-lock.json` must match.

| Version example | npm dist-tag |
| --- | --- |
| `2.0.0-alpha.1` | `alpha` |
| `2.0.0-beta.1` | `beta` |
| `2.0.0-rc.1` or other prereleases | `next` |
| `2.0.0` | `latest` |

After committing the release changes, prepare and publish an alpha with:

```sh
npm version 2.0.0-alpha.1
git push origin HEAD
git push origin v2.0.0-alpha.1
```

`npm version` updates both manifests and creates the version commit and tag.
For subsequent releases, use an explicit version such as `2.0.0-alpha.2`,
`2.0.0-beta.1`, or `2.0.0`. Prereleases never update `latest`.
The workflow still requires the repository's `NPM_TOKEN` secret.

To check the pipeline without publishing, run **Publish to npm** manually on
the release commit with **dry-run** enabled, before pushing the version tag.
The summary reports the selected version and npm tag without claiming a publish.

Consumer release gates run on separate runners for pnpm 11, pnpm 12, and npm.
Their generated applications and package caches do not accumulate on the publish
runner; publication still requires every gate, the build, and the tests to pass.
Consumer logs and dependency audits are uploaded even when a gate fails.

If a release failed before npm publication and the fix only changes the release
workflow, do not move or recreate its Git tag. After merging the workflow fix,
run **Publish to npm** from `main`, set **release-tag** to the existing tag
(for example, `v2.0.0-alpha.1`), and enable **dry-run** first. The workflow resolves
that tag once and checks out the same commit for every gate and for publication.
After a successful dry run, repeat with **dry-run** disabled to publish.
GitHub's **Re-run jobs** uses the old workflow revision and will not pick up the fix.
If the package itself needs changes, create a new version and tag instead.

Try the exact alpha with `npx swallowkit@2.0.0-alpha.1 init my-app --frontend react`,
or use `npx swallowkit@alpha ...` / `npx swallowkit@beta ...` for the respective
channel. Plain `npx swallowkit ...` continues to use `latest`.

## 🔗 Status

SwallowKit is under active development. The API, project structure, and generated output may change.

Feedback, issues, and small example use cases are welcome.

## 📄 License

MIT
