import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  buildProjectLocalUvInstallerEnv,
  buildUvPipInstallArgs,
  buildUvVenvArgs,
  getProjectLocalUvPaths,
  getPythonProjectRoot,
  ensureUvVirtualEnvironment,
  buildPythonCodegenInstallEnv,
} from "../utils/python-uv";

describe("python uv helpers", () => {
  it("keeps only the fallback uv binary inside the project", () => {
    const projectRoot = "C:\\repo";
    const uvPaths = getProjectLocalUvPaths(projectRoot);

    expect(uvPaths.stateDir).toBe(path.join(projectRoot, ".uv"));
    expect(uvPaths.localUvExecutable.endsWith(process.platform === "win32" ? path.join(".uv", "bin", "uv.exe") : path.join(".uv", "bin", "uv"))).toBe(true);
  });

  it("derives the project root from the functions directory", () => {
    expect(getPythonProjectRoot(path.join("C:\\repo", "functions"))).toBe("C:\\repo");
  });

  it("leaves uv interpreter discovery, cache paths and user settings unchanged during bootstrap", () => {
    const configured = {
      PATH: "system-path",
      UV_PYTHON: "3.15",
      UV_CACHE_DIR: "user-cache",
      UV_PYTHON_INSTALL_DIR: "user-python",
      UV_PYTHON_PREFERENCE: "system",
      UV_PYTHON_DOWNLOADS: "never",
      UV_PYTHON_NO_REGISTRY: "false",
    };
    expect(buildProjectLocalUvInstallerEnv(configured, "C:\\repo")).toMatchObject(configured);
    expect(buildProjectLocalUvInstallerEnv({}, "C:\\repo").UV_PYTHON_PREFERENCE).toBeUndefined();
    expect(buildProjectLocalUvInstallerEnv({}, "C:\\repo").UV_PYTHON_NO_REGISTRY).toBeUndefined();
  });

  it("limits bootstrap changes to a project-local uv binary and its child environment", () => {
    const base = { PSModulePath: "powershell-7-modules", UV_PYTHON: "3.15" };
    const env = buildProjectLocalUvInstallerEnv(base, "C:\\repo");
    expect(env.UV_UNMANAGED_INSTALL).toBe(path.join("C:\\repo", ".uv", "bin"));
    expect(env.UV_NO_MODIFY_PATH).toBe("1");
    expect(env.UV_PYTHON).toBe("3.15");
    expect(env.PSModulePath).toBe(process.platform === "win32" ? undefined : base.PSModulePath);
    expect(base.PSModulePath).toBe("powershell-7-modules");
  });

  it("preserves an existing unusable virtual environment instead of clearing it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-uv-test-"));
    const marker = path.join(root, "keep.txt");
    fs.writeFileSync(marker, "user data");
    try {
      await expect(
        ensureUvVirtualEnvironment("uv-must-not-be-called", root, root, process.env)
      ).rejects.toThrow("The virtual environment was preserved");
      expect(fs.readFileSync(marker, "utf8")).toBe("user data");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds uv commands for venv creation and requirements installation", () => {
    expect(buildUvVenvArgs(".venv")).toEqual(["venv", ".venv"]);
    expect(buildUvPipInstallArgs(path.join("C:\\repo", "functions", ".venv", "Scripts", "python.exe"), "requirements.txt")).toEqual([
      "pip",
      "install",
      "--python",
      path.join("C:\\repo", "functions", ".venv", "Scripts", "python.exe"),
      "-r",
      "requirements.txt",
    ]);
  });

  it("does not require a C compiler for PyYAML's optional codegen accelerator", () => {
    expect(buildPythonCodegenInstallEnv({ UV_PYTHON: "3.15" })).toEqual({
      UV_PYTHON: "3.15", PYYAML_FORCE_LIBYAML: "0",
    });
    expect(buildPythonCodegenInstallEnv({ PYYAML_FORCE_LIBYAML: "1" }).PYYAML_FORCE_LIBYAML).toBe("1");
  });
});
