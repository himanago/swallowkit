---
applyTo: "shared/models/**"
---

# Shared Models — Zod Schema Rules

The root `AGENTS.md` is the canonical contract. Files here are ai-authored
source-of-truth models, subject to the current result of
`{{runCmd}} swallowkit machine inspect boundaries`.

## Rules

- Define Zod schemas using `zod/v4` (`import { z } from 'zod/v4'`).
- Use the Zod pattern where the schema constant and inferred TypeScript type
  share the same name.
- Include `id`, `createdAt`, and `updatedAt` as optional string fields. The
  backend manages their values.
- Export a `displayName` string for UI display.
- Re-export every model from `shared/index.ts`, outside managed markers where
  applicable.
- For relationships, use nested schemas rather than duplicating model shapes.

After changing a model, do not manually patch generated artifacts.

Use the `swallowkit-modify-model` Agent Skill when available. Otherwise follow
`.swallowkit/workflows/modify-model.md`.

The normal agent workflow is:

```text
inspect drift → plan scaffold → apply scaffold → verify project
```

Prefer the equivalent `swallowkit_*` MCP tools; use the machine interface as the
fallback. Stop for any `requires-human` result.
