import * as path from "path";
import {
  buildProjectLocalUvEnv,
  buildUvPipInstallArgs,
  buildUvVenvArgs,
  getProjectLocalUvPaths,
  getPythonProjectRoot,
} from "../utils/python-uv";

describe("python uv helpers", () => {
  it("keeps uv-managed state inside the project", () => {
    const projectRoot = "C:\\repo";
    const uvPaths = getProjectLocalUvPaths(projectRoot);

    expect(uvPaths.stateDir).toBe(path.join(projectRoot, ".uv"));
    expect(uvPaths.cacheDir).toBe(path.join(projectRoot, ".uv", "cache"));
    expect(uvPaths.pythonInstallDir).toBe(path.join(projectRoot, ".uv", "python"));
    expect(uvPaths.localUvExecutable.endsWith(process.platform === "win32" ? path.join(".uv", "bin", "uv.exe") : path.join(".uv", "bin", "uv"))).toBe(true);
  });

  it("derives the project root from the functions directory", () => {
    expect(getPythonProjectRoot(path.join("C:\\repo", "functions"))).toBe("C:\\repo");
  });

  it("builds project-local uv environment variables", () => {
    const env = buildProjectLocalUvEnv({ PATH: "C:\\Windows\\System32" }, "C:\\repo");

    expect(env.UV_CACHE_DIR).toBe(path.join("C:\\repo", ".uv", "cache"));
    expect(env.UV_PYTHON_INSTALL_DIR).toBe(path.join("C:\\repo", ".uv", "python"));
    expect(env.UV_TOOL_DIR).toBe(path.join("C:\\repo", ".uv", "tools"));
    expect(env.UV_TOOL_BIN_DIR).toBe(path.join("C:\\repo", ".uv", "tools", "bin"));
    expect(env.UV_MANAGED_PYTHON).toBe("true");
    expect(env.UV_PYTHON_PREFERENCE).toBe("managed");
    expect(env.UV_PYTHON_NO_REGISTRY).toBe(process.platform === "win32" ? "true" : undefined);
  });

  it("builds uv commands for venv creation and requirements installation", () => {
    expect(buildUvVenvArgs(".venv")).toEqual(["venv", ".venv", "--python", "3.11", "--managed-python"]);
    expect(buildUvPipInstallArgs(path.join("C:\\repo", "functions", ".venv", "Scripts", "python.exe"), "requirements.txt")).toEqual([
      "pip",
      "install",
      "--python",
      path.join("C:\\repo", "functions", ".venv", "Scripts", "python.exe"),
      "-r",
      "requirements.txt",
    ]);
  });
});
