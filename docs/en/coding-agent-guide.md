# Coding agent guide

See [package manager commands and troubleshooting](./package-managers.md) for pnpm 11/12 and npm usage.

SwallowKit does not replace a coding agent's development process. It supplies
project inspection, deterministic change operations, ownership boundaries, and
verification guardrails that compose with requirements, specification,
planning, TDD, implementation, and review practices.

For the detailed machine/MCP command and response contract, see
[AI / MCP integration](./ai-mcp-guide.md).

## Purpose

Development-process skills decide **how the work proceeds**. SwallowKit is the
authoritative project-specific layer that determines **how the current project
can be inspected and changed safely and reproducibly**.

```text
Development process / engineering practices
  e.g. process skills, Spec Kit, GSD, BMAD,
       custom skills, normal agent interaction
                    │
                    │ intent / specification / task
                    ▼
             SwallowKit contract
                    │
        ┌───────────┼────────────┐
        │           │            │
     inspect     plan/apply     verify
        │           │            │
        └───────────┼────────────┘
                    ▼
       deterministic Azure application
```

SwallowKit owns current-project inspection, deterministic artifact generation,
drift detection, structural verification, failure explanation, and
infrastructure guardrails. It does not introduce its own requirements,
specification, ticketing, or semantic-review framework.

## Generated agent integration files

`swallowkit init` creates a layered integration rather than repeating one large
contract for every agent:

| File | Role |
| --- | --- |
| `AGENTS.md` | Canonical always-on project contract |
| `CLAUDE.md` | Claude Code adapter that points to `AGENTS.md` |
| `.github/copilot-instructions.md` | GitHub Copilot adapter that points to `AGENTS.md` |
| `.github/instructions/*.instructions.md` | Path/layer-specific rules |
| `.mcp.json` | Project-scoped SwallowKit MCP bootstrap |
| `.github/skills/*/SKILL.md` | Task-specific Agent Skills |
| `.swallowkit/workflows/*.md` | Agent-neutral fallback runbooks |

The adapters contain enough always-on rules to make SwallowKit visible before
an agent has loaded `AGENTS.md`. Task-specific detail remains in Skills and
runbooks so the canonical contract stays operational rather than encyclopedic.

## SwallowKit across the development lifecycle

### Discovery and requirements clarification

Inspect the current project, relevant entities, routes, infrastructure, and
ownership boundaries before asking implementation-detail questions. The agent
should answer facts discoverable from the repository or SwallowKit itself and
reserve human questions for genuine product and domain decisions.

### Specification

Describe user intent, observable behavior, acceptance criteria, and useful test
seams. Treat SwallowKit architecture and ownership as implementation
constraints. Do not describe each generated layer as a separate manually
implemented component.

### Planning

Inspect current capabilities whenever support or ownership changes a design
decision. Never infer SwallowKit capabilities from model memory: the installed
version and project state are authoritative.

### Ticket decomposition

Prefer independently valuable and verifiable vertical slices. If one model
change deterministically derives schema contracts, Functions, BFF, UI, and
infrastructure, keep those generated changes in the same behavioral slice.

```text
Add priority support to Todo
  ├─ change the source-of-truth model
  ├─ plan/apply the managed artifacts
  ├─ add custom behavior and tests
  └─ verify the project
```

Do not create schema, backend, BFF, UI, and infrastructure tickets solely
because the generated files occupy horizontal layers.

### Implementation

Inspect responsibility boundaries before choosing files. Edit `ai-authored`
locations normally, change `deterministic` artifacts only through their source
of truth and plan/apply, and edit `shared` files only outside managed markers.

### Verification

Run SwallowKit verification after implementation and follow structured failure
evidence until the project converges or an explicit human decision is required.

### Review

Perform semantic/specification/engineering review after mechanical SwallowKit
verification. The two gates answer different questions and neither substitutes
for the other.

## Inspect before asking or designing

Use only the inspections relevant to the task:

