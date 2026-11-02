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
- Fall back to `{{runCmd}} swallowkit machine ...` when MCP is unavailable, or
  when an MCP response's `metadata.swallowkitVersion` is older than the project's
  SwallowKit (`metadata.warnings` contains `mcp-older-than-project`).
- Inspect responsibility boundaries before editing framework-related files.
- Never hand-edit deterministic SwallowKit-managed artifacts.
- Add auth schemes only via plan/apply auth; never hand-write `auth.schemes`
  in swallowkit.config (policies and `swa.allowedProviders` are hand-edited
  after apply).
- Use plan/apply for deterministic generation.
- Respect all `requires-human` states and provisioning approval gates.
- Normal `swallowkit provision` is for humans. Agents must not use it to bypass
  the machine/MCP approval flow.
- Provision timeouts/Ctrl+C do not prove Azure failed. Inspect the original
  execution checkpoint with `machine inspect provision --plan <runId>`; resume
  `machine apply provision --plan <runId> --approve` only after explicit human
  approval. Preserve checkpoints; never re-submit Bicep/reconcile/cancel/delete
  to repair waiting or tag/ledger failures. Do not print deployment output secrets.
- Run SwallowKit verification before considering implementation complete.
- Follow root `AGENTS.md` for persistence, development seeds, runtime evidence,
  and local service/data safety; mechanical verification alone is not E2E proof.
- Default verification includes `backend-build` for standalone Functions.
  Skipped toolchains are not validation; Python compilation checks syntax only.
- Configure auth via plan/apply auth before adding `authPolicy`; otherwise
  scaffold blocks before file writes. Scaffold appends missing shared model exports.

Task-specific SwallowKit Agent Skills are available under `.github/skills/`.
Equivalent agent-agnostic runbooks are available under
`.swallowkit/workflows/`.

The root `AGENTS.md` is the canonical project contract.
