/**
 * Workflow Docs & Agent Skills
 *
 * 同一のランブック コンテンツから 2 つの表面を生成する:
 * - `.swallowkit/workflows/*.md` — Coding Agent 非依存の Markdown ランブック
 *   (AGENTS.md / CLAUDE.md / copilot-instructions.md から参照される)
 * - `.github/skills/<name>/SKILL.md` — Agent Skills (agentskills.io open standard)。
 *   GitHub Copilot (VS Code / CLI / cloud agent) 等が name/description で自動発見し、
 *   タスクに関連するときだけ本文をロードする (progressive disclosure)。
 */

import * as fs from "fs";
import * as path from "path";

export interface WorkflowDoc {
  /** `.swallowkit/workflows/` 配下のファイル名 */
  fileName: string;
  title: string;
  content: string;
  /**
   * Agent Skills のスキル名 (ディレクトリ名と一致必須)。
   * agentskills.io 仕様: 小文字英数字とハイフンのみ・64 文字以内。
   * undefined の場合はスキルとして出力しない (README など)。
   */
  skillName?: string;
  /**
   * Agent Skills の description (最大 1024 文字)。
   * 「何をするか」と「いつ使うか」の両方を書く。
   */
  skillDescription?: string;
}

export function buildWorkflowDocs(runCmd: string): WorkflowDoc[] {
  const addModel: WorkflowDoc = {
    fileName: "add-model.md",
    title: "Add a new model (autonomous loop)",
    skillName: "swallowkit-add-model",
    skillDescription:
      "Add a new persistent model, including models with custom APIs, and generate required infrastructure. Derive CRUD Functions, BFF routes, and UI only when needed using the plan/apply/verify loop. Use when asked to add a model, entity, resource, table, or a new CRUD feature.",
    content: `# Workflow: Add a new model

Goal: add a persistent model and generate its required infrastructure, even with custom APIs. A hand-written model alone is not complete.

## Responsibility boundary

- **You author freely**: the model schema (\`shared/models/<name>.ts\`) and any business logic.
- **SwallowKit generates deterministically**: Functions CRUD, BFF routes, UI pages, OpenAPI, Bicep containers.
- Query the full contract: \`${runCmd} swallowkit machine inspect boundaries\`

## Steps

1. Create the model file (deterministic template):
   \`${runCmd} swallowkit machine plan model <name> --overwrite never\`
   then apply the returned plan with
   \`${runCmd} swallowkit machine apply model --plan <planId>\`.
   - This previews schema, shared export, container migration, project manifest, and artifact-ledger writes;
     no generated project files are written before apply.
     For a hand-written schema, use \`${runCmd} swallowkit machine plan model-infrastructure <name>\`
     and apply it with \`${runCmd} swallowkit machine apply model --plan <planId>\` to backfill
     its container migration without changing schema bytes or generating CRUD.
2. Edit \`shared/models/<name>.ts\` — add domain fields (free-form authoring).
   - Native C#/Python types follow Zod, not names: \`z.iso.datetime()\` for dates, \`z.number().int()\` for integers.
   - \`<model>Id\` fields reference a model only when it exists in \`shared/models\`; otherwise declare
     \`export const references = { fieldId: 'Model' }\` (or \`false\` to opt out).
3. When CRUD is needed, compute the change plan (writes nothing):
   \`${runCmd} swallowkit machine plan scaffold <name>\`
   - \`status: "requires-human"\` → review \`data.conflicts\`; only proceed with \`--approve\` if overwriting is intended.
   - Must not change Bicep/infrastructure during the CRUD scaffold? Add \`--skip-infra\` to plan and apply. Nothing under \`infra/\` changes and
     the plan warns \`infra-skipped\`; the model container migration should already be registered by step 1 (or the backfill command).
     State the reason and pending infrastructure work; verify fails while required local container migrations are missing or stale, and a passing verify does not prove Azure provisioning succeeded.
   - Read \`data.warnings\`. \`user-scoped-data-without-auth\` means generated CRUD would expose every user's documents;
     add auth (\`swallowkit-add-auth\`) and owner-scoped ai-authored endpoints before exposing the model.
   - \`auth-policy-without-auth\` blocks generation before file writes: configure authentication with plan/apply auth,
     then re-plan. Do not remove a required policy to bypass this prerequisite.
     For named \`auth.schemes\`, define named authorization policies selecting schemes/roles and reference them from
     \`authPolicy.policy\` or read/write names; role-only declarations block with \`auth-policy-requires-named-policy\`.
     Single-provider \`auth.provider\` supports role lists only; named policies block with \`auth-named-policy-requires-named-scheme\`.
   - Scaffold appends missing exports to \`shared/index.ts\` for hand-authored models too.
     Manual exports are allowed; no managed markers exist in that file.
   - If custom APIs replace CRUD, skip scaffold (including \`--api-only\`, which still generates CRUD).
     The model migration from step 1 (or the backfill command) is sufficient.
     Keep the schema exported from \`shared/index.ts\`. External connector models need their connector mapping, not a Cosmos container.
   - If the partition key changes after migration generation, preview
     \`${runCmd} swallowkit machine plan model-infrastructure <name> --refresh-pending --resource-group <name>\`.
     Only a proven unapplied migration can be refreshed; applied, attempted, unknown, or user-modified definitions block without writes.
4. Apply the reviewed CRUD scaffold plan, if needed:
   \`${runCmd} swallowkit machine apply scaffold --plan <planId>\`
5. Verify:
   - Inspect \`machine inspect entities\`, \`machine inspect infra\`, \`machine inspect artifacts\`, and \`machine inspect drift\`.
     Match the model's container name and partition key to its Bicep, \`sourceModel\` in
     \`infra/migrations/manifest.json\`, and \`.swallowkit/artifacts.json\`.
     For a baseline-owned container, verify the tracked definition and \`infra/main.bicep\` wiring instead of requiring a new migration.
     Do not hand-edit a checksum-locked baseline or an existing migration.
   - Run \`${runCmd} swallowkit machine verify project\`.
   - \`summary.done: false\` → \`${runCmd} swallowkit machine explain failure\` and repair, then re-verify.
   - Required infrastructure still missing? Report the reason and remaining work, not completion or deployment readiness.
     Local generation does not provision Azure; follow the separate provision workflow and human approval gates.
6. If \`dev-seeds/\` exists, update seed JSON for the new model. Seeds are only
   applied by \`${runCmd} swallowkit dev --seed-env <environment>\` — editing the
   JSON alone does nothing. Follow root \`AGENTS.md\` for seed naming, target
   inspection/data safety, and runtime evidence before claiming completion.

## Terminal states

| status | meaning | next |
|--------|---------|------|
| complete | operation finished | continue |
| in-progress | more work remains (e.g. failing checks) | follow nextActions |
| blocked | prerequisite missing (e.g. stale plan) | re-plan |
| requires-human | approval needed | ask the human, or pass --approve when instructed |
| failed | operation failed | inspect error.details |
`,
  };

  const modifyModel: WorkflowDoc = {
    fileName: "modify-model.md",
    title: "Modify an existing model schema",
    skillName: "swallowkit-modify-model",
    skillDescription:
      "Change an existing Zod model schema in a SwallowKit project and re-align every generated artifact (Functions, BFF, UI, infra) via drift inspection and plan/apply regeneration. Use when asked to add/remove/rename model fields, change validation rules, or when inspect drift reports schema-drift.",
    content: `# Workflow: Modify an existing model

Goal: change a schema and re-align every generated artifact.

## Steps

1. Edit \`shared/models/<name>.ts\` (free-form authoring).
2. Check what drifted:
   \`${runCmd} swallowkit machine inspect drift\`
   - \`schema-drift\` findings list the models whose artifacts are stale.
3. Plan the regeneration:
   \`${runCmd} swallowkit machine plan scaffold <name>\`
   - Conflicts mean generated files were hand-edited after generation. Decide: keep the hand-edit (move the logic to an ai-authored file first) or overwrite with \`--approve\`.
4. Apply: \`${runCmd} swallowkit machine apply scaffold --plan <planId>\`
5. Verify: \`${runCmd} swallowkit machine verify project\`
   Follow root \`AGENTS.md\` for persistence, seed/data safety, and runtime evidence
   when the changed behavior requires it.

## Guardrail

Never hand-edit managed artifacts to implement schema changes — always change the model
and regenerate. Hand-edits are detected as drift and block unattended overwrites.
`,
  };

  const addAuth: WorkflowDoc = {
    fileName: "add-auth.md",
    title: "Add authentication (plan/apply with config ownership rules)",
    skillName: "swallowkit-add-auth",
    skillDescription:
      "Add authentication (custom-jwt, Azure Static Web Apps built-in, or external-token) to a SwallowKit project via plan/apply auth, including the config ownership rules (never hand-write auth.schemes; hand-edit policies and allowedProviders after apply) and post-apply steps. Use when asked to add login, authentication, authorization, roles, or a named auth scheme.",
    content: `# Workflow: Add authentication

Goal: introduce an auth scheme deterministically and finish the manual follow-ups.

## Config ownership (critical)

- \`auth.schemes\` is **owned by plan/apply auth. Never hand-write scheme entries** —
  a pre-written scheme makes planning fail with \`already exists\`.
- \`auth.authorization.policies\` and \`swa.allowedProviders\` are **hand-edited after
  apply** (the config is an extension point; this is the expected workflow).

## Steps

1. Check what already exists: \`${runCmd} swallowkit machine inspect capabilities\`
   (authentication section) and the current \`auth\` block in swallowkit.config.
2. Plan (writes nothing):
   \`${runCmd} swallowkit machine plan auth --provider <custom-jwt|swa|external-token> [--scheme <name>] [--allowed-providers github,aad]\`
3. Apply:
   \`${runCmd} swallowkit machine apply auth --plan <planId>\`
4. Follow the returned \`nextActions\`:
   - Define \`auth.authorization.policies\` referencing the scheme (hand-edit).
   - swa: confirm \`swa.allowedProviders\` — generated login URLs use the first entry.
   - external-token: implement the generated verifier stub. It fails closed and
     **verify passes with the stub**, so a green verify does not mean the auth
     flow works (a \`auth-verifier-stub\` warning is surfaced while unmodified).
5. Add \`authPolicy\` to models that need guards, then re-run plan/apply scaffold
   for them.
6. Verify: \`${runCmd} swallowkit machine verify project\`

## Scope guardrail

Generated CRUD enforces authentication and roles but does **not** scope rows to
the caller. Owner-scoped behavior belongs in ai-authored endpoints that derive
the scoping key from the verified principal, never from the request body.
`,
  };

  const verifyRepair: WorkflowDoc = {
    fileName: "verify-and-repair.md",
    title: "Verify and repair loop",
    skillName: "swallowkit-verify-repair",
    skillDescription:
      "Converge a SwallowKit project to a verified state: run structure/drift/typecheck/backend-build (and build/lint/test) checks, read evidence with explain failure, repair, and repeat. Use after any code or schema change, when verification fails, when the build/lint/tests are broken, or before finishing a task.",
    content: `# Workflow: Verify and repair

Goal: converge the project to a verified state after any change.

## Loop

1. \`${runCmd} swallowkit machine verify project\`
   - default checks: structure, drift, typecheck, backend-build (+ project-specific checks from swallowkit.config \`verify.checks\`)
   - backend-build: standalone C# \`dotnet build\`, TypeScript \`tsc --noEmit\`, Python 3 \`compileall\` (syntax only).
     Missing toolchains are skipped with a reason, not proof of a working backend. Restore them and re-run.
   - opt-in heavier checks: \`--checks "structure,drift,typecheck,backend-build,build,lint,test"\` (quote CSV in PowerShell)
2. If \`summary.done\` is false:
   - \`${runCmd} swallowkit machine explain failure\` → evidence (logTail, findings, violations) and suggestedActions per check.
   - Repair:
     - \`drift\` failures → follow each finding's \`repairAction\` (usually re-run plan/apply scaffold).
     - \`structure\` failures → follow \`suggestedFix\` per violation.
     - \`typecheck\`/\`backend-build\`/\`build\`/\`lint\`/\`test\` failures → fix the source code, not generated artifacts.
3. Repeat until \`summary.done: true\`. This is mechanical verification only.
   Before claiming completion, follow root \`AGENTS.md\` for scope-dependent runtime
   evidence and local service/data safety; passing checks do not replace those gates.

## Exit criteria

Stop and ask a human when:
- the same check fails 3 times in a row with the same evidence, or
- a repair would require overwriting hand-edited files (\`requires-human\`).
`,
  };

  const provision: WorkflowDoc = {
    fileName: "provision.md",
    title: "Provision Azure resources (plan/apply with approval gate)",
    skillName: "swallowkit-provision",
    skillDescription:
      "Provision Azure resources (Static Web Apps, Functions, Cosmos DB) for a SwallowKit project using the two-phase plan/apply flow with a mandatory human approval gate. Use when asked to deploy infrastructure, provision Azure, create resource groups, or run Bicep deployments.",
    content: `# Workflow: Provision Azure resources

Goal: bootstrap Azure once, then apply only pending versioned infrastructure migrations with an explicit human approval gate.

## Rules

- Provisioning **always** requires human approval — \`plan provision\` returns
  \`status: "requires-human"\` and \`requiresApproval: true\` by design.
- Never pass \`--approve\` to \`apply provision\` unless a human explicitly
  instructed you to provision in this session.
- This plan/apply workflow is for agents. Humans normally run \`swallowkit provision\`
  directly; do not switch to that command to bypass the agent approval gate.
- Inspect infra locally first — no \`az\` calls are needed for inspection.
- Never edit an applied migration. Create a corrective migration instead.
- Never use \`--reconcile\` for an ordinary model or resource addition.
- A local az error/timeout or Ctrl+C does not prove Azure failed. Never
  re-submit, cancel, or delete a deployment to repair a wait or bookkeeping failure.
- Respect \`status\`, \`outcome\`, and \`nextActions\`, not just \`ok\`.

## Steps

1. Inspect the infrastructure definition (pure local Bicep analysis):
   \`${runCmd} swallowkit machine inspect infra\`
   - review parameters, modules, outputs, and container wiring warnings.
2. Compute the provisioning plan (no resources are created):
   \`${runCmd} swallowkit machine plan provision -g <resource-group> --location <region> --swa-location <swa-region>\`
  - the plan reports \`bootstrap\`, \`migrate\`, \`noop\`, or \`adoption-required\`.
  - it lists only pending migrations and the exact \`az\` commands that would run.
  - for an older untagged environment, first run \`${runCmd} swallowkit migrations init --legacy-baseline\`, then plan with \`--adopt-existing --baseline 0 --what-if\`.
  - only intentional baseline changes use \`--reconcile --what-if\`; this can reset template-managed settings.
3. Present the plan to the human and wait for explicit approval.
4. Only after approval:
   \`${runCmd} swallowkit machine apply provision --plan <planId> --approve\`
5. If \`in-progress\`, \`unknown\`, or \`partial\`, retain the execution
   checkpoint and read/wait for the original deployment:
   \`${runCmd} swallowkit machine inspect provision --plan <runId> --wait-seconds 300\`.
   Inspection never writes Azure tags or the local ledger.
6. After fresh explicit human approval, resume:
   \`${runCmd} swallowkit machine apply provision --plan <runId> --approve\`.
   Attempted deployments are not re-submitted; remaining reviewed steps and
   tags/ledger finish only after Azure \`Succeeded\`.
7. Report completion only when \`status: "complete"\` and
   \`outcome: "succeeded"\`. Never report deployment output secrets.

For an older untracked bootstrap, plan with \`--resume-deployment <name>\`
and the original RG, subscription and regions. Recovery compares its ARM
template and non-secure parameters to local Bicep before approval. Mismatch,
unreadable evidence or secure parameters block; do not work around this by
using reconcile/adoption or replacing the migration manifest.

## Terminal states

\`apply provision\` without \`--approve\` fails with \`approval-required\` —
this is the guardrail working as intended, not an error to work around.

Azure \`Running\`/\`Accepted\` means \`in-progress\`. An unreadable or missing
deployment means \`unknown\`, not Azure failure. Azure \`Failed\`/\`Canceled\`
returns sanitized Azure and operation causes. Azure \`Succeeded\` with incomplete
tag/ledger writes means \`partial\`; resume bookkeeping without redeploying.
The default wait is 300 seconds (0-3600 via \`--wait-seconds\`), not unlimited.
Warning-only stderr with exit 0 is accepted. Diagnostics report local exit,
signal, elapsed time and truncated/redacted output separately from Azure state.
`,
  };

  const index: WorkflowDoc = {
    fileName: "README.md",
    title: "SwallowKit agent workflows",
    content: `# SwallowKit Agent Workflows

Agent-agnostic runbooks for autonomous development loops. Machine-readable
interfaces (\`swallowkit machine ...\` / MCP \`swallowkit_*\` tools) return a
\`status\` terminal state and \`nextActions\`, so agents can chain steps without
parsing human-oriented output.

These runbooks are also installed as Agent Skills (agentskills.io format)
under \`.github/skills/\` so skills-aware agents load them automatically.

| Workflow | File | Skill |
|----------|------|-------|
| Add a new model | [add-model.md](./add-model.md) | \`swallowkit-add-model\` |
| Modify an existing model | [modify-model.md](./modify-model.md) | \`swallowkit-modify-model\` |
| Add authentication | [add-auth.md](./add-auth.md) | \`swallowkit-add-auth\` |
| Verify and repair | [verify-and-repair.md](./verify-and-repair.md) | \`swallowkit-verify-repair\` |
| Provision Azure resources | [provision.md](./provision.md) | \`swallowkit-provision\` |

## Responsibility boundary (summary)

- **ai-authored** (write freely): \`shared/models/\`, business logic, custom pages/components, tests.
- **deterministic** (never hand-edit): artifacts generated by SwallowKit (see \`.swallowkit/artifacts.json\`) and \`.swallowkit/\` metadata. Change models/config and regenerate via plan/apply.
- **shared**: \`shared/index.ts\` allows manual exports (no markers; SwallowKit appends missing entries).
  For Python \`functions/function_app.py\`, edit outside the registration marker.
- **infrastructure**: baseline \`infra/\` files are checksum-locked by \`infra/migrations/manifest.json\`; add resources as new migrations (\`swallowkit create-migration <slug>\`, \`swallowkit migrations add-model <model>\`).

Full machine-readable contract: \`${runCmd} swallowkit machine inspect boundaries\`
`,
  };

  return [index, addModel, modifyModel, addAuth, verifyRepair, provision];
}