::: code-group
```bash [npm]
npx swallowkit machine inspect project
npx swallowkit machine inspect entities
npx swallowkit machine inspect routes
npx swallowkit machine inspect boundaries
npx swallowkit machine inspect drift
npx swallowkit machine inspect infra
```
```bash [pnpm]
pnpm exec swallowkit machine inspect project
pnpm exec swallowkit machine inspect entities
pnpm exec swallowkit machine inspect routes
pnpm exec swallowkit machine inspect boundaries
pnpm exec swallowkit machine inspect drift
pnpm exec swallowkit machine inspect infra
```
:::

Prefer equivalent `swallowkit_*` MCP tools when available. Use the machine
interface as the agent-facing fallback.

This policy avoids questions such as how generated CRUD layers are wired,
whether a managed route may be edited, or whether an infrastructure operation
exists when current inspection can answer them. It does not suppress questions
about ambiguous product behavior, business rules, or risk choices.

## Responsibility boundary

`machine inspect boundaries` (or `swallowkit_inspect_boundaries`) is the
machine-readable authority for the current project:

| Zone | Editing policy | Typical examples |
| --- | --- | --- |
| `ai-authored` | Edit directly | source-of-truth models, custom logic, custom UI, tests |
| `deterministic` | Never hand-edit; change source/config and plan/apply | generated CRUD, BFF, UI, schema, and infra artifacts |
| `shared` | Edit only outside managed markers | aggregate or infrastructure files with SwallowKit sections |

The examples are not a substitute for inspection. Ownership can vary by
backend, feature, and SwallowKit version.

## Planning and ticketing

A specification should lead with desired behavior rather than generated-file
mechanics. A plan can record SwallowKit constraints and the expected
plan/apply/verify loop without turning deterministic output into independent
manual work.

Ticket boundaries should be vertical or tracer-bullet slices that can be
implemented and verified independently. Horizontal tickets are appropriate
only when they represent genuinely independent value or risk, not merely
separate generated directories.

## Implementation workflow

The standard agent workflow is:

```text
inspect → plan → evaluate conflicts/approval → apply → verify
```

Prefer MCP tools when the runtime exposes them. Otherwise use structured
machine operations, for example:

::: code-group
```bash [npm]
npx swallowkit machine inspect drift
npx swallowkit machine plan scaffold todo
npx swallowkit machine apply scaffold --plan <planId>
npx swallowkit machine verify project
```
```bash [pnpm]
pnpm exec swallowkit machine inspect drift
pnpm exec swallowkit machine plan scaffold todo
pnpm exec swallowkit machine apply scaffold --plan <planId>
pnpm exec swallowkit machine verify project
```
:::

Use `swallowkit-add-model`, `swallowkit-modify-model`, and
`swallowkit-verify-repair` when the runtime supports Agent Skills. Otherwise
read the corresponding `.swallowkit/workflows/` runbook. These task-level
capabilities are designed to be invoked from a larger implementation process.

### Example request for your agent

Describe the behavior you want rather than asking for separate edits to each generated file.

> Add priority to Todo. Read this project's AGENTS.md and relevant Skill/workflow,
> and keep its selected package manager. Inspect ownership and drift before editing.
> After changing the model, create a scaffold Plan, inspect its changes and conflicts,
> then Apply it. Run verify and tests for the priority behavior.
> If a decision is needed, such as overwriting hand edits, show the affected diff and options.

A **Plan here is a change plan returned by SwallowKit**. It is separate from an agent's
written task plan or Plan mode: it contains planned operations, conflicts, and a `planId`.
Planning does not change generated targets, but saves the plan under
`.swallowkit/state/plans/`. Pass the reviewed plan's `planId` to Apply.

A `stale-plan` response means files fingerprinted during planning have changed.
Inspect the current diff, create a new Plan, and review it again. `--approve` does not
make a stale Plan valid. For `requires-human`, obtain the requested decision before
continuing. Ordinary changes without conflicts do not need an additional blanket approval step.

### When drift is reported

Drift is a mismatch between models, generation records, current files, or project metadata.
Read each finding's kind, severity, and `repairAction` from `machine inspect drift`,
together with the editing policy from `machine inspect boundaries`.
A finding does not automatically mean every affected file should be overwritten.

