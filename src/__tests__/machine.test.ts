import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import * as childProcess from "child_process";
import { runMachineCli } from "../machine";

jest.mock("child_process", () => {
  const actual = jest.requireActual("child_process");
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

function createModelSource(name: string): string {
  return `import { z } from 'zod/v4';

export const ${name} = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${name} = z.infer<typeof ${name}>;

export const displayName = '${name}';
`;
}

function createProjectFixture(rootDir: string, options: { includeGeneratedArtifacts?: boolean; forbiddenBffDependency?: boolean } = {}): void {
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

  if (options.includeGeneratedArtifacts) {
    writeFile(path.join(rootDir, "lib", "api", "call-function.ts"), "export function callFunction() {}\n");
    writeFile(path.join(rootDir, "functions", "src", "todo.ts"), "export {};\n");
    writeFile(path.join(rootDir, "app", "api", "todo", "route.ts"), "export async function GET() { return Response.json([]); }\n");
    writeFile(path.join(rootDir, "app", "api", "todo", "[id]", "route.ts"), "export async function GET() { return Response.json({}); }\n");
  }

  if (options.forbiddenBffDependency) {
    writeFile(
      path.join(rootDir, "app", "api", "forbidden", "route.ts"),
      "import { CosmosClient } from '@azure/cosmos';\nexport async function GET() { return Response.json({ ok: Boolean(CosmosClient) }); }\n"
    );
  }
}

function createCSharpScaffoldFixture(rootDir: string): void {
  writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "sample-app" }, null, 2));
  writeFile(
    path.join(rootDir, "swallowkit.config.js"),
    `module.exports = {
  backend: {
    language: 'csharp',
  },
  api: {
    endpoint: '/api/_swallowkit',
  },
};
`
  );
  writeFile(path.join(rootDir, "shared", "package.json"), JSON.stringify({ name: "@sample-app/shared" }, null, 2));
  writeFile(path.join(rootDir, "shared", "index.ts"), "export {};\n");
  writeFile(path.join(rootDir, "shared", "models", "estimate.ts"), createModelSource("Estimate"));
  writeFile(path.join(rootDir, "shared", "models", "member.ts"), createModelSource("Member"));
  writeFile(path.join(rootDir, "shared", "models", "team.ts"), createModelSource("Team"));
  fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
  fs.symlinkSync(
    path.join(repoRoot, "node_modules", "zod"),
    path.join(rootDir, "node_modules", "zod"),
    "junction"
  );

  writeFile(
    path.join(rootDir, "functions", "Crud", "EstimateFunctions.cs"),
    "namespace SwallowKit.Functions;\npublic sealed class EstimateFunctions { public void Approve() {} public void Submit() {} public void Remand() {} }\n"
  );
  writeFile(path.join(rootDir, "functions", "generated", "csharp-models", "README.md"), "keep generated readme\n");
  writeFile(path.join(rootDir, "functions", "generated", "csharp-models", "SwallowKitBackendModels.csproj"), "<Project />\n");
  writeFile(path.join(rootDir, "functions", "generated", "csharp-models", "SwallowKitBackendModels.sln"), "solution\n");
  writeFile(
    path.join(rootDir, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model", "Member.cs"),
    "// existing member\n"
  );
  writeFile(
    path.join(rootDir, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model", "Team.cs"),
    "// existing team\n"
  );
}

function mockSuccessfulSpawn() {
  const spawnMock = childProcess.spawn as unknown as any;
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as childProcess.ChildProcess;
    process.nextTick(() => child.emit("close", 0));
    return child;
  });
  return spawnMock;
}

