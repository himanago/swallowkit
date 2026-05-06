import * as path from "path";
import {
  buildFunctionsStartArgs,
  buildNextDevArgs,
  buildDevCommand,
  buildPythonFunctionsEnv,
  DevOptions,
  getPythonVirtualEnvPaths,
} from "../cli/commands/dev";
import { createProgram, normalizeDevCommandArgv } from "../cli/index";

describe("dev command helpers", () => {
  it("passes the requested port to Azure Functions Core Tools", () => {
    expect(buildFunctionsStartArgs("7076")).toEqual(["start", "--port", "7076"]);
  });

  it("uses webpack mode for npm-based Next.js dev", () => {
    expect(buildNextDevArgs("npm", "3012")).toEqual(["next", "dev", "--port", "3012", "--webpack"]);
  });

  it("uses pnpm exec for pnpm-based Next.js dev", () => {
    expect(buildNextDevArgs("pnpm", "3012")).toEqual(["exec", "next", "dev", "--port", "3012", "--webpack"]);
  });

  it("builds Python virtual environment paths under functions/.venv", () => {
    const functionsDir = path.join("C:\\repo", "functions");
    const paths = getPythonVirtualEnvPaths(functionsDir);

    expect(paths.venvDir).toBe(path.join(functionsDir, ".venv"));
    expect(paths.binDir.endsWith(process.platform === "win32" ? path.join(".venv", "Scripts") : path.join(".venv", "bin"))).toBe(true);
    expect(paths.pythonExecutable.endsWith(process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"))).toBe(true);
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
    expect(optionsBeforeCommand).toMatchObject(optionsAfterCommand);
  });
});
