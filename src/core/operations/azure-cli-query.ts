import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { MachineCommandError } from "../../machine/errors";

export interface AzureCliInvocation {
  file: string;
  args: string[];
  installer?: "MSI";
}

export function resolveAzureCliInvocation(
  platform: NodeJS.Platform = process.platform,
  searchPath: string = process.env.PATH ?? ""
): AzureCliInvocation {
  if (platform !== "win32") return { file: "az", args: [] };
  for (const directory of searchPath.split(";").filter(Boolean)) {
    const root = directory.replace(/^"|"$/g, "");
    const executable = path.join(root, "az.exe");
    if (fs.existsSync(executable) && fs.statSync(executable).isFile()) return { file: executable, args: [] };
    const launcher = path.join(root, "az.cmd");
    if (!fs.existsSync(launcher) || !fs.statSync(launcher).isFile()) continue;
    // The Windows MSI launcher delegates to this bundled Python, not cmd.exe.
    const python = path.resolve(root, "..", "python.exe");
    if (fs.existsSync(python) && fs.statSync(python).isFile()) {
      return { file: python, args: ["-IBm", "azure.cli"], installer: "MSI" };
    }
    throw new MachineCommandError("azure-cli-launcher-unsupported",
      "The Windows Azure CLI launcher has no bundled python.exe. Install the supported Azure CLI MSI or place az.exe on PATH; no shell fallback is used.",
      { launcher }, "blocked");
  }
  throw new MachineCommandError("az-cli-not-found", "Cannot find az.exe or the Azure CLI MSI az.cmd on PATH.", undefined, "blocked");
}

export function runAzureCliQuery(invocation: AzureCliInvocation, args: readonly string[]) {
  return spawnSync(invocation.file, [...invocation.args, ...args], {
    shell: false, encoding: "utf8", timeout: 60_000,
    ...(invocation.installer ? { env: { ...process.env, AZ_INSTALLER: invocation.installer } } : {}),
  });
}