function createFreshInitProjectFixture(rootDir: string, backendLanguage: "csharp" | "python" = "csharp"): void {
  writeFile(path.join(rootDir, "package.json"), JSON.stringify({ name: "sample-app" }, null, 2));
  writeFile(
    path.join(rootDir, "swallowkit.config.js"),
    `module.exports = {
  backend: {
    language: '${backendLanguage}',
  },
  functions: {
    baseUrl: process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071',
  },
  deployment: {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
    swaName: process.env.AZURE_SWA_NAME || '',
  },
};
`
  );
  writeFile(path.join(rootDir, "shared", "package.json"), JSON.stringify({ name: "@sample-app/shared" }, null, 2));
  writeFile(path.join(rootDir, "shared", "index.ts"), "export {};\n");
  fs.mkdirSync(path.join(rootDir, "shared", "models"), { recursive: true });
  writeFile(path.join(rootDir, "app", "api", "greet", "route.ts"), "export async function GET() { return Response.json({}); }\n");
  writeFile(path.join(rootDir, "lib", "api", "backend.ts"), "export const api = {};\n");
  fs.mkdirSync(path.join(rootDir, "functions"), { recursive: true });
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

describe("machine CLI", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-machine-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("inspects SwallowKit project metadata as JSON", async () => {
    createProjectFixture(tempDir, { includeGeneratedArtifacts: true });

    const { response, exitCode } = await runMachine(["node", "swallowkit", "machine", "inspect", "project"]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("inspect-project");
    expect(response.data.manifest.entities[0].name).toBe("Todo");
    expect(response.data.manifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Todo-bff-list",
          publicPath: "/api/todo",
          exists: true,
        }),
      ])
    );
  });

  it("validates forbidden BFF dependencies", async () => {
    createProjectFixture(tempDir, {
      includeGeneratedArtifacts: true,
      forbiddenBffDependency: true,
    });

    const { response, exitCode } = await runMachine(["node", "swallowkit", "machine", "validate", "project"]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("validate-project");
    expect(response.data.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forbidden-bff-dependency",
          severity: "error",
        }),
      ])
    );
  });

  it("does not report false positives for a fresh C# init project", async () => {
    createFreshInitProjectFixture(tempDir, "csharp");

    const { response, exitCode } = await runMachine(["node", "swallowkit", "machine", "validate", "project"]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("validate-project");
    expect(response.data.manifest.backendLanguage).toBe("csharp");
    expect(response.data.manifest.configValidation.valid).toBe(true);
    expect(response.data.violations).toEqual([]);
  });

  it("generates model templates through the machine interface", async () => {
    writeFile(path.join(tempDir, "package.json"), JSON.stringify({ name: "sample-app" }, null, 2));
    writeFile(
      path.join(tempDir, "swallowkit.config.js"),
      `module.exports = {
  backend: { language: 'typescript' },
  api: { endpoint: '/api/_swallowkit' },
};
`
    );
    fs.mkdirSync(path.join(tempDir, "node_modules"), { recursive: true });
    fs.symlinkSync(
      path.join(repoRoot, "node_modules", "zod"),
      path.join(tempDir, "node_modules", "zod"),
      "junction"
    );
    writeFile(path.join(tempDir, "shared", "index.ts"), "export {};\n");

    const { response, exitCode } = await runMachine([
      "node",
      "swallowkit",
      "machine",
      "generate",
      "model",
      "Task",
      "--overwrite",
      "never",
    ]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("generate-model");
    expect(response.data.createdFiles).toContain("shared/models/task.ts");
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "project.json"))).toBe(true);
  });

  it("generates scaffold artifacts through the machine interface", async () => {
    createProjectFixture(tempDir);

    const { response, exitCode } = await runMachine([
      "node",
      "swallowkit",
      "machine",
      "generate",
      "scaffold",
      "todo",
      "--api-only",
    ]);

    expect(exitCode).toBe(0);
    expect(response.ok).toBe(true);
    expect(response.command).toBe("generate-scaffold");
    expect(response.data.createdFiles).toEqual(
      expect.arrayContaining([
        "app/api/todo/route.ts",
        "app/api/todo/[id]/route.ts",
        "functions/src/todo.ts",
        "lib/api/call-function.ts",
      ])
    );
    expect(fs.existsSync(path.join(tempDir, ".swallowkit", "project.json"))).toBe(true);
  });

  it("preserves C# custom Functions and shared generated assets when api-only scaffolding one model", async () => {
    createCSharpScaffoldFixture(tempDir);
    const spawnSyncMock = childProcess.spawnSync as unknown as any;
    spawnSyncMock.mockReturnValue({ status: 0 });
    const spawnMock = mockSuccessfulSpawn();

    try {
      const { response, exitCode } = await runMachine([
        "node",
        "swallowkit",
        "machine",
        "generate",
        "scaffold",
        "estimate",
        "--api-only",
      ]);

      expect(exitCode).toBe(0);
      expect(response.ok).toBe(true);
      expect(response.command).toBe("generate-scaffold");
      expect(response.data.createdFiles).toEqual(
        expect.arrayContaining([
          "functions/Crud/EstimateCrudFunctions.cs",
          "app/api/estimate/route.ts",
          "app/api/estimate/[id]/route.ts",
        ])
      );
      expect(response.data.deletedFiles).toEqual([]);
      expect(fs.readFileSync(path.join(tempDir, "functions", "Crud", "EstimateFunctions.cs"), "utf-8")).toContain("Approve");
      expect(fs.existsSync(path.join(tempDir, "functions", "generated", "csharp-models", "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "functions", "generated", "csharp-models", "SwallowKitBackendModels.csproj"))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "functions", "generated", "csharp-models", "SwallowKitBackendModels.sln"))).toBe(true);
      expect(fs.readFileSync(path.join(tempDir, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model", "Member.cs"), "utf-8")).toBe("// existing member\n");
      expect(fs.readFileSync(path.join(tempDir, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model", "Team.cs"), "utf-8")).toBe("// existing team\n");
      expect(fs.existsSync(path.join(tempDir, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model", "Estimate.cs"))).toBe(true);
    } finally {
      spawnMock.mockReset();
      spawnSyncMock.mockReset();
    }
  });
});
