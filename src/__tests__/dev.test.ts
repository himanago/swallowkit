import * as path from "path";
import {
  buildFunctionsStartArgs,
  buildNextDevArgs,
  buildPythonFunctionsEnv,
  getPythonVirtualEnvPaths,
} from "../cli/commands/dev";

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
