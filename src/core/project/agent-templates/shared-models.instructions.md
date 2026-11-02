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
- Match the filename with the PascalCase schema export (or legacy camelCase
  `Schema` export). Embedded helpers never own containers; ambiguous exports
  block generation instead of selecting the first declaration.
- Separate helper files are excluded only with a real nested-schema reference
  from a persistent entity and no `id` or persistence metadata. Unsupported helper
  fields still block analysis and helper sources remain fingerprint dependencies.
  Unreferenced id-less files stop with a classification error, not a guessed container.
- `z.record` is not supported by the current generation contract. Analysis
  failures identify file/schema/field/reason and block the operation; never
  drop a field, weaken its type, or reorder schemas to hide the failure.
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

- For new persistent models, follow the root `AGENTS.md` model-creation and
  infrastructure workflow even when all APIs are custom. `create-model`
  registers the Cosmos container migration without CRUD. For a hand-written
  model use `migrations add-model <model>`; this preserves schema bytes.
  Use `--dry-run` to list all writes. A schema
  alone is not completion: verify container Bicep wiring or migrations and
  `.swallowkit/artifacts.json`. Non-persistent types and connector-backed
  models do not require invented Cosmos containers. If generation is omitted,
  report the reason and unfinished infrastructure; never claim deployability
  while required persistence infrastructure is missing.
- A changed partition key requires `migrations add-model <model> --refresh-pending --resource-group <rg>` (optional `--subscription <id>`).
  Only read-only Azure proof of a pending, unmodified generated migration
  permits refresh; unknown or applied state is blocked. Baselines and applied
  checksums are never rewritten. Re-plan provision after changing any model.
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
