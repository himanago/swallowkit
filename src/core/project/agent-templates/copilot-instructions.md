# Copilot Instructions

This is a **SwallowKit** project.

Read and follow the root `AGENTS.md` as the canonical project contract.

SwallowKit applies during discovery, requirements clarification, specification,
planning, ticket decomposition, implementation, verification, and review — not
only during code generation.

Key rules:

- Inspect current SwallowKit capabilities instead of assuming them.
- Answer repository- and SwallowKit-inspectable questions before asking the human.
- Prefer `swallowkit_*` MCP tools when available.
- Otherwise use `{{runCmd}} swallowkit machine ...`. Also use it when an MCP
  response's `metadata.swallowkitVersion` is older than the project's SwallowKit
  or `metadata.warnings` contains `mcp-older-than-project`.
- Inspect responsibility boundaries before editing framework-related files.
- Never hand-edit deterministic SwallowKit-managed artifacts.
- Add auth schemes only via plan/apply auth; never hand-write `auth.schemes`
  in swallowkit.config (policies and `swa.allowedProviders` are hand-edited
  after apply).
- Use plan/apply for deterministic generation.
- Respect `requires-human` states and other human approval gates.
- Run SwallowKit verification before completion.
- Default verification includes `backend-build` for standalone Functions.
  Skipped toolchains are not validation; Python compilation checks syntax only.
- Configure auth via plan/apply auth before adding `authPolicy`; otherwise
  scaffold blocks before file writes. Scaffold appends missing shared model exports.

Task-specific SwallowKit Agent Skills live under `.github/skills/`.
Agent-agnostic equivalents live under `.swallowkit/workflows/`.
