/**
 * Azure CLI invocation that works without a shell on every platform.
 *
 * On Windows `az` is a batch wrapper (az.cmd). Node cannot spawn it with `shell: false`
 * (ENOENT for "az", EINVAL for "az.cmd"), so the wrapper is resolved explicitly:
 * the MSI layout runs its bundled Python exactly like az.cmd does, and other wrappers
 * run through cmd.exe with every argument quoted.
 */

import { spawn, spawnSync, SpawnSyncOptions } from "child_process";
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
  signal: NodeJS.Signals | null;
  elapsedMs: number;
  failureKind?: "timeout" | "buffer" | "cancelled" | "spawn" | "signal" | "communication" | "exit";
  errorCode?: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface AzCliRunOptions {
  timeout?: number;
  invocation?: AzCliInvocation | null;
  signal?: AbortSignal;
  /** Capture is bounded independently of the child's output volume. */
  captureBytes?: number;
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
      throw new Error(`Azure CLI argument cannot be passed safely through ${path.basename(script)} (quotes, percent signs, or newlines).`);
    }
  }
  return `"${[script, ...args].map((value) => `"${value.replace(/(\\+)$/, "$1$1")}"`).join(" ")}"`;
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
  options: AzCliRunOptions = {}
): AzCliResult {
  const startedAt = Date.now();
  const invocation = options.invocation === undefined ? getAzCliInvocation() : options.invocation;
  if (!invocation) {
    return missingCliResult();
  }
  const spawnOptions: SpawnSyncOptions = {
    shell: false,
    encoding: "utf-8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: options.captureBytes ?? 1_048_576,
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
    return {
      ...missingCliResult(),
      error: error instanceof Error ? error : new Error(String(error)),
      errorCode: (error as NodeJS.ErrnoException)?.code,
      elapsedMs: Date.now() - startedAt,
    };
  }
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    signal: result.signal ?? null,
    elapsedMs: Date.now() - startedAt,
    stdoutTruncated: errorCode === "ENOBUFS",
    stderrTruncated: errorCode === "ENOBUFS",
    ...(errorCode ? { errorCode } : {}),
    ...(errorCode === "ETIMEDOUT" ? { failureKind: "timeout" as const }
      : errorCode === "ENOBUFS" ? { failureKind: "buffer" as const }
        : result.error ? { failureKind: "spawn" as const }
          : result.signal ? { failureKind: "signal" as const }
            : result.status !== 0 ? { failureKind: "exit" as const } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function missingCliResult(): AzCliResult {
  return {
    status: null, stdout: "", stderr: "", signal: null, elapsedMs: 0,
    stdoutTruncated: false, stderrTruncated: false,
    error: Object.assign(new Error("az was not found on PATH"), { code: "ENOENT" }),
    errorCode: "ENOENT", failureKind: "spawn",
  };
}

/** Unlike spawnSync/maxBuffer, discarding excess output never kills the Azure CLI. */
export async function runAzCliAsync(args: string[], options: AzCliRunOptions = {}): Promise<AzCliResult> {
  const invocation = options.invocation === undefined ? getAzCliInvocation() : options.invocation;
  if (!invocation) return missingCliResult();
  const timeout = options.timeout ?? 60_000;
  const captureBytes = options.captureBytes ?? 65_536;
  if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isInteger(captureBytes) || captureBytes < 1) {
    throw new Error("Azure CLI timeout and captureBytes must be finite positive values.");
  }
  const startedAt = Date.now();
  const result: AzCliResult = {
    status: null, stdout: "", stderr: "", signal: null, elapsedMs: 0,
    stdoutTruncated: false, stderrTruncated: false,
  };
  if (options.signal?.aborted) return { ...result, failureKind: "cancelled" };
  let commandArgs: string[];
  try {
    commandArgs = invocation.batchScript
      ? ["/d", "/s", "/v:off", "/c", buildBatchCommandLine(invocation.batchScript, args)]
      : [...invocation.prefixArgs, ...args];
  } catch (error) {
    return { ...result, error: error instanceof Error ? error : new Error(String(error)), failureKind: "spawn" };
  }
  return new Promise<AzCliResult>((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let finished = false;
    let drainTimer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof spawn>;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (drainTimer) clearTimeout(drainTimer);
      options.signal?.removeEventListener("abort", abort);
      result.stdout = stdout.toString("utf-8");
      result.stderr = stderr.toString("utf-8");
      result.elapsedMs = Date.now() - startedAt;
      if (!result.failureKind && result.status !== 0) {
        result.failureKind = result.signal ? "signal"
          : /ConnectionReset|ConnectionError|connection.*(?:closed|reset|aborted)|ReadTimeout|RemoteDisconnected|ETIMEDOUT|ECONNRESET/i.test(result.stderr)
            ? "communication" : "exit";
      }
      resolve(result);
    };
    const stop = (kind: "timeout" | "cancelled") => {
      if (finished || result.failureKind === "timeout" || result.failureKind === "cancelled") return;
      result.failureKind = kind;
      if (kind === "timeout") result.errorCode = "ETIMEDOUT";
      child?.kill("SIGTERM");
      // Descendants can inherit pipes; do not wait indefinitely for their close events.
      drainTimer = setTimeout(() => {
        child?.kill("SIGKILL");
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        result.stdoutTruncated = true;
        result.stderrTruncated = true;
        finish();
      }, 1_000);
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), timeout);
    try {
      child = spawn(invocation.command, commandArgs, {
        shell: false,
        windowsHide: true,
        ...(invocation.batchScript ? { windowsVerbatimArguments: true } : {}),
        env: invocation.env ? { ...process.env, ...invocation.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      result.error = error instanceof Error ? error : new Error(String(error));
      result.errorCode = (error as NodeJS.ErrnoException)?.code;
      result.failureKind = "spawn";
      finish();
      return;
    }
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const buffer = stream === "stdout" ? stdout : stderr;
      const remaining = captureBytes - buffer.length;
      if (chunk.length > remaining) result[`${stream}Truncated`] = true;
      if (remaining <= 0) return;
      const combined = Buffer.concat([buffer, chunk.subarray(0, Math.max(remaining, 0))]);
      if (stream === "stdout") stdout = combined;
      else stderr = combined;
    };
    child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (finished) return;
      result.error = error;
      result.errorCode = error.code;
      result.failureKind ??= "spawn";
      finish();
    });
    child.on("exit", (code, signal) => {
      if (finished) return;
      result.status = code;
      result.signal = signal;
      if (!drainTimer) {
        drainTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          result.stdoutTruncated = true;
          result.stderrTruncated = true;
          finish();
        }, 1_000);
      }
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      result.status = code;
      result.signal = signal;
      finish();
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
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
