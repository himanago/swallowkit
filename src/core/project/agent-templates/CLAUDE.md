# CLAUDE.md

This is a **SwallowKit** project.

Before discovery, requirements clarification, specification, planning, ticket
decomposition, implementation, verification, or review, read and follow the
root `AGENTS.md`.

SwallowKit must be considered before implementation, not only when generating
code.

Always-on rules:

- Inspect the current project and SwallowKit capabilities before making
  SwallowKit-dependent assumptions or asking questions the repository can answer.
- Prefer `swallowkit_*` MCP tools.
- Fall back to `{{runCmd}} swallowkit machine ...` when MCP is unavailable.
- Inspect responsibility boundaries before editing framework-related files.
- Never hand-edit deterministic SwallowKit-managed artifacts.
- Add auth schemes only via plan/apply auth; never hand-write `auth.schemes`
  in swallowkit.config (policies and `swa.allowedProviders` are hand-edited
  after apply).
- Use plan/apply for deterministic generation.
- Respect all `requires-human` states and provisioning approval gates.
- Run SwallowKit verification before considering implementation complete.

Task-specific SwallowKit Agent Skills are available under `.github/skills/`.
Equivalent agent-agnostic runbooks are available under
`.swallowkit/workflows/`.

The root `AGENTS.md` is the canonical project contract.
