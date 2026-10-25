import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
export const DEFAULT_AZURE_PYTHON_VERSION = "3.14";

export interface ProjectLocalUvPaths {
  stateDir: string;
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
    localUvInstallDir,
    localUvExecutable: process.platform === "win32"
      ? path.join(localUvInstallDir, "uv.exe")
      : path.join(localUvInstallDir, "uv"),
  };
}

export function buildProjectLocalUvInstallerEnv(
  baseEnv: NodeJS.ProcessEnv,
  projectRoot: string
): NodeJS.ProcessEnv {
  const uvPaths = getProjectLocalUvPaths(projectRoot);

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    UV_UNMANAGED_INSTALL: uvPaths.localUvInstallDir,
    UV_NO_MODIFY_PATH: "1",
  };
  // Windows PowerShell must discover its own modules, not inherit PowerShell 7's.
  if (process.platform === "win32") {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
  }
  return env;
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

export function buildUvVenvArgs(venvDir: string): string[] {
  return ["venv", venvDir];
}

export function getVirtualEnvPythonPath(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

export async function ensureUvVirtualEnvironment(
  uvCommand: string,
  venvDir: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const pythonExecutable = getVirtualEnvPythonPath(venvDir);
  if (!fs.existsSync(venvDir)) {
    const { stdout, stderr } = await execFileAsync(uvCommand, buildUvVenvArgs(venvDir), { cwd, env });
    if (env.SWALLOWKIT_MACHINE_OUTPUT !== "1") {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
  }
  try {
    await execFileAsync(pythonExecutable, ["--version"], { cwd, env });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot execute Python at ${pythonExecutable}: ${reason}\n` +
      "The virtual environment was preserved. Check the interpreter and OS application-control policy. " +
      "To switch Python, explicitly recreate this environment with uv and a trusted interpreter; SwallowKit will not clear it automatically."
    );
  }
  return pythonExecutable;
}

export function buildUvPipInstallArgs(pythonExecutable: string, requirementsPath: string): string[] {
  return ["pip", "install", "--python", pythonExecutable, "-r", requirementsPath];
}

export function buildPythonCodegenInstallEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Codegen reads JSON; PyYAML's optional accelerator must not require a C compiler.
  return { ...env, PYYAML_FORCE_LIBYAML: env.PYYAML_FORCE_LIBYAML ?? "0" };
}
