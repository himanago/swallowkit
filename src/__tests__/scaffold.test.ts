import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { EventEmitter } from "events";
import * as childProcess from "child_process";
import { generateCosmosContainer, generateUIComponents } from "../cli/commands/scaffold";
import {
  NSWAG_CONSOLECORE_VERSION,
  buildCSharpCodegenToolManifestSource,
  buildPythonCodegenRequirementsSource,
  generateLanguageSchemaArtifacts,
  getCSharpNativeGeneratorArgs,
  getCSharpSchemaModelPath,
  getCSharpSchemaOptionPath,
  getPythonNativeGeneratorArgs,
  getPythonSchemaModelPath,
} from "../core/scaffold/native-schema-generator";
import { createBasicModelInfo } from "./fixtures";

describe("authenticated UI scaffold layouts", () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  const authOptions = {
    authPolicy: { policy: "staffOnly" },
    writeRoles: ["authenticated"],
    authContextImport: "@/lib/auth/schemes/staff/auth-context",
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(originalCwd, ".tmp-auth-layout-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes a model-scoped provider layout and regenerates it stably", async () => {
    const model = createBasicModelInfo({ name: "Product", schemaName: "productSchema" });

    await generateUIComponents(model, "@fixture/shared", authOptions);
    const layoutPath = path.join(tempDir, "app", "product", "layout.tsx");
    const first = fs.readFileSync(layoutPath, "utf-8");
    await generateUIComponents(model, "@fixture/shared", authOptions);
    const second = fs.readFileSync(layoutPath, "utf-8");

    expect(second).toBe(first);
    expect(second).toContain("from '@/lib/auth/schemes/staff/auth-context'");
    expect(second.match(/import \{ AuthProvider \}/g)).toHaveLength(1);
    expect(second.match(/<AuthProvider>/g)).toHaveLength(1);
    expect(fs.readFileSync(path.join(tempDir, "app", "product", "page.tsx"), "utf-8"))
      .toContain("from '@/lib/auth/schemes/staff/auth-context'");
  });

  it("does not create an auth layout for an unauthenticated model or affect another route", async () => {
    await generateUIComponents(createBasicModelInfo({ name: "Product", schemaName: "productSchema" }), "@fixture/shared");
    await generateUIComponents(createBasicModelInfo({ name: "Line", schemaName: "lineSchema" }), "@fixture/shared");

    expect(fs.existsSync(path.join(tempDir, "app", "product", "layout.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "app", "line", "layout.tsx"))).toBe(false);
    expect(fs.readFileSync(path.join(tempDir, "app", "line", "page.tsx"), "utf-8"))
      .not.toContain("schemes/staff/auth-context");
  });

  it("builds the generated authenticated CRUD routes with Next.js", async () => {
    const model = createBasicModelInfo({ name: "Product", schemaName: "productSchema" });
    await generateUIComponents(model, "@fixture/shared", authOptions);

    writeFile(path.join(tempDir, "app", "layout.tsx"), `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`);
    writeFile(path.join(tempDir, "lib", "auth", "schemes", "staff", "auth-context.tsx"), `'use client';
import { createContext, useContext } from 'react';
const AuthContext = createContext<{ user: { id: string }; loading: boolean; hasAnyRole: (roles: string[]) => boolean } | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthContext.Provider value={{ user: { id: 'test' }, loading: false, hasAnyRole: () => true }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}
`);
    writeFile(path.join(tempDir, "shared.ts"), `import { z } from 'zod/v4';
export const productSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
`);
    writeFile(path.join(tempDir, "package.json"), JSON.stringify({
      private: true,
      scripts: { build: "next build" },
    }, null, 2));
    writeFile(path.join(tempDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        lib: ["dom", "dom.iterable", "esnext"],
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        baseUrl: ".",
        paths: { "@/*": ["./*"], "@fixture/shared": ["./shared.ts"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }, null, 2));

    const npmCommand = process.platform === "win32"
      ? { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "npm run build"] }
      : { file: "npm", args: ["run", "build"] };
    expect(() => childProcess.execFileSync(npmCommand.file, npmCommand.args, {
      cwd: tempDir,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
      timeout: 120_000,
    })).not.toThrow();
  }, 150_000);
});

jest.mock("child_process", () => {
  const actual = jest.requireActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    spawn: jest.fn(),
    spawnSync: jest.fn(),
  };
});

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
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

describe("native schema generators", () => {
  it("writes a dotnet tool manifest for NSwag", () => {
    const manifest = JSON.parse(buildCSharpCodegenToolManifestSource());

    expect(manifest.version).toBe(1);
    expect(manifest.tools["nswag.consolecore"].version).toBe(NSWAG_CONSOLECORE_VERSION);
    expect(manifest.tools["nswag.consolecore"].commands).toEqual(["nswag"]);
  });

  it("pins python schema generation requirements without Java", () => {
    expect(buildPythonCodegenRequirementsSource()).toContain("datamodel-code-generator");
    expect(buildPythonCodegenRequirementsSource()).not.toContain("openapi-generator");
  });

  it("builds NSwag arguments for model-only C# generation", () => {
    const outputPath = path.join("C:\\temp\\generated\\csharp-models", ".native-temp", "Contracts.cs");
    const args = getCSharpNativeGeneratorArgs("C:\\temp\\todo.openapi.json", outputPath);

    expect(args.slice(0, 4)).toEqual(["tool", "run", "nswag", "openapi2csclient"]);
    expect(args).toContain("/GenerateClientClasses:false");
    expect(args).toContain("/GenerateDtoTypes:true");
    expect(args).toContain("/GenerateNullableReferenceTypes:true");
    expect(args).toContain(`/output:${outputPath}`);
  });

  it("builds datamodel-code-generator arguments for python assets", () => {
    const outputPath = path.join("C:\\temp\\generated\\python-models", ".native-temp", "models.py");
    const args = getPythonNativeGeneratorArgs("C:\\temp\\todo.openapi.json", outputPath);

    expect(args).toEqual(
      expect.arrayContaining([
        "-m",
        "datamodel_code_generator",
        "--input-file-type",
        "openapi",
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--disable-timestamp",
        outputPath,
      ])
    );
  });

  it("keeps generated asset paths under functions/generated", () => {
    expect(getCSharpSchemaModelPath("C:\\temp\\generated\\csharp-models", "Product")).toBe(
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Model", "Product.cs")
    );
    expect(getCSharpSchemaOptionPath("C:\\temp\\generated\\csharp-models")).toBe(
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Client", "Option.cs")
    );
    expect(getPythonSchemaModelPath("C:\\temp\\generated\\python-models", "Product")).toBe(
      path.join("C:\\temp\\generated\\python-models", "backend_models", "models", "product.py")
    );
  });
describe("generateCosmosContainer", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-cosmos-container-"));
    process.chdir(tempDir);
    fs.mkdirSync(path.join(tempDir, "infra", "containers"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "infra", "main.bicep"), "module cosmosDbServerless 'modules/cosmosdb-serverless.bicep' = if (cosmosDbMode == 'serverless') {\n  name: 'cosmosDb'\n}\n");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("generates container templates without container-level throughput settings", async () => {
    await generateCosmosContainer({ name: "SurveyResponse", partitionKey: "/id" });

    const containerFilePath = path.join(tempDir, "infra", "containers", "survey-response-container.bicep");
    const containerContent = fs.readFileSync(containerFilePath, "utf-8");
    const mainContent = fs.readFileSync(path.join(tempDir, "infra", "main.bicep"), "utf-8");

    expect(containerContent).toContain("resource container");
    expect(containerContent).not.toContain("throughput");
    expect(containerContent).not.toContain("options:");
    expect(mainContent).toContain("module surveyResponseContainer 'containers/survey-response-container.bicep'");
    expect(mainContent).not.toContain("dependsOn");
  });
});
  describe("non-destructive native schema generation", () => {
    const originalCwd = process.cwd();
    let tempDir: string;
    let spawnSyncMock: any;
    let spawnMock: any;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-native-schema-"));
      process.chdir(tempDir);
      fs.mkdirSync(path.join(tempDir, "functions"), { recursive: true });
      spawnSyncMock = childProcess.spawnSync as unknown as any;
      spawnSyncMock.mockReturnValue({ status: 0 });
      spawnMock = mockSuccessfulSpawn();
    });

    afterEach(() => {
      spawnMock.mockReset();
      spawnSyncMock.mockReset();
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("preserves existing C# generated directory contents while writing only requested model files", async () => {
      const outputDir = path.join(tempDir, "functions", "generated", "csharp-models");
      writeFile(path.join(outputDir, "README.md"), "keep me\n");
      writeFile(path.join(outputDir, "SwallowKitBackendModels.csproj"), "<Project />\n");
      writeFile(path.join(outputDir, "src", "SwallowKitBackendModels", "Model", "Member.cs"), "// existing member\n");

      const estimate = createBasicModelInfo({ name: "Estimate", filePath: path.join(tempDir, "shared", "models", "estimate.ts") });

      await generateLanguageSchemaArtifacts([estimate], estimate, "functions", "csharp");

      expect(fs.readFileSync(path.join(outputDir, "README.md"), "utf-8")).toBe("keep me\n");
      expect(fs.existsSync(path.join(outputDir, "SwallowKitBackendModels.csproj"))).toBe(true);
      expect(fs.readFileSync(getCSharpSchemaModelPath(outputDir, "Member"), "utf-8")).toBe("// existing member\n");
      expect(fs.existsSync(getCSharpSchemaModelPath(outputDir, "Todo"))).toBe(false);
      expect(fs.existsSync(getCSharpSchemaModelPath(outputDir, "Estimate"))).toBe(true);
      expect(fs.existsSync(getCSharpSchemaOptionPath(outputDir))).toBe(true);
    });

    it("preserves existing Python generated directory contents while appending requested model exports", async () => {
      const outputDir = path.join(tempDir, "functions", "generated", "python-models");
      writeFile(path.join(outputDir, "README.md"), "keep python\n");
      writeFile(path.join(outputDir, "backend_models", "models", "member.py"), "# existing member\n");
      writeFile(path.join(outputDir, "backend_models", "__init__.py"), "from .models.member import Member\n");
      writeFile(path.join(outputDir, "backend_models", "models", "__init__.py"), "from .member import Member\n");

      const estimate = createBasicModelInfo({ name: "Estimate", filePath: path.join(tempDir, "shared", "models", "estimate.ts") });

      await generateLanguageSchemaArtifacts([estimate], estimate, "functions", "python");

      expect(fs.readFileSync(path.join(outputDir, "README.md"), "utf-8")).toBe("keep python\n");
      expect(fs.readFileSync(path.join(outputDir, "backend_models", "models", "member.py"), "utf-8")).toBe("# existing member\n");
      expect(fs.existsSync(getPythonSchemaModelPath(outputDir, "Todo"))).toBe(false);
      expect(fs.existsSync(getPythonSchemaModelPath(outputDir, "Estimate"))).toBe(true);
      const packageInit = fs.readFileSync(path.join(outputDir, "backend_models", "__init__.py"), "utf-8");
      const modelsInit = fs.readFileSync(path.join(outputDir, "backend_models", "models", "__init__.py"), "utf-8");
      expect(packageInit).toContain("from .models.member import Member");
      expect(packageInit).toContain("from .models.estimate import Estimate");
      expect(modelsInit).toContain("from .member import Member");
      expect(modelsInit).toContain("from .estimate import Estimate");
    });
  });
});
