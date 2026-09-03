import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createWorktreePathHash,
  resolveCosmosDatabaseNameForWorktree,
  resolveGitWorktreeInfo,
} from "../cli/commands/cosmos-worktree-isolation";

describe("Cosmos DB worktree isolation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "swallowkit-worktree-isolation-")
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps the base database name in the main worktree", () => {
    const mainRoot = path.join(tempDir, "main");
    const gitDir = path.join(mainRoot, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    const runGit = jest.fn(() => [mainRoot, gitDir, ".git"].join("\n"));

    const result = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      mainRoot,
      runGit
    );

    expect(runGit).toHaveBeenCalledWith(
      [
        "rev-parse",
        "--show-toplevel",
        "--absolute-git-dir",
        "--git-common-dir",
      ],
      mainRoot
    );
    expect(result).toEqual({
      databaseName: "MyAppDatabase",
      worktreeIsolationEnabled: false,
    });
  });

  it("adds an eight-character path hash in a linked worktree", () => {
    const { linkedRoot, gitDir, commonDir } = createLinkedWorktreePaths("one");

    const result = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      linkedRoot,
      () => [linkedRoot, gitDir, commonDir].join("\n")
    );

    expect(result.worktreeIsolationEnabled).toBe(true);
    expect(result.databaseName).toMatch(/^MyAppDatabase_[a-f0-9]{8}$/);
    expect(result.databaseName).toBe(
      `MyAppDatabase_${createWorktreePathHash(linkedRoot)}`
    );
  });

  it("generates the same hash for repeated resolution of one worktree", () => {
    const { linkedRoot, gitDir, commonDir } =
      createLinkedWorktreePaths("stable");
    const runGit = () => [linkedRoot, gitDir, commonDir].join("\n");

    const first = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      linkedRoot,
      runGit
    );
    const second = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      linkedRoot,
      runGit
    );

    expect(second.databaseName).toBe(first.databaseName);
  });

  it("generates different hashes for different worktree roots", () => {
    const firstRoot = path.join(tempDir, "linked-one");
    const secondRoot = path.join(tempDir, "linked-two");
    fs.mkdirSync(firstRoot);
    fs.mkdirSync(secondRoot);

    expect(createWorktreePathHash(firstRoot)).not.toBe(
      createWorktreePathHash(secondRoot)
    );
  });

  it("uses the worktree root when invoked from a subdirectory", () => {
    const { linkedRoot, gitDir, commonDir } =
      createLinkedWorktreePaths("nested");
    const nestedDir = path.join(linkedRoot, "apps", "web");
    fs.mkdirSync(nestedDir, { recursive: true });
    const runGit = () => [linkedRoot, gitDir, commonDir].join("\n");

    const fromRoot = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      linkedRoot,
      runGit
    );
    const fromNestedDir = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      nestedDir,
      runGit
    );

    expect(fromNestedDir.databaseName).toBe(fromRoot.databaseName);
  });

  it("falls back to the base name when Git information cannot be read", () => {
    const result = resolveCosmosDatabaseNameForWorktree(
      "MyAppDatabase",
      tempDir,
      () => {
        throw new Error("git is unavailable");
      }
    );

    expect(result).toEqual({
      databaseName: "MyAppDatabase",
      worktreeIsolationEnabled: false,
    });
    expect(
      resolveGitWorktreeInfo(tempDir, () => "not enough output")
    ).toBeNull();
  });

  function createLinkedWorktreePaths(name: string): {
    linkedRoot: string;
    gitDir: string;
    commonDir: string;
  } {
    const mainRoot = path.join(tempDir, `main-${name}`);
    const linkedRoot = path.join(tempDir, `linked-${name}`);
    const commonDir = path.join(mainRoot, ".git");
    const gitDir = path.join(commonDir, "worktrees", name);
    fs.mkdirSync(linkedRoot, { recursive: true });
    fs.mkdirSync(gitDir, { recursive: true });

    return { linkedRoot, gitDir, commonDir };
  }
});
