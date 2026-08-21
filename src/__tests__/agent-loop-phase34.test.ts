/**
 * Phase 3/4 agent-loop tests:
 * - inspect boundaries / inspect infra
 * - plan/apply auth(承認フロー含む)
 * - plan/apply provision(az 実行なしの安全パスのみ)
 * - verify のカスタムチェック読込
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as childProcess from "child_process";
import { runMachineCli } from "../machine";
import { inspectInfra } from "../core/project/infra";
import { loadCustomVerifyChecks } from "../core/verify";
import { buildAgentSkills, buildWorkflowDocs, writeAgentSkills, writeWorkflowDocs } from "../core/project/workflows";

jest.mock("child_process", () => {
  const actual = jest.requireActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: jest.fn(),
    spawnSync: jest.fn(),
  };
});

const repoRoot = process.cwd();

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function createProjectFixture(rootDir: string): void {
  writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "sample-app" }, null, 2));
  writeFile(
    path.join(rootDir, "swallowkit.config.js"),
    `module.exports = {
  database: {
    connectionString: 'AccountEndpoint=https://example.local;',
  },
  backend: {
    language: 'typescript',
  },
  api: {
    endpoint: '/api/_swallowkit',
  },
};
`
  );
  writeFile(path.join(rootDir, "shared", "package.json"), JSON.stringify({ name: "@sample-app/shared" }, null, 2));
  writeFile(path.join(rootDir, "shared", "index.ts"), "export {};\n");
  writeFile(path.join(rootDir, "functions", "package.json"), JSON.stringify({ name: "functions" }, null, 2));
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.symlinkSync(
    path.join(repoRoot, "node_modules", "zod"),
    path.join(rootDir, "node_modules", "zod"),
    "junction"
  );
}

const SAMPLE_MAIN_BICEP = `targetScope = 'resourceGroup'

@description('Project name')
param projectName string

@description('Cosmos DB mode')
@allowed(['freetier', 'serverless'])
param cosmosDbMode string = 'serverless'

param enableVNet bool = false

module logAnalytics 'modules/loganalytics.bicep' = {
  name: 'logAnalytics'
  params: {
    name: 'log-x'
  }
}

module cosmosDbServerless 'modules/cosmosdb-serverless.bicep' = if (cosmosDbMode == 'serverless') {
  name: 'cosmosDb'
}

module todoContainer 'containers/todo-container.bicep' = {
  name: 'todoContainer'
}

output cosmosDbAccountName string = 'x'
output vnetEnabled bool = enableVNet
`;

async function runMachine(argv: string[]): Promise<{ response: any; exitCode: number }> {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExitCode = process.exitCode;

  (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;

  process.exitCode = 0;

  try {
    await runMachineCli(argv);
    return {
      response: JSON.parse(writes.join("")),
      exitCode: process.exitCode || 0,
    };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

describe("agent loop phase 3/4", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-p34-"));
    process.chdir(tempDir);
    (childProcess.spawnSync as unknown as any).mockReturnValue({ status: 1, stdout: "", stderr: "" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("returns the responsibility boundary contract via inspect boundaries", async () => {
    createProjectFixture(tempDir);
    const { response, exitCode } = await runMachine(["node", "swallowkit", "machine", "inspect", "boundaries"]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.data.contractVersion).toBe(1);
    expect(response.data.ownershipPolicies.map((p: any) => p.ownership)).toEqual(
      expect.arrayContaining(["managed", "generated-once", "user-owned", "extension-point", "metadata"])
    );
    const managed = response.data.ownershipPolicies.find((p: any) => p.ownership === "managed");
    expect(managed.zone).toBe("deterministic");
    expect(managed.editPolicy).toBe("regenerate-via-plan-apply");
    expect(response.data.conventionRules.some((r: any) => r.pattern === "*")).toBe(true);
  });

  it("inspects Bicep infra assets deterministically", () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    writeFile(path.join(tempDir, "infra", "modules", "loganalytics.bicep"), "// module\n");
    writeFile(path.join(tempDir, "infra", "containers", "todo-container.bicep"), "// wired\n");
    writeFile(path.join(tempDir, "infra", "containers", "orphan-container.bicep"), "// not wired\n");

    const inspection = inspectInfra(tempDir);

    expect(inspection.mainBicep.exists).toBe(true);
    expect(inspection.mainBicep.params.map((p) => p.name)).toEqual(["projectName", "cosmosDbMode", "enableVNet"]);
    const cosmosMode = inspection.mainBicep.params.find((p) => p.name === "cosmosDbMode");
    expect(cosmosMode?.allowed).toEqual(["freetier", "serverless"]);
    expect(cosmosMode?.description).toBe("Cosmos DB mode");

    const serverless = inspection.mainBicep.modules.find((m) => m.symbolicName === "cosmosDbServerless");
    expect(serverless?.condition).toBe("cosmosDbMode == 'serverless'");
    expect(serverless?.deploymentName).toBe("cosmosDb");

    expect(inspection.mainBicep.outputs).toEqual([
      { name: "cosmosDbAccountName", type: "string" },
      { name: "vnetEnabled", type: "bool" },
    ]);

    expect(inspection.containers).toEqual([
      { file: "infra/containers/orphan-container.bicep", wired: false },
      { file: "infra/containers/todo-container.bicep", wired: true },
    ]);
    expect(inspection.warnings.some((w) => w.startsWith("container-not-wired"))).toBe(true);
  });

  it("plans auth without writing files, applies it, and enforces approval on conflicts", async () => {
    createProjectFixture(tempDir);

    // 1. Plan — ディスクへの書き込みなし
    const plan1 = await runMachine(["node", "swallowkit", "machine", "plan", "auth", "--provider", "custom-jwt"]);
    expect(plan1.exitCode).toBe(0);
    expect(plan1.response.ok).toBe(true);
    expect(plan1.response.data.planType).toBe("auth");
    expect(plan1.response.data.requiresApproval).toBe(false);
    expect(plan1.response.status).toBe("complete");
    const plannedPaths = plan1.response.data.operations.map((op: any) => op.path);
    expect(plannedPaths).toEqual(expect.arrayContaining(["shared/models/auth.ts", "proxy.ts", "app/login/page.tsx"]));
    expect(fs.existsSync(path.join(tempDir, "proxy.ts"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "shared", "models", "auth.ts"))).toBe(false);

    // 2. Apply — 実際に書き込み、台帳に記録される
    const apply1 = await runMachine([
      "node", "swallowkit", "machine", "apply", "auth", "--plan", plan1.response.data.planId,
    ]);
    expect(apply1.exitCode).toBe(0);
    expect(apply1.response.ok).toBe(true);
    expect(apply1.response.status).toBe("complete");
    expect(fs.existsSync(path.join(tempDir, "proxy.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "shared", "models", "auth.ts"))).toBe(true);
    const ledger = JSON.parse(fs.readFileSync(path.join(tempDir, ".swallowkit", "artifacts.json"), "utf-8"));
    expect(ledger.artifacts.some((a: any) => a.path === "proxy.ts" && a.generator === "add-auth")).toBe(true);

    // 3. managed ファイルを手編集後の plan は競合として検出される
    fs.appendFileSync(path.join(tempDir, "lib", "auth", "auth-context.tsx"), "\n// hand edit\n");
    const plan2 = await runMachine(["node", "swallowkit", "machine", "plan", "auth", "--provider", "custom-jwt"]);
    expect(plan2.response.ok).toBe(true);
    expect(plan2.response.data.requiresApproval).toBe(true);
    expect(plan2.response.status).toBe("requires-human");
    const conflict = plan2.response.data.conflicts.find((c: any) => c.path === "lib/auth/auth-context.tsx");
    expect(conflict?.conflictReason).toBe("modified-after-generation");

    // 4. 承認なしの apply は requires-human で停止
    const applyNoApprove = await runMachine(["node", "swallowkit", "machine", "apply", "auth", "--provider", "custom-jwt"]);
    expect(applyNoApprove.response.ok).toBe(false);
    expect(applyNoApprove.response.error.code).toBe("approval-required");
    expect(applyNoApprove.response.status).toBe("requires-human");
    expect(fs.readFileSync(path.join(tempDir, "lib", "auth", "auth-context.tsx"), "utf-8")).toContain("// hand edit");

    // 5. --approve で上書き適用できる
    const applyApproved = await runMachine([
      "node", "swallowkit", "machine", "apply", "auth", "--provider", "custom-jwt", "--approve",
    ]);
    expect(applyApproved.response.ok).toBe(true);
    expect(applyApproved.response.data.approvedConflicts.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(tempDir, "lib", "auth", "auth-context.tsx"), "utf-8")).not.toContain("// hand edit");
  });

  it("plans provision locally and always requires human approval to apply", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");

    const plan = await runMachine([
      "node", "swallowkit", "machine", "plan", "provision",
      "--resource-group", "rg-sample",
      "--location", "japaneast",
      "--swa-location", "eastasia",
    ]);

    expect(plan.exitCode).toBe(0);
    expect(plan.response.ok).toBe(true);
    expect(plan.response.status).toBe("requires-human");
    expect(plan.response.data.requiresApproval).toBe(true);
    // spawnSync がモックで失敗を返すため az CLI は「利用不可」として警告される
    expect(plan.response.data.azCliAvailable).toBe(false);
    expect(plan.response.data.warnings.some((w: string) => w.startsWith("az-cli-not-found"))).toBe(true);
    expect(plan.response.data.commands.some((c: string) => c.includes("az deployment group create"))).toBe(true);

    // 承認なしの apply は requires-human
    const applyNoApprove = await runMachine([
      "node", "swallowkit", "machine", "apply", "provision", "--plan", plan.response.data.planId,
    ]);
    expect(applyNoApprove.response.ok).toBe(false);
    expect(applyNoApprove.response.error.code).toBe("approval-required");
    expect(applyNoApprove.response.status).toBe("requires-human");

    // 存在しない plan は blocked
    const applyMissing = await runMachine([
      "node", "swallowkit", "machine", "apply", "provision", "--plan", "does-not-exist", "--approve",
    ]);
    expect(applyMissing.response.ok).toBe(false);
    expect(applyMissing.response.error.code).toBe("plan-not-found");
    expect(applyMissing.response.status).toBe("blocked");
  });

  it("rejects invalid provision inputs", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);

    const badRg = await runMachine([
      "node", "swallowkit", "machine", "plan", "provision",
      "--resource-group", "rg; rm -rf /",
      "--location", "japaneast",
      "--swa-location", "eastasia",
    ]);
    expect(badRg.response.ok).toBe(false);
    expect(badRg.response.error.code).toBe("invalid-arguments");

    const badLocation = await runMachine([
      "node", "swallowkit", "machine", "plan", "provision",
      "--resource-group", "rg-sample",
      "--location", "Japan East",
      "--swa-location", "eastasia",
    ]);
    expect(badLocation.response.ok).toBe(false);
    expect(badLocation.response.error.code).toBe("invalid-arguments");
  });

  it("loads custom verify checks from swallowkit.config.json and rejects invalid ids", () => {
    writeFile(
      path.join(tempDir, "swallowkit.config.json"),
      JSON.stringify({
        verify: {
          checks: [
            { id: "smoke-api", title: "API smoke", command: "node scripts/smoke.js" },
            { id: "Bad_Id", command: "echo bad" },
            { id: "typecheck", command: "echo clash-with-builtin" },
          ],
        },
      })
    );

    const checks = loadCustomVerifyChecks(tempDir);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ id: "smoke-api", command: "node scripts/smoke.js" });
  });

  describe("workflow docs & agent skills", () => {
    it("builds workflow docs including provision and an index referencing skills", () => {
      const docs = buildWorkflowDocs("pnpm exec");
      const fileNames = docs.map((d) => d.fileName);
      expect(fileNames).toEqual(
        expect.arrayContaining(["README.md", "add-model.md", "modify-model.md", "verify-and-repair.md", "provision.md"])
      );
      const index = docs.find((d) => d.fileName === "README.md")!;
      expect(index.content).toContain(".github/skills/");
      expect(index.content).toContain("swallowkit-provision");
    });

    it("builds agent skills that follow the agentskills.io spec", () => {
      const skills = buildAgentSkills("pnpm exec");
      expect(skills.map((s) => s.skillName)).toEqual([
        "swallowkit-add-model",
        "swallowkit-modify-model",
        "swallowkit-verify-repair",
        "swallowkit-provision",
      ]);
      for (const skill of skills) {
        // name: 小文字英数字とハイフンのみ・連続ハイフンなし・64文字以内
        expect(skill.skillName).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(skill.skillName.length).toBeLessThanOrEqual(64);
        // frontmatter: name はディレクトリ名と一致、description は 1024 文字以内
        const frontmatter = skill.content.match(/^---\n([\s\S]*?)\n---\n/);
        expect(frontmatter).not.toBeNull();
        expect(frontmatter![1]).toContain(`name: ${skill.skillName}`);
        const description = frontmatter![1].match(/description: (.+)/)![1];
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        // 本文にランブックが含まれる
        expect(skill.content).toContain("# Workflow:");
        expect(skill.content).toContain("pnpm exec swallowkit machine");
      }
    });

    it("writes skills to .github/skills/<name>/SKILL.md and runbooks to .swallowkit/workflows/", () => {
      const skillPaths = writeAgentSkills(tempDir, "npx");
      expect(skillPaths).toEqual([
        ".github/skills/swallowkit-add-model/SKILL.md",
        ".github/skills/swallowkit-modify-model/SKILL.md",
        ".github/skills/swallowkit-verify-repair/SKILL.md",
        ".github/skills/swallowkit-provision/SKILL.md",
      ]);
      for (const rel of skillPaths) {
        expect(fs.existsSync(path.join(tempDir, rel))).toBe(true);
      }

      const workflowPaths = writeWorkflowDocs(tempDir, "npx");
      expect(workflowPaths).toContain(".swallowkit/workflows/provision.md");
      for (const rel of workflowPaths) {
        expect(fs.existsSync(path.join(tempDir, rel))).toBe(true);
      }

      // provision スキルは承認ゲートを明記する
      const provisionSkill = fs.readFileSync(
        path.join(tempDir, ".github", "skills", "swallowkit-provision", "SKILL.md"),
        "utf-8"
      );
      expect(provisionSkill).toContain("requires-human");
      expect(provisionSkill).toContain("--approve");
    });
  });

  describe("robustness (irregular inputs)", () => {
    it("returns not-a-swallowkit-project (blocked) for write commands outside a project", async () => {
      // fixture なし = プロジェクトマーカーなし
      const planResult = await runMachine(["node", "swallowkit", "machine", "plan", "scaffold", "todo"]);
      expect(planResult.response.ok).toBe(false);
      expect(planResult.response.status).toBe("blocked");
      expect(planResult.response.error.code).toBe("not-a-swallowkit-project");

      const generateResult = await runMachine(["node", "swallowkit", "machine", "generate", "model", "todo"]);
      expect(generateResult.response.ok).toBe(false);
      expect(generateResult.response.status).toBe("blocked");
      expect(generateResult.response.error.code).toBe("not-a-swallowkit-project");
    });

    it("degrades corrupted plan state to plan-not-found instead of crashing", async () => {
      createProjectFixture(tempDir);
      const planFile = path.join(tempDir, ".swallowkit", "state", "plans", "corrupt99.json");
      writeFile(planFile, "{not valid json!!!");

      const result = await runMachine([
        "node", "swallowkit", "machine", "apply", "scaffold", "--plan", "corrupt99", "--approve",
      ]);
      expect(result.response.ok).toBe(false);
      expect(result.response.status).toBe("blocked");
      expect(result.response.error.code).toBe("plan-not-found");
    });

    it("degrades corrupted last-verify state to no-verification-result", async () => {
      createProjectFixture(tempDir);
      writeFile(path.join(tempDir, ".swallowkit", "state", "last-verify.json"), "not json");

      const result = await runMachine(["node", "swallowkit", "machine", "explain", "failure"]);
      expect(result.response.ok).toBe(false);
      expect(result.response.status).toBe("blocked");
      expect(result.response.error.code).toBe("no-verification-result");
    });

    it("returns help text as a success envelope for --help", async () => {
      const result = await runMachine(["node", "swallowkit", "machine", "--help"]);
      expect(result.response.ok).toBe(true);
      expect(result.response.command).toBe("machine-help");
      expect(result.response.data.help).toContain("Usage:");
      expect(result.exitCode).toBe(0);

      const subResult = await runMachine(["node", "swallowkit", "machine", "plan", "scaffold", "--help"]);
      expect(subResult.response.ok).toBe(true);
      expect(subResult.response.data.help).toContain("plan scaffold");
    });

    it("returns invalid-command with usage details for unknown commands and missing required options", async () => {
      const unknown = await runMachine(["node", "swallowkit", "machine", "frobnicate"]);
      expect(unknown.response.ok).toBe(false);
      expect(unknown.response.error.code).toBe("invalid-command");
      expect(unknown.exitCode).toBe(1);

      createProjectFixture(tempDir);
      const missingOption = await runMachine(["node", "swallowkit", "machine", "plan", "provision"]);
      expect(missingOption.response.ok).toBe(false);
      expect(missingOption.response.error.code).toBe("invalid-command");
      expect(missingOption.response.error.message).toContain("--resource-group");
      expect(missingOption.exitCode).toBe(1);
    });

    it("preserves the full multi-line error message from legacy console.error paths", async () => {
      createProjectFixture(tempDir);
      // 存在しないモデル → scaffold 内部の console.error + process.exit 経路
      const result = await runMachine(["node", "swallowkit", "machine", "plan", "scaffold", "no-such-model"]);
      expect(result.response.ok).toBe(false);
      // 断片ではなく "Model file not found" を含む全文が返ること
      expect(result.response.error.message).toContain("Model file not found");
    });
  });
});
