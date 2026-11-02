import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { addModelContainerMigration } from "../core/operations/model-migration";
import { initializeLegacyMigrations } from "../core/operations/migration-generator";
import { planProvisionOperation } from "../core/operations/provision-operations";
import { inspectModelInfrastructure } from "../core/project/model-infrastructure";
import { validateProject } from "../core/project/validation";
import { runMachineCli } from "../machine";

const repoRoot = process.cwd();

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function createProjectFixture(rootDir: string): void {
  writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "sample-app" }));
  writeFile(path.join(rootDir, "swallowkit.config.js"), "module.exports = { backend: { language: 'typescript' } };\n");
  writeFile(path.join(rootDir, "shared", "package.json"), JSON.stringify({ name: "@sample-app/shared" }));
  writeFile(path.join(rootDir, "shared", "index.ts"), "export {};\n");
  writeFile(path.join(rootDir, "shared", "models", "todo.ts"), modelSource("/id"));
  writeFile(path.join(rootDir, "infra", "main.bicep"), "targetScope = 'resourceGroup'\n");
  writeFile(path.join(rootDir, "infra", "main.parameters.json"), JSON.stringify({ parameters: {} }));
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, "node_modules", "zod"), path.join(rootDir, "node_modules", "zod"), "junction");
  initializeLegacyMigrations(rootDir);
}

function modelSource(partitionKey: string): string {
  return `import { z } from 'zod/v4';
export const Todo = z.object({ id: z.string(), userId: z.string() });
export type Todo = z.infer<typeof Todo>;
export const partitionKey = '${partitionKey}';
`;
}

function snapshotFiles(rootDir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (!entry.isSymbolicLink()) result[path.relative(rootDir, target).replace(/\\/g, "/")] = fs.readFileSync(target, "utf-8");
    }
  };
  visit(rootDir);
  return result;
}

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
    return { response: JSON.parse(writes.join("")), exitCode: process.exitCode || 0 };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

describe("local model infrastructure completeness", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-model-infra-"));
    process.chdir(tempDir);
    createProjectFixture(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports a handwritten entity without a registered container migration and leaves files untouched", async () => {
    const before = snapshotFiles(tempDir);

    const findings = await inspectModelInfrastructure(tempDir);
    const validation = await validateProject(tempDir);

    expect(findings).toEqual([
      expect.objectContaining({ code: "model-container-migration-missing", model: "Todo" }),
    ]);
    expect(validation.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "model-container-migration-missing", severity: "error" })])
    );
    const machineValidation = await runMachine(["node", "swallowkit", "machine", "validate", "project"]);
    expect(machineValidation.response.status).toBe("failed");
    expect(machineValidation.response.data.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "model-container-migration-missing" })])
    );
    expect(snapshotFiles(tempDir)).toEqual(before);
  });

  it("blocks provision planning locally when a handwritten model has no registered migration", async () => {
    const before = snapshotFiles(tempDir);

    await expect(planProvisionOperation({
      resourceGroup: "sample-rg",
      location: "japaneast",
      swaLocation: "eastasia",
    })).rejects.toMatchObject({ code: "model-infrastructure-incomplete", status: "blocked" });

    expect(snapshotFiles(tempDir)).toEqual(before);
  });

  it("reports partition-key drift in a registered migration and blocks provision without writes", async () => {
    await addModelContainerMigration(path.join(tempDir, "shared", "models", "todo.ts"), { projectRoot: tempDir });
    writeFile(path.join(tempDir, "shared", "models", "todo.ts"), modelSource("/userId"));
    const before = snapshotFiles(tempDir);

    const findings = await inspectModelInfrastructure(tempDir);
    expect(findings).toEqual([
      expect.objectContaining({ code: "model-container-migration-stale", model: "Todo" }),
    ]);
    await expect(planProvisionOperation({
      resourceGroup: "sample-rg",
      location: "japaneast",
      swaLocation: "eastasia",
    })).rejects.toMatchObject({ code: "model-infrastructure-incomplete", status: "blocked" });
    expect(snapshotFiles(tempDir)).toEqual(before);
  });

  it("checks entities without treating referenced helper schemas or connectors as Cosmos containers", async () => {
    writeFile(path.join(tempDir, "shared", "models", "topic-mastery.ts"), `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
`);
    writeFile(path.join(tempDir, "shared", "models", "todo.ts"), `import { z } from 'zod/v4';
import { TopicMastery } from './topic-mastery';
export const Todo = z.object({ id: z.string(), userId: z.string(), mastery: z.array(TopicMastery) });
export type Todo = z.infer<typeof Todo>;
`);
    writeFile(path.join(tempDir, "shared", "models", "remote-record.ts"), `import { z } from 'zod/v4';
export const RemoteRecord = z.object({ id: z.string(), title: z.string() });
export const connectorConfig = { connector: 'mysql', table: 'records', operations: ['getAll', 'getById'] as const };
`);
    await addModelContainerMigration("todo");

    expect(await inspectModelInfrastructure(tempDir)).toEqual([]);
  });
});
