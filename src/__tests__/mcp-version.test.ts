import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compareSemver, isPrerelease, parseSemver } from "../utils/semver";
import {
  MCP_DELEGATED_FROM_ENV,
  buildPinnedUpdateNotice,
  decideMcpLaunch,
  resolveProjectSwallowKit,
} from "../mcp/version-selection";
import { readMcpConfigVersion, resolveMcpPinVersion } from "../core/project/mcp-config";
import { configureMcp } from "../cli/commands/configure-mcp";
import { buildSwallowKitMcpProjectConfigSource, selectInitialMcpVersion } from "../cli/commands/init";
import { getSwallowKitVersion } from "../version";

const repositoryRoot = path.resolve(__dirname, "..", "..");
const builtMcpEntrypoint = path.join(repositoryRoot, "dist", "mcp", "index.js");
const itWhenBuilt = fs.existsSync(builtMcpEntrypoint) ? it : it.skip;

function createProject(version: string | null, options: { mcpScript?: string } = {}): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-mcp-version-"));
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "sample", devEngines: { packageManager: { name: "pnpm" } } }));
  fs.writeFileSync(path.join(project, ".mcp.json"), buildSwallowKitMcpProjectConfigSource("pnpm"));
  if (version) {
    const root = path.join(project, "node_modules", "swallowkit");
    fs.mkdirSync(path.join(root, "dist", "mcp"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
      name: "swallowkit",
      version,
      bin: { swallowkit: "dist/cli/index.js", "swallowkit-mcp": "dist/mcp/index.js" },
    }));
    fs.writeFileSync(path.join(root, "dist", "mcp", "index.js"), options.mcpScript ?? "");
  }
  return project;
}

describe("semantic version precedence", () => {
  it.each([
    ["2.0.0-alpha.3", "1.1.2", 1],
    ["2.0.0-alpha.3", "2.0.0", -1],
    ["2.0.0", "2.0.0-alpha.3", 1],
    ["2.0.0-alpha.3", "2.0.0-alpha.3", 0],
    ["2.0.0-alpha.3", "2.0.0-alpha.10", -1],
    ["2.0.0-alpha.3", "2.0.0-beta.1", -1],
    ["2.0.0-beta.1", "2.0.0-rc.1", -1],
    ["2.0.0-alpha", "2.0.0-alpha.1", -1],
    ["2.0.0-1", "2.0.0-alpha", -1],
    ["1.10.0", "1.9.9", 1],
    ["1.0.0+build.1", "1.0.0", 0],
  ])("compares %s with %s", (left, right, expected) => {
    expect(compareSemver(left, right)).toBe(expected);
    expect(compareSemver(right, left)).toBe(-expected || 0);
  });

  it("rejects values that are not semantic versions", () => {
    expect(parseSemver("latest")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("01.2.3")).toBeNull();
    expect(compareSemver("latest", "1.0.0")).toBeNull();
    expect(isPrerelease("2.0.0-alpha.3")).toBe(true);
    expect(isPrerelease("2.0.0")).toBe(false);
  });
});

