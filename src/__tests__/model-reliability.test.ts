import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";
import { createModelOperation } from "../core/operations/create-model";
import { planProvisionOperation, applyProvisionOperation } from "../core/operations/provision-operations";
import { FileOperationSession, hashFileIfExists, runWithFileSession } from "../core/operations/file-session";
import { createMigrationManifest, saveMigrationManifest, loadMigrationManifest, getMigrationTagKey, encodeMigrationState, checksumAtVersion } from "../core/project/migrations";
import { getAllModels, parseModelFile } from "../core/scaffold/model-parser";
import { runVerify } from "../core/verify";
import { addModelMigrationOperation } from "../core/operations/model-infrastructure";
import { planModelOperation, applyModelOperation } from "../core/operations/model-plan";
import { runMachineCli } from "../machine";
import { buildSwallowKitToolDefinitions } from "../mcp";
import { generateAuthModels } from "../core/scaffold/auth-generator";
import { recordSessionOperations } from "../core/project/artifacts";
import { savePlanState } from "../core/project/state";

jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  spawnSync: jest.fn(),
}));

jest.mock("../core/operations/azure-cli-query", () => ({
  ...jest.requireActual<typeof import("../core/operations/azure-cli-query")>("../core/operations/azure-cli-query"),
  resolveAzureCliInvocation: () => ({ file: "fixture-az", args: [] }),
}));

