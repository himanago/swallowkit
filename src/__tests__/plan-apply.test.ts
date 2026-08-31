import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as childProcess from "child_process";
import { EventEmitter } from "events";
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

function createNativeBackendFixture(rootDir: string, backendLanguage: "csharp" | "python"): void {
  createProjectFixture(rootDir);
  writeFile(
    path.join(rootDir, "swallowkit.config.js"),
    `module.exports = {
  database: {
    connectionString: 'AccountEndpoint=https://example.local;',
  },
  backend: {
    language: '${backendLanguage}',
  },
  api: {
    endpoint: '/api/_swallowkit',
  },
};
`
  );

  if (backendLanguage === "csharp") {
    writeFile(path.join(rootDir, "functions", "SwallowKit.Functions.csproj"), "<Project />\n");
  } else {
    writeFile(
      path.join(rootDir, "functions", "function_app.py"),
      "from azure.functions import FunctionApp\n\napp = FunctionApp()\n\n# SwallowKit scaffold registrations\n"
    );
  }
}

function mockSuccessfulNativeCodegen(): () => void {
  const spawnSyncMock = childProcess.spawnSync as unknown as any;
  const spawnMock = childProcess.spawn as unknown as any;
  spawnSyncMock.mockReturnValue({ status: 0 });
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as childProcess.ChildProcess;
    process.nextTick(() => child.emit("close", 0));
    return child;
  });
  return () => {
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
  };
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

  it("plans and applies multiple models in one command (scaffold batch)", async () => {
    createProjectFixture(tempDir);
    writeFile(path.join(tempDir, "shared", "models", "note.ts"), createModelSource("Note"));

    const plan = await runMachine(machineArgs("plan", "scaffold", "todo", "note", "--api-only"));

    expect(plan.exitCode).toBe(0);
    expect(plan.response.ok).toBe(true);
    expect(plan.response.command).toBe("plan-scaffold");
    expect(plan.response.status).toBe("complete");
    expect(plan.response.data.planType).toBe("scaffold-batch");
    expect(plan.response.data.plans).toHaveLength(2);
    expect(plan.response.nextActions).toHaveLength(2);
    expect(plan.response.nextActions[0].description).toContain("todo");
    expect(plan.response.nextActions[1].description).toContain("note");
    // 何も書き込まれていない
    expect(fs.existsSync(path.join(tempDir, "app"))).toBe(false);

    const apply = await runMachine(machineArgs("apply", "scaffold", "todo", "note", "--api-only"));

    expect(apply.exitCode).toBe(0);
    expect(apply.response.ok).toBe(true);
    expect(apply.response.data.applyType).toBe("scaffold-batch");
    expect(apply.response.data.results).toHaveLength(2);
    expect(fs.existsSync(path.join(tempDir, "app", "api", "todo", "route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "app", "api", "note", "route.ts"))).toBe(true);
  });

  it("rejects --plan combined with multiple models", async () => {
    createProjectFixture(tempDir);

    const { response, exitCode } = await runMachine(machineArgs("apply", "scaffold", "a", "b", "--plan", "abc"));

    expect(exitCode).toBe(1);
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("invalid-arguments");
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

  it.each([
    {
      backendLanguage: "csharp" as const,
      modelPath: "functions/generated/csharp-models/src/SwallowKitBackendModels/Model/Todo.cs",
    },
    {
      backendLanguage: "python" as const,
      modelPath: "functions/generated/python-models/backend_models/models/todo.py",
    },
  ])(
    "includes $backendLanguage native schema artifacts in plan, ledger, and approval checks",
    async ({ backendLanguage, modelPath }) => {
      createNativeBackendFixture(tempDir, backendLanguage);
      const restoreCodegenMocks = mockSuccessfulNativeCodegen();

      try {
        const plan = await runMachine(machineArgs("plan", "scaffold", "todo", "--api-only"));

        expect(plan.response).toEqual(expect.objectContaining({ ok: true, status: "complete" }));
        expect(plan.exitCode).toBe(0);
        expect(plan.response.data.warnings).not.toEqual(
          expect.arrayContaining([expect.stringContaining("external-codegen")])
        );
        expect(plan.response.data.operations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "functions/openapi/todo.openapi.json", action: "create" }),
            expect.objectContaining({ path: modelPath, action: "create", ownership: "managed" }),
          ])
        );
        expect(fs.existsSync(path.join(tempDir, "functions", "openapi"))).toBe(false);
        expect(fs.existsSync(path.join(tempDir, modelPath))).toBe(false);
        expect(childProcess.spawn).not.toHaveBeenCalled();

        const applied = await runMachine(
          machineArgs("apply", "scaffold", "--plan", plan.response.data.planId)
        );
        expect(applied.exitCode).toBe(0);
        expect(fs.existsSync(path.join(tempDir, modelPath))).toBe(true);

        const ledger = JSON.parse(
          fs.readFileSync(path.join(tempDir, ".swallowkit", "artifacts.json"), "utf-8")
        );
        expect(ledger.artifacts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: modelPath, ownership: "managed", generator: "native-schema" }),
          ])
        );

        fs.appendFileSync(path.join(tempDir, modelPath), "\n// customized\n");
        const denied = await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));
        expect(denied.exitCode).toBe(1);
        expect(denied.response.error.code).toBe("approval-required");
        expect(denied.response.error.details.conflicts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: modelPath, conflictReason: "modified-after-generation" }),
          ])
        );
      } finally {
        restoreCodegenMocks();
      }
    }
  );

  it("leaves the project untouched when the native toolchain validation fails on apply", async () => {
    createNativeBackendFixture(tempDir, "csharp");
    const spawnSyncMock = childProcess.spawnSync as unknown as any;
    // dotnet --version が失敗 → .NET SDK 不在としてプリフライトで拒否される
    spawnSyncMock.mockReturnValue({ status: 1 });

    try {
      const { response, exitCode } = await runMachine(machineArgs("apply", "scaffold", "todo", "--api-only"));

      expect(exitCode).toBe(1);
      expect(response.ok).toBe(false);
      expect(response.error.message).toContain(".NET SDK is required");

      expect(fs.existsSync(path.join(tempDir, "app"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "lib"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "functions", "openapi"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "functions", "generated"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "functions", "Crud"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, ".swallowkit", "artifacts.json"))).toBe(false);
    } finally {
      spawnSyncMock.mockReset();
    }
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

  it("rejects a native backend plan when a nested model changes after planning", async () => {
    createNativeBackendFixture(tempDir, "csharp");
    writeFile(path.join(tempDir, "shared", "models", "member.ts"), createModelSource("Member"));
    writeFile(
      path.join(tempDir, "shared", "models", "todo.ts"),
      `import { z } from 'zod/v4';
import { Member } from './member';

export const Todo = z.object({
  id: z.string(),
  name: z.string().min(1),
  member: Member,
});

export type Todo = z.infer<typeof Todo>;
`
    );

    const plan = await runMachine(machineArgs("plan", "scaffold", "todo", "--api-only"));
    expect(plan.response).toEqual(expect.objectContaining({ ok: true, status: "complete" }));
    expect(plan.response.data.fingerprints["shared/models/member.ts"]).toMatch(/^[0-9a-f]{64}$/);

    writeFile(
      path.join(tempDir, "shared", "models", "member.ts"),
      createModelSource("Member", "\n  role: z.string().optional(),")
    );

    const applied = await runMachine(
      machineArgs("apply", "scaffold", "--plan", plan.response.data.planId)
    );
    expect(applied.exitCode).toBe(1);
    expect(applied.response.error.code).toBe("stale-plan");
    expect(applied.response.error.details.changedFiles).toContain("shared/models/member.ts");
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
