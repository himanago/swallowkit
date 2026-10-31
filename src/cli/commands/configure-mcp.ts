import { Command } from "commander";
import { ensureSwallowKitProject } from "../../core/config";
import {
  MCP_CONFIG_PATH,
  MCP_LATEST,
  lookupPublishedLatestVersion,
  readMcpConfigVersion,
  resolveMcpPinVersion,
  writeMcpConfigVersion,
} from "../../core/project/mcp-config";
import { resolveProjectSwallowKit } from "../../mcp/version-selection";
import { parseSemver } from "../../utils/semver";
import { getSwallowKitVersion } from "../../version";

export interface ConfigureMcpResult {
  previousVersion: string | null;
  version: string;
  reason: string;
}

export function configureMcp(
  options: { version?: string; cwd?: string },
  lookupLatest: (packageName: string) => string | null = lookupPublishedLatestVersion
): ConfigureMcpResult {
  const cwd = options.cwd ?? process.cwd();
  const requested = (options.version ?? "auto").trim();
  const previousVersion = readMcpConfigVersion(cwd);

  let decision: { version: string; reason: string };
  if (requested === "auto") {
    const projectVersion = resolveProjectSwallowKit(cwd)?.version ?? getSwallowKitVersion();
    decision = resolveMcpPinVersion(projectVersion, lookupLatest("swallowkit"));
  } else if (requested === MCP_LATEST) {
    decision = { version: MCP_LATEST, reason: "Explicitly requested latest." };
  } else if (parseSemver(requested)) {
    decision = { version: requested, reason: "Explicitly pinned version." };
  } else {
    throw new Error(`--version must be "auto", "latest", or a semantic version (got "${requested}").`);
  }

  writeMcpConfigVersion(cwd, decision.version);
  return { previousVersion, ...decision };
}

export const configureMcpCommand = new Command("configure-mcp")
  .description(`Select the SwallowKit MCP version used by ${MCP_CONFIG_PATH} (auto: latest unless the project is newer)`)
  .option("--version <version>", "auto | latest | <semver>", "auto")
  .action((options: { version?: string }) => {
    ensureSwallowKitProject("configure-mcp");
    const result = configureMcp({ version: options.version });
    console.log(`${MCP_CONFIG_PATH}: SWALLOWKIT_MCP_VERSION ${result.previousVersion ?? "(unset)"} -> ${result.version}`);
    console.log(`Reason: ${result.reason}`);
    console.log("Restart the MCP server (or reload your agent) to apply the change.");
  });
