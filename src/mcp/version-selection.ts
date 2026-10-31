/**
 * Runtime version selection for `swallowkit-mcp`.
 *
 * Policy: when launched as `latest` (or without an explicit version), use whichever is
 * newer of this MCP package and the project-installed `swallowkit`. A newer project
 * install takes over through its own `swallowkit-mcp`, so prerelease projects never get
 * an older contract. An explicit SWALLOWKIT_MCP_VERSION is always honored.
 */

import * as fs from "fs";
import * as path from "path";
import type { MachineNextAction } from "../machine/contracts";
import { MCP_LATEST, MCP_VERSION_ENV } from "../core/project/mcp-config";
import { compareSemver } from "../utils/semver";

export const MCP_DELEGATED_FROM_ENV = "SWALLOWKIT_MCP_DELEGATED_FROM";

export interface ProjectSwallowKitInstall {
  version: string;
  packageRoot: string;
  mcpEntrypoint: string | null;
}

export type McpVersionSelection =
  | "running-version"
  | "project-version"
  | "pinned";

export interface McpVersionContext {
  /** Version of the MCP server answering the request. */
  mcpVersion: string;
  /** SWALLOWKIT_MCP_VERSION as requested by the launcher (`latest` when unset). */
  requestedVersion: string;
  projectVersion: string | null;
  selection: McpVersionSelection;
  delegated: boolean;
  delegatedFrom?: string;
  warnings: string[];
  nextActions: MachineNextAction[];
}

export type McpLaunchDecision =
  | { action: "delegate"; entrypoint: string; fromVersion: string; toVersion: string }
  | { action: "serve"; context: McpVersionContext };

export interface McpLaunchInput {
  selfVersion: string;
  selfPackageRoot: string;
  env: NodeJS.ProcessEnv;
  project: ProjectSwallowKitInstall | null;
  execCommand?: string;
}

function normalizeRoot(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved).toLowerCase();
  } catch {
    return resolved.toLowerCase();
  }
}

export function resolveProjectSwallowKit(cwd: string): ProjectSwallowKitInstall | null {
  // Same lookup order as Node's node_modules resolution from the project directory.
  let packageJsonPath: string | null = null;
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", "swallowkit", "package.json");
    if (fs.existsSync(candidate)) {
      packageJsonPath = fs.realpathSync(candidate);
      break;
    }
    if (path.dirname(directory) === directory) return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: string;
      bin?: string | Record<string, string>;
    };
    if (!manifest.version) return null;
    const packageRoot = path.dirname(packageJsonPath);
    const bin = typeof manifest.bin === "object" ? manifest.bin["swallowkit-mcp"] : undefined;
    const candidate = path.resolve(packageRoot, bin ?? path.join("dist", "mcp", "index.js"));
    return {
      version: manifest.version,
      packageRoot,
      mcpEntrypoint: fs.existsSync(candidate) ? candidate : null,
    };
  } catch {
    return null;
  }
}

export function decideMcpLaunch(input: McpLaunchInput): McpLaunchDecision {
  const { selfVersion, env, project } = input;
  const exec = input.execCommand ?? "npx";
  const requested = (env[MCP_VERSION_ENV] ?? "").trim() || MCP_LATEST;
  const pinned = requested !== MCP_LATEST;
  const delegatedFrom = (env[MCP_DELEGATED_FROM_ENV] ?? "").trim() || undefined;
  const projectVersion = project?.version ?? null;
  const projectNewer = projectVersion ? (compareSemver(projectVersion, selfVersion) ?? 0) > 0 : false;
  const sameInstall = project ? normalizeRoot(project.packageRoot) === normalizeRoot(input.selfPackageRoot) : false;

  if (!pinned && !delegatedFrom && project && projectNewer && !sameInstall && project.mcpEntrypoint) {
    return { action: "delegate", entrypoint: project.mcpEntrypoint, fromVersion: selfVersion, toVersion: project.version };
  }

  const warnings: string[] = [];
  const nextActions: MachineNextAction[] = [];
  if (projectVersion && projectNewer) {
    warnings.push(
      `mcp-older-than-project: swallowkit-mcp ${selfVersion} is older than the project's swallowkit ${projectVersion}. ` +
        "Its capabilities, boundaries, and plan/apply contracts may be outdated for this project."
    );
    nextActions.push({
      command: `${exec} swallowkit machine inspect capabilities`,
      description: "Use the project-local machine interface, which matches the installed SwallowKit version, until MCP is updated.",
    });
    nextActions.push({
      command: `${exec} swallowkit configure-mcp`,
      description: pinned
        ? `Re-select the MCP version (${MCP_VERSION_ENV} is pinned to ${requested}), then restart the MCP server.`
        : "Pin the MCP launcher to the project version, then restart the MCP server.",
    });
  }

  return {
    action: "serve",
    context: {
      mcpVersion: selfVersion,
      requestedVersion: requested,
      projectVersion,
      selection: delegatedFrom ? "project-version" : pinned ? "pinned" : "running-version",
      delegated: Boolean(delegatedFrom),
      ...(delegatedFrom ? { delegatedFrom } : {}),
      warnings,
      nextActions,
    },
  };
}

/**
 * For an explicitly pinned launcher, report when the published `latest` has caught up
 * with or passed the pinned version so the pin can be removed.
 */
export function buildPinnedUpdateNotice(
  context: McpVersionContext,
  publishedLatest: string | null,
  execCommand = "npx"
): { warning: string; nextAction: MachineNextAction } | null {
  if (context.selection !== "pinned" || !publishedLatest) return null;
  const comparison = compareSemver(publishedLatest, context.requestedVersion);
  if (comparison === null || comparison < 0) return null;
  return {
    warning:
      `mcp-pin-outdated: ${MCP_VERSION_ENV} is pinned to ${context.requestedVersion}, but published latest is ${publishedLatest}. ` +
      `Switch the launcher back to "${MCP_LATEST}".`,
    nextAction: {
      command: `${execCommand} swallowkit configure-mcp`,
      description: `Re-select the MCP launcher version (returns to "${MCP_LATEST}" when it is at least the project version), then restart the MCP server.`,
    },
  };
}