describe("stable model reliability", () => {
  const cwd = process.cwd();
  const subscription = "11111111-1111-1111-1111-111111111111";
  let root: string;

  function write(relative: string, content: string): string {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  }

  function snapshot(directory = root): Record<string, string> {
    return Object.assign({}, ...fs.readdirSync(directory, { withFileTypes: true }).map(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? snapshot(file) : { [path.relative(root, file)]: fs.readFileSync(file, "utf8") };
    }));
  }

  async function machine(args: string[]) {
    const chunks: string[] = [];
    const output = jest.spyOn(process.stdout, "write").mockImplementation(chunk => {
      chunks.push(String(chunk));
      return true;
    });
    const previousExit = process.exitCode;
    process.exitCode = 0;
    try {
      await runMachineCli(["node", "swallowkit", "machine", ...args]);
      return { stdout: chunks.join(""), stderr: "", exitCode: process.exitCode || 0 };
    } finally {
      output.mockRestore();
      process.exitCode = previousExit;
    }
  }

  beforeEach(() => {
    jest.mocked(childProcess.spawnSync).mockReset();
    root = fs.mkdtempSync(path.join(cwd, ".model-reliability-"));
    process.chdir(root);
    write("package.json", '{"name":"reliability"}');
    write("swallowkit.config.js", "module.exports = {};\n");
    write("shared/index.ts", "export {};\n");
    write("infra/main.bicep", "targetScope = 'resourceGroup'\n");
    write("infra/main.parameters.json", '{"parameters":{"projectName":{"value":"reliability"}}}');
    saveMigrationManifest(createMigrationManifest(root), root);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("uses the same preview writes and structured failures for machine and MCP", async () => {
    const args = ["generate", "model", "probe", "--overwrite", "never", "--dry-run"];
    const response = JSON.parse((await machine(args)).stdout);
    expect(response.ok).toBe(true);
    const tool = buildSwallowKitToolDefinitions(machine).find(candidate => candidate.name === "swallowkit_generate_model")!;
    const mcp = JSON.parse((await tool.handler({ names: ["probe"], dryRun: true })).content[0].text);
    expect(mcp.operations).toEqual(response.data.operations);
    expect(fs.existsSync(path.join(root, "shared", "models", "probe.ts"))).toBe(false);
    write("shared/models/workflow-step-state.ts", `import {z} from 'zod/v4';
export const WorkflowStepState=z.object({id:z.string(),output:z.record(z.string(),z.string())});`);
    const failure = JSON.parse((await machine(args)).stdout);
    expect(failure).toMatchObject({
      ok: false, status: "blocked", error: { code: "schema-analysis-unsupported",
        details: { schemaName: "WorkflowStepState", field: "output", reason: "ZodRecord" } },
    });
    await expect(tool.handler({ names: ["probe"], dryRun: true })).rejects.toThrow("schema-analysis-unsupported");
    const verification = JSON.parse((await machine(["verify", "project", "--checks", "structure"])).stdout);
    expect(verification.status).toBe("failed");
    expect(verification.data.summary.done).toBe(false);
  });

  it("does not mistake generated authentication DTOs for persistent entities", async () => {
    const session = new FileOperationSession("commit", root);
    session.writeFile(path.join(root, "shared", "models", "auth.ts"), generateAuthModels(), {
      ownership: "managed", generator: "add-auth",
    });
    recordSessionOperations(session.operations, {}, root);
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    expect((await getAllModels()).map(model => model.name)).toEqual(["Probe"]);
    expect(loadMigrationManifest(root).migrations.map(m => m.sourceModel)).toEqual(["Probe"]);
  });

  it("keeps connector models out of Cosmos even without migration tracking", async () => {
      write("swallowkit.config.js", `module.exports = {
        connectors: { catalog: { type:'rdb', provider:'postgres', connectionEnvVar:'FICTIONAL_CATALOG' } }
      };`);
      fs.unlinkSync(path.join(root, "infra", "migrations", "manifest.json"));
      const result = await createModelOperation({ names: ["catalog-entry"], connector: "catalog", overwriteMode: "never" });
      expect(result.connectorType).toBe("rdb");
      expect(result.infrastructureFiles).toEqual([]);
      expect(result.operations.some(operation => operation.path.startsWith("infra/"))).toBe(false);
      await expect(addModelMigrationOperation("catalog-entry")).rejects.toMatchObject({ code: "connector-model-infrastructure" });
    });

    it("retains legacy filename-matching Schema exports over unrelated helpers", async () => {
      const file = write("shared/models/todo.ts", `import {z} from 'zod/v4';
export const otherSchema=z.object({wrong:z.string()});
export const Helper=z.object({wrong:z.number()});
export const todoSchema=z.object({id:z.string(),title:z.string()});`);
      expect((await parseModelFile(file)).schemaName).toBe("todoSchema");
    });

    it("plans a multi-model batch atomically and respects a refused overwrite", async () => {
      const original = write("shared/models/probe.ts", `import {z} from 'zod/v4'; export const Probe=z.object({id:z.string()});`);
      const bytes = fs.readFileSync(original, "utf8");
      const result = await createModelOperation({
        names: ["probe"], overwriteMode: "prompt", confirmOverwrite: async () => false,
      });
      expect(result.skippedFiles).toEqual(["shared/models/probe.ts"]);
      expect(result.operations.every(operation => operation.ownership === "metadata")).toBe(true);
      expect(loadMigrationManifest(root).migrations).toHaveLength(0);
      expect(fs.readFileSync(original, "utf8")).toBe(bytes);
      const generated = await createModelOperation({ names: ["one", "two"], overwriteMode: "never" });
      expect(generated.infrastructureFiles).toHaveLength(2);
      expect(loadMigrationManifest(root).migrations.map(m => m.sourceModel)).toEqual(["One", "Two"]);
      await expect(createModelOperation({ names: ["three", "bad'name"], overwriteMode: "never" })).rejects.toMatchObject({ code: "invalid-model-name" });
      expect(fs.existsSync(path.join(root, "shared", "models", "three.ts"))).toBe(false);
      expect(loadMigrationManifest(root).migrations).toHaveLength(2);
    });
  it("creates registered Cosmos infrastructure without CRUD and targets it in the next mocked provision plan", async () => {
    const baseline = loadMigrationManifest(root).baseline;
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const manifest = loadMigrationManifest(root);
    expect(manifest.baseline).toEqual(baseline);
    expect(manifest.migrations).toEqual([expect.objectContaining({ source: "model", sourceModel: "Probe" })]);
    expect(fs.existsSync(path.join(root, "functions"))).toBe(false);
    expect(fs.readFileSync(path.join(root, ".swallowkit", "artifacts.json"), "utf8")).toContain(manifest.migrations[0].template);
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, argv) => {
      const stdout = argv[0] === "--version" ? "" : argv[1] === "exists" ? "true" :
        JSON.stringify({ id: "/fictional/rg", tags: {
          [getMigrationTagKey(manifest.projectId)]: encodeMigrationState({ schemaVersion: 1, version: 0, checksum: baseline.checksum }),
        } });
      return { status: 0, stdout, stderr: "", pid: 0, output: [], signal: null };
    });
    const plan = await planProvisionOperation({ resourceGroup: "rg-fictional", location: "japaneast", swaLocation: "eastasia" });
    expect(plan.mode).toBe("migrate");
    expect(plan.pendingMigrations.map(m => m.sourceModel)).toEqual(["Probe"]);
    expect(plan.commands.some(command => command.includes(manifest.migrations[0].template.replace(/\//g, path.sep)))).toBe(true);
    expect(plan.requiresApproval).toBe(true);
    fs.appendFileSync(path.join(root, "shared", "models", "probe.ts"), "\n// changed after provision planning\n");
    await expect(applyProvisionOperation({ planId: plan.planId, approve: true })).rejects.toMatchObject({ code: "stale-plan" });
  });

  it("includes registered containers in the first bootstrap provision and preserves approval gates", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, args) => ({
      status: 0, stdout: args[0] === "--version" ? "" : "false",
      stderr: "", pid: 0, output: [], signal: null,
    }));
    const plan = await planProvisionOperation({ resourceGroup: "rg-fictional", location: "japaneast", swaLocation: "eastasia" });
    expect(plan.mode).toBe("bootstrap");
    expect(plan.pendingMigrations.map(m => m.sourceModel)).toEqual(["Probe"]);
    expect(plan.commandSpecs.map(command => command.kind)).toEqual(["resource-group", "deployment", "tag", "migration", "tag"]);
    az.mockClear();
    await expect(applyProvisionOperation({ planId: plan.planId })).rejects.toMatchObject({ code: "approval-required" });
    expect(az).not.toHaveBeenCalled();
  });

  it("includes infrastructure writes in collect mode without writing the model or migration", async () => {
    const session = new FileOperationSession("collect", root);
    await runWithFileSession(session, () => createModelOperation({ names: ["probe"], overwriteMode: "never" }));
    expect(session.operations.map(op => op.path)).toEqual(expect.arrayContaining([
      "shared/models/probe.ts", "infra/migrations/manifest.json", "infra/migrations/0001-create-probe-container/main.bicep",
    ]));
    expect(fs.existsSync(path.join(root, "shared", "models", "probe.ts"))).toBe(false);
    expect(loadMigrationManifest(root).migrations).toEqual([]);
  });

  it("applies a mocked bootstrap through baseline and migration tags without losing baseline outputs", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const manifest = loadMigrationManifest(root);
    const tags: Record<string, string> = {};
    let exists = false;
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, args) => {
      let stdout = "{}";
      if (args[1] === "exists") stdout = String(exists);
      else if (args[1] === "show") stdout = JSON.stringify({ id: "/fictional/rg", tags });
      else if (args[0] === "group" && args[1] === "create") exists = true;
      else if (args[0] === "group" && args[1] === "update") {
        const assignment = args[args.indexOf("--set") + 1].slice("tags.".length);
        const separator = assignment.indexOf("=");
        tags[assignment.slice(0, separator)] = assignment.slice(separator + 1);
      } else if (args[0] === "deployment") {
        stdout = JSON.stringify({ properties: { outputs: args.includes("swallowkit-baseline")
          ? { functionAppName: { value: "fictional-functions" } }
          : { containerName: { value: "Probes" } } } });
      }
      return { status: 0, stdout, stderr: "", pid: 0, output: [], signal: null };
    });
    const plan = await planProvisionOperation({ resourceGroup: "rg-fictional", location: "japaneast", swaLocation: "eastasia" });
    const applied = await applyProvisionOperation({ planId: plan.planId, approve: true });
    expect(applied.executedCommands).toHaveLength(5);
    expect(applied.deploymentOutputs).toEqual({
      functionAppName: { value: "fictional-functions" }, containerName: { value: "Probes" },
    });
    expect(tags[getMigrationTagKey(manifest.projectId)]).toBe(encodeMigrationState({
      schemaVersion: 1, version: 1, checksum: checksumAtVersion(manifest, 1, root),
    }));
    expect(loadMigrationManifest(root).baseline).toEqual(manifest.baseline);
  });

  it("plans every metadata write, applies once, and rejects stale model-plan inputs", async () => {
    const plan = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    expect(plan.operations.map(op => op.path)).toEqual(expect.arrayContaining([
      "shared/models/probe.ts", "shared/index.ts", "infra/migrations/manifest.json",
      ".swallowkit/project.json", ".swallowkit/artifacts.json",
    ]));
    expect(fs.existsSync(path.join(root, "shared", "models", "probe.ts"))).toBe(false);
    await applyModelOperation(plan.planId);
    const skipped = await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    expect(skipped.operations.every(operation => operation.action === "skip")).toBe(true);
    expect(loadMigrationManifest(root).migrations).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(root, ".swallowkit", "project.json"), "utf8")).entities)
      .toEqual([expect.objectContaining({ name: "Probe" })]);
    const next = await planModelOperation({ kind: "model", options: { names: ["other"], overwriteMode: "never" } });
    fs.appendFileSync(path.join(root, "shared", "models", "probe.ts"), "\n// changed\n");
    await expect(applyModelOperation(next.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(fs.existsSync(path.join(root, "shared", "models", "other.ts"))).toBe(false);
  });

  it("repairs registered model metadata and keeps repeated infrastructure runs byte-identical", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const projectManifestPath = path.join(root, ".swallowkit", "project.json");
    const staleManifest = JSON.parse(fs.readFileSync(projectManifestPath, "utf8"));
    staleManifest.entities = [];
    fs.writeFileSync(projectManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);

    const repaired = await addModelMigrationOperation("probe");
    expect(repaired.operations).toContainEqual(expect.objectContaining({
      path: ".swallowkit/project.json",
      action: "modify",
    }));
    expect(JSON.parse(fs.readFileSync(projectManifestPath, "utf8")).entities)
      .toEqual([expect.objectContaining({ name: "Probe" })]);

    const migrationBytes = fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8");
    const projectBytes = fs.readFileSync(projectManifestPath, "utf8");
    const artifactBytes = fs.readFileSync(path.join(root, ".swallowkit", "artifacts.json"), "utf8");
    const repeated = await addModelMigrationOperation("probe");

    expect(repeated.operations.every(operation => operation.action === "skip")).toBe(true);
    expect(fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8")).toBe(migrationBytes);
    expect(fs.readFileSync(projectManifestPath, "utf8")).toBe(projectBytes);
    expect(fs.readFileSync(path.join(root, ".swallowkit", "artifacts.json"), "utf8")).toBe(artifactBytes);
    expect(loadMigrationManifest(root).migrations).toHaveLength(1);
  });

  it("repairs stale metadata for all-skipped multi-model generation and rejects stale repair plans without writes", async () => {
    await createModelOperation({ names: ["one", "two"], overwriteMode: "never" });
    const projectManifestPath = path.join(root, ".swallowkit", "project.json");
    const staleManifest = JSON.parse(fs.readFileSync(projectManifestPath, "utf8"));
    staleManifest.entities = [];
    fs.writeFileSync(projectManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);

    const repaired = await createModelOperation({ names: ["one", "two"], overwriteMode: "never" });
    expect(repaired.skippedFiles).toEqual(["shared/models/one.ts", "shared/models/two.ts"]);
    expect(repaired.operations).toContainEqual(expect.objectContaining({
      path: ".swallowkit/project.json",
      action: "modify",
    }));
    expect(JSON.parse(fs.readFileSync(projectManifestPath, "utf8")).entities.map((entity: { name: string }) => entity.name))
      .toEqual(["One", "Two"]);
    expect(loadMigrationManifest(root).migrations.map(migration => migration.sourceModel)).toEqual(["One", "Two"]);

    const stableProjectBytes = fs.readFileSync(projectManifestPath, "utf8");
    const stableMigrationBytes = fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8");
    const rerun = await createModelOperation({ names: ["one", "two"], overwriteMode: "never" });
    expect(rerun.operations.every(operation => operation.action === "skip")).toBe(true);
    expect(fs.readFileSync(projectManifestPath, "utf8")).toBe(stableProjectBytes);
    expect(fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8")).toBe(stableMigrationBytes);

    const staleAgain = JSON.parse(stableProjectBytes);
    staleAgain.entities = [];
    fs.writeFileSync(projectManifestPath, `${JSON.stringify(staleAgain, null, 2)}\n`);
    const plan = await planModelOperation({
      kind: "model",
      options: { names: ["one", "two"], overwriteMode: "never" },
    });
    expect(plan.operations).toContainEqual(expect.objectContaining({
      path: ".swallowkit/project.json",
      action: "modify",
    }));
    expect(plan.fingerprints[".swallowkit/project.json"]).not.toBeNull();
    fs.appendFileSync(projectManifestPath, "\n");
    const beforeApply = snapshot();
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(snapshot()).toEqual(beforeApply);
  });

  it("rejects newly discovered entity/helper inputs after planning without changing application files", async () => {
    const plan = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),score:z.number()});`);
    write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
import {TopicMastery} from './topic-mastery';
export const LearningProfile=z.object({id:z.string(),masteryByTopic:z.array(TopicMastery)});`);
    const before = snapshot();
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(snapshot()).toEqual(before);
  });

  it("applies exactly the staged bytes, including deterministic manifest and ledger timestamps", async () => {
    const plan = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    await new Promise(resolve => setTimeout(resolve, 10));
    await applyModelOperation(plan.planId);
    for (const operation of plan.operations) {
      expect(hashFileIfExists(path.join(root, operation.path))).toBe(operation.newHash);
    }
  });

  it("rejects a changed staged output hash without writing", async () => {
    const plan = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    plan.operations[0].newHash = "f".repeat(64);
    savePlanState(plan);
    const before = snapshot();
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(snapshot()).toEqual(before);
  });

  it.each(["entity", "dependency"])("rejects a removed %s input without writing", async removed => {
    write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),score:z.number()});`);
    write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
import {TopicMastery} from './topic-mastery';
export const LearningProfile=z.object({id:z.string(),masteryByTopic:z.array(TopicMastery)});`);
    const plan = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    fs.unlinkSync(path.join(root, "shared", "models", removed === "entity" ? "learning-profile.ts" : "topic-mastery.ts"));
    const before = snapshot();
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(snapshot()).toEqual(before);
  });

  it("backfills a handwritten model byte-for-byte, excludes embedded helpers, and reruns as a no-op", async () => {
    const source = `import {z} from 'zod/v4';
export const Helper=z.object({name:z.string()});
export const Profile=z.object({id:z.string(),userId:z.string(),helper:Helper});
export const partitionKey='/userId';\r\n`;
    const file = write("shared/models/profile.ts", source);
    const preview = await addModelMigrationOperation("profile", { dryRun: true });
    expect(preview.operations.map(op => op.path)).toContain("infra/migrations/0001-create-profile-container/main.bicep");
    expect(loadMigrationManifest(root).migrations).toHaveLength(0);
    const result = await addModelMigrationOperation("profile");
    expect(fs.readFileSync(file, "utf8")).toBe(source);
    expect(loadMigrationManifest(root).migrations.map(m => m.sourceModel)).toEqual(["Profile"]);
    expect(fs.readFileSync(path.join(root, result.template!), "utf8")).toContain("'/userId'");
    const metadata = fs.readFileSync(path.join(root, ".swallowkit", "artifacts.json"), "utf8");
    const repeat = await addModelMigrationOperation("profile");
    expect(repeat.operations.every(op => op.action === "skip")).toBe(true);
    expect(fs.readFileSync(path.join(root, ".swallowkit", "artifacts.json"), "utf8")).toBe(metadata);
    expect(fs.existsSync(path.join(root, "functions"))).toBe(false);
  });

  it("fingerprints transitive schema dependencies and inspects current rather than cached models", async () => {
    const dependency = write("shared/schemas/helper.ts", `import {z} from 'zod/v4'; export const helperSchema=z.object({value:z.string()});`);
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
import {helperSchema} from '../schemas/helper';
export const Probe=z.object({id:z.string(),nested:helperSchema});`);
    const plan = await planModelOperation({ kind: "model-infrastructure", model: "probe" });
    expect(plan.fingerprints["shared/schemas/helper.ts"]).toBeDefined();
    fs.appendFileSync(dependency, "\n// changed dependency\n");
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "stale-plan" });
    expect(loadMigrationManifest(root).migrations).toHaveLength(0);
    await addModelMigrationOperation("probe");
    write("shared/models/probe.ts", `import {z} from 'zod/v4'; export const Probe=z.object({id:z.string(),currentField:z.string()});`);
    const inspection = JSON.parse((await machine(["inspect", "entities"])).stdout);
    expect(JSON.stringify(inspection.data)).toContain("currentField");
    expect(JSON.stringify(inspection.data)).not.toContain('"name":"nested"');
  });

  it("does not register an imported helper-only file as an independent Cosmos entity", async () => {
    write("app/api/.gitkeep", "");
    write("functions/.gitkeep", "");
    const helper = write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),score:z.number()});`);
    write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
import {TopicMastery} from './topic-mastery';
export const LearningProfile=z.object({id:z.string(),userId:z.string(),masteryByTopic:z.array(TopicMastery)});
export const partitionKey='/userId';`);
    expect((await getAllModels()).map(model => model.name)).toEqual(["LearningProfile"]);
    const model = await parseModelFile(path.join(root, "shared", "models", "learning-profile.ts"));
    expect(model.fields.find(field => field.name === "masteryByTopic")?.isNestedSchema).toBe(false);
    const plan = await planModelOperation({ kind: "model-infrastructure", model: "learning-profile" });
    expect(plan.fingerprints["shared/models/topic-mastery.ts"]).toBeDefined();
    await applyModelOperation(plan.planId);
    expect(loadMigrationManifest(root).migrations.map(migration => migration.sourceModel)).toEqual(["LearningProfile"]);
    const verification = await runVerify(["structure"]);
    expect(verification.checks.find(check => check.id === "structure")?.status).toBe("pass");
    const before = snapshot();
    await expect(addModelMigrationOperation("topic-mastery")).rejects.toMatchObject({ code: "model-entity-id-required" });
    expect(snapshot()).toEqual(before);
    fs.appendFileSync(helper, "\n// changed helper\n");
    const stale = await planModelOperation({ kind: "model", options: { names: ["probe"], overwriteMode: "never" } });
    fs.appendFileSync(helper, "\n// changed again\n");
    await expect(applyModelOperation(stale.planId)).rejects.toMatchObject({ code: "stale-plan" });
    write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),output:z.record(z.string(),z.string())});`);
    await expect(getAllModels()).rejects.toMatchObject({
      code: "schema-analysis-unsupported", details: { filePath: helper, field: "output", reason: "ZodRecord" },
    });
  });

  it("blocks unclassified id-less models and never hides invalid persistence ids as helpers", async () => {
    write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),score:z.number()});`);
    await expect(getAllModels()).rejects.toMatchObject({ code: "model-classification-ambiguous" });
    write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
import {TopicMastery} from './topic-mastery';
export const LearningProfile=z.object({id:z.string(),mastery:z.array(TopicMastery)});`);
    write("shared/models/topic-mastery.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({id:z.string().optional(),score:z.number()});`);
    await expect(getAllModels()).rejects.toMatchObject({ code: "model-entity-id-required" });
  });

  it("pins the default subscription once in persisted refresh plans and all subsequent queries", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    let activeSubscription = subscription;
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, args) => ({
      status: 0, stdout: args[0] === "account" ? activeSubscription : "false",
      stderr: "", pid: 0, output: [], signal: null,
    }));
    const request = { kind: "model-infrastructure" as const, model: "probe",
      options: { refreshPending: true, resourceGroup: "rg-fictional" } };
    const plan = await planModelOperation(request);
    expect(plan.request).toMatchObject({ options: { subscription } });
    expect(request.options).not.toHaveProperty("subscription");
    activeSubscription = "22222222-2222-2222-2222-222222222222";
    await applyModelOperation(plan.planId);
    expect(az.mock.calls.filter(([, args]) => args[0] === "account")).toHaveLength(1);
    for (const [, args] of az.mock.calls.filter(([, args]) => args[0] !== "account")) {
      expect(args[args.indexOf("--subscription") + 1]).toBe(subscription);
    }
  });

  it("pins a default subscription throughout existence, tags and retained-history queries", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const manifest = loadMigrationManifest(root);
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, args) => ({
      status: 0, stdout: args[0] === "account" ? subscription :
        args[1] === "exists" ? "true" :
          args[0] === "deployment" ? JSON.stringify([{ name: "swallowkit-baseline", properties: { provisioningState: "Succeeded" } }]) :
            JSON.stringify({ [getMigrationTagKey(manifest.projectId)]: encodeMigrationState({
              schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum,
            }) }),
      stderr: "", pid: 0, output: [], signal: null,
    }));
    const before = snapshot();
    const result = await addModelMigrationOperation("probe", {
      refreshPending: true, resourceGroup: "rg-fictional", dryRun: true,
    });
    expect(result.refreshTarget).toEqual({ resourceGroup: "rg-fictional", subscription });
    expect(az.mock.calls.map(([, args]) => args.slice(0, 2))).toEqual([
      ["account", "show"], ["group", "exists"], ["group", "show"], ["deployment", "group"],
    ]);
    expect(az.mock.calls.slice(1).every(([, args]) => args[args.indexOf("--subscription") + 1] === subscription)).toBe(true);
    expect(snapshot()).toEqual(before);
  });

  it.each(["", "not-a-subscription"])("fails closed when the default subscription cannot be pinned: %j", async stdout => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockReturnValue({ status: 0, stdout, stderr: "", pid: 0, output: [], signal: null });
    const before = snapshot();
    await expect(planModelOperation({ kind: "model-infrastructure", model: "probe",
      options: { refreshPending: true, resourceGroup: "rg-fictional" } }))
      .rejects.toMatchObject({ code: "migration-subscription-unavailable" });
    expect(snapshot()).toEqual(before);
    expect(az).toHaveBeenCalledTimes(1);
  });

  it("keeps refresh dry-run byte-for-byte read-only and repeats Azure proof on apply", async () => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const manifest = loadMigrationManifest(root);
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockReturnValue({ status: 0, stdout: "false", stderr: "", pid: 0, output: [], signal: null });
    const before = snapshot();
    const options = { refreshPending: true, resourceGroup: "rg-fictional", subscription };
    const preview = await addModelMigrationOperation("probe", { ...options, dryRun: true });
    expect(preview.operations.some(operation => operation.path.endsWith("main.bicep"))).toBe(true);
    expect(snapshot()).toEqual(before);
    const plan = await planModelOperation({ kind: "model-infrastructure", model: "probe", options });
    const planned = snapshot();
    az.mockImplementation((_file, args) => ({
      status: 0, stdout: args?.[0] === "deployment"
        ? JSON.stringify([{ name: "swallowkit-migration-0001", properties: { provisioningState: "Running" } }])
        : args?.[1] === "exists" ? "true"
          : JSON.stringify({ [getMigrationTagKey(manifest.projectId)]: encodeMigrationState({
            schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum,
          }) }),
      stderr: "", pid: 0, output: [], signal: null,
    }));
    await expect(applyModelOperation(plan.planId)).rejects.toMatchObject({ code: "migration-deployment-attempted" });
    expect(snapshot()).toEqual(planned);
  });

  it("respects a statically overridden baseline partition key without rewriting its checksum", async () => {
    write("infra/containers/profile-container.bicep", "param partitionKeyPath string = '/id'\n");
    write("infra/main.bicep", `targetScope = 'resourceGroup'
module profile 'containers/profile-container.bicep' = {
  name: 'profile'
  params: { partitionKeyPath: '/userId' }
}`);
    fs.unlinkSync(path.join(root, "infra", "migrations", "manifest.json"));
    saveMigrationManifest(createMigrationManifest(root), root);
    const baseline = loadMigrationManifest(root).baseline;
    write("shared/models/profile.ts", `import {z} from 'zod/v4';
export const Profile=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    expect((await addModelMigrationOperation("profile")).template).toBeNull();
    write("shared/models/profile.ts", `import {z} from 'zod/v4'; export const Profile=z.object({id:z.string(),userId:z.string()});`);
    await expect(addModelMigrationOperation("profile")).rejects.toMatchObject({ code: "baseline-container-configuration-change" });
    expect(loadMigrationManifest(root).baseline).toEqual(baseline);
    expect(loadMigrationManifest(root).migrations).toEqual([]);
  });

  it("blocks missing or stale Cosmos infrastructure in verification and before any provision query", async () => {
    write("shared/models/probe.ts", `import {z} from 'zod/v4'; export const Probe=z.object({id:z.string()});`);
    jest.mocked(childProcess.spawnSync).mockClear();
    const options = { resourceGroup: "rg-fictional", location: "japaneast", swaLocation: "eastasia" };
    await expect(planProvisionOperation(options)).rejects.toMatchObject({ code: "model-infrastructure-missing" });
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect((await runVerify(["structure"])).summary.done).toBe(false);
    const validation = JSON.parse((await machine(["validate", "project"])).stdout);
    expect(validation.status).toBe("failed");
    expect(validation.data.violations).toContainEqual(expect.objectContaining({ code: "model-infrastructure-missing" }));
    const validateTool = buildSwallowKitToolDefinitions(machine).find(tool => tool.name === "swallowkit_validate_project")!;
    expect(JSON.parse((await validateTool.handler({})).content[0].text).status).toBe("failed");
    await addModelMigrationOperation("probe");
    write("shared/models/probe.ts", `import {z} from 'zod/v4'; export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    await expect(planProvisionOperation(options)).rejects.toMatchObject({ code: "applied-migration-immutable" });
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it("uses the same persisted handwritten-model plan and apply operation through MCP", async () => {
    const source = `import {z} from 'zod/v4'; export const Profile=z.object({id:z.string()});`;
    const file = write("shared/models/profile.ts", source);
    const tools = buildSwallowKitToolDefinitions(machine);
    const planTool = tools.find(tool => tool.name === "swallowkit_plan_model_infrastructure")!;
    const plan = JSON.parse((await planTool.handler({ model: "profile" })).content[0].text);
    expect(plan.operations.map((operation: { path: string }) => operation.path)).toContain("infra/migrations/manifest.json");
    expect(loadMigrationManifest(root).migrations).toHaveLength(0);
    await tools.find(tool => tool.name === "swallowkit_apply_model")!.handler({ planId: plan.planId });
    expect(loadMigrationManifest(root).migrations).toHaveLength(1);
    expect(fs.readFileSync(file, "utf8")).toBe(source);
  });

  it.each(["pending", "absent-group", "applied", "unknown", "checksum-drift", "Running", "Accepted", "Succeeded", "Failed", "unknown-history", "empty-history"])("refreshes only authoritatively pending generated migrations: %s", async status => {
    await createModelOperation({ names: ["probe"], overwriteMode: "never" });
    const manifest = loadMigrationManifest(root);
    const migration = manifest.migrations[0];
    const template = fs.readFileSync(path.join(root, migration.template), "utf8");
    const manifestBytes = fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8");
    write("shared/models/probe.ts", `import {z} from 'zod/v4';
export const Probe=z.object({id:z.string(),userId:z.string()}); export const partitionKey='/userId';`);
    const state = {
      schemaVersion: 1 as const, version: status === "applied" ? 1 : 0,
      checksum: status === "checksum-drift" ? "f".repeat(64) : checksumAtVersion(manifest, status === "applied" ? 1 : 0, root),
    };
    const az = jest.mocked(childProcess.spawnSync as (
      file: string, args: readonly string[]
    ) => childProcess.SpawnSyncReturns<string>);
    az.mockImplementation((_file, args) => ({
      status: 0, stdout: args[0] === "deployment" ?
        JSON.stringify(["Running", "Accepted", "Succeeded", "Failed"].includes(status) ?
          [{ name: "swallowkit-migration-0001", properties: { provisioningState: status } }] :
          status === "unknown-history" ? {} : status === "empty-history" ? [] :
            [{ name: "swallowkit-baseline", properties: { provisioningState: "Succeeded" } }]) :
        args[1] === "exists" ? String(status !== "absent-group") :
          JSON.stringify(status === "unknown" ? {} : { [getMigrationTagKey(manifest.projectId)]: encodeMigrationState(state) }),
      stderr: "", pid: 0, output: [], signal: null,
    }));
    const action = () => addModelMigrationOperation("probe", { refreshPending: true, resourceGroup: "rg-fictional", subscription });
    if (status === "pending" || status === "absent-group") {
      const plan = await planModelOperation({
        kind: "model-infrastructure", model: "probe",
        options: { refreshPending: true, resourceGroup: "rg-fictional", subscription },
      });
      expect(fs.readFileSync(path.join(root, migration.template), "utf8")).toBe(template);
      await applyModelOperation(plan.planId);
      expect(fs.readFileSync(path.join(root, migration.template), "utf8")).toContain("'/userId'");
    } else {
      await expect(action()).rejects.toMatchObject({
        code: status === "applied" ? "applied-migration-immutable" :
          status === "checksum-drift" ? "migration-checksum-mismatch" :
            status === "unknown" ? "migration-state-unavailable" :
              ["unknown-history", "empty-history"].includes(status) ? "migration-deployment-history-unavailable" : "migration-deployment-attempted",
      });
      expect(fs.readFileSync(path.join(root, migration.template), "utf8")).toBe(template);
    }
    expect(fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf8")).toBe(manifestBytes);
    expect(az.mock.calls.every(([, args]) =>
      args[0] === "group" && ["exists", "show"].includes(args[1]) ||
      args.slice(0, 3).join(" ") === "deployment group list")).toBe(true);
  });

  it("selects the filename-matching export independently of helper ordering or Schema suffix", async () => {
    const file = write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
export const TopicMastery = z.object({topicId:z.string(),score:z.number()});
export const unrelatedSchema = z.object({wrong:z.string()});
export const LearningProfile = z.object({id:z.string(),userId:z.string(),masteryByTopic:z.array(TopicMastery)});
export type LearningProfile = z.infer<typeof LearningProfile>;
export const partitionKey = '/userId';
`);
    const model = await parseModelFile(file);
    expect(model.schemaName).toBe("LearningProfile");
    expect(model.fields.map(field => field.name)).toEqual(["id", "userId", "masteryByTopic"]);
    expect(model.partitionKey).toBe("/userId");
    expect(model.fields[2]).toMatchObject({ type: "object" });
  });

  it("stops ambiguous schema selection with structured candidates", async () => {
    const file = write("shared/models/ambiguous.ts", `import {z} from 'zod/v4';
export const First = z.object({id:z.string()});
export const Second = z.object({id:z.string()});
`);
    await expect(parseModelFile(file)).rejects.toMatchObject({
      code: "schema-selection-ambiguous", details: { candidates: ["First", "Second"] },
    });
  });
  it("reports the record limitation on LearningProfile, never selecting the supported helper instead", async () => {
    const file = write("shared/models/learning-profile.ts", `import {z} from 'zod/v4';
export const TopicMastery=z.object({topicId:z.string(),score:z.number()});
export const LearningProfile=z.object({id:z.string(),userId:z.string(),masteryByTopic:z.record(z.string(),TopicMastery)});
export type LearningProfile=z.infer<typeof LearningProfile>;
export const partitionKey='/userId';
`);
    await expect(parseModelFile(file)).rejects.toMatchObject({
      code: "schema-analysis-unsupported",
      details: { schemaName: "LearningProfile", field: "masteryByTopic", reason: "ZodRecord" },
    });
  });

  it.each(["zod", "zod/v4"])("blocks records in %s with field-specific diagnostics instead of losing value types", async (zod) => {
    const file = write("shared/models/workflow-step-state.ts", `import {z} from '${zod}';
export const WorkflowStepState = z.object({id:z.string(),output:z.record(z.string(),z.string())});
`);
    await expect(parseModelFile(file)).rejects.toMatchObject({
      code: "schema-analysis-unsupported",
      details: { modelPath: file, schemaName: "WorkflowStepState", field: "output", reason: "ZodRecord" },
    });
  });

  it.each(["", "[]"])("rejects incomplete dynamic analysis output %j rather than an empty entity", async output => {
    const file = write("shared/models/probe.ts", `import {z} from 'zod/v4'; export const Probe=z.object({id:z.string(),output:z.record(z.string(),z.string())});`);
    const executeNode = jest.fn(() => output);
    await expect(parseModelFile(file, { executeNode })).rejects.toMatchObject({
      code: "schema-analysis-unsupported", details: { filePath: file, schemaName: "Probe", reason: expect.any(String) },
    });
  });

  it("fails closed for unsupported existing models before creating any files, and verification cannot pass", async () => {
    write("shared/models/workflow-step-state.ts", `import {z} from 'zod/v4';
export const WorkflowStepState = z.object({id:z.string(),output:z.record(z.string(),z.string())});
`);
    const index = fs.readFileSync(path.join(root, "shared", "index.ts"), "utf8");
    await expect(getAllModels()).rejects.toMatchObject({ code: "schema-analysis-unsupported" });
    await expect(createModelOperation({ names: ["probe"], overwriteMode: "never" })).rejects.toMatchObject({
      code: "schema-analysis-unsupported",
    });
    expect(fs.existsSync(path.join(root, "shared", "models", "probe.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "shared", "index.ts"), "utf8")).toBe(index);
    expect(loadMigrationManifest(root).migrations).toEqual([]);
    const verify = await runVerify(["structure"]);
    expect(verify.summary.done).toBe(false);
  });
});
