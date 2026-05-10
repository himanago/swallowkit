import * as path from "path";

export const SWALLOWKIT_PYTHON_VERSION = "3.11";

export interface ProjectLocalUvPaths {
  stateDir: string;
  cacheDir: string;
  pythonInstallDir: string;
  toolDir: string;
  toolBinDir: string;
  localUvInstallDir: string;
  localUvExecutable: string;
}

export function getPythonProjectRoot(functionsDir: string): string {
  return path.dirname(functionsDir);
}

export function getProjectLocalUvPaths(projectRoot: string): ProjectLocalUvPaths {
  const stateDir = path.join(projectRoot, ".uv");
  const localUvInstallDir = path.join(stateDir, "bin");

  return {
    stateDir,
    cacheDir: path.join(stateDir, "cache"),
    pythonInstallDir: path.join(stateDir, "python"),
    toolDir: path.join(stateDir, "tools"),
    toolBinDir: path.join(stateDir, "tools", "bin"),
    localUvInstallDir,
    localUvExecutable: process.platform === "win32"
      ? path.join(localUvInstallDir, "uv.exe")
      : path.join(localUvInstallDir, "uv"),
  };
}

export function buildProjectLocalUvEnv(
  baseEnv: NodeJS.ProcessEnv,
  projectRoot: string
): NodeJS.ProcessEnv {
  const uvPaths = getProjectLocalUvPaths(projectRoot);
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    UV_CACHE_DIR: uvPaths.cacheDir,
    UV_PYTHON_INSTALL_DIR: uvPaths.pythonInstallDir,
    UV_TOOL_DIR: uvPaths.toolDir,
    UV_TOOL_BIN_DIR: uvPaths.toolBinDir,
    UV_PYTHON_PREFERENCE: "only-managed",
  };

  if (process.platform === "win32") {
    env.UV_PYTHON_NO_REGISTRY = "true";
  }

  return env;
}

export function buildProjectLocalUvInstallerEnv(
  baseEnv: NodeJS.ProcessEnv,
  projectRoot: string
): NodeJS.ProcessEnv {
  const uvPaths = getProjectLocalUvPaths(projectRoot);

  return {
    ...buildProjectLocalUvEnv(baseEnv, projectRoot),
    UV_UNMANAGED_INSTALL: uvPaths.localUvInstallDir,
    UV_NO_MODIFY_PATH: "1",
  };
}

export function getProjectLocalUvInstallerCommand(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: "powershell",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ProgressPreference = 'SilentlyContinue'; irm https://astral.sh/uv/install.ps1 | iex",
      ],
    };
  }

  return {
    command: "sh",
    args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
  };
}

export function buildUvVenvArgs(venvDir: string, pythonVersion = SWALLOWKIT_PYTHON_VERSION): string[] {
  return ["venv", venvDir, "--python", pythonVersion];
}

export function buildUvPipInstallArgs(pythonExecutable: string, requirementsPath: string): string[] {
  return ["pip", "install", "--python", pythonExecutable, "-r", requirementsPath];
}
