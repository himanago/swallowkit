---
applyTo: "functions/**"
---

# Azure Functions — Backend Rules

The root `AGENTS.md` is the canonical contract. Azure Functions own application
business logic and data access, but generated handlers and contracts may be
deterministic. Inspect boundaries before choosing an edit location.

- Put custom behavior only in an ai-authored location reported by the current
  boundary contract.
- Never directly edit deterministic handlers or generated schema assets.
- Keep backend contracts aligned with `shared/models/` through MCP-first
  plan/apply, using the machine interface as fallback.
- Auto-generate `id`, `createdAt`, and `updatedAt` on the backend. Never trust
  client-sent values for these fields.
- Container names use PascalCase plural form and default to `/id` as the
  partition key unless the source-of-truth model says otherwise.
- Respect `requires-human` and run SwallowKit verification after changes.

Backend language: {{backendLanguageLabel}}.
