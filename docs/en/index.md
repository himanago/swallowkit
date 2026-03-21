---
layout: home

hero:
  name: "SwallowKit"
  text: "Type-Safe Azure Dev Toolkit"
  tagline: Schema-driven full-stack development for Next.js on Azure. End-to-end type safety with shared Zod schemas.
  image:
    src: /logo.png
    alt: SwallowKit
  actions:
    - theme: brand
      text: Get Started
      link: /en/scaffold-guide
    - theme: alt
      text: CLI Reference
      link: /en/cli-reference
    - theme: alt
      text: View on GitHub
      link: https://github.com/himanago/swallowkit

features:
  - icon: 🔄
    title: Zod Schema Sharing
    details: Define your schema once and share it across the frontend, BFF, Azure Functions, and Cosmos DB — no duplication, no drift.
  - icon: ⚡
    title: CRUD Code Generation
    details: Run <code>swallowkit scaffold</code> to automatically generate Azure Functions, Next.js BFF routes, and React UI components from your Zod schema.
  - icon: 🛡️
    title: Full Type Safety
    details: End-to-end TypeScript from the React client to the Cosmos DB document. Types are always inferred from your schema, never written by hand.
  - icon: 🎯
    title: BFF Pattern
    details: Next.js API Routes act as a typed Backend-For-Frontend proxy layer, with automatic Zod validation and Azure Functions resource-name inference.
  - icon: ☁️
    title: Azure Optimised
    details: Minimal-cost reference architecture using Azure Static Web Apps, Azure Functions, and Azure Cosmos DB — with Managed Identity throughout.
  - icon: 🚀
    title: Zero-Config Deployment
    details: Provision Azure resources with Bicep IaC and get auto-generated GitHub Actions or Azure Pipelines CI/CD workflows in one command.
  - icon: 🤖
    title: AI-Friendly
    details: Auto-generated instruction files (<code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.github/copilot-instructions.md</code>) and layer-specific rules help GitHub Copilot, Claude Code, and OpenAI Codex follow project conventions.
---

<div class="vp-doc" style="max-width: 960px; margin: 0 auto; padding: 48px 24px;">

<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 24px;">
  <span style="font-size: 0.9rem; color: var(--vp-c-text-2);">Azure Functions backend:</span>
  <span style="padding: 4px 10px; border: 1px solid var(--vp-c-divider); border-radius: 999px; font-size: 0.85rem;">TypeScript</span>
  <span style="padding: 4px 10px; border: 1px solid var(--vp-c-divider); border-radius: 999px; font-size: 0.85rem;">C#</span>
  <span style="padding: 4px 10px; border: 1px solid var(--vp-c-divider); border-radius: 999px; font-size: 0.85rem;">Python</span>
</div>

## Quick Start

```bash
npx swallowkit init my-app
cd my-app
```

### Create your first model

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

### Generate full CRUD

```bash
npx swallowkit scaffold shared/models/todo.ts
```

This generates Azure Functions, BFF API routes, and React components — all fully typed.

### Start the dev server

```bash
npx swallowkit dev
# Next.js → http://localhost:3000
# Azure Functions → http://localhost:7071
```

</div>
