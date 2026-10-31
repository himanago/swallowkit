/**
 * Project-scoped MCP launcher version management.
 *
 * `.mcp.json` intentionally resolves `swallowkit@latest` so that projects created
 * with older releases still get the current stable tools. A prerelease project can
 * be newer than `latest`; in that case the launcher is pinned to the project
 * version until a stable release that understands project-aware delegation catches up.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compareSemver, isPrerelease, parseSemver } from "../../utils/semver";

export const MCP_CONFIG_PATH = ".mcp.json";
export const MCP_VERSION_ENV = "SWALLOWKIT_MCP_VERSION";
export const MCP_LATEST = "latest";

export interface McpPinDecision {
  version: string;
  reason: string;
}

/**
 * Decide the SWALLOWKIT_MCP_VERSION value for a project that uses `projectVersion`.
 * Uses `latest` unless the project version is newer than the published `latest`.
 * When the registry could not be reached, prereleases are pinned conservatively.
 */
export function resolveMcpPinVersion(projectVersion: string, publishedLatest: string | null): McpPinDecision {
  if (!parseSemver(projectVersion)) {
    return { version: MCP_LATEST, reason: `Project version ${projectVersion} is not a valid semantic version.` };
  }
  if (publishedLatest && parseSemver(publishedLatest)) {
    const comparison = compareSemver(projectVersion, publishedLatest)!;
    return comparison > 0
      ? { version: projectVersion, reason: `Project version ${projectVersion} is newer than published latest ${publishedLatest}.` }
      : { version: MCP_LATEST, reason: `Published latest ${publishedLatest} is the same as or newer than project version ${projectVersion}.` };
  }
  return isPrerelease(projectVersion)
    ? { version: projectVersion, reason: `Published latest is unknown; prerelease ${projectVersion} is pinned so MCP matches the project.` }
    : { version: MCP_LATEST, reason: "Published latest is unknown; stable projects keep latest." };
}

export function lookupPublishedLatestVersion(packageName: string, timeoutMs = 15000): string | null {
  // Run outside the project so its devEngines/packageManager policy does not reject npm.
  const result = spawnSync("npm", ["view", `${packageName}@latest`, "version"], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) return null;
  const version = String(result.stdout).trim().split(/\s+/).pop() ?? "";
  return parseSemver(version) ? version : null;
}

export function readMcpConfigVersion(projectDir: string): string | null {
  const configPath = path.join(projectDir, MCP_CONFIG_PATH);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const value = config?.mcpServers?.swallowkit?.env?.[MCP_VERSION_ENV];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Update only the SwallowKit MCP version in .mcp.json, preserving all other content. */
export function writeMcpConfigVersion(projectDir: string, version: string): void {
  const configPath = path.join(projectDir, MCP_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    throw new Error(`${MCP_CONFIG_PATH} was not found. Run this command from a SwallowKit project root.`);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const server = config?.mcpServers?.swallowkit;
  if (!server || typeof server !== "object") {
    throw new Error(`${MCP_CONFIG_PATH} does not define mcpServers.swallowkit.`);
  }
  server.env = { ...(server.env ?? {}), [MCP_VERSION_ENV]: version };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}
