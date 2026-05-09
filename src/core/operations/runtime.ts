import * as fs from "fs";
import * as path from "path";

export interface CapturedConsoleMessages {
  logs: string[];
  warnings: string[];
  errors: string[];
}

export interface FileMutationSummary {
  createdFiles: string[];
  updatedFiles: string[];
  appendedFiles: string[];
  deletedFiles: string[];
  createdDirectories: string[];
}

export class ProcessExitInterceptError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Process exited with code ${exitCode}`);
    this.name = "ProcessExitInterceptError";
    this.exitCode = exitCode;
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }

      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }

      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function normalizePathForSummary(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  return relative && !relative.startsWith("..") ? relative.replace(/\\/g, "/") : targetPath.replace(/\\/g, "/");
}

interface FileSystemEntrySnapshot {
  type: "file" | "directory";
  mtimeMs: number;
  size: number;
}

function snapshotFileSystem(rootDirectory: string): Map<string, FileSystemEntrySnapshot> {
  const snapshot = new Map<string, FileSystemEntrySnapshot>();
  const excludedDirectoryNames = new Set([".git", "node_modules"]);

  function walk(currentDirectory: string): void {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(currentDirectory, entry.name);
      const stats = fs.statSync(entryPath);
      snapshot.set(entryPath, {
        type: entry.isDirectory() ? "directory" : "file",
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });

      if (entry.isDirectory()) {
        walk(entryPath);
      }
    }
  }

  if (fs.existsSync(rootDirectory)) {
    walk(rootDirectory);
  }

  return snapshot;
}

export async function withWorkingDirectory<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const originalDirectory = process.cwd();
  process.chdir(directory);

  try {
    return await action();
  } finally {
    process.chdir(originalDirectory);
  }
}

export async function captureConsoleMessages<T>(
  action: () => Promise<T>
): Promise<{ result: T; messages: CapturedConsoleMessages }> {
  const messages: CapturedConsoleMessages = {
    logs: [],
    warnings: [],
    errors: [],
  };

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    messages.logs.push(formatConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    messages.warnings.push(formatConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    messages.errors.push(formatConsoleArgs(args));
  };

  try {
    const result = await action();
    return { result, messages };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export async function captureConsoleMessagesWithError<T>(
  action: () => Promise<T>
): Promise<{ result?: T; messages: CapturedConsoleMessages; error?: unknown }> {
  const messages: CapturedConsoleMessages = {
    logs: [],
    warnings: [],
    errors: [],
  };

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    messages.logs.push(formatConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    messages.warnings.push(formatConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    messages.errors.push(formatConsoleArgs(args));
  };

  try {
    return { result: await action(), messages };
  } catch (error) {
    return { messages, error };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export async function interceptProcessExit<T>(action: () => Promise<T>): Promise<T> {
  const originalExit = process.exit;

  process.exit = ((code?: number | string | null) => {
    const normalizedCode = typeof code === "number"
      ? code
      : typeof process.exitCode === "number"
        ? process.exitCode
        : 1;
    throw new ProcessExitInterceptError(normalizedCode);
  }) as typeof process.exit;

  try {
    return await action();
  } finally {
    process.exit = originalExit;
  }
}

export async function trackFileMutations<T>(
  action: () => Promise<T>
): Promise<{ result: T; mutations: FileMutationSummary }> {
  const rootDirectory = process.cwd();
  const before = snapshotFileSystem(rootDirectory);
  const result = await action();
  const after = snapshotFileSystem(rootDirectory);

  const createdFiles = new Set<string>();
  const updatedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  const createdDirectories = new Set<string>();

  for (const [entryPath, afterEntry] of after.entries()) {
    const beforeEntry = before.get(entryPath);
    if (!beforeEntry) {
      if (afterEntry.type === "directory") {
        createdDirectories.add(normalizePathForSummary(entryPath));
      } else {
        createdFiles.add(normalizePathForSummary(entryPath));
      }
      continue;
    }

    if (
      afterEntry.type === "file" &&
      (beforeEntry.mtimeMs !== afterEntry.mtimeMs || beforeEntry.size !== afterEntry.size)
    ) {
      updatedFiles.add(normalizePathForSummary(entryPath));
    }
  }

  for (const [entryPath, beforeEntry] of before.entries()) {
    if (!after.has(entryPath) && beforeEntry.type === "file") {
      deletedFiles.add(normalizePathForSummary(entryPath));
    }
  }

  return {
    result,
    mutations: {
      createdFiles: Array.from(createdFiles).sort(),
      updatedFiles: Array.from(updatedFiles).sort(),
      appendedFiles: [],
      deletedFiles: Array.from(deletedFiles).sort(),
      createdDirectories: Array.from(createdDirectories).sort(),
    },
  };
}