describe("MCP launch version selection", () => {
  const selfPackageRoot = path.join(os.tmpdir(), "published-swallowkit");
  const project = (version: string, entrypoint: string | null = "/project/node_modules/swallowkit/dist/mcp/index.js") => ({
    version,
    packageRoot: "/project/node_modules/swallowkit",
    mcpEntrypoint: entrypoint,
  });

  it("delegates when the project install is newer than the latest launcher", () => {
    const decision = decideMcpLaunch({
      selfVersion: "1.1.2",
      selfPackageRoot,
      env: { SWALLOWKIT_MCP_VERSION: "latest" },
      project: project("2.0.0-alpha.3"),
    });
    expect(decision).toEqual({
      action: "delegate",
      entrypoint: "/project/node_modules/swallowkit/dist/mcp/index.js",
      fromVersion: "1.1.2",
      toVersion: "2.0.0-alpha.3",
    });
  });

  it("treats an unset version like latest", () => {
    expect(decideMcpLaunch({ selfVersion: "1.1.2", selfPackageRoot, env: {}, project: project("2.0.0-alpha.3") }).action)
      .toBe("delegate");
  });

  it.each([
    ["latest caught up with a stable release", "2.0.0", "2.0.0-alpha.3"],
    ["same version", "2.0.0-alpha.3", "2.0.0-alpha.3"],
    ["latest is newer", "2.1.0", "2.0.0"],
  ])("keeps the launcher when %s", (_label, selfVersion, projectVersion) => {
    const decision = decideMcpLaunch({ selfVersion, selfPackageRoot, env: { SWALLOWKIT_MCP_VERSION: "latest" }, project: project(projectVersion) });
    expect(decision.action).toBe("serve");
    if (decision.action !== "serve") return;
    expect(decision.context).toMatchObject({ mcpVersion: selfVersion, projectVersion, selection: "running-version", delegated: false, warnings: [] });
  });

  it("serves the launcher when SwallowKit is not installed in the project", () => {
    const decision = decideMcpLaunch({ selfVersion: "1.1.2", selfPackageRoot, env: { SWALLOWKIT_MCP_VERSION: "latest" }, project: null });
    expect(decision).toMatchObject({ action: "serve", context: { projectVersion: null, warnings: [], selection: "running-version" } });
  });

  it("honors an explicit pin and warns, without delegating, when the pin is older than the project", () => {
    const decision = decideMcpLaunch({
      selfVersion: "2.0.0-alpha.3",
      selfPackageRoot,
      env: { SWALLOWKIT_MCP_VERSION: "2.0.0-alpha.3" },
      project: project("2.0.0-alpha.4"),
      execCommand: "pnpm exec",
    });
    expect(decision.action).toBe("serve");
    if (decision.action !== "serve") return;
    expect(decision.context.selection).toBe("pinned");
    expect(decision.context.warnings[0]).toMatch(/^mcp-older-than-project: swallowkit-mcp 2\.0\.0-alpha\.3 is older than the project's swallowkit 2\.0\.0-alpha\.4/);
    expect(decision.context.nextActions.map((action) => action.command)).toEqual([
      "pnpm exec swallowkit machine inspect capabilities",
      "pnpm exec swallowkit configure-mcp",
    ]);
  });

  it("does not delegate again inside a delegated process", () => {
    const decision = decideMcpLaunch({
      selfVersion: "2.0.0-alpha.3",
      selfPackageRoot,
      env: { SWALLOWKIT_MCP_VERSION: "latest", [MCP_DELEGATED_FROM_ENV]: "1.1.2" },
      project: project("2.0.0-alpha.3"),
    });
    expect(decision).toMatchObject({
      action: "serve",
      context: { selection: "project-version", delegated: true, delegatedFrom: "1.1.2", mcpVersion: "2.0.0-alpha.3" },
    });
  });

  it("warns instead of delegating when the newer project install has no MCP entrypoint", () => {
    const decision = decideMcpLaunch({ selfVersion: "1.1.2", selfPackageRoot, env: {}, project: project("2.0.0-alpha.3", null) });
    expect(decision.action).toBe("serve");
    if (decision.action === "serve") expect(decision.context.warnings).toHaveLength(1);
  });

  it("reports a pinned launcher once published latest catches up", () => {
    const context = {
      mcpVersion: "2.0.0-alpha.3", requestedVersion: "2.0.0-alpha.3", projectVersion: "2.0.0-alpha.3",
      selection: "pinned" as const, delegated: false, warnings: [], nextActions: [],
    };
    expect(buildPinnedUpdateNotice(context, "1.1.2")).toBeNull();
    expect(buildPinnedUpdateNotice(context, null)).toBeNull();
    const notice = buildPinnedUpdateNotice(context, "2.0.0", "pnpm exec");
    expect(notice?.warning).toMatch(/pinned to 2\.0\.0-alpha\.3, but published latest is 2\.0\.0/);
    expect(notice?.nextAction.command).toBe("pnpm exec swallowkit configure-mcp");
    expect(buildPinnedUpdateNotice({ ...context, selection: "running-version" }, "2.0.0")).toBeNull();
  });

  it("finds the project-installed package and its MCP entrypoint", () => {
    const directory = createProject("2.0.0-alpha.3");
    const empty = createProject(null);
    try {
      const install = resolveProjectSwallowKit(directory);
      expect(install?.version).toBe("2.0.0-alpha.3");
      expect(install?.mcpEntrypoint).toBe(path.join(fs.realpathSync(directory), "node_modules", "swallowkit", "dist", "mcp", "index.js"));
      expect(resolveProjectSwallowKit(empty)).toBeNull();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("MCP launcher version in .mcp.json", () => {
  it.each([
    ["2.0.0-alpha.3", "1.1.2", "2.0.0-alpha.3"],
    ["2.0.0-alpha.3", "2.0.0", "latest"],
    ["2.0.0-alpha.3", "2.0.0-alpha.3", "latest"],
    ["1.1.2", "1.1.2", "latest"],
    ["1.1.1", "1.1.2", "latest"],
    ["2.0.0-alpha.3", null, "2.0.0-alpha.3"],
    ["1.1.2", null, "latest"],
  ])("project %s with published latest %s uses %s", (projectVersion, latest, expected) => {
    expect(resolveMcpPinVersion(projectVersion, latest).version).toBe(expected);
  });

  it("selects the init value from this CLI version and the registry", () => {
    const current = getSwallowKitVersion();
    expect(selectInitialMcpVersion(() => current).version).toBe("latest");
    expect(selectInitialMcpVersion(() => "0.0.1").version).toBe(current);
  });

  it("re-selects and preserves the rest of .mcp.json with configure-mcp", () => {
    const directory = createProject("2.0.0-alpha.3");
    try {
      expect(configureMcp({ cwd: directory }, () => "1.1.2")).toMatchObject({ previousVersion: "latest", version: "2.0.0-alpha.3" });
      expect(readMcpConfigVersion(directory)).toBe("2.0.0-alpha.3");
      expect(configureMcp({ cwd: directory }, () => "2.0.0")).toMatchObject({ previousVersion: "2.0.0-alpha.3", version: "latest" });
      expect(configureMcp({ cwd: directory, version: "2.0.0-alpha.3" }).version).toBe("2.0.0-alpha.3");
      expect(configureMcp({ cwd: directory, version: "latest" }).version).toBe("latest");
      expect(() => configureMcp({ cwd: directory, version: "next" })).toThrow(/auto/);
      const config = JSON.parse(fs.readFileSync(path.join(directory, ".mcp.json"), "utf8"));
      expect(config.mcpServers.swallowkit.args).toEqual(["dlx", "--package", "swallowkit@${SWALLOWKIT_MCP_VERSION}", "swallowkit-mcp"]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("built MCP entrypoint version delegation", () => {
  const runEntrypoint = (cwd: string, env: NodeJS.ProcessEnv) =>
    new Promise<{ stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [builtMcpEntrypoint], {
        cwd,
        env: { ...process.env, SWALLOWKIT_MCP_UPDATE_CHECK: "0", ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 10000);
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (/version: .*selection/.test(stderr)) child.kill();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stderr, code });
      });
    });

  itWhenBuilt("hands the session to a newer project install", async () => {
    const directory = createProject("999.0.0-alpha.1", {
      mcpScript: `process.stderr.write("project-mcp delegatedFrom=" + process.env.${MCP_DELEGATED_FROM_ENV} + "\\n");`,
    });
    try {
      const result = await runEntrypoint(directory, { SWALLOWKIT_MCP_VERSION: "latest" });
      expect(result.stderr).toContain("delegating to the project-installed swallowkit-mcp 999.0.0-alpha.1");
      expect(result.stderr).toContain(`project-mcp delegatedFrom=${getSwallowKitVersion()}`);
      expect(result.code).toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 20000);

  itWhenBuilt("keeps serving when the project install is older or the version is pinned", async () => {
    const older = createProject("0.0.1", { mcpScript: "process.stderr.write('should-not-run');" });
    const newer = createProject("999.0.0", { mcpScript: "process.stderr.write('should-not-run');" });
    try {
      const fromOlder = await runEntrypoint(older, { SWALLOWKIT_MCP_VERSION: "latest" });
      expect(fromOlder.stderr).toContain(`version: ${getSwallowKitVersion()} (selection: running-version)`);
      expect(fromOlder.stderr).not.toContain("should-not-run");
      const pinned = await runEntrypoint(newer, { SWALLOWKIT_MCP_VERSION: getSwallowKitVersion() });
      expect(pinned.stderr).toContain("(selection: pinned)");
      expect(pinned.stderr).toContain("mcp-older-than-project");
      expect(pinned.stderr).not.toContain("should-not-run");
    } finally {
      fs.rmSync(older, { recursive: true, force: true });
      fs.rmSync(newer, { recursive: true, force: true });
    }
  }, 30000);
});
