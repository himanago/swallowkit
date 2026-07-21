import * as http from "http";
import { readFileSync } from "fs";
import * as path from "path";
import {
  buildFunctionsBaseUrl,
  buildFunctionsStartArgs,
  buildFunctionsCoreToolsCommand,
  buildNextDevArgs,
  buildSwaStartArgs,
  buildDevCommand,
  buildPythonFunctionsEnv,
  compareVersionNumbers,
  DevOptions,
  getFunctionsReadinessTimeoutMs,
  getCSharpFunctionsBuildArtifactPaths,
  getPythonVirtualEnvPaths,
  getSwaCliInstallCommand,
  parseCoreToolsVersion,
  waitForHttpServerReady,
} from "../cli/commands/dev";
import { CLI_VERSION, createProgram, normalizeDevCommandArgv } from "../cli/index";

const packageVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")
).version as string;

describe("dev command helpers", () => {
  it("keeps the CLI version in sync with package.json", () => {
    expect(CLI_VERSION).toBe(packageVersion);
  });

  it("passes the requested port to Azure Functions Core Tools", () => {
    expect(buildFunctionsStartArgs("7076")).toEqual(["start", "--port", "7076"]);
  });

  it("parses the Core Tools version from CLI output", () => {
    expect(parseCoreToolsVersion("4.6.0+ab90faafcab539d63cd3d0ce5faf1bca4395fccc")).toBe("4.6.0");
  });

  it("compares Core Tools versions numerically", () => {
    expect(compareVersionNumbers("4.0.5198", "4.6.0")).toBeLessThan(0);
    expect(compareVersionNumbers("4.6.0", "4.6.0")).toBe(0);
    expect(compareVersionNumbers("4.10.0", "4.6.0")).toBeGreaterThan(0);
  });

  it("falls back to npm Core Tools for older C# isolated hosts", () => {
    expect(buildFunctionsCoreToolsCommand("csharp", "4.0.5198")).toEqual({
      command: "npm",
      argsPrefix: ["exec", "--yes", "azure-functions-core-tools@4", "--"],
      label: "npm exec azure-functions-core-tools@4 (installed func 4.0.5198 is too old for C# isolated)",
    });
  });

  it("keeps the installed func command for supported Core Tools versions", () => {
    expect(buildFunctionsCoreToolsCommand("csharp", "4.6.0")).toEqual({
      command: "func",
      argsPrefix: [],
      label: "func 4.6.0",
    });
  });

  it("uses webpack mode for npm-based Next.js dev", () => {
    expect(buildNextDevArgs("npm", "3012")).toEqual(["next", "dev", "--port", "3012", "--webpack"]);
  });

  it("uses pnpm exec for pnpm-based Next.js dev", () => {
    expect(buildNextDevArgs("pnpm", "3012")).toEqual(["exec", "next", "dev", "--port", "3012", "--webpack"]);
  });

  it("builds the Azure Functions base URL from host and port", () => {
    expect(buildFunctionsBaseUrl(undefined, "7071")).toBe("http://localhost:7071");
    expect(buildFunctionsBaseUrl("127.0.0.1", "7072")).toBe("http://127.0.0.1:7072");
  });

  it("builds SWA CLI arguments without bypassing the Next.js BFF", () => {
    expect(buildSwaStartArgs(undefined, "3000", "4280")).toEqual([
      "start",
      "http://localhost:3000",
      "--swa-config-location",
      ".",
      "--port",
      "4280",
    ]);
    expect(buildSwaStartArgs(undefined, "3000", "4280")).not.toContain("--api-devserver-url");
  });

  it("provides a project-local SWA CLI install command", () => {
    expect(getSwaCliInstallCommand("pnpm")).toBe("pnpm add -Dw @azure/static-web-apps-cli");
    expect(getSwaCliInstallCommand("npm")).toBe("npm install -D @azure/static-web-apps-cli");
  });

  it("gives C# more startup time before reporting readiness timeout", () => {
    expect(getFunctionsReadinessTimeoutMs("csharp")).toBeGreaterThan(getFunctionsReadinessTimeoutMs("typescript"));
    expect(getFunctionsReadinessTimeoutMs("csharp")).toBeGreaterThan(getFunctionsReadinessTimeoutMs("python"));
  });

  it("waits until an HTTP server responds before reporting ready", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(404);
      response.end("not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine ephemeral port.");
    }

    try {
      await expect(
        waitForHttpServerReady(`http://127.0.0.1:${address.port}`, 2_000, 50)
      ).resolves.toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("builds Python virtual environment paths under functions/.venv", () => {
    const functionsDir = path.join("C:\\repo", "functions");
    const paths = getPythonVirtualEnvPaths(functionsDir);

    expect(paths.venvDir).toBe(path.join(functionsDir, ".venv"));
    expect(paths.binDir.endsWith(process.platform === "win32" ? path.join(".venv", "Scripts") : path.join(".venv", "bin"))).toBe(true);
    expect(paths.pythonExecutable.endsWith(process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"))).toBe(true);
  });

  it("targets C# bin and obj directories for build cleanup", () => {
    const functionsDir = path.join("C:\\repo", "functions");

    expect(getCSharpFunctionsBuildArtifactPaths(functionsDir)).toEqual([
      path.join(functionsDir, "bin"),
      path.join(functionsDir, "obj"),
    ]);
  });

  it("injects Python virtual environment settings for Functions", () => {
    const functionsDir = path.join("C:\\repo", "functions");
    const env = buildPythonFunctionsEnv({ PATH: "C:\\Windows\\System32" }, functionsDir);
    const expectedBinDir = getPythonVirtualEnvPaths(functionsDir).binDir;

    expect(env.VIRTUAL_ENV).toBe(path.join(functionsDir, ".venv"));
    expect(env.languageWorkers__python__defaultExecutablePath).toBe(
      getPythonVirtualEnvPaths(functionsDir).pythonExecutable
    );
    expect(env.PATH?.startsWith(`${expectedBinDir}${path.delimiter}`)).toBe(true);
  });
});

describe("dev CLI parser", () => {
  it("exposes the Static Web Apps plan option on init", () => {
    const init = createProgram().commands.find((command) => command.name() === "init");
    const option = init?.options.find((candidate) => candidate.long === "--swa-plan");

    expect(option).toBeDefined();
    expect(option?.description).toContain("free | standard");
  });

  async function parseDevOptions(argv: string[]): Promise<DevOptions> {
    let capturedOptions: DevOptions | undefined;
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const program = createProgram(buildDevCommand(async (options) => {
      capturedOptions = options;
    }, () => undefined));

    program.exitOverride();

    try {
      await program.parseAsync(normalizeDevCommandArgv(argv));
    } finally {
      logSpy.mockRestore();
    }

    expect(capturedOptions).toBeDefined();
    return capturedOptions!;
  }

  it("normalizes dev options placed before the subcommand", () => {
    expect(
      normalizeDevCommandArgv([
        "node",
        "swallowkit",
        "--seed-env",
        "local",
        "--mock-connectors",
        "dev",
        "--port",
        "3001",
      ])
    ).toEqual([
      "node",
      "swallowkit",
      "dev",
      "--seed-env",
      "local",
      "--mock-connectors",
      "--port",
      "3001",
    ]);
  });

  it("keeps non-dev commands unchanged", () => {
    const argv = ["node", "swallowkit", "create-model", "dev", "--connector", "external"];
    expect(normalizeDevCommandArgv(argv)).toEqual(argv);
  });

  it("parses the same dev options regardless of whether they appear before or after the subcommand", async () => {
    const expected = {
      port: "3001",
      functionsPort: "7072",
      host: "127.0.0.1",
      open: true,
      verbose: true,
      noFunctions: true,
      seedEnv: "local",
      mockConnectors: true,
      swaPort: "4290",
      noSwa: true,
    };

    const optionsAfterCommand = await parseDevOptions([
      "node",
      "swallowkit",
      "dev",
      "--port",
      "3001",
      "--functions-port",
      "7072",
      "--host",
      "127.0.0.1",
      "--open",
      "--verbose",
      "--no-functions",
      "--seed-env",
      "local",
      "--mock-connectors",
      "--swa-port",
      "4290",
      "--no-swa",
    ]);

    const optionsBeforeCommand = await parseDevOptions([
      "node",
      "swallowkit",
      "--verbose",
      "--host",
      "127.0.0.1",
      "--seed-env",
      "local",
      "--mock-connectors",
      "--swa-port",
      "4290",
      "--no-swa",
      "--no-functions",
      "--port",
      "3001",
      "--functions-port",
      "7072",
      "--open",
      "dev",
    ]);

    expect(optionsAfterCommand).toMatchObject(expected);
    expect(optionsBeforeCommand).toMatchObject(expected);
    expect({ ...optionsBeforeCommand }).toMatchObject({ ...optionsAfterCommand });
  });

  it("keeps Azure Functions enabled by default", async () => {
    const options = await parseDevOptions([
      "node",
      "swallowkit",
      "dev",
    ]);

    expect(options.noFunctions).toBe(false);
  });
});
