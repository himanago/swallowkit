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
- `id` is a **required** string field: `id: z.string()`. Generated CRUD, UI,
  and repositories assume `id` is always present — do NOT make it optional.
- `createdAt` and `updatedAt` are **optional** string fields
  (`z.string().optional()`). The backend manages their values.
- Export a `displayName` string for UI display.
- Re-export every model from `shared/index.ts`, outside managed markers where
  applicable.
- For relationships, use nested schemas rather than duplicating model shapes.

## Optional model declarations (exact formats)

These are the only declarations SwallowKit parses from a model file:

```ts
// Cosmos DB partition key (default '/id'). Must reference a schema field.
export const partitionKey = '/learnerId';

// Role-based access control on generated CRUD.
export const authPolicy = { roles: ['admin'] };
// or: { read: ['user'], write: ['admin'] } or: { policy: 'adminOnly' }

// Human-readable name for generated UI.
export const displayName = 'Learner';

// Bind the model to a configured external connector instead of Cosmos DB.
export const connectorConfig = {
  connector: 'mysql',
  table: 'learners',
  operations: ['list', 'get', 'create', 'update', 'delete'],
};
```

The full machine-readable contract:
`{{runCmd}} swallowkit machine inspect capabilities`

After changing a model, do not manually patch generated artifacts.

## After changing a model

- The shared package is consumed via its built `dist/`. `verify project`
  rebuilds it automatically, but if you typecheck manually, build the shared
  package first — "no exported member" errors usually mean a stale `dist/`.
- If `dev-seeds/` exists, update the seed JSON. Seeds are only applied by
  running `{{runCmd}} swallowkit dev --seed-env <environment>`; editing the
  JSON alone does nothing.

Use the `swallowkit-modify-model` Agent Skill when available. Otherwise follow
`.swallowkit/workflows/modify-model.md`.

The normal agent workflow is:

```text
inspect drift → plan scaffold → apply scaffold → verify project
```

Prefer the equivalent `swallowkit_*` MCP tools; use the machine interface as the
fallback. Stop for any `requires-human` result.
