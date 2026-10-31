/**
 * Azure CLI invocation that works without a shell on every platform.
 *
 * On Windows `az` is a batch wrapper (az.cmd). Node cannot spawn it with `shell: false`
 * (ENOENT for "az", EINVAL for "az.cmd"), so the wrapper is resolved explicitly:
 * the MSI layout runs its bundled Python exactly like az.cmd does, and other wrappers
 * run through cmd.exe with every argument quoted.
 */

import { spawnSync, SpawnSyncOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface AzCliInvocation {
  command: string;
  prefixArgs: string[];
  env?: NodeJS.ProcessEnv;
  /** Batch wrapper that must be started through cmd.exe. */
  batchScript?: string;
  /** Resolved executable or wrapper, for diagnostics. */
  source: string;
}

export interface AzCliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type AzCliAvailability =
  | { available: true; invocation: AzCliInvocation }
  | { available: false; reason: "not-found" | "not-runnable"; detail: string };

function findOnWindowsPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((ext) => ext.toLowerCase());
  for (const directory of pathValue.split(";").filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory.replace(/^"|"$/g, ""), `${name}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return null;
}

export function resolveAzCliInvocation(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): AzCliInvocation | null {
  if (platform !== "win32") return { command: "az", prefixArgs: [], source: "az" };

  const resolved = findOnWindowsPath("az", env);
  if (!resolved) return null;
  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".exe" || extension === ".com") {
    return { command: resolved, prefixArgs: [], source: resolved };
  }

  // MSI install: wbin\az.cmd runs "..\python.exe -IBm azure.cli %*" with AZ_INSTALLER=MSI.
  const bundledPython = path.join(path.dirname(resolved), "..", "python.exe");
  if (path.basename(path.dirname(resolved)).toLowerCase() === "wbin" && fs.existsSync(bundledPython)) {
    return {
      command: path.resolve(bundledPython),
      prefixArgs: ["-IBm", "azure.cli"],
      env: { AZ_INSTALLER: "MSI" },
      source: resolved,
    };
  }

  return { command: env.ComSpec ?? "cmd.exe", prefixArgs: [], batchScript: resolved, source: resolved };
}

/** Builds the cmd.exe /s /c payload. Rejects characters cmd.exe would reinterpret even inside quotes. */
export function buildBatchCommandLine(script: string, args: string[]): string {
  for (const value of [script, ...args]) {
    if (/["%\r\n]/.test(value)) {
      throw new Error(`Azure CLI argument cannot be passed safely through ${path.basename(script)}: ${JSON.stringify(value)}`);
    }
  }
  return `"${[script, ...args].map((value) => `"${value}"`).join(" ")}"`;
}

let cachedInvocation: AzCliInvocation | null | undefined;

export function getAzCliInvocation(): AzCliInvocation | null {
  if (cachedInvocation === undefined) cachedInvocation = resolveAzCliInvocation();
  return cachedInvocation;
}

export function resetAzCliInvocationCache(): void {
  cachedInvocation = undefined;
}

/** Test hook: pin the resolved invocation (null = not found). */
export function setAzCliInvocationForTesting(invocation: AzCliInvocation | null | undefined): void {
  cachedInvocation = invocation;
}

export function runAzCli(
  args: string[],
  options: { timeout?: number; invocation?: AzCliInvocation | null } = {}
): AzCliResult {
  const invocation = options.invocation === undefined ? getAzCliInvocation() : options.invocation;
  if (!invocation) {
    return { status: null, stdout: "", stderr: "", error: Object.assign(new Error("az was not found on PATH"), { code: "ENOENT" }) };
  }
  const spawnOptions: SpawnSyncOptions = {
    shell: false,
    encoding: "utf-8",
    timeout: options.timeout ?? 300_000,
    env: invocation.env ? { ...process.env, ...invocation.env } : process.env,
  };
  let result;
  try {
    result = invocation.batchScript
      ? spawnSync(invocation.command, ["/d", "/s", "/v:off", "/c", buildBatchCommandLine(invocation.batchScript, args)], {
        ...spawnOptions,
        windowsVerbatimArguments: true,
      })
      : spawnSync(invocation.command, [...invocation.prefixArgs, ...args], spawnOptions);
  } catch (error) {
    return { status: null, stdout: "", stderr: "", error: error instanceof Error ? error : new Error(String(error)) };
  }
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    ...(result.error ? { error: result.error } : {}),
  };
}

export function checkAzCliAvailability(): AzCliAvailability {
  const invocation = getAzCliInvocation();
  if (!invocation) {
    return { available: false, reason: "not-found", detail: "az was not found on PATH." };
  }
  const result = runAzCli(["--version"], { timeout: 60_000, invocation });
  if (result.status === 0) return { available: true, invocation };
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (errorCode === "ENOENT") {
    return { available: false, reason: "not-found", detail: "az was not found on PATH." };
  }
  const output = `${result.stderr || result.stdout}`.trim().split(/\r?\n/).slice(-3).join(" ");
  return {
    available: false,
    reason: "not-runnable",
    detail: `${invocation.source} could not run "az --version" (${result.error?.message ?? `exit ${result.status}`})${output ? `: ${output}` : ""}`,
  };
}
