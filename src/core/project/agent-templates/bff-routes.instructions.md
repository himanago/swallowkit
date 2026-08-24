---
applyTo: "app/api/**"
---

# BFF API Routes — Rules

The root `AGENTS.md` is the canonical contract. Inspect the current
responsibility boundary before editing files in this layer.

- `app/api/` is a BFF/proxy layer. Never place business logic, database access,
  or direct Cosmos DB calls here.
- Use `callFunction()` from `@/lib/api/call-function` to forward requests to
  Azure Functions.
- Input/output validation may use schemas imported from `@{{projectName}}/shared`.
- Never directly edit a route reported as deterministic. Change its source of
  truth and use MCP-first plan/apply, with the machine interface as fallback.
- Edit shared artifacts only outside managed markers.
- Respect `requires-human` and run SwallowKit verification after changes.
