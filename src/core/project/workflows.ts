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
      "Add a new data model to a SwallowKit project and deterministically derive CRUD Functions, BFF routes, UI pages, and Cosmos DB infra from it using the plan/apply/verify loop. Use when asked to add a model, entity, resource, table, or a new CRUD feature.",
    content: `# Workflow: Add a new model

Goal: add a data model and derive CRUD/BFF/UI/infra deterministically.

## Responsibility boundary

- **You author freely**: the model schema (\`shared/models/<name>.ts\`) and any business logic.
- **SwallowKit generates deterministically**: Functions CRUD, BFF routes, UI pages, OpenAPI, Bicep containers.
- Query the full contract: \`${runCmd} swallowkit machine inspect boundaries\`

## Steps

1. Create the model file (deterministic template):
   \`${runCmd} swallowkit machine generate model <name> --overwrite never\`
2. Edit \`shared/models/<name>.ts\` — add domain fields (free-form authoring).
3. Compute the change plan (writes nothing):
   \`${runCmd} swallowkit machine plan scaffold <name>\`
   - \`status: "requires-human"\` → review \`data.conflicts\`; only proceed with \`--approve\` if overwriting is intended.
4. Apply:
   \`${runCmd} swallowkit machine apply scaffold --plan <planId>\`
5. Verify:
   \`${runCmd} swallowkit machine verify project\`
   - \`summary.done: false\` → \`${runCmd} swallowkit machine explain failure\` and repair, then re-verify.
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

Goal: deploy the Bicep infrastructure with an explicit human approval gate.

## Rules

- Provisioning **always** requires human approval — \`plan provision\` returns
  \`status: "requires-human"\` and \`requiresApproval: true\` by design.
- Never pass \`--approve\` to \`apply provision\` unless a human explicitly
  instructed you to provision in this session.
- Inspect infra locally first — no \`az\` calls are needed for inspection.

## Steps

1. Inspect the infrastructure definition (pure local Bicep analysis):
   \`${runCmd} swallowkit machine inspect infra\`
   - review parameters, modules, outputs, and container wiring warnings.
2. Compute the provisioning plan (no resources are created):
   \`${runCmd} swallowkit machine plan provision -g <resource-group> --location <region>\`
   - optional: \`--what-if\` to include an \`az deployment ... what-if\` preview.
   - the plan lists the exact \`az\` commands that would run.
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
