import { spawnSync } from "child_process";
import { MachineCommandError } from "../../machine/errors";
import { MigrationManifest, MigrationState, decodeMigrationState, getMigrationTagKey, selectPendingMigrations } from "../project/migrations";

export interface PendingMigrationTarget {
  resourceGroup?: string;
  subscription?: string;
}

export function confirmPendingMigration(
  manifest: MigrationManifest, version: number, target: PendingMigrationTarget, projectRoot: string
): MigrationState {
  if (!target.resourceGroup || !/^[A-Za-z0-9._()-]{1,90}$/.test(target.resourceGroup) ||
      (target.subscription && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(target.subscription))) {
    throw new MachineCommandError(
      "migration-state-required", "Refreshing a pending migration requires --resource-group and an optional valid --subscription.",
      { version, nextAction: "Use migrations add-model <model> --refresh-pending --resource-group <rg> [--subscription <id>]." }, "blocked"
    );
  }
  const query = (command: "exists" | "show") => spawnSync("az", [
    "group", command, "--name", target.resourceGroup!,
    ...(target.subscription ? ["--subscription", target.subscription] : []),
    ...(command === "show" ? ["--query", "tags", "-o", "json"] : []),
  ], { shell: false, encoding: "utf8", timeout: 60_000 });
  const existence = query("exists");
  if (!existence.error && existence.status === 0 && existence.stdout.trim() === "false") {
    return { schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum };
  }
  if (existence.error || existence.status !== 0 || existence.stdout.trim() !== "true") {
    throw new MachineCommandError("migration-state-unavailable", "Cannot establish whether the target resource group exists; no files were changed.",
      { version, reason: existence.error?.message ?? existence.stderr }, "blocked");
  }
  const result = query("show");
  if (result.error || result.status !== 0) {
    throw new MachineCommandError("migration-state-unavailable", "Cannot prove that the migration is pending; Azure tag lookup failed. No files were changed.",
      { version, reason: result.error?.message ?? result.stderr }, "blocked");
  }
  let state: MigrationState;
  try {
    const tags: unknown = JSON.parse(result.stdout);
    const value = tags && typeof tags === "object" ? Reflect.get(tags, getMigrationTagKey(manifest.projectId)) : undefined;
    if (typeof value !== "string") throw new Error("Project migration tag is missing.");
    state = decodeMigrationState(value);
  } catch (error) {
    throw new MachineCommandError("migration-state-unavailable", "Cannot prove that the migration is pending; a valid project migration tag is required.",
      { version, reason: error instanceof Error ? error.message : String(error) }, "blocked");
  }
  selectPendingMigrations(manifest, state, projectRoot);
  if (state.version >= version) {
    throw new MachineCommandError("applied-migration-immutable", "This model container migration is already applied. Cosmos partition keys cannot be changed in place.",
      { version, appliedVersion: state.version }, "blocked");
  }
  const history = spawnSync("az", [
    "deployment", "group", "list", "--resource-group", target.resourceGroup,
    ...(target.subscription ? ["--subscription", target.subscription] : []),
    "-o", "json",
  ], { shell: false, encoding: "utf8", timeout: 60_000 });
  if (history.error || history.status !== 0) {
    throw new MachineCommandError("migration-deployment-history-unavailable", "Deployment history must be readable before refreshing a pending migration.",
      { version, reason: history.error?.message ?? history.stderr }, "blocked");
  }
  let deployments: Array<{ name: string; properties: { provisioningState: string } }>;
  try {
    const parsed: unknown = JSON.parse(history.stdout);
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item.name !== "string" ||
        typeof item.properties?.provisioningState !== "string")) throw new Error("Incomplete deployment history.");
    deployments = parsed;
  } catch {
    throw new MachineCommandError("migration-deployment-history-unavailable", "Azure returned incomplete deployment history; no files were changed.",
      { version }, "blocked");
  }
  const unsafe = deployments.filter(deployment => {
    if (deployment.name === "swallowkit-baseline") return deployment.properties.provisioningState !== "Succeeded";
    const match = /^swallowkit-migration-(\d{4,})$/.exec(deployment.name);
    return !match || Number(match[1]) > state.version || deployment.properties.provisioningState !== "Succeeded";
  });
  if (unsafe.length) {
    throw new MachineCommandError(
      "migration-deployment-attempted",
      "Deployment history cannot prove this migration was never attempted. A container may already exist even if its migration tag was not advanced. No files were changed.",
      { version, deployments: unsafe.map(deployment => ({ name: deployment.name, state: deployment.properties.provisioningState })) }, "blocked"
    );
  }
  return state;
}