| Finding | What the agent should check |
| --- | --- |
| `schema-drift` | Confirm the model change is intentional, then Plan and Apply scaffold for the affected model. |
| `artifact-modified` | Review the post-generation diff and ownership. Changes in user-editable areas can be expected; preserve needed customizations. |
| `artifact-missing` | Check whether deletion was intentional and regenerate artifacts that are still needed. |
| `generator-drift` | Compare the generating and running SwallowKit versions; review regeneration changes when adopting an update. |
| `manifest-drift` | Investigate the mismatch between the actual project structure and its records, then follow the supplied `repairAction`. |

MCP defaults to `latest`, while normal CLI commands use the project's pinned version.
If versions differ, inspect the current capabilities of each interface instead of assuming
they are identical. Use the same project and version of the interface for Plan and Apply.
See the [package manager guide](./package-managers.md) for configuring the MCP version.

After repair, run `machine verify project`; use `machine explain failure` to inspect
evidence for failures. Resolving drift does not by itself prove the requested feature
behavior or a successful Azure deployment. Check those through their own tests and execution results.

## Verification versus semantic review

SwallowKit verification asks:

> Is the project mechanically and structurally correct, free from managed
> artifact drift, and passing its configured checks?

Semantic review asks:

> Is the design right? Is the behavior right? Does it satisfy the specification
> and user intent?

Use this order:

```text
implementation → SwallowKit verify → semantic code review
```

When verification fails, use `machine explain failure` or its MCP equivalent,
repair the correct source, and verify again.

## Human approval

Machine operations return terminal states and `nextActions`. A
`requires-human` state is a deliberate stop, not an error to route around. The
agent must request the stated decision and must never invent approval.

Azure provisioning always uses the `swallowkit-provision` Skill/runbook and its
explicit approval gate. Even a broad request to complete deployment does not
implicitly grant the approval expected after the plan is presented.

## Composing with external development processes

Any process framework can provide discovery, specification, ticketing, TDD,
implementation orchestration, or semantic review while invoking SwallowKit for
current-project facts and deterministic operations. This applies equally to
custom Skills, Spec Kit, GSD, BMAD, and ordinary Codex, Claude Code, or GitHub
Copilot conversations.

### Example: Matt Pocock Skills

The following is a recommended composition example, not a compatibility
guarantee or dependency:

```text
grill-with-docs
    ├─ inspect project/entities/routes/boundaries as relevant
    ├─ answer repository/SwallowKit-answerable questions autonomously
    └─ ask the human only for genuine product/domain decisions
    ↓
to-spec
    ├─ describe intent and observable behavior
    ├─ include SwallowKit architecture/ownership as constraints
    └─ avoid treating generated layers as independent manual implementation
    ↓
to-tickets
    ├─ keep vertical / tracer-bullet slices
    └─ generated schema/API/BFF/UI/infra work stays inside the slice
    ↓
implement
    ├─ inspect boundaries
    ├─ ai-authored → normal implementation/TDD
    ├─ deterministic → SwallowKit plan/apply
    ├─ shared → edit outside managed markers
    └─ SwallowKit verify
    ↓
code-review
    └─ semantic / spec / engineering review after mechanical verification
```

**SwallowKit supports Matt Pocock Skills through composition, not through a
hard dependency.** SwallowKit does not install, vendor, fork, or rewrite those
Skills.

## Complete generated agent documents

The following are the complete English templates used by `swallowkit init`, not
abridged excerpts. `{{projectName}}`, `{{backendLanguageLabel}}`,
`{{functionsStructureLine}}`, `{{backendRules}}`, `{{pm}}`, and `{{runCmd}}`
are expanded for the selected project. The docs import the canonical templates
directly, so generator wording and these published originals share one source.

### Generated AGENTS.md

<<< ../../src/core/project/agent-templates/AGENTS.md{md}

### Generated CLAUDE.md

<<< ../../src/core/project/agent-templates/CLAUDE.md{md}

### Generated .github/copilot-instructions.md

<<< ../../src/core/project/agent-templates/copilot-instructions.md{md}
