import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runMachineCli } from "../machine";

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

function createModelSource(name: string, extraField = ""): string {
  return `import { z } from 'zod/v4';

export const ${name} = z.object({
  id: z.string(),
  name: z.string().min(1),${extraField}
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${name} = z.infer<typeof ${name}>;

export const displayName = '${name}';
`;
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
  writeFile(path.join(rootDir, "shared", "models", "todo.ts"), createModelSource("Todo"));
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.symlinkSync(
    path.join(repoRoot, "node_modules", "zod"),
    path.join(rootDir, "node_modules", "zod"),
    "junction"
  );
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
    return {
      response: JSON.parse(writes.join("")),
      exitCode: process.exitCode || 0,
    };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

function machineArgs(...args: string[]): string[] {
  return ["node", "swallowkit", "machine", ...args];
}

describe("plan / apply / drift / verify machine commands", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-agent-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("plans a scaffold without writing files and reports operations", async () => {
    createProjectFixture(tempDir);

    const { response, exitCode } = await runMachine(machineArgs("plan", "scaffold", "todo", "--api-only"));

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("plan-scaffold");
    expect(response.status).toBe("complete");
    expect(response.data.planId).toMatch(/^[0-9a-f]{12}$/);
    expect(response.data.requiresApproval).toBe(false);
    expect(response.data.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "app/api/todo/route.ts", action: "create", ownership: "managed" }),
        expect.objectContaining({ path: "functions/src/todo.ts", action: "create" }),
      ])
    );
    expect(response.nextActions[0].command).toContain(`apply scaffold --plan ${response.data.planId}`);

    // No generated files were written
    expect(fs.existsSync(path.join(tempDir, "app"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "functions"))).toBe(false);
    // But the plan state was persisted
    expect(
      fs.existsSync(path.join(tempDir, ".swallowkit", "state", "plans", `${response.data.planId}.json`))
    ).toBe(true);
  });

  it("applies a previously computed plan and records the artifact ledger", async () => {
    createProjectFixture(tempDir);

    const plan = await runMachine(machineArgs("plan", "scaffold", "todo", "--api-only"));
    const planId = plan.response.data.planId;

    const { response, exitCode } = await runMachine(machineArgs("apply", "scaffold", "--plan", planId));

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("apply-scaffold");
    expect(response.status).toBe("complete");
    expect(response.data.createdFiles).toEqual(
      expect.arrayContaining(["app/api/todo/route.ts", "functions/src/todo.ts"])
    );

    // Artifact ledger created and tracks the generated files
    const ledgerPath = path.join(tempDir, ".swallowkit", "artifacts.json");
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
    expect(ledger.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "app/api/todo/route.ts", ownership: "managed", sourceModel: "Todo" }),
      ])
    );

    // Applied plan state is cleaned up
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "state", "plans", `${planId}.json`))).toBe(false);
  });

  it("rejects a stale plan when files change after planning", async () => {
    createProjectFixture(tempDir);

    const plan = await runMachine(machineArgs("plan", "scaffold", "todo", "--api-only"));
    const planId = plan.response.data.planId;

    // Model schema changes after the plan was computed
    writeFile(
      path.join(tempDir, "shared", "models", "todo.ts"),
      createModelSource("Todo", "\n  priority: z.number().optional(),")
    );

    const { response, exitCode } = await runMachine(machineArgs("apply", "scaffold", "--plan", planId));

    expect(exitCode).toBe(1);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("stale-plan");
    expect(response.status).toBe("blocked");
    expect(response.error.details.changedFiles).toContain("shared/models/todo.ts");
    // Nothing was applied
    expect(fs.existsSync(path.join(tempDir, "app"))).toBe(false);
  });

  it("requires approval to overwrite files modified after generation, then applies with --approve", async () => {
    createProjectFixture(tempDir);

    await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));

    // User modifies a managed artifact
    const routePath = path.join(tempDir, "app", "api", "todo", "route.ts");
    const customized = `// customized by user\n${fs.readFileSync(routePath, "utf-8")}`;
    fs.writeFileSync(routePath, customized, "utf-8");

    const denied = await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));

    expect(denied.exitCode).toBe(1);
    expect(denied.response.ok).toBe(false);
    expect(denied.response.error.code).toBe("approval-required");
    expect(denied.response.status).toBe("requires-human");
    expect(denied.response.error.details.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "app/api/todo/route.ts",
          action: "overwrite",
          conflictReason: "modified-after-generation",
        }),
      ])
    );
    // The customization is untouched
    expect(fs.readFileSync(routePath, "utf-8")).toBe(customized);

    const approved = await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only", "--approve"));

    expect(approved.exitCode).toBe(0);
    expect(approved.response.ok).toBe(true);
    expect(approved.response.data.approvedConflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "app/api/todo/route.ts" })])
    );
    expect(fs.readFileSync(routePath, "utf-8")).not.toContain("customized by user");
  });

  it("inspects artifacts and detects drift after manual edits and schema changes", async () => {
    createProjectFixture(tempDir);
    await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));

    const artifacts = await runMachine(machineArgs("inspect", "artifacts"));
    expect(artifacts.response.ok).toBe(true);
    expect(artifacts.response.data.ledgerFound).toBe(true);
    expect(artifacts.response.data.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "functions/src/todo.ts", exists: true, modified: false }),
      ])
    );

    // Clean project → no error/warning drift about artifacts
    const cleanDrift = await runMachine(machineArgs("inspect", "drift"));
    expect(cleanDrift.response.ok).toBe(true);
    expect(
      cleanDrift.response.data.findings.filter((f: any) => f.kind === "artifact-modified" && f.severity !== "info")
    ).toEqual([]);

    // Manual edit to a managed artifact + schema change
    fs.appendFileSync(path.join(tempDir, "functions", "src", "todo.ts"), "\n// manual edit\n");
    writeFile(
      path.join(tempDir, "shared", "models", "todo.ts"),
      createModelSource("Todo", "\n  priority: z.number().optional(),")
    );

    const drift = await runMachine(machineArgs("inspect", "drift"));
    expect(drift.response.ok).toBe(true);
    expect(drift.response.data.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "artifact-modified", path: "functions/src/todo.ts", severity: "warning" }),
        expect.objectContaining({ kind: "schema-drift", entity: "Todo" }),
      ])
    );
    expect(drift.response.data.findings.every((f: any) => typeof f.repairAction === "string")).toBe(true);
  });

  it("verifies the project and explains failures", async () => {
    createProjectFixture(tempDir);
    await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));

    const verify = await runMachine(machineArgs("verify", "project", "--checks", "structure,drift"));

    expect(verify.exitCode).toBe(0);
    expect(verify.response.ok).toBe(true);
    expect(verify.response.command).toBe("verify-project");
    expect(verify.response.status).toBe("complete");
    expect(verify.response.data.summary.done).toBe(true);
    expect(verify.response.data.checks.map((check: any) => check.id)).toEqual(["structure", "drift"]);

    // explain failure with no failing checks returns an empty list
    const explain = await runMachine(machineArgs("explain", "failure"));
    expect(explain.response.ok).toBe(true);
    expect(explain.response.data.failures).toEqual([]);
  });

  it("returns no-verification-result when explain failure runs before verify", async () => {
    createProjectFixture(tempDir);

    const { response, exitCode } = await runMachine(machineArgs("explain", "failure"));

    expect(exitCode).toBe(1);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("no-verification-result");
    expect(response.status).toBe("blocked");
  });
});
