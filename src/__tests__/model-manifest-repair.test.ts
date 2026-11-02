import * as fs from "fs";
import * as path from "path";
import { createModelOperation } from "../core/operations/create-model";
import { addModelContainerMigration } from "../core/operations/model-migration";
import { applyModelOperation, ModelPlanData, planModelInfrastructureOperation, planModelOperation } from "../core/operations/model-plan";
import { initializeLegacyMigrations } from "../core/operations/migration-generator";
import { hashContent } from "../core/operations/file-session";
import { buildProjectManifest, readProjectManifest, syncProjectManifest } from "../core/project/manifest";
import { detectDrift } from "../core/project/drift";
import { validateProject } from "../core/project/validation";
import * as azureCli from "../utils/azure-cli";

const repoRoot = process.cwd();

function writeFile(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === "node_modules") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else files[path.relative(root, target).replace(/\\/g, "/")] = fs.readFileSync(target, "utf-8");
    }
  }
  visit(root);
  return files;
}

describe("model operation manifest repair", () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(repoRoot, ".swallowkit-manifest-test-"));
    process.chdir(root);
    writeFile(root, "package.json", '{"name":"manifest-consumer"}');
    writeFile(root, "swallowkit.config.js", "module.exports = { frontend: { framework: 'react' }, backend: { language: 'csharp' } };\n");
    writeFile(root, "shared/package.json", '{"name":"@manifest-consumer/shared"}');
    writeFile(root, "shared/index.ts", "export {};\n");
    fs.mkdirSync(path.join(root, "shared", "models"), { recursive: true });
    writeFile(root, "infra/main.bicep", "targetScope = 'resourceGroup'\n");
    writeFile(root, "functions/custom.cs", "// Handwritten business logic\n");
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(repoRoot, "node_modules", "zod"), path.join(root, "node_modules", "zod"), "junction");
    initializeLegacyMigrations(root);
    await syncProjectManifest(root);
    jest.spyOn(azureCli, "checkAzCliAvailability").mockImplementation(() => {
      throw new Error("Manifest repair must stay offline");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(repoRoot);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function addModel(name = "LearningProfile", file = "learning-profile"): void {
    writeFile(root, `shared/models/${file}.ts`, `import { z } from 'zod/v4';
export const ${name} = z.object({ id: z.string(), userId: z.string(), values: z.array(z.object({ key: z.string(), value: z.number() })) });
export const partitionKey = '/userId';
`);
  }

  async function expectCurrentManifest(names: string[]): Promise<void> {
    const stored = readProjectManifest(root)!;
    expect(stored.entities.map((entity) => entity.name)).toEqual([...names].sort());
    const { manifest: rebuilt } = await buildProjectManifest(root);
    expect({ ...stored, generatedAt: "" }).toEqual({ ...rebuilt, generatedAt: "" });
    expect((await validateProject(root)).violations.map((violation) => violation.code)).not.toContain("manifest-out-of-date");
    expect((await detectDrift(root)).findings.map((finding) => finding.kind)).not.toContain("manifest-drift");
    expect(azureCli.checkAzCliAvailability).not.toHaveBeenCalled();
  }

  async function applyReviewed(plan: ModelPlanData): Promise<void> {
    await applyModelOperation({ planId: plan.planId });
    for (const operation of plan.operations) {
      expect(hashContent(fs.readFileSync(path.join(root, operation.path), "utf-8"))).toBe(operation.contentFingerprint);
    }
  }

  it("plans and applies an existing model registration with its project manifest, without generating CRUD", async () => {
    addModel();
    const before = snapshot(root);
    const preview = await planModelInfrastructureOperation("learning-profile", {}, false);
    expect(snapshot(root)).toEqual(before);
    expect(preview.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ".swallowkit/project.json", action: "update", ownership: "metadata" }),
    ]));
    const plan = await planModelInfrastructureOperation("learning-profile");
    await applyReviewed(plan);
    await expectCurrentManifest(["LearningProfile"]);
    for (const [file, content] of Object.entries(before)) {
      if (file === ".swallowkit/project.json" || file === ".swallowkit/artifacts.json" || file === "infra/migrations/manifest.json") continue;
      expect(fs.readFileSync(path.join(root, file), "utf-8")).toBe(content);
    }
    expect(fs.existsSync(path.join(root, "bff"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "functions"))).toEqual(["custom.cs"]);
  });

  it("repairs metadata for an already registered model and re-plans as an exact no-op", async () => {
    addModel();
    await addModelContainerMigration("learning-profile");
    await syncProjectManifest(root, []);
    const before = snapshot(root);
    const dryRun = await addModelContainerMigration("learning-profile", { dryRun: true });
    expect(dryRun.operations).toContainEqual({ path: ".swallowkit/project.json", action: "modify" });
    expect(snapshot(root)).toEqual(before);
    const plan = await planModelInfrastructureOperation("learning-profile");
    expect(plan.operations.filter((operation) => operation.action !== "skip").map((operation) => operation.path))
      .toEqual([".swallowkit/project.json"]);
    await applyReviewed(plan);
    await expectCurrentManifest(["LearningProfile"]);
    for (const [file, content] of Object.entries(before)) {
      if (file !== ".swallowkit/project.json") expect(fs.readFileSync(path.join(root, file), "utf-8")).toBe(content);
    }
    const repaired = snapshot(root);
    const repeat = await planModelInfrastructureOperation("learning-profile");
    expect(repeat.operations.every((operation) => operation.action === "skip")).toBe(true);
    await applyReviewed(repeat);
    expect(snapshot(root)).toEqual(repaired);
  });

  it("repairs metadata when every model generation is skipped, without creating infrastructure", async () => {
    addModel();
    await addModelContainerMigration("learning-profile");
    await syncProjectManifest(root, []);
    const before = snapshot(root);
    const warning = (await validateProject(root)).violations.find((violation) => violation.code === "manifest-out-of-date");
    const drift = (await detectDrift(root)).findings.find((finding) => finding.kind === "manifest-drift");
    expect(warning?.suggestedFix).toContain("machine plan model <existing-model> --overwrite never");
    expect(drift?.repairAction).toBe(warning?.suggestedFix);
    const preview = await planModelOperation({ names: ["learning-profile"], overwriteMode: "never" }, false);
    expect(snapshot(root)).toEqual(before);
    expect(preview.operations.map((operation) => operation.path)).toEqual([".swallowkit/project.json"]);
    const plan = await planModelOperation({ names: ["learning-profile"], overwriteMode: "never" });
    await applyReviewed(plan);
    await expectCurrentManifest(["LearningProfile"]);
    const repaired = snapshot(root);
    const result = await createModelOperation({ names: ["learning-profile"], overwriteMode: "never" });
    expect(result.createdFiles).toEqual([]);
    expect(result.infrastructureFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(["shared/models/learning-profile.ts"]);
    expect(snapshot(root)).toEqual(repaired);
  });

  it("keeps all nine entities in the manifest across sequential registrations with no duplicate migrations", async () => {
    const models = [
      ["LearningProfile", "learning-profile"], ["LearningObservation", "learning-observation"],
      ["PracticeSession", "practice-session"], ["TutorSession", "tutor-session"],
      ["ReviewPlan", "review-plan"], ["WorkflowRun", "workflow-run"],
      ["ProcessedEvent", "processed-event"], ["GrammarTopic", "grammar-topic"],
      ["TutorProfile", "tutor-profile"],
    ];
    for (const [name, file] of models) addModel(name, file);
    for (const [, file] of models) await applyReviewed(await planModelInfrastructureOperation(file));
    await expectCurrentManifest(models.map(([name]) => name));
    const migrations = JSON.parse(fs.readFileSync(path.join(root, "infra", "migrations", "manifest.json"), "utf-8"));
    expect(migrations.migrations).toHaveLength(9);
    const before = snapshot(root);
    for (const [, file] of models) {
      const repeat = await planModelInfrastructureOperation(file);
      expect(repeat.operations.every((operation) => operation.action === "skip")).toBe(true);
      await applyReviewed(repeat);
    }
    expect(snapshot(root)).toEqual(before);
  });

  it.each(["manifest", "other-model", "membership"])("rejects stale metadata plans after a changed %s without writes", async (change) => {
    addModel();
    addModel("TutorProfile", "tutor-profile");
    const plan = await planModelInfrastructureOperation("learning-profile");
    if (change === "manifest") {
      writeFile(root, ".swallowkit/project.json", JSON.stringify({ ...readProjectManifest(root), generatedAt: "concurrent edit" }));
    } else if (change === "other-model") {
      addModel("TutorProfileChanged", "tutor-profile");
    } else {
      addModel("NewModel", "new-model");
    }
    const before = snapshot(root);
    await expect(applyModelOperation({ planId: plan.planId })).rejects.toMatchObject({ code: "stale-plan" });
    expect(snapshot(root)).toEqual(before);
  });

  it("fails before writing a migration when another model cannot be analyzed", async () => {
    addModel();
    writeFile(root, "shared/models/invalid.ts", "export const Invalid = 42;\n");
    const before = snapshot(root);
    await expect(addModelContainerMigration("learning-profile")).rejects.toThrow();
    expect(snapshot(root)).toEqual(before);
  });
});
