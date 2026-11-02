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
      "Add a persistent model with registered Cosmos infrastructure, independently of optional CRUD Functions, BFF routes and UI. Use when asked to add a model, entity, resource, table, or a new CRUD feature.",
    content: `# Workflow: Add a new model

Goal: register a persistent model and its infrastructure; derive CRUD/BFF/UI only when needed.

For persistent models, this workflow is required even when all APIs are custom.
A hand-written schema alone is not completion. Non-persistent types remain
ai-authored; connector-backed models follow their connector workflow without
inventing Cosmos containers. If generation is omitted, report the reason and
unfinished work; never claim deployability with required infrastructure missing.

## Responsibility boundary

- **You author freely**: the model schema (\`shared/models/<name>.ts\`) and any business logic.
- **SwallowKit generates deterministically**: Functions CRUD, BFF routes, UI pages, OpenAPI, Bicep containers.
- Query the full contract: \`${runCmd} swallowkit machine inspect boundaries\`

## Steps

1. Create the model file (deterministic template):
   \`${runCmd} swallowkit machine generate model <name> --overwrite never\`
   This also registers the Cosmos container migration and generation ledger.
   Preview with \`--dry-run\`, or use \`machine plan model <name>\` and
   \`machine apply model --plan <planId>\` to review every write before applying.
2. Edit \`shared/models/<name>.ts\` — add domain fields (free-form authoring).
   For a handwritten model use \`migrations add-model <name>\` without rewriting
   the schema or generating CRUD. A changed partition key requires
   \`migrations add-model <name> --refresh-pending --resource-group <rg>\`
   (optional \`--subscription <id>\`): read-only Azure tag/checksum and deployment
   history checks must show no attempt of this generated migration in retained history.
   Unknown or applied state is blocked. Proof applies only to the selected
   target; never rewrite history used by another environment.
   The subscription is pinned once per operation/plan. Empty/missing expected
   history blocks; deleted attempts cannot be recovered, so do not refresh
   after history deletion/truncation or out-of-band deployment.
3. If CRUD is wanted, compute its change plan (writes no application files):
   \`${runCmd} swallowkit machine plan scaffold <name>\`
   - \`status: "requires-human"\` → review \`data.conflicts\`; only proceed with \`--approve\` if overwriting is intended.
4. If a CRUD plan was created, apply it:
   \`${runCmd} swallowkit machine apply scaffold --plan <planId>\`
5. Verify:
   \`${runCmd} swallowkit machine verify project\`
   - \`summary.done: false\` → \`${runCmd} swallowkit machine explain failure\` and repair, then re-verify.
   - Check model/container name and partition key, versioned container
     migrations in \`infra/migrations/manifest.json\` (or existing baseline-owned
     container wiring in \`infra/main.bicep\`), and the
     generation ledger \`.swallowkit/artifacts.json\`. Use \`machine inspect entities\`,
     \`machine inspect infra\`, and \`machine inspect drift\` and inspect actual files.
     Model creation registers containers without requiring scaffold.
     Schema ambiguity and unsupported fields (including \`z.record\`) block
     generation and verification instead of silently omitting models.
     Separate id-less helpers require actual embedded references from a
     persistent entity and no persistence metadata. Their analysis failures
     still block and their source dependencies remain fingerprinted.
     Local verification is not proof of Azure deployment.
6. If \`dev-seeds/\` exists, update seed JSON for the new model. Seeds are only
   applied by \`${runCmd} swallowkit dev --seed-env <environment>\` — editing the
   JSON alone does nothing.

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
   Keep the filename-matching PascalCase schema export (legacy camelCase
   \`Schema\` is supported); helper order must not select a different entity.
   A partition-key change is not an ordinary regeneration: use the explicit
   \`migrations add-model --refresh-pending --resource-group\` flow above only
   for a migration proven never attempted. Applied Cosmos keys are immutable.
2. Check what drifted:
   \`${runCmd} swallowkit machine inspect drift\`
   - \`schema-drift\` findings list the models whose artifacts are stale.
3. Plan the regeneration:
   \`${runCmd} swallowkit machine plan scaffold <name>\`
   - Conflicts mean generated files were hand-edited after generation. Decide: keep the hand-edit (move the logic to an ai-authored file first) or overwrite with \`--approve\`.
4. Apply: \`${runCmd} swallowkit machine apply scaffold --plan <planId>\`
5. Verify: \`${runCmd} swallowkit machine verify project\`

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
      "Converge a SwallowKit project to a verified state: run structure/drift/typecheck (and build/lint/test) checks, read evidence with explain failure, repair, and repeat. Use after any code or schema change, when verification fails, when the build/lint/tests are broken, or before finishing a task.",
    content: `# Workflow: Verify and repair

Goal: converge the project to a verified state after any change.
Unsupported schema analysis and missing/stale Cosmos infrastructure must not
be ignored. Check the structured file/schema/field/reason diagnostic; never
reorder schema exports or hand-edit the ledger to get a passing result.
Local verification is not proof of Azure deployment.

## Loop

1. \`${runCmd} swallowkit machine verify project\`
   - default checks: structure, drift, typecheck (+ project-specific checks from swallowkit.config \`verify.checks\`)
   - opt-in heavier checks: \`--checks structure,drift,typecheck,build,lint,test\`
2. If \`summary.done\` is false:
   - \`${runCmd} swallowkit machine explain failure\` → evidence (logTail, findings, violations) and suggestedActions per check.
   - Repair:
     - \`drift\` failures → follow each finding's \`repairAction\` (usually re-run plan/apply scaffold).
     - \`structure\` failures → follow \`suggestedFix\` per violation.
     - \`typecheck\`/\`build\`/\`lint\`/\`test\` failures → fix the code in ai-authored files.
3. Repeat until \`summary.done: true\`.

## Exit criteria

For startup, persistence, API, or UI changes, follow the generated root
\`AGENTS.md\` runtime and persistence checks; a green summary alone is not
runtime evidence. Documentation-only changes do not require database startup.

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
- Inspect infra locally first — no \`az\` calls are needed for inspection.
- Never edit an applied migration. Create a corrective migration instead.
- Never use \`--reconcile\` for an ordinary model or resource addition.

## Steps

1. Inspect the infrastructure definition (pure local Bicep analysis):
   \`${runCmd} swallowkit machine inspect infra\`
   - review parameters, modules, outputs, and container wiring warnings.
2. Compute the provisioning plan (no resources are created):
   \`${runCmd} swallowkit machine plan provision -g <resource-group> --location <region>\`
  - the plan reports \`bootstrap\`, \`migrate\`, \`noop\`, or \`adoption-required\`.
  - it lists only pending migrations and the exact \`az\` commands that would run.
  - for an older untagged environment, first run \`${runCmd} swallowkit migrations init --legacy-baseline\`, then plan with \`--adopt-existing --baseline 0 --what-if\`.
  - only intentional baseline changes use \`--reconcile --what-if\`; this can reset template-managed settings.
3. Present the plan to the human and wait for explicit approval.
4. Only after approval:
   \`${runCmd} swallowkit machine apply provision --plan <planId> --approve\`
5. Verify the deployment outputs and report them.

## Terminal states

\`apply provision\` without \`--approve\` fails with \`approval-required\` —
this is the guardrail working as intended, not an error to work around.
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
- **shared** (edit outside markers): \`infra/main.bicep\`, \`functions/function_app.py\`, \`shared/index.ts\`.

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
