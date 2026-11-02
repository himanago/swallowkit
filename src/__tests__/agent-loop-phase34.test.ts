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
import { detectDrift } from "../core/project/drift";
import { parseModelFile } from "../core/scaffold/model-parser";
import { inspectInfra } from "../core/project/infra";
import { loadCustomVerifyChecks, compactVerifyResult, runVerify, VerifyResult } from "../core/verify";
import { buildAgentSkills, buildWorkflowDocs, writeAgentSkills, writeWorkflowDocs } from "../core/project/workflows";
import { applyProvisionOperation, planProvisionOperation } from "../core/operations/provision-operations";
import { resetAzCliInvocationCache, setAzCliInvocationForTesting } from "../utils/azure-cli";
import * as azureCli from "../utils/azure-cli";
import { createCustomMigration, initializeLegacyMigrations } from "../core/operations/migration-generator";
import { createModelOperation } from "../core/operations/create-model";
import { addModelContainerMigration } from "../core/operations/model-migration";
import { createMigrationManifest, encodeMigrationState, getMigrationTagKey, loadMigrationManifest, saveMigrationManifest } from "../core/project/migrations";

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
    // Platform-independent az invocation; the Windows wrapper resolution is covered in azure-cli.test.ts.
    setAzCliInvocationForTesting({ command: "az", prefixArgs: [], source: "az" });
    jest.spyOn(azureCli, "runAzCliAsync").mockImplementation(async (args) => azureCli.runAzCli(args));
  });

  afterEach(() => {
    resetAzCliInvocationCache();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
    jest.restoreAllMocks();
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

  it("threads --allowed-providers into the config and generated SWA artifacts for a named scheme", async () => {
    createProjectFixture(tempDir);

    const plan = await runMachine([
      "node", "swallowkit", "machine", "plan", "auth",
      "--provider", "swa", "--scheme", "admin", "--allowed-providers", "github",
    ]);
    expect(plan.response.ok).toBe(true);
    expect(plan.response.data.allowedProviders).toEqual(["github"]);

    const apply = await runMachine([
      "node", "swallowkit", "machine", "apply", "auth", "--plan", plan.response.data.planId,
    ]);
    expect(apply.response.ok).toBe(true);

    const config = fs.readFileSync(path.join(tempDir, "swallowkit.config.js"), "utf-8");
    expect(config).toContain("swa: { allowedProviders: ['github'] }");

    const authContext = fs.readFileSync(
      path.join(tempDir, "lib", "auth", "schemes", "admin", "auth-context.tsx"),
      "utf-8"
    );
    expect(authContext).toContain("/.auth/login/github?");
    expect(authContext).not.toContain("/.auth/login/aad");

    // apply auth は「policies を定義せよ」等の後続手順を nextActions で返す
    const descriptions = apply.response.nextActions.map((a: any) => a.description).join(" ");
    expect(descriptions).toContain("auth.authorization.policies");
    expect(descriptions).toContain("allowedProviders");
  });

  it("plans provision locally and always requires human approval to apply", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    setAzCliInvocationForTesting(null);

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

  it("requires explicit adoption for an existing untagged resource group", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample-app" } } }));
    initializeLegacyMigrations(tempDir);

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") return { status: 0, stdout: JSON.stringify({ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample", tags: {} }), stderr: "" };
      return { status: 1, stdout: "", stderr: "unexpected" };
    });

    const plan = await planProvisionOperation({ resourceGroup: "rg-sample", location: "japaneast", swaLocation: "eastasia", subscription: "11111111-1111-1111-1111-111111111111" });

    expect(plan.mode).toBe("adoption-required");
    expect(plan.commands).toEqual([]);
  });

  it("adopts a legacy baseline without deploying main.bicep when what-if only modifies resources", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample-app" } } }));
    initializeLegacyMigrations(tempDir);

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") return { status: 0, stdout: JSON.stringify({ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample", tags: {} }), stderr: "" };
      if (args[0] === "deployment" && args[2] === "what-if") {
        return { status: 0, stdout: JSON.stringify({ changes: [{ changeType: "Modify", resourceId: "/functions/sample" }] }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    });

    const plan = await planProvisionOperation({
      resourceGroup: "rg-sample",
      location: "japaneast",
      swaLocation: "eastasia",
      adoptExisting: true,
      baseline: 0,
      whatIf: true,
      subscription: "11111111-1111-1111-1111-111111111111",
    });

    expect(plan.mode).toBe("adopt");
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toContain("az tag update");
    expect(plan.commands[0]).not.toContain("deployment group create");
  });

  it("recovers an interrupted bootstrap by reconciling before recording baseline state", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample-app" } } }));
    saveMigrationManifest(createMigrationManifest(tempDir, { projectId: "new-project" }), tempDir);

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") return { status: 0, stdout: JSON.stringify({ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample", tags: {} }), stderr: "" };
      if (args[0] === "deployment" && args[2] === "what-if") return { status: 0, stdout: JSON.stringify({ changes: [] }), stderr: "" };
      return { status: 1, stdout: "", stderr: "unexpected" };
    });

    const plan = await planProvisionOperation({
      resourceGroup: "rg-sample",
      location: "japaneast",
      swaLocation: "eastasia",
      reconcile: true,
      subscription: "11111111-1111-1111-1111-111111111111",
    });

    expect(plan.mode).toBe("reconcile");
    expect(plan.commands.some((command) => command.includes("deployment group create"))).toBe(true);
    expect(plan.commands.at(-1)).toContain("tag update");
    expect(plan.manifestAfterApply?.baseline.legacy).toBe(false);
  });

  it("plans only migrations newer than the Azure tag", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample-app" } } }));
    const manifest = initializeLegacyMigrations(tempDir);
    createCustomMigration("add-search", tempDir);
    const tagValue = encodeMigrationState({ schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum });

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") {
        const tagKey = getMigrationTagKey(manifest.projectId);
        return { status: 0, stdout: JSON.stringify({ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample", tags: { [tagKey]: tagValue } }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    });

    const plan = await planProvisionOperation({ resourceGroup: "rg-sample", location: "japaneast", swaLocation: "eastasia", subscription: "11111111-1111-1111-1111-111111111111" });

    expect(plan.mode).toBe("migrate");
    expect(plan.pendingMigrations.map((migration) => migration.version)).toEqual([1]);
    expect(plan.commands.filter((command) => command.includes("deployment group create"))).toHaveLength(1);
    expect(plan.commands.some((command) => command.includes("tag update") && command.includes("--operation Merge"))).toBe(true);
  });

  it("plans a newly created persistent model container through the registered migration ledger", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "sample-app" } },
    }));
    const baseline = initializeLegacyMigrations(tempDir);

    const created = await createModelOperation({ names: ["learning profile"], overwriteMode: "never" });
    expect(created.infrastructureFiles).toEqual(expect.arrayContaining([
      "infra/migrations/0001-create-learning-profile-container/main.bicep",
      "infra/migrations/manifest.json",
    ]));
    expect(fs.readFileSync(path.join(tempDir, ".swallowkit", "artifacts.json"), "utf-8")).toContain('"sourceModel": "LearningProfile"');
    const repeated = await createModelOperation({ names: ["learning profile"], overwriteMode: "never" });
    expect(repeated.createdFiles).toEqual([]);
    expect(repeated.skippedFiles).toEqual(["shared/models/learning-profile.ts"]);
    expect(loadMigrationManifest(tempDir).migrations).toHaveLength(1);

    const tagKey = getMigrationTagKey(baseline.projectId);
    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") {
        return {
          status: 0,
          stdout: JSON.stringify({
            id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample",
            tags: { [tagKey]: encodeMigrationState({ schemaVersion: 1, version: 0, checksum: baseline.baseline.checksum }) },
          }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    });

    const plan = await planProvisionOperation({
      resourceGroup: "rg-sample",
      location: "japaneast",
      swaLocation: "eastasia",
      subscription: "11111111-1111-1111-1111-111111111111",
    });

    expect(plan.mode).toBe("migrate");
    expect(plan.pendingMigrations.map((migration) => migration.sourceModel)).toEqual(["LearningProfile"]);
    expect(plan.commands.filter((command) => command.includes("deployment group create"))).toHaveLength(1);
    expect(fs.readFileSync(
      path.join(tempDir, "infra", "migrations", "0001-create-learning-profile-container", "main.bicep"),
      "utf-8"
    )).toContain("'LearningProfiles'");
  });

  it("includes registered model migrations in the first bootstrap provision plan", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "sample-app" } },
    }));
    initializeLegacyMigrations(tempDir);
    await createModelOperation({ names: ["learning profile"], overwriteMode: "never" });

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "false\n", stderr: "" };
      return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    });

    const plan = await planProvisionOperation({
      resourceGroup: "rg-sample",
      location: "japaneast",
      swaLocation: "eastasia",
      subscription: "11111111-1111-1111-1111-111111111111",
    });

    expect(plan.mode).toBe("bootstrap");
    expect(plan.pendingMigrations.map((migration) => migration.sourceModel)).toEqual(["LearningProfile"]);
    expect(plan.commands).toEqual(expect.arrayContaining([
      expect.stringContaining("--name swallowkit-baseline"),
      expect.stringContaining("--name swallowkit-migration-1-"),
      expect.stringContaining("tags.swallowkit-migration-"),
    ]));
  });

  it("exposes the schema-preserving model migration preview and apply through machine CLI", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    const baseline = initializeLegacyMigrations(tempDir);
    const modelSource = `import { z } from 'zod/v4';
export const Todo = z.object({ id: z.string(), userId: z.string() });
export const partitionKey = '/userId';
`;
    writeFile(path.join(tempDir, "shared", "models", "todo.ts"), modelSource);
    const ledgerPath = path.join(tempDir, ".swallowkit", "artifacts.json");
    const beforeLedger = fs.readFileSync(ledgerPath, "utf-8");

    const preview = await runMachine(["node", "swallowkit", "machine", "migrations", "add-model", "todo", "--dry-run"]);
    expect(preview.exitCode).toBe(0);
    expect(preview.response.command).toBe("migrations-add-model");
    expect(preview.response.data.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "infra/migrations/0001-create-todo-container/main.bicep", action: "create" }),
      expect.objectContaining({ path: "infra/migrations/manifest.json", action: "modify" }),
      expect.objectContaining({ path: ".swallowkit/artifacts.json", action: "modify" }),
    ]));
    expect(fs.existsSync(path.join(tempDir, "infra", "migrations", "0001-create-todo-container", "main.bicep"))).toBe(false);
    expect(fs.readFileSync(ledgerPath, "utf-8")).toBe(beforeLedger);

    const applied = await runMachine(["node", "swallowkit", "machine", "migrations", "add-model", "todo"]);
    expect(applied.exitCode).toBe(0);
    expect(loadMigrationManifest(tempDir).migrations).toEqual([
      expect.objectContaining({ version: 1, source: "model", sourceModel: "Todo" }),
    ]);
    expect(fs.readFileSync(path.join(tempDir, "shared", "models", "todo.ts"), "utf-8")).toBe(modelSource);
    expect(loadMigrationManifest(tempDir).baseline.checksum).toBe(baseline.baseline.checksum);
  });

  it("plans and applies model infrastructure without rewriting a handwritten schema, then targets it in provision", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "sample-app" } },
    }));
    const baseline = initializeLegacyMigrations(tempDir);
    const modelSource = `import { z } from 'zod/v4';
export const Todo = z.object({ id: z.string(), userId: z.string() });
export const partitionKey = '/userId';
`;
    writeFile(path.join(tempDir, "shared", "models", "todo.ts"), modelSource);
    const ledgerPath = path.join(tempDir, ".swallowkit", "artifacts.json");
    const beforeLedger = fs.readFileSync(ledgerPath, "utf-8");

    const planned = await runMachine(["node", "swallowkit", "machine", "plan", "model-infrastructure", "todo"]);
    expect(planned.exitCode).toBe(0);
    expect(planned.response.command).toBe("plan-model-infrastructure");
    expect(planned.response.data.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "infra/migrations/0001-create-todo-container/main.bicep", action: "create" }),
      expect.objectContaining({ path: "infra/migrations/manifest.json", action: "update" }),
      expect.objectContaining({ path: ".swallowkit/artifacts.json", action: "update" }),
    ]));
    expect(fs.existsSync(path.join(tempDir, "infra", "migrations", "0001-create-todo-container", "main.bicep"))).toBe(false);
    expect(fs.readFileSync(ledgerPath, "utf-8")).toBe(beforeLedger);

    const applied = await runMachine([
      "node", "swallowkit", "machine", "apply", "model", "--plan", planned.response.data.planId,
    ]);
    expect(applied.exitCode).toBe(0);
    expect(applied.response.data.planType).toBe("model-infrastructure");
    expect(fs.readFileSync(path.join(tempDir, "shared", "models", "todo.ts"), "utf-8")).toBe(modelSource);
    expect(loadMigrationManifest(tempDir).migrations).toEqual([
      expect.objectContaining({ version: 1, source: "model", sourceModel: "Todo" }),
    ]);
    expect(loadMigrationManifest(tempDir).baseline.checksum).toBe(baseline.baseline.checksum);

    const tagKey = getMigrationTagKey(baseline.projectId);
    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") {
        return {
          status: 0,
          stdout: JSON.stringify({
            id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample",
            tags: { [tagKey]: encodeMigrationState({ schemaVersion: 1, version: 0, checksum: baseline.baseline.checksum }) },
          }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    });
    const provisionPlan = await planProvisionOperation({
      resourceGroup: "rg-sample",
      location: "japaneast",
      swaLocation: "eastasia",
      subscription: "11111111-1111-1111-1111-111111111111",
    });
    expect(provisionPlan.pendingMigrations.map((migration) => migration.sourceModel)).toEqual(["Todo"]);
  });

  it("invalidates model infrastructure plans when a referenced helper is removed", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    initializeLegacyMigrations(tempDir);
    const helperPath = path.join(tempDir, "shared", "models", "topic-mastery.ts");
    const entityPath = path.join(tempDir, "shared", "models", "learning-profile.ts");
    writeFile(helperPath, `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
`);
    writeFile(entityPath, `import { z } from 'zod/v4';
import { TopicMastery } from './topic-mastery';
export const LearningProfile = z.object({ id: z.string(), mastery: z.array(TopicMastery) });
`);
    const beforeLedger = fs.readFileSync(path.join(tempDir, ".swallowkit", "artifacts.json"), "utf-8");
    const planned = await runMachine([
      "node", "swallowkit", "machine", "plan", "model-infrastructure", "learning-profile",
    ]);
    expect(planned.exitCode).toBe(0);
    expect(planned.response.data.fingerprints["shared/models/topic-mastery.ts"]).toMatch(/^[a-f0-9]{64}$/);

    fs.unlinkSync(helperPath);
    const applied = await runMachine([
      "node", "swallowkit", "machine", "apply", "model", "--plan", planned.response.data.planId,
    ]);
    expect(applied.response.status).toBe("blocked");
    expect(applied.response.error.code).toBe("stale-plan");
    expect(fs.existsSync(path.join(tempDir, "infra", "migrations", "0001-create-learning-profile-container", "main.bicep"))).toBe(false);
    expect(fs.readFileSync(path.join(tempDir, ".swallowkit", "artifacts.json"), "utf-8")).toBe(beforeLedger);
  });

  it("plans model, migration, and metadata writes without applying them, then applies the same plan", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "sample-app" } },
    }));
    initializeLegacyMigrations(tempDir);
    const migrationManifest = path.join(tempDir, "infra", "migrations", "manifest.json");
    const migrationManifestBefore = fs.readFileSync(migrationManifest, "utf-8");
    const artifactLedger = path.join(tempDir, ".swallowkit", "artifacts.json");
    const artifactLedgerBefore = fs.readFileSync(artifactLedger, "utf-8");
    const planned = await runMachine(["node", "swallowkit", "machine", "plan", "model", "todo"]);
    expect(planned.exitCode).toBe(0);
    expect(planned.response.ok).toBe(true);
    expect(planned.response.status).toBe("complete");
    const plannedPaths = planned.response.data.operations.map((operation: { path: string }) => operation.path);
    expect(plannedPaths).toEqual(expect.arrayContaining([
      "shared/models/todo.ts",
      "shared/index.ts",
      "infra/migrations/manifest.json",
      ".swallowkit/artifacts.json",
      ".swallowkit/project.json",
    ]));
    expect(fs.existsSync(path.join(tempDir, "shared", "models", "todo.ts"))).toBe(false);
    expect(fs.readFileSync(migrationManifest, "utf-8")).toBe(migrationManifestBefore);
    expect(fs.readFileSync(artifactLedger, "utf-8")).toBe(artifactLedgerBefore);
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "project.json"))).toBe(false);

    const plannedManifest = planned.response.data.operations.find(
      (operation: { path: string }) => operation.path === ".swallowkit/project.json"
    );
    expect(plannedManifest.contentFingerprint).toBeDefined();
    const applied = await runMachine([
      "node", "swallowkit", "machine", "apply", "model", "--plan", planned.response.data.planId,
    ]);
    expect(applied.exitCode).toBe(0);
    expect(applied.response.ok).toBe(true);
    expect(applied.response.data.result.createdFiles).toContain("shared/models/todo.ts");
    expect(fs.existsSync(path.join(tempDir, "infra", "migrations", "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "artifacts.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "project.json"))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(tempDir, ".swallowkit", "project.json"), "utf-8"));
    expect(manifest.entities.find((entity: { name: string }) => entity.name === "Todo").filePath)
      .toBe("shared/models/todo.ts");
  });

  it("invalidates a model plan when model-directory membership changes", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({
      parameters: { projectName: { value: "sample-app" } },
    }));
    initializeLegacyMigrations(tempDir);
    const planned = await runMachine(["node", "swallowkit", "machine", "plan", "model", "todo"]);
    expect(planned.response.ok).toBe(true);
    writeFile(
      path.join(tempDir, "shared", "models", "topic-mastery.ts"),
      "import { z } from 'zod/v4'; export const TopicMastery = z.object({ topicId: z.string() });\n"
    );

    const applied = await runMachine([
      "node", "swallowkit", "machine", "apply", "model", "--plan", planned.response.data.planId,
    ]);
    expect(applied.exitCode).toBe(1);
    expect(applied.response.status).toBe("blocked");
    expect(applied.response.error.code).toBe("stale-plan");
    expect(applied.response.error.details.changedFiles).toContain("directory-list:shared/models");
    expect(fs.existsSync(path.join(tempDir, "shared", "models", "todo.ts"))).toBe(false);
  });

  it("does not create Cosmos infrastructure for connector models", async () => {
    createProjectFixture(tempDir);
    const configPath = path.join(tempDir, "swallowkit.config.js");
    const config = fs.readFileSync(configPath, "utf-8").replace(
      "api: {",
      "connectors: { external: { type: 'api', baseUrl: 'https://example.local' } },\n  api: {"
    );
    writeFile(configPath, config);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    initializeLegacyMigrations(tempDir);

    const result = await createModelOperation({
      names: ["external entry"],
      connector: "external",
      overwriteMode: "never",
    });

    expect(result.createdFiles).toEqual(["shared/models/external-entry.ts"]);
    expect(result.infrastructureFiles).toEqual([]);
    expect(loadMigrationManifest(tempDir).migrations).toEqual([]);
  });

  it("does not write model or infra artifacts when an existing model cannot be analyzed", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    initializeLegacyMigrations(tempDir);
    writeFile(path.join(tempDir, "shared", "models", "learning-profile.ts"), `import { z } from 'zod/v4';
export const TopicSchema = z.object({ name: z.string() });
export const LearningProfile = z.object({ id: z.string(), masteryByTopic: z.record(z.string(), TopicSchema) });
`);
    const indexBefore = fs.readFileSync(path.join(tempDir, "shared", "index.ts"), "utf-8");

    await expect(createModelOperation({ names: ["new entity"], overwriteMode: "never" })).rejects.toMatchObject({
      code: "schema-field-unsupported",
      status: "blocked",
      details: expect.objectContaining({ filePath: expect.stringContaining("learning-profile.ts"), field: "masteryByTopic" }),
    });

    expect(fs.existsSync(path.join(tempDir, "shared", "models", "new-entity.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(tempDir, "shared", "index.ts"), "utf-8")).toBe(indexBefore);
    expect(loadMigrationManifest(tempDir).migrations).toEqual([]);
    expect(fs.existsSync(path.join(tempDir, "infra", "migrations", "0001-create-new-entity-container"))).toBe(false);
  });

  it("previews and safely refreshes an unapplied container definition after an authored partition-key change", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
    const baseline = initializeLegacyMigrations(tempDir);
    await createModelOperation({ names: ["learning profile"], overwriteMode: "never" });
    const modelPath = path.join(tempDir, "shared", "models", "learning-profile.ts");
    writeFile(modelPath, `import { z } from 'zod/v4';
export const LearningProfile = z.object({ id: z.string(), userId: z.string() });
export type LearningProfile = z.infer<typeof LearningProfile>;
export const partitionKey = '/userId';
`);
    const migrationPath = path.join(tempDir, "infra", "migrations", "0001-create-learning-profile-container", "main.bicep");
    const ledgerPath = path.join(tempDir, ".swallowkit", "artifacts.json");
    const oldTemplate = fs.readFileSync(migrationPath, "utf-8");
    const oldLedger = fs.readFileSync(ledgerPath, "utf-8");
    const manifest = loadMigrationManifest(tempDir);
    const tagKey = getMigrationTagKey(baseline.projectId);

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "account" && args[1] === "show") {
        return { status: 0, stdout: "11111111-1111-1111-1111-111111111111\n", stderr: "" };
      }
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") {
        return {
          status: 0,
          stdout: JSON.stringify({
            id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample",
            tags: { [tagKey]: encodeMigrationState({ schemaVersion: 1, version: 0, checksum: baseline.baseline.checksum }) },
          }),
          stderr: "",
        };
      }
      if (args[0] === "deployment" && args[1] === "group" && args[2] === "list") {
        return { status: 0, stdout: "[]", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    });

    const preview = await runMachine([
      "node", "swallowkit", "machine", "plan", "model-infrastructure", "learning-profile",
      "--refresh-pending", "--resource-group", "rg-sample",
    ]);
    expect(preview.exitCode).toBe(0);
    expect(preview.response.data.modelInfrastructure).toMatchObject({
      resourceGroup: "rg-sample",
      subscription: "11111111-1111-1111-1111-111111111111",
    });
    expect(preview.response.data.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "infra/migrations/0001-create-learning-profile-container/main.bicep", action: "update" }),
      expect.objectContaining({ path: ".swallowkit/artifacts.json", action: "update" }),
    ]));
    expect(fs.readFileSync(migrationPath, "utf-8")).toBe(oldTemplate);
    expect(fs.readFileSync(ledgerPath, "utf-8")).toBe(oldLedger);
    expect(loadMigrationManifest(tempDir).migrations).toEqual(manifest.migrations);

    const refreshed = await runMachine([
      "node", "swallowkit", "machine", "apply", "model", "--plan", preview.response.data.planId,
    ]);
    expect(refreshed.exitCode).toBe(0);
    expect(refreshed.response.data.result.migration.version).toBe(1);
    expect(fs.readFileSync(migrationPath, "utf-8")).toContain("'/userId'");
    expect(fs.readFileSync(ledgerPath, "utf-8")).not.toBe(oldLedger);
    expect(loadMigrationManifest(tempDir).migrations).toEqual(manifest.migrations);
    const azureCalls = (childProcess.spawnSync as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls.map((call) => call[1] as string[]);
    expect(azureCalls.filter((args) => args[0] === "group" || args[0] === "deployment")
      .every((args) => args.includes("--subscription") && args.includes("11111111-1111-1111-1111-111111111111")))
      .toBe(true);
  });

  it.each(["Running", "Accepted", "Succeeded"] as const)(
    "refuses to rewrite a pending migration after an Azure %s deployment attempt",
    async (deploymentState) => {
      createProjectFixture(tempDir);
      writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
      writeFile(path.join(tempDir, "infra", "main.parameters.json"), "{}\n");
      const baseline = initializeLegacyMigrations(tempDir);
      await createModelOperation({ names: ["learning profile"], overwriteMode: "never" });
      writeFile(path.join(tempDir, "shared", "models", "learning-profile.ts"), `import { z } from 'zod/v4';
export const LearningProfile = z.object({ id: z.string(), userId: z.string() });
export const partitionKey = '/userId';
`);
      const migrationPath = path.join(tempDir, "infra", "migrations", "0001-create-learning-profile-container", "main.bicep");
      const oldTemplate = fs.readFileSync(migrationPath, "utf-8");
      const tagKey = getMigrationTagKey(baseline.projectId);
      (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
        if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
        if (args[0] === "account" && args[1] === "show") {
          return { status: 0, stdout: "11111111-1111-1111-1111-111111111111\n", stderr: "" };
        }
        if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
        if (args[0] === "group" && args[1] === "show") {
          return {
            status: 0,
            stdout: JSON.stringify({
              id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample",
              tags: { [tagKey]: encodeMigrationState({ schemaVersion: 1, version: 0, checksum: baseline.baseline.checksum }) },
            }),
            stderr: "",
          };
        }
        if (args[0] === "deployment" && args[1] === "group" && args[2] === "list") {
          return {
            status: 0,
            stdout: JSON.stringify([{ name: "swallowkit-migration-1-abc123", state: deploymentState }]),
            stderr: "",
          };
        }
        return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
      });

      await expect(addModelContainerMigration("learning-profile", {
        refreshPending: true,
        resourceGroup: "rg-sample",
        subscription: "11111111-1111-1111-1111-111111111111",
      })).rejects.toMatchObject({
        code: "migration-refresh-provision-attempted",
        status: "blocked",
      });
      expect(fs.readFileSync(migrationPath, "utf-8")).toBe(oldTemplate);
    }
  );

  it("applies only the pending migration and advances its tag", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "infra", "main.bicep"), SAMPLE_MAIN_BICEP);
    writeFile(path.join(tempDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: { projectName: { value: "sample-app" } } }));
    const manifest = initializeLegacyMigrations(tempDir);
    createCustomMigration("add-search", tempDir);
    const tagKey = getMigrationTagKey(manifest.projectId);
    let tagValue = encodeMigrationState({ schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum });
    const deployedTemplates: string[] = [];

    (childProcess.spawnSync as unknown as any).mockImplementation((_file: string, args: string[]) => {
      if (args[0] === "--version") return { status: 0, stdout: "azure-cli", stderr: "" };
      if (args[0] === "group" && args[1] === "exists") return { status: 0, stdout: "true\n", stderr: "" };
      if (args[0] === "group" && args[1] === "show") return { status: 0, stdout: JSON.stringify({ id: "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample", tags: { [tagKey]: tagValue } }), stderr: "" };
      if (args[0] === "deployment" && args[2] === "show") {
        const name = args[args.indexOf("--name") + 1];
        return deployedTemplates.length === 0
          ? { status: 1, stdout: "", stderr: "DeploymentNotFound" }
          : { status: 0, stdout: JSON.stringify({ id: `/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-sample/providers/Microsoft.Resources/deployments/${name}`, state: "Succeeded", correlationId: "fixture-correlation" }), stderr: "" };
      }
      if (args[0] === "deployment" && args[2] === "create") {
        deployedTemplates.push(args[args.indexOf("--template-file") + 1]);
        return { status: 0, stdout: JSON.stringify({ properties: { outputs: {} } }), stderr: "" };
      }
      if (args[0] === "tag" && args[1] === "update") {
        tagValue = args[args.indexOf("--tags") + 1].slice(tagKey.length + 1);
        return { status: 0, stdout: "{}", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    });

    const plan = await planProvisionOperation({ resourceGroup: "rg-sample", location: "japaneast", swaLocation: "eastasia", subscription: "11111111-1111-1111-1111-111111111111" });
    const result = await applyProvisionOperation({ planId: plan.planId, approve: true });

    expect(result.executedCommands).toHaveLength(2);
    expect(deployedTemplates).toEqual([path.join(tempDir, "infra", "migrations", "0001-add-search", "main.bicep")]);
    expect(tagValue).toContain(":1:");
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

  it.each<[string, string[]]>([
    ["pnpm", ["exec", "tsc", "--noEmit"]],
    ["npm", ["exec", "tsc", "--", "--noEmit"]],
  ])("uses %s for the typecheck fallback", async (packageManager, expectedArgs) => {
    writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "sample-app",
        devEngines: { packageManager: { name: packageManager, version: ">=11 <13", onFail: "error" } },
      })
    );
    writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true } }));
    (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const result = await runVerify(["typecheck"], tempDir);

    expect(result.checks[0]).toMatchObject({
      status: "pass",
      evidence: { command: `${packageManager} ${expectedArgs.join(" ")}` },
    });
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      packageManager,
      expectedArgs,
      expect.objectContaining({ cwd: tempDir })
    );
  });

  it.each<[string, string[]]>([
    ["pnpm", ["exec", "next", "typegen"]],
    ["npm", ["exec", "--", "next", "typegen"]],
  ])("generates Next.js route types with %s before typechecking", async (packageManager, typegenArgs) => {
    writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "sample-app", devEngines: { packageManager: { name: packageManager, version: ">=10", onFail: "error" } } })
    );
    writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true } }));
    writeFile(path.join(tempDir, "next.config.ts"), "export default {};\n");
    writeFile(path.join(tempDir, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "16.0.0" }));
    const spawnSyncMock = childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>;
    spawnSyncMock.mockReset();
    spawnSyncMock
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "typegen failed" })
      .mockReturnValueOnce({ status: 2, stdout: "app/layout.tsx: Cannot find name 'LayoutProps'.", stderr: "" });

    const result = await runVerify(["typecheck"], tempDir);

    expect(spawnSyncMock.mock.calls[0].slice(0, 2)).toEqual([packageManager, typegenArgs]);
    expect(result.checks[0].status).toBe("fail");
    expect(result.checks[0].evidence.logTail?.[0]).toMatch(/^next typegen did not complete \(exit 1\)/);
  });

  it("uses the existing typecheck script when present", async () => {
    writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "sample-app",
        scripts: { typecheck: "tsc --noEmit" },
        devEngines: { packageManager: { name: "pnpm", version: ">=11 <13", onFail: "error" } },
      })
    );
    writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true } }));
    (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({ status: 0, stdout: "", stderr: "" });

    const result = await runVerify(["typecheck"], tempDir);

    expect(result.checks[0]).toMatchObject({ status: "pass", evidence: { command: "pnpm run typecheck" } });
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["run", "typecheck"],
      expect.objectContaining({ cwd: tempDir })
    );
  });

  it("includes standalone C# compilation in default verification and explains source errors", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "swallowkit.config.json"), JSON.stringify({ backend: { language: "csharp" } }));
    // The fixture's .js config otherwise takes precedence.
    fs.unlinkSync(path.join(tempDir, "swallowkit.config.js"));
    fs.mkdirSync(path.join(tempDir, "shared", "models"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "app", "api"), { recursive: true });
    writeFile(path.join(tempDir, "functions", "SwallowKit.Functions.csproj"), "<Project />\n");
    const spawnMock = childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>;
    spawnMock.mockImplementation((command: string, args: string[]) => ({
      status: command === "dotnet" && args[0] === "build" ? 1 : 0,
      stdout: command === "dotnet" && args[0] === "build"
        ? `${path.join(tempDir, "functions", "Crud", "ProbeItemCrudFunctions.cs")}(8,7): error CS0246: Functions namespace not found`
        : "",
      stderr: "",
    }));
    const result = await runVerify(undefined, tempDir);
    expect(result.summary.done).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "backend-build", status: "fail",
      evidence: expect.objectContaining({ logTail: expect.arrayContaining([expect.stringContaining("(8,7): error CS0246")]) }),
    }));
    const explanation = await runMachine(["node", "swallowkit", "machine", "explain", "failure", "--check", "backend-build"]);
    expect(JSON.stringify(explanation.response)).toContain("(8,7): error CS0246");
  });

  it.each(["csharp", "python"] as const)("skips %s backend compilation when its toolchain is missing", async (language) => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "swallowkit.config.js"), `module.exports = { backend: { language: '${language}' } };`);
    const missing = Object.assign(new Error("not found"), { code: "ENOENT" });
    (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({ status: null, error: missing });
    const result = await runVerify(["backend-build"], tempDir);
    expect(result.checks[0]).toMatchObject({ id: "backend-build", status: "skip" });
    expect(result.checks[0].evidence.diagnostics?.[0]).toMatch(/not installed|not available/);
    expect(result.summary).toMatchObject({ skipped: 1, failed: 0 });
  });

  it("does not hide an installed backend toolchain execution failure as a skip", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "swallowkit.config.js"), "module.exports = { backend: { language: 'csharp' } };");
    const denied = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
    (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({ status: null, error: denied });
    const result = await runVerify(["backend-build"], tempDir);
    expect(result.checks[0]).toMatchObject({ status: "error", evidence: { errorCode: "verification-command-unavailable" } });
  });

  it("uses the project's compiler and functions tsconfig for TypeScript backend verification", async () => {
    createProjectFixture(tempDir);
    fs.symlinkSync(path.join(repoRoot, "node_modules", "typescript"), path.join(tempDir, "node_modules", "typescript"), "junction");
    const spawnMock = childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>;
    spawnMock.mockReturnValue({ status: 2, stdout: "src/probe-item.ts(9,3): error TS2322: Invalid type", stderr: "" });
    const result = await runVerify(["backend-build"], tempDir);
    expect(result.summary.done).toBe(false);
    expect(result.checks[0].evidence.diagnostics).toContain("src/probe-item.ts(9,3): error TS2322: Invalid type");
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, [
      expect.stringContaining(path.join("typescript", "bin", "tsc")), "--project", "tsconfig.json", "--noEmit",
    ], expect.objectContaining({ cwd: path.join(tempDir, "functions"), shell: false }));
  });

  it("prefers the existing Python dev virtualenv and includes source syntax errors", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "swallowkit.config.js"), "module.exports = { backend: { language: 'python' } };");
    const python = path.join(tempDir, "functions", ".venv", ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]));
    writeFile(python, "mock interpreter");
    const spawnMock = childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>;
    spawnMock.mockImplementation((_command: string, args: string[]) => args.includes("compileall")
      ? { status: 1, stdout: '*** Error compiling "./blueprints/probe_item.py"...\n  File "./blueprints/probe_item.py", line 12\nSyntaxError: invalid syntax', stderr: "" }
      : { status: 0, stdout: "", stderr: "" });
    const result = await runVerify(["backend-build"], tempDir);
    expect(result.checks[0].status).toBe("fail");
    expect(result.checks[0].evidence.diagnostics).toContain('  File "./blueprints/probe_item.py", line 12');
    expect(spawnMock).toHaveBeenCalledWith(python, [
      "-m", "compileall", "-q", "-f", "-x", expect.stringContaining(".codegen-venv"), ".",
    ], expect.objectContaining({ cwd: path.join(tempDir, "functions"), shell: false }));
  });

  it.each([
    ["python", "python"],
    ["unsupported", "typescript"],
  ])("resolves the backend like generation when SWALLOWKIT_BACKEND_LANGUAGE=%s", async (override, expected) => {
    createProjectFixture(tempDir); // config file says typescript
    fs.symlinkSync(path.join(repoRoot, "node_modules", "typescript"), path.join(tempDir, "node_modules", "typescript"), "junction");
    const spawnMock = childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>;
    spawnMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
    const previous = process.env.SWALLOWKIT_BACKEND_LANGUAGE;
    process.env.SWALLOWKIT_BACKEND_LANGUAGE = override;
    try {
      const result = await runVerify(["backend-build"], tempDir);
      expect(result.checks[0].evidence.command).toContain(expected === "python" ? "compileall" : "tsc");
    } finally {
      if (previous === undefined) delete process.env.SWALLOWKIT_BACKEND_LANGUAGE;
      else process.env.SWALLOWKIT_BACKEND_LANGUAGE = previous;
    }
  });

  it("reports verification command startup failures as blocked", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true } }));
    const unavailable = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
    (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: unavailable,
    });

    const { response, exitCode } = await runMachine([
      "node", "swallowkit", "machine", "verify", "project", "--checks", "typecheck",
    ]);

    expect(exitCode).toBe(1);
    expect(response).toMatchObject({
      ok: false,
      status: "blocked",
      error: {
        code: "verification-command-unavailable",
        details: expect.objectContaining({
          command: expect.stringContaining("tsc"),
          diagnostics: [expect.stringContaining("spawn EPERM")],
        }),
      },
    });
    expect(response.error.details.nextAction).toContain("permits normal child process execution");
  });

  it("counts only stale schema-generated artifacts in a mixed-hash ledger", async () => {
    const modelSource = "import { z } from 'zod/v4';\nexport const Todo = z.object({ id: z.string() });\n";
    const modelPath = path.join(tempDir, "shared", "models", "todo.ts");
    writeFile(modelPath, modelSource);
    const currentSchemaHash = (await parseModelFile(modelPath)).semanticFingerprint;
    writeFile(
      path.join(tempDir, ".swallowkit", "artifacts.json"),
      JSON.stringify({
        version: 1,
        swallowkitVersion: "1.0.0",
        artifacts: [
          {
            path: "functions/src/todo.ts",
            ownership: "managed",
            generator: "scaffold",
            generatorVersion: "1.0.0",
            sourceModel: "Todo",
            schemaHash: currentSchemaHash,
            contentHash: "current-managed-content",
            generatedAt: "2026-01-01T00:00:00.000Z",
            lastOperation: "update",
          },
          {
            path: "app/api/todo/route.ts",
            ownership: "managed",
            generator: "scaffold",
            generatorVersion: "1.0.0",
            sourceModel: "Todo",
            schemaHash: "stale-managed-hash",
            contentHash: "stale-managed-content",
            generatedAt: "2026-01-01T00:00:00.000Z",
            lastOperation: "update",
          },
          {
            path: "functions/src/extensions/todo.ts",
            ownership: "extension-point",
            generator: "scaffold",
            generatorVersion: "1.0.0",
            sourceModel: "Todo",
            schemaHash: "old-extension-hash",
            contentHash: "extension-content",
            generatedAt: "2026-01-01T00:00:00.000Z",
            lastOperation: "update",
          },
        ],
      })
    );

    const result = await detectDrift(tempDir);
    const schemaFindings = result.findings.filter((finding) => finding.kind === "schema-drift");

    expect(schemaFindings).toHaveLength(1);
    expect(schemaFindings[0]).toMatchObject({ entity: "Todo", expected: "stale-managed-hash", actual: currentSchemaHash });
    expect(schemaFindings[0].message).toContain("(1 artifact(s) are stale)");
  });

  it("compactVerifyResult suppresses info findings without changing the summary", () => {
    const result: VerifyResult = {
      verifiedAt: new Date().toISOString(),
      summary: { passed: 1, failed: 0, skipped: 0, errors: 0, done: true },
      checks: [
        {
          id: "drift",
          title: "Generated artifact drift",
          status: "pass",
          durationMs: 1,
          fixable: true,
          evidence: {
            findings: [
              { kind: "artifact-modified", severity: "info", path: "shared/models/todo.ts", message: "expected edit", repairAction: "none" },
              { kind: "schema-drift", severity: "warning", path: "functions/src/todo.ts", message: "stale", repairAction: "re-plan" },
            ] as never,
          },
          suggestedActions: [],
        },
      ],
    };

    const compact = compactVerifyResult(result);
    expect(compact.summary).toEqual(result.summary);
    expect(compact.checks[0].evidence.findings).toHaveLength(1);
    expect(compact.checks[0].evidence.findings![0].severity).toBe("warning");
    expect(compact.checks[0].evidence.suppressedInfoFindings).toBe(1);
    // 元の結果は変更しない
    expect(result.checks[0].evidence.findings).toHaveLength(2);
  });

  describe("workflow docs & agent skills", () => {
    it("builds workflow docs including provision and an index referencing skills", () => {
      const docs = buildWorkflowDocs("pnpm exec");
      const fileNames = docs.map((d) => d.fileName);
      expect(fileNames).toEqual(
        expect.arrayContaining(["README.md", "add-model.md", "modify-model.md", "add-auth.md", "verify-and-repair.md", "provision.md"])
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
        "swallowkit-add-auth",
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
        ".github/skills/swallowkit-add-auth/SKILL.md",
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
