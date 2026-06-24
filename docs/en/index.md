---
layout: home

hero:
  name: "SwallowKit"
  text: "Schema-driven scaffolding"
  tagline: "Keep your Next.js frontend, BFF, Azure Functions backend, and infrastructure aligned through shared Zod schemas."
  image:
    src: /logo.png
    alt: SwallowKit
  actions:
    - theme: brand
      text: Getting started
      link: /en/getting-started
    - theme: alt
      text: Core concepts
      link: /en/concepts
    - theme: alt
      text: GitHub
      link: https://github.com/himanago/swallowkit

features:
  - title: Shared schema and contracts
    details: Define each domain model once as a Zod schema. SwallowKit uses it to generate TypeScript types, validation, BFF routes, backend handlers, and API contracts — so they stay consistent as the application grows.
  - title: Full-stack CRUD scaffolding
    details: "Run <code>swallowkit scaffold</code> to generate Azure Functions, Next.js BFF API routes, and React UI components from a single schema file. The generated code is readable and editable."
  - title: Azure infrastructure and deployment
    details: Bicep templates, CI/CD workflows (GitHub Actions or Azure Pipelines), and Azure resource provisioning are generated alongside application code. Static Web Apps, Functions, and Cosmos DB are configured with Managed Identity.
  - title: AI-agent-friendly structure
    details: "Generated instruction files (<code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.github/copilot-instructions.md</code>) and the <code>swallowkit machine</code> CLI give coding agents explicit boundaries for inspecting, generating, and validating project artifacts."
---

<div class="vp-doc" style="max-width: 960px; margin: 0 auto; padding: 48px 24px;">

## Why SwallowKit?

In full-stack applications, the same domain model is repeated across frontend forms, client validation, BFF types, backend DTOs, API contracts, database entities, and infrastructure config. These definitions drift apart as the project grows.

AI tools can generate code quickly, but they do not automatically maintain consistency across these layers. Frameworks can hide complexity, but production applications still need explicit architecture that developers can read and change.

SwallowKit addresses this by placing a shared Zod schema at the center and generating the surrounding application structure from it. It is a scaffolding toolkit — not a runtime framework. Generated code can be read, edited, and replaced.

## Next steps

- [Getting started](/en/getting-started) — Create a project and generate your first CRUD flow
- [Core concepts](/en/concepts) — Understand the schema-centric architecture
- [Scaffold guide](/en/scaffold-guide) — CRUD generation in detail
- [Deploy to Azure](/en/deployment-guide) — Provision and deploy with Bicep
- [AI / MCP guide](/en/ai-mcp-guide) — Machine-readable interfaces for coding agents

</div>
