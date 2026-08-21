# AI / MCP integration

SwallowKit provides a machine-readable CLI (`swallowkit machine`) and a bundled MCP stdio server (`swallowkit-mcp`) so coding agents can operate through official generators, inspectors, and validators instead of guessing raw filesystem edits.

## Architecture

The integration surface is intentionally layered:

1. **Human CLI**: interactive prompts, colored logs, human-readable guidance
2. **Machine CLI**: `swallowkit machine ...` with deterministic JSON output
3. **MCP runtime**: `swallowkit-mcp`, a thin stdio adapter over the machine CLI
4. **Project manifest**: `.swallowkit/project.json`, the framework-owned project metadata used for inspection and validation

This keeps framework logic in SwallowKit itself while making AI integrations explicit and predictable.

## Machine CLI

Use the machine interface when an agent needs structured project data or needs to invoke the official generators without interactive prompts.

### Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
```
```bash [pnpm]
pnpm swallowkit machine inspect project
pnpm swallowkit machine inspect entities
pnpm swallowkit machine inspect routes
```
:::

These commands return framework-owned metadata such as:

- project manifest source
- entities and schema metadata
- generated BFF / Functions route mappings
- connectors, auth, and architecture metadata

### Validation

::: code-group
```bash [npm]
npx swallowkit machine validate project
```
```bash [pnpm]
pnpm swallowkit machine validate project
```
:::

Validation returns structured violations for:

- config errors
- naming issues
- missing generated artifacts
- missing required files/directories
- forbidden dependencies across SwallowKit layers

### Generation

::: code-group
```bash [npm]
npx swallowkit machine generate model todo --overwrite never
npx swallowkit machine generate scaffold todo --api-only
```
```bash [pnpm]
pnpm swallowkit machine generate model todo --overwrite never
pnpm swallowkit machine generate scaffold todo --api-only
```
:::

Generation stays non-interactive and returns JSON describing created or updated artifacts.

### Plan / Apply

A two-phase flow that lets agents preview changes before writing anything. This is the recommended path for autonomous loops.

::: code-group
```bash [npm]
npx swallowkit machine plan scaffold todo --api-only
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine apply scaffold todo --approve
```
```bash [pnpm]
pnpm swallowkit machine plan scaffold todo --api-only
pnpm swallowkit machine apply scaffold --plan <planId>
pnpm swallowkit machine apply scaffold todo --approve
```
:::

- `plan scaffold` writes nothing to disk; it returns the files that would be created / updated / overwritten, plus any conflicts. Plans are stored in `.swallowkit/state/plans/` and referenced by `planId`.
- `apply scaffold --plan <planId>` rejects the plan with `stale-plan` (`status: "blocked"`) if any planned file changed after planning.
- Overwriting a managed file that was hand-edited after generation returns `approval-required` (`status: "requires-human"`) and requires an explicit `--approve`.
- External codegen for C# / Python (OpenAPI / native schema assets) is not included in plans; it is reported as a warning and executed on apply.
- `plan auth --provider <p>` / `apply auth` follow the same two-phase flow (`custom-jwt` / `swa` / `external-token` / `none`; use `--scheme` to add a named scheme).

### Provision (Plan / Apply, approval always required)

::: code-group
```bash [npm]
npx swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia
npx swallowkit machine apply provision --plan <planId> --approve
```
```bash [pnpm]
pnpm swallowkit machine plan provision -g my-rg --location japaneast --swa-location eastasia
pnpm swallowkit machine apply provision --plan <planId> --approve
```
:::

- `plan provision` performs a purely local, deterministic preflight (Bicep analysis, az CLI availability, a preview of the commands that would run). It requires neither Azure connectivity nor `az login`.
- Only when `--what-if` is passed does it run `az deployment group what-if` (which requires `az login`).
- Provisioning creates billable resources, so the plan always reports `requiresApproval: true` (`status: "requires-human"`). `apply provision` refuses to run without an `--approve` that reflects explicit human consent.

### Responsibility Boundary / Infra Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect infra
```
```bash [pnpm]
pnpm swallowkit machine inspect boundaries
pnpm swallowkit machine inspect infra
```
:::