export const WORKFLOWS_DIR = path.join(".swallowkit", "workflows");
export const SKILLS_DIR = path.join(".github", "skills");

/** `.swallowkit/workflows/*.md` を書き出し、書き込んだ相対パスを返す。 */
export function writeWorkflowDocs(projectDir: string, runCmd: string): string[] {
  const dir = path.join(projectDir, WORKFLOWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const doc of buildWorkflowDocs(runCmd)) {
    fs.writeFileSync(path.join(dir, doc.fileName), doc.content, "utf-8");
    written.push(path.posix.join(".swallowkit", "workflows", doc.fileName));
  }
  return written;
}

/** Agent Skills (agentskills.io) の SKILL.md コンテンツを組み立てる。 */
export function buildAgentSkills(runCmd: string): Array<{ skillName: string; content: string }> {
  return buildWorkflowDocs(runCmd)
    .filter((doc): doc is WorkflowDoc & { skillName: string; skillDescription: string } =>
      Boolean(doc.skillName && doc.skillDescription)
    )
    .map((doc) => ({
      skillName: doc.skillName,
      content: `---\nname: ${doc.skillName}\ndescription: ${doc.skillDescription}\nmetadata:\n  generator: swallowkit\n---\n\n${doc.content}`,
    }));
}

/**
 * `.github/skills/<name>/SKILL.md` を書き出し、書き込んだ相対パスを返す。
 * agentskills.io 仕様: ディレクトリ名は frontmatter の name と一致必須。
 */
export function writeAgentSkills(projectDir: string, runCmd: string): string[] {
  const written: string[] = [];
  for (const skill of buildAgentSkills(runCmd)) {
    const dir = path.join(projectDir, SKILLS_DIR, skill.skillName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill.content, "utf-8");
    written.push(path.posix.join(".github", "skills", skill.skillName, "SKILL.md"));
  }
  return written;
}
