import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const WORKTREE_HASH_LENGTH = 8;

export interface GitWorktreeInfo {
  worktreeRoot: string;
  gitDir: string;
  gitCommonDir: string;
  isLinkedWorktree: boolean;
}

export interface CosmosDatabaseNameResolution {
  databaseName: string;
  worktreeIsolationEnabled: boolean;
  worktreeRoot?: string;
}

export type GitCommandRunner = (args: string[], cwd: string) => string;

const runGitCommand: GitCommandRunner = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });

/**
 * Resolve Git's worktree metadata without relying on whether .git is a file or
 * directory. A linked worktree has a per-worktree Git directory that differs
 * from the repository's common Git directory.
 */
export function resolveGitWorktreeInfo(
  cwd: string = process.cwd(),
  runGit: GitCommandRunner = runGitCommand
): GitWorktreeInfo | null {
  try {
    const output = runGit(
      [
        "rev-parse",
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-common-dir",
      ],
      cwd
    );
    const lines = output.split(/\r?\n/).map((line) => line.trim());
    const [worktreeRootOutput, gitDirOutput, gitCommonDirOutput] = lines;

    if (!worktreeRootOutput || !gitDirOutput || !gitCommonDirOutput) {
      return null;
    }

    const worktreeRoot = canonicalizePath(worktreeRootOutput, cwd);
    const gitDir = canonicalizePath(gitDirOutput, cwd);
    const gitCommonDir = canonicalizePath(gitCommonDirOutput, cwd);

    return {
      worktreeRoot,
      gitDir,
      gitCommonDir,
      isLinkedWorktree: gitDir !== gitCommonDir,
    };
  } catch {
    return null;
  }
}

/**
 * Produce a stable, database-safe identifier for a canonical worktree path.
 */
export function createWorktreePathHash(worktreeRoot: string): string {
  return createHash("sha256")
    .update(canonicalizePath(worktreeRoot), "utf-8")
    .digest("hex")
    .slice(0, WORKTREE_HASH_LENGTH);
}

export function applyCosmosDatabaseWorktreeIsolation(
  baseDatabaseName: string,
  worktreeInfo: GitWorktreeInfo | null
): CosmosDatabaseNameResolution {
  if (!worktreeInfo?.isLinkedWorktree) {
    return {
      databaseName: baseDatabaseName,
      worktreeIsolationEnabled: false,
    };
  }

  const suffix = createWorktreePathHash(worktreeInfo.worktreeRoot);
  return {
    databaseName: `${baseDatabaseName}_${suffix}`,
    worktreeIsolationEnabled: true,
    worktreeRoot: worktreeInfo.worktreeRoot,
  };
}

export function resolveCosmosDatabaseNameForWorktree(
  baseDatabaseName: string,
  cwd: string = process.cwd(),
  runGit: GitCommandRunner = runGitCommand
): CosmosDatabaseNameResolution {
  return applyCosmosDatabaseWorktreeIsolation(
    baseDatabaseName,
    resolveGitWorktreeInfo(cwd, runGit)
  );
}

function canonicalizePath(
  value: string,
  basePath: string = process.cwd()
): string {
  const absolutePath = path.resolve(basePath, value);
  let canonicalPath = absolutePath;

  try {
    canonicalPath = fs.realpathSync.native(absolutePath);
  } catch {
    // Git metadata can disappear between discovery and normalization. The
    // normalized absolute path remains a stable fallback for this invocation.
  }

  const normalizedPath = path.normalize(canonicalPath).normalize("NFC");
  return process.platform === "win32"
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}