- `inspect boundaries` returns the **responsibility boundary between AI free-form authoring and SwallowKit's deterministic generation** as a machine-readable contract. Each ownership maps to a `zone` (`deterministic` / `ai-authored` / `shared`) and an `editPolicy` (`regenerate-via-plan-apply` / `free-edit` / `edit-outside-markers` / `never-hand-edit`); paths not in the ledger resolve through prefix-based `conventionRules`. Agents should consult this contract before editing and route changes to `deterministic` areas through plan/apply.
- `inspect infra` parses the Bicep assets under `infra/` (params / modules / outputs / container wiring) without calling Azure. A scaffold-generated container that is not wired into `main.bicep` is reported as a `container-not-wired` warning.

### Artifact / Drift Inspection

::: code-group
```bash [npm]
npx swallowkit machine inspect artifacts
npx swallowkit machine inspect drift
```
```bash [pnpm]
pnpm swallowkit machine inspect artifacts
pnpm swallowkit machine inspect drift
```
:::

- `inspect artifacts` returns the generated-artifact ledger (`.swallowkit/artifacts.json`) with ownership (`managed` / `generated-once` / `user-owned` / `extension-point` / `metadata`) and modified / missing flags.
- `inspect drift` detects schema changes (schema-drift), manual edits (artifact-modified), missing files (artifact-missing), generator version differences (generator-drift), and manifest divergence (manifest-drift). Every finding includes a `repairAction`.

### Verify / Explain

::: code-group
```bash [npm]
npx swallowkit machine verify project
npx swallowkit machine verify project --checks structure,drift
npx swallowkit machine explain failure
npx swallowkit machine explain failure --check typecheck
```
```bash [pnpm]
pnpm swallowkit machine verify project
pnpm swallowkit machine verify project --checks structure,drift
pnpm swallowkit machine explain failure
pnpm swallowkit machine explain failure --check typecheck
```
:::

- `verify project` runs `structure` (project conventions), `drift` (artifact divergence), and `typecheck` (TypeScript), returning per-check evidence (command, exit code, log tail) and `suggestedActions`. `summary.done: true` is the completion signal.
- `--checks` also accepts `build` / `lint` / `test`, which run the matching package.json script when present (and are skipped otherwise).
- Custom checks defined under `verify.checks` in `swallowkit.config.json` (e.g. `{ "id": "smoke-api", "command": "node scripts/smoke.js" }`) are added to the default set. Ids must match `^[a-z][a-z0-9-]*$` and must not clash with built-in ids.
- `explain failure` returns the evidence and repair actions for the failing checks from the most recent verify run.

## Response Shape

All machine commands write a single JSON document to stdout.

### Success

```json
{
  "ok": true,
  "command": "inspect-project",
  "status": "complete",
  "data": {
    "manifestSource": "file",
    "manifest": {}
  }
}
```

### Failure

```json
{
  "ok": false,
  "command": "generate-scaffold",
  "status": "failed",
  "error": {
    "code": "internal-error",
    "message": "..."
  }
}
```

### Terminal State

Every machine command returns a `status` that autonomous loops can use as a termination signal.

| status | meaning |
| --- | --- |
| `complete` | Operation finished; proceed to the next step |
| `in-progress` | Unresolved issues remain (e.g. failed verify checks); keep fixing |
| `blocked` | A precondition broke (e.g. stale-plan, not-a-swallowkit-project); redo the previous step |
| `requires-human` | Human judgement or approval is required (e.g. approval-required) |
| `failed` | The operation itself failed |

Successful responses may also include `nextActions` suggesting the next command to run.

Key guardrail error codes:

- `not-a-swallowkit-project` (blocked) — a write command ran outside a project; move to the project root
- `stale-plan` (blocked) — planned files changed after planning; re-plan
- `plan-not-found` (blocked) — the plan is missing or corrupted; re-plan
- `approval-required` (requires-human) — overwrites/provisioning need human approval; a guardrail, not an error

## Project Manifest

SwallowKit keeps project semantics in `.swallowkit/project.json`.

The manifest is synchronized after framework-owned mutations such as:

- `init`
- `create-model`
- `scaffold`
- `add-connector`
- `add-auth`

Inspection and validation use this manifest as the primary project map. If it is missing, SwallowKit reconstructs metadata from the current project structure.

## MCP Server

Use the bundled stdio MCP server when your agent platform supports MCP tools:

::: code-group
```bash [npm]
npx swallowkit-mcp
```
```bash [pnpm]
pnpm swallowkit-mcp
```
:::

The server exposes explicit tools only:

- `swallowkit_inspect_project`
- `swallowkit_inspect_entities`
- `swallowkit_inspect_routes`
- `swallowkit_inspect_artifacts`
- `swallowkit_inspect_boundaries`
- `swallowkit_inspect_drift`
- `swallowkit_inspect_infra`
- `swallowkit_validate_project`
- `swallowkit_generate_model`
- `swallowkit_scaffold_model`
- `swallowkit_plan_scaffold`
- `swallowkit_apply_scaffold`
- `swallowkit_plan_auth`
- `swallowkit_apply_auth`
- `swallowkit_plan_provision`
- `swallowkit_apply_provision`
- `swallowkit_verify_project`
- `swallowkit_explain_failure`

The MCP layer does not implement framework logic on its own. It delegates each tool call to the machine CLI.

## Generated Project Bootstrap

`swallowkit init` writes a project-scoped `.mcp.json` file at the repository root. It resolves and launches the latest SwallowKit MCP entrypoint on each start; set `SWALLOWKIT_MCP_VERSION` in the file to pin a version.

Example shape:

```json
{
  "mcpServers": {
    "swallowkit": {
      "command": "node",
      "args": ["./node_modules/swallowkit/dist/mcp/index.js"],
      "cwd": "."
    }
  }
}
```

Practical behavior:

- **Claude Code** can load project-scoped MCP servers from `.mcp.json`
- **GitHub Copilot CLI** can also discover workspace `.mcp.json` servers
- **Other agents / Codex-style runtimes** can reuse the same launcher when their MCP client supports project-level config; otherwise they should use the machine CLI fallback

The generated instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) explicitly tell agents to prefer MCP tools when available and fall back to `swallowkit machine ...` when they are not. The MCP bootstrap requires pnpm and network access when the selected version is not cached.

### Agent Skills (agentskills.io standard)

`init` also generates the autonomous-loop runbooks as skills in the [Agent Skills](https://agentskills.io/) open-standard format under `.github/skills/`. Skills-aware agents (GitHub Copilot in VS Code / CLI / cloud agent, and others) keep only the frontmatter `name` / `description` resident and load the body on demand when the task matches (progressive disclosure).

| Skill | Use for |
|-------|---------|
| `swallowkit-add-model` | adding a model / CRUD feature (plan/apply/verify loop) |
| `swallowkit-modify-model` | changing an existing schema and resolving drift |
| `swallowkit-verify-repair` | the verify-and-repair convergence loop |
| `swallowkit-provision` | Azure provisioning (always via human approval) |

For agents without skills support, the same runbooks live in `.swallowkit/workflows/` and are referenced from `AGENTS.md`.

## Recommended Usage

- Use **inspect** first to understand the SwallowKit project structure
- Perform write operations in two phases: **plan → (review) → apply**
- Run **verify** after applying; on failure use **explain failure** to get evidence, fix, and re-verify
- Use **validate** / **inspect drift** before or after generation to detect framework rule violations and divergence
- Use **generate / apply** instead of editing framework-owned (`managed`) artifacts by hand
- Keep custom logic in application files, but let SwallowKit own generated structure and metadata

Typical autonomous loop:

```text
inspect project → plan scaffold → apply scaffold --plan <id> → verify project
   └ on failure: explain failure → fix → verify project (repeat)
   └ on approval-required: ask a human → apply scaffold --approve
```

Responsibility boundary principles:

| zone | Edit policy | Examples |
| --- | --- | --- |
| `deterministic` | Never hand-edit; regenerate via plan/apply | `functions/src/*.ts`, `app/api/*/route.ts`, `infra/containers/` |
| `ai-authored` | AI / developers write freely | `app/**/page.tsx` (after generation), `lib/`, custom code |
| `shared` | Edit outside SwallowKit markers only | `infra/main.bicep`, `functions/function_app.py`, `shared/index.ts` |

Fetch the contract with `inspect boundaries` (or `swallowkit_inspect_boundaries`) before editing, and replace direct edits to `deterministic` areas with model edits followed by plan/apply.
# Authentication data in machine/MCP output

`inspect project` and the corresponding MCP project inspection return canonical `auth.schemes` and `auth.authorization.policies`. Legacy single-provider configuration appears as the `default` scheme, and `public` appears as `anonymous`. Validation diagnostics include the full configuration path and a suggested correction; consumers must never reinterpret an invalid or missing policy as anonymous.
