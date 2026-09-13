/**
 * Plan / Apply Provision — Azure プロビジョニングの事前計画と承認付き実行。
 *
 * - plan provision: ローカルの決定論的プリフライト(Bicep 解析・az CLI 有無)のみ。
 *   ネットワークアクセスや az login を必要とする操作は行わない。
 *   --what-if を明示した場合のみ az deployment group what-if を実行する。
 * - apply provision: 常に承認(--approve)必須。承認なしでは requires-human で停止する。
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { MachineCommandError } from "../../machine/errors";
import { getSwallowKitVersion } from "../../version";
import { inspectInfra, InfraInspection } from "../project/infra";
import { deletePlanState, loadPlanState, savePlanState } from "../project/state";
import { hashFileIfExists } from "./file-session";
import {
  MIGRATION_MANIFEST_PATH,
  MigrationManifest,
  MigrationState,
  ResolvedMigration,
  checksumAtVersion,
  collectLegacyBaselineFiles,
  computeBaselineChecksum,
  decodeMigrationState,
  encodeMigrationState,
  findBaselineDrift,
  getMigrationTagKey,
  loadMigrationManifest,
  replaceMigrationManifest,
  resolveMigrations,
  selectPendingMigrations,
} from "../project/migrations";

const RESOURCE_GROUP_PATTERN = /^[A-Za-z0-9._()-]{1,90}$/;
const LOCATION_PATTERN = /^[a-z0-9]{3,30}$/;
const SUBSCRIPTION_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface PlanProvisionOptions {
  resourceGroup: string;
  location: string;
  swaLocation: string;
  subscription?: string;
  /** 明示指定時のみ az deployment group what-if を実行(az login 済みが前提) */
  whatIf?: boolean;
  adoptExisting?: boolean;
  baseline?: number;
  reconcile?: boolean;
}

export type ProvisionMode = "offline" | "bootstrap" | "adoption-required" | "adopt" | "migrate" | "noop" | "reconcile";

interface ProvisionCommand {
  file: "az";
  args: string[];
  kind: "resource-group" | "deployment" | "migration" | "tag";
  expectedState?: MigrationState | null;
}

export interface ProvisionPlanData {
  planId: string;
  planType: "provision";
  resourceGroup: string;
  location: string;
  swaLocation: string;
  subscription?: string;
  createdAt: string;
  swallowkitVersion: string;
  azCliAvailable: boolean;
  mode: ProvisionMode;
  infra: InfraInspection;
  /** apply 時に実行されるコマンド(レビュー用) */
  commands: string[];
  commandSpecs: ProvisionCommand[];
  migrationTagKey?: string;
  remoteState?: MigrationState | null;
  pendingMigrations: ResolvedMigration[];
  manifestAfterApply?: MigrationManifest;
  whatIfResult?: string;
  warnings: string[];
  /** provision は常に人間の承認が必要 */
  requiresApproval: true;
  fingerprints: Record<string, string | null>;
  baselineSnapshotChecksum?: string;
}

function validateProvisionInputs(options: PlanProvisionOptions): void {
  if (!RESOURCE_GROUP_PATTERN.test(options.resourceGroup)) {
    throw new MachineCommandError(
      "invalid-arguments",
      `Invalid resource group name: ${options.resourceGroup}`,
      undefined,
      "failed"
    );
  }
  if (!LOCATION_PATTERN.test(options.location) || !LOCATION_PATTERN.test(options.swaLocation)) {
    throw new MachineCommandError(
      "invalid-arguments",
      "Locations must be lowercase Azure region names (e.g. japaneast, eastasia).",
      undefined,
      "failed"
    );
  }
  if (options.subscription && !SUBSCRIPTION_PATTERN.test(options.subscription)) {
    throw new MachineCommandError(
      "invalid-arguments",
      "Subscription must be a GUID.",
      undefined,
      "failed"
    );
  }
}

function isAzCliAvailable(): boolean {
  try {
    const result = spawnSync("az", ["--version"], { shell: false, stdio: "ignore", timeout: 30_000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

function displayCommand(command: ProvisionCommand): string {
  return [command.file, ...command.args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)].join(" ");
}

interface AzResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runAz(args: string[], timeout = 300_000): AzResult {
  const result = spawnSync("az", args, { shell: false, encoding: "utf-8", timeout });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function subscriptionArgs(subscription?: string): string[] {
  return subscription ? ["--subscription", subscription] : [];
}

function buildBootstrapCommands(options: PlanProvisionOptions, mainBicepPath: string, parametersPath: string): ProvisionCommand[] {
  const commands: ProvisionCommand[] = [];
  commands.push({ file: "az", args: ["group", "create", "--name", options.resourceGroup, "--location", options.location, ...subscriptionArgs(options.subscription)], kind: "resource-group" });
  commands.push({
    file: "az",
    args: ["deployment", "group", "create", "--name", "swallowkit-baseline", "--resource-group", options.resourceGroup, "--template-file", mainBicepPath, "--parameters", parametersPath, "--parameters", `location=${options.location}`, `swaLocation=${options.swaLocation}`, ...subscriptionArgs(options.subscription)],
    kind: "deployment",
  });
  return commands;
}

function readProjectName(parametersPath: string): string {
  try {
    const parameters = JSON.parse(fs.readFileSync(parametersPath, "utf-8"));
    const projectName = parameters?.parameters?.projectName?.value;
    if (typeof projectName === "string" && /^[A-Za-z0-9-]+$/.test(projectName)) return projectName;
  } catch {
    // The caller reports the same actionable error for malformed and missing values.
  }
  throw new MachineCommandError("invalid-infra-parameters", "infra/main.parameters.json must define parameters.projectName.value.", undefined, "blocked");
}

interface RemoteGroupState {
  exists: boolean;
  id?: string;
  tags: Record<string, string>;
}

function inspectRemoteGroup(options: PlanProvisionOptions): RemoteGroupState {
  const existsResult = runAz(["group", "exists", "--name", options.resourceGroup, ...subscriptionArgs(options.subscription)], 60_000);
  if (existsResult.status !== 0) {
    throw new MachineCommandError("azure-state-query-failed", `Could not query resource group: ${(existsResult.stderr || existsResult.stdout || "").trim()}`, undefined, "blocked");
  }
  if ((existsResult.stdout || "").trim() !== "true") return { exists: false, tags: {} };
  const showResult = runAz(["group", "show", "--name", options.resourceGroup, ...subscriptionArgs(options.subscription), "--query", "{id:id,tags:tags}", "-o", "json"], 60_000);
  if (showResult.status !== 0) {
    throw new MachineCommandError("azure-state-query-failed", `Could not read resource group tags: ${(showResult.stderr || showResult.stdout || "").trim()}`, undefined, "blocked");
  }
  const parsed = JSON.parse(showResult.stdout || "{}");
  return { exists: true, id: parsed.id, tags: parsed.tags ?? {} };
}

function tagCommand(resourceId: string, key: string, state: MigrationState, expectedState: MigrationState | null): ProvisionCommand {
  return { file: "az", args: ["tag", "update", "--resource-id", resourceId, "--operation", "Merge", "--tags", `${key}=${encodeMigrationState(state)}`], kind: "tag", expectedState };
}

function bootstrapTagCommand(options: PlanProvisionOptions, key: string, state: MigrationState): ProvisionCommand {
  return { file: "az", args: ["group", "update", "--name", options.resourceGroup, "--set", `tags.${key}=${encodeMigrationState(state)}`, ...subscriptionArgs(options.subscription)], kind: "tag", expectedState: null };
}

function runBaseWhatIf(options: PlanProvisionOptions, mainBicepPath: string, parametersPath: string): string {
  const result = runAz([
    "deployment", "group", "what-if",
    "--resource-group", options.resourceGroup,
    "--template-file", mainBicepPath,
    "--parameters", parametersPath,
    "--parameters", `location=${options.location}`, `swaLocation=${options.swaLocation}`,
    ...subscriptionArgs(options.subscription),
    "--result-format", "FullResourcePayloads",
    "--no-pretty-print",
    "-o", "json",
  ]);
  if (result.status !== 0) {
    throw new MachineCommandError("what-if-failed", `az deployment group what-if failed: ${(result.stderr || result.stdout).trim().slice(0, 2000)}`, undefined, "blocked");
  }
  return result.stdout.trim();
}

function assertAdoptionWhatIfIsSafe(whatIfResult: string): void {
  try {
    const parsed = JSON.parse(whatIfResult) as { changes?: Array<{ changeType?: string; resourceId?: string }> };
    const destructive = (parsed.changes ?? []).filter((change) => change.changeType === "Create" || change.changeType === "Delete");
    if (destructive.length > 0) {
      throw new MachineCommandError(
        "adoption-drift-blocked",
        "Legacy adoption found resources that would be created or deleted. Move undeployed additions into migrations before adopting this environment.",
        { changes: destructive },
        "blocked"
      );
    }
  } catch (error) {
    if (error instanceof MachineCommandError) throw error;
    throw new MachineCommandError("what-if-invalid", "Azure what-if did not return valid JSON for legacy adoption.", undefined, "blocked");
  }
}

export async function planProvisionOperation(options: PlanProvisionOptions): Promise<ProvisionPlanData> {
  const projectRoot = process.cwd();
  validateProvisionInputs(options);

  const infra = inspectInfra(projectRoot);
  const warnings = [...infra.warnings];

  if (!infra.mainBicep.exists) {
    throw new MachineCommandError(
      "infra-not-found",
      'infra/main.bicep not found. Run "swallowkit init" to generate infrastructure files.',
      undefined,
      "blocked"
    );
  }
  if (!infra.parametersFile.exists) {
    warnings.push("infra/main.parameters.json not found; deployment will fail until it is created.");
  }

  const azCliAvailable = isAzCliAvailable();
  if (!azCliAvailable) {
    warnings.push("az-cli-not-found: Azure CLI is not installed. Install it before applying: https://aka.ms/azure-cli");
  }

  const mainBicepPath = path.join(projectRoot, "infra", "main.bicep");
  const parametersPath = path.join(projectRoot, "infra", "main.parameters.json");
  let mode: ProvisionMode = "offline";
  let commandSpecs: ProvisionCommand[] = buildBootstrapCommands(options, mainBicepPath, parametersPath);
  let pendingMigrations: ResolvedMigration[] = [];
  let migrationTagKey: string | undefined;
  let remoteState: MigrationState | null | undefined;
  let whatIfResult: string | undefined;
  let manifestAfterApply: MigrationManifest | undefined;
  let baselineDrift: string[] = [];

  const manifestPath = path.join(projectRoot, MIGRATION_MANIFEST_PATH);
  const manifest = fs.existsSync(manifestPath) ? loadMigrationManifest(projectRoot) : null;
  if (manifest) {
    for (const migration of manifest.migrations) {
      const files = [migration.template, migration.parameters].filter((value): value is string => Boolean(value));
      for (const relativePath of files) {
        if (!fs.existsSync(path.join(projectRoot, relativePath))) {
          throw new MachineCommandError("migration-file-not-found", `Migration file not found: ${relativePath}`, undefined, "blocked");
        }
      }
    }
    baselineDrift = findBaselineDrift(manifest, projectRoot);
  }

  if (azCliAvailable) {
    const remoteGroup = inspectRemoteGroup(options);
    if (!manifest) {
      if (remoteGroup.exists) {
        throw new MachineCommandError(
          "migration-manifest-not-found",
          'Existing Azure resources require migration tracking. Run "swallowkit migrations init --legacy-baseline" first.',
          undefined,
          "blocked"
        );
      }
      throw new MachineCommandError("migration-manifest-not-found", "Initialize a migration manifest before the first provision.", undefined, "blocked");
    }

    migrationTagKey = getMigrationTagKey(manifest.projectId);
    if (!remoteGroup.exists) {
      mode = "bootstrap";
      const baselineFiles = collectLegacyBaselineFiles(projectRoot);
      manifestAfterApply = {
        ...manifest,
        baseline: { ...manifest.baseline, files: baselineFiles, checksum: computeBaselineChecksum(baselineFiles) },
      };
      const baselineState: MigrationState = { schemaVersion: 1, version: 0, checksum: manifestAfterApply.baseline.checksum };
      commandSpecs = [...buildBootstrapCommands(options, mainBicepPath, parametersPath), bootstrapTagCommand(options, migrationTagKey, baselineState)];
      if (options.whatIf) warnings.push("what-if-skipped: Resource-group-scope what-if requires the target resource group to exist.");
    } else {
      if (baselineDrift.length > 0 && !options.reconcile) {
        throw new MachineCommandError(
          "baseline-drift",
          "Baseline infrastructure files changed after migration tracking was initialized. Move additive changes into a migration or use --reconcile for an intentional full deployment.",
          { changedFiles: baselineDrift },
          "blocked"
        );
      }
      const tagValue = remoteGroup.tags[migrationTagKey];
      remoteState = tagValue ? decodeMigrationState(tagValue) : null;
      if (!remoteState) {
        mode = "adoption-required";
        commandSpecs = [];
        if (options.reconcile && !manifest.baseline.legacy) {
          whatIfResult = runBaseWhatIf(options, mainBicepPath, parametersPath);
          warnings.push("Recovering an interrupted bootstrap by reconciling the baseline before recording migration state.");
          mode = "reconcile";
          const baselineFiles = collectLegacyBaselineFiles(projectRoot);
          manifestAfterApply = {
            ...manifest,
            baseline: { ...manifest.baseline, files: baselineFiles, checksum: computeBaselineChecksum(baselineFiles) },
          };
          commandSpecs = buildBootstrapCommands(options, mainBicepPath, parametersPath).filter((command) => command.kind !== "resource-group");
          commandSpecs.push(tagCommand(
            remoteGroup.id!,
            migrationTagKey,
            { schemaVersion: 1, version: 0, checksum: manifestAfterApply.baseline.checksum },
            null
          ));
        } else if (options.adoptExisting) {
          if (options.baseline !== 0) {
            throw new MachineCommandError("invalid-baseline", "Legacy adoption currently supports only --baseline 0.", undefined, "blocked");
          }
          if (!options.whatIf) {
            throw new MachineCommandError("adoption-what-if-required", "Legacy adoption requires --what-if before the baseline tag can be recorded.", undefined, "requires-human");
          }
          if (!manifest.baseline.legacy) {
            throw new MachineCommandError("invalid-baseline", "--adopt-existing requires a manifest created with migrations init --legacy-baseline.", undefined, "blocked");
          }
          whatIfResult = runBaseWhatIf(options, mainBicepPath, parametersPath);
          assertAdoptionWhatIfIsSafe(whatIfResult);
          warnings.push("Legacy adoption records the current environment as baseline 0 without deploying main.bicep. Review all Modify results before approval.");
          mode = "adopt";
          commandSpecs = [tagCommand(remoteGroup.id!, migrationTagKey, { schemaVersion: 1, version: 0, checksum: manifest.baseline.checksum }, null)];
        }
      } else if (options.reconcile) {
        selectPendingMigrations(manifest, remoteState, projectRoot);
        mode = "reconcile";
        warnings.push("Reconcile redeploys infra/main.bicep and may reset template-managed properties such as Function App settings.");
        whatIfResult = runBaseWhatIf(options, mainBicepPath, parametersPath);
        commandSpecs = buildBootstrapCommands(options, mainBicepPath, parametersPath).filter((command) => command.kind !== "resource-group");
        const baselineFiles = collectLegacyBaselineFiles(projectRoot);
        manifestAfterApply = {
          ...manifest,
          baseline: { ...manifest.baseline, files: baselineFiles, checksum: computeBaselineChecksum(baselineFiles) },
        };
        const reconciledState: MigrationState = {
          schemaVersion: 1,
          version: remoteState.version,
          checksum: checksumAtVersion(manifestAfterApply, remoteState.version, projectRoot),
        };
        commandSpecs.push(tagCommand(remoteGroup.id!, migrationTagKey, reconciledState, remoteState));
      } else {
        pendingMigrations = selectPendingMigrations(manifest, remoteState, projectRoot);
        mode = pendingMigrations.length > 0 ? "migrate" : "noop";
        commandSpecs = [];
        const projectName = pendingMigrations.length > 0 ? readProjectName(parametersPath) : "";
        let expectedState = remoteState;
        for (const migration of pendingMigrations) {
          commandSpecs.push({
            file: "az",
            args: [
              "deployment", "group", "create",
              "--name", "swallowkit-migration",
              "--resource-group", options.resourceGroup,
              "--template-file", path.join(projectRoot, migration.template),
              ...(migration.parameters ? ["--parameters", path.join(projectRoot, migration.parameters)] : []),
              "--parameters", `projectName=${projectName}`, `location=${options.location}`,
              ...subscriptionArgs(options.subscription),
            ],
            kind: "migration",
            expectedState,
          });
          const nextState = { schemaVersion: 1 as const, version: migration.version, checksum: migration.cumulativeChecksum };
          commandSpecs.push(tagCommand(remoteGroup.id!, migrationTagKey, nextState, expectedState));
          expectedState = nextState;
        }
      }
    }
  } else if (options.whatIf || options.adoptExisting || options.reconcile) {
    throw new MachineCommandError("az-cli-not-found", "Azure CLI is required for --what-if, --adopt-existing, and --reconcile.", undefined, "blocked");
  }

  const fingerprints: Record<string, string | null> = {
    "infra/main.bicep": hashFileIfExists(mainBicepPath),
    "infra/main.parameters.json": hashFileIfExists(parametersPath),
  };
  const baselineSnapshotChecksum = manifest
    ? computeBaselineChecksum(collectLegacyBaselineFiles(projectRoot))
    : undefined;
  if (manifest) {
    fingerprints[MIGRATION_MANIFEST_PATH] = hashFileIfExists(manifestPath);
    for (const baselineFile of manifest.baseline.files) {
      fingerprints[baselineFile.path] = hashFileIfExists(path.join(projectRoot, baselineFile.path));
    }
    for (const migration of manifest.migrations) {
      fingerprints[migration.template] = hashFileIfExists(path.join(projectRoot, migration.template));
      if (migration.parameters) fingerprints[migration.parameters] = hashFileIfExists(path.join(projectRoot, migration.parameters));
    }
  }

  const planId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        resourceGroup: options.resourceGroup,
        location: options.location,
        swaLocation: options.swaLocation,
        subscription: options.subscription,
        mode,
        remoteState,
        pendingMigrations: pendingMigrations.map((migration) => ({ version: migration.version, checksum: migration.checksum })),
        baselineSnapshotChecksum,
        fingerprints,
      })
    )
    .digest("hex")
    .slice(0, 12);

  const plan: ProvisionPlanData = {
    planId,
    planType: "provision",
    resourceGroup: options.resourceGroup,
    location: options.location,
    swaLocation: options.swaLocation,
    ...(options.subscription ? { subscription: options.subscription } : {}),
    createdAt: new Date().toISOString(),
    swallowkitVersion: getSwallowKitVersion(),
    azCliAvailable,
    mode,
    infra,
    commands: commandSpecs.map(displayCommand),
    commandSpecs,
    ...(migrationTagKey ? { migrationTagKey } : {}),
    ...(remoteState !== undefined ? { remoteState } : {}),
    pendingMigrations,
    ...(manifestAfterApply ? { manifestAfterApply } : {}),
    ...(whatIfResult !== undefined ? { whatIfResult } : {}),
    warnings,
    requiresApproval: true,
    fingerprints,
    ...(baselineSnapshotChecksum ? { baselineSnapshotChecksum } : {}),
  };

  savePlanState(plan, projectRoot);
  return plan;
}

export interface ApplyProvisionOptions {
  planId: string;
  approve?: boolean;
}

export interface ApplyProvisionResult {
  planId: string;
  resourceGroup: string;
  location: string;
  swaLocation: string;
  executedCommands: string[];
  deploymentOutputs?: Record<string, unknown>;
  warnings: string[];
}

function statesEqual(left: MigrationState | null | undefined, right: MigrationState | null | undefined): boolean {
  return left?.version === right?.version && left?.checksum === right?.checksum;
}

function readRemoteMigrationState(plan: ProvisionPlanData): { group: RemoteGroupState; state: MigrationState | null } {
  const group = inspectRemoteGroup(plan);
  if (!group.exists || !plan.migrationTagKey) return { group, state: null };
  const tagValue = group.tags[plan.migrationTagKey];
  return { group, state: tagValue ? decodeMigrationState(tagValue) : null };
}

function assertPlanRemoteState(plan: ProvisionPlanData, expected: MigrationState | null | undefined): void {
  if (plan.mode === "offline") return;
  const current = readRemoteMigrationState(plan);
  if (plan.mode === "bootstrap") {
    if (current.group.exists) {
      throw new MachineCommandError("stale-azure-state", "The resource group was created after this plan. Re-run plan provision.", undefined, "blocked");
    }
    return;
  }
  if (!current.group.exists || !statesEqual(current.state, expected)) {
    throw new MachineCommandError(
      "stale-azure-state",
      "Azure migration state changed after this plan was created. Re-run plan provision.",
      { expected, actual: current.state, resourceGroupExists: current.group.exists },
      "blocked"
    );
  }
}

function assertTagExpectedState(plan: ProvisionPlanData, expected: MigrationState | null | undefined): void {
  const current = readRemoteMigrationState(plan);
  if (!current.group.exists || !statesEqual(current.state, expected)) {
    throw new MachineCommandError(
      "stale-azure-state",
      "Azure migration state changed before its tag could be updated. Re-run plan provision.",
      { expected, actual: current.state, resourceGroupExists: current.group.exists },
      "blocked"
    );
  }
}

export async function applyProvisionOperation(options: ApplyProvisionOptions): Promise<ApplyProvisionResult> {
  const projectRoot = process.cwd();

  const plan = loadPlanState<ProvisionPlanData>(options.planId, projectRoot);
  if (!plan) {
    throw new MachineCommandError(
      "plan-not-found",
      `Plan "${options.planId}" was not found. Run "plan provision" to create a new plan.`,
      { planId: options.planId },
      "blocked"
    );
  }

  // Bicep が plan 後に変更されていないか確認
  const changedFiles: string[] = [];
  for (const [relativePath, expectedHash] of Object.entries(plan.fingerprints)) {
    const currentHash = hashFileIfExists(path.join(projectRoot, relativePath));
    if (currentHash !== expectedHash) changedFiles.push(relativePath);
  }
  if (changedFiles.length > 0) {
    throw new MachineCommandError(
      "stale-plan",
      `Plan "${options.planId}" is stale: ${changedFiles.join(", ")} changed after the plan was created. Re-run "plan provision".`,
      { planId: options.planId, changedFiles },
      "blocked"
    );
  }
  if (plan.baselineSnapshotChecksum) {
    const currentBaselineChecksum = computeBaselineChecksum(collectLegacyBaselineFiles(projectRoot));
    if (currentBaselineChecksum !== plan.baselineSnapshotChecksum) {
      throw new MachineCommandError(
        "stale-plan",
        `Plan "${options.planId}" is stale: baseline infrastructure inventory changed after the plan was created.`,
        { planId: options.planId },
        "blocked"
      );
    }
  }

  if (!options.approve) {
    throw new MachineCommandError(
      "approval-required",
      "Provisioning creates billable Azure resources and always requires human approval. Review plan.commands and re-run with --approve.",
      { planId: plan.planId, commands: plan.commands },
      "requires-human"
    );
  }
  if (!plan.mode || !plan.commandSpecs) {
    throw new MachineCommandError("incompatible-plan", "This provision plan was created by an older SwallowKit version. Re-run plan provision.", undefined, "blocked");
  }
  if (plan.mode === "offline") {
    throw new MachineCommandError("online-plan-required", "Provision apply requires a fresh plan created while Azure CLI is available and authenticated.", undefined, "blocked");
  }

  if (plan.mode === "adoption-required") {
    throw new MachineCommandError(
      "adoption-required",
      'This existing resource group has no SwallowKit migration state. Re-plan with --adopt-existing --baseline 0 --what-if.',
      { planId: plan.planId },
      "requires-human"
    );
  }

  if (!isAzCliAvailable()) {
    throw new MachineCommandError(
      "az-cli-not-found",
      "Azure CLI is not installed. Install it first: https://aka.ms/azure-cli",
      undefined,
      "blocked"
    );
  }

  const executedCommands: string[] = [];
  const warnings = [...plan.warnings];
  let deploymentOutputs: Record<string, unknown> | undefined;

  assertPlanRemoteState(plan, plan.remoteState);

  for (const command of plan.commandSpecs) {
    if (command.kind === "migration") {
      assertPlanRemoteState(plan, command.expectedState);
    }
    if (command.kind === "tag") {
      assertTagExpectedState(plan, command.expectedState);
    }
    const result = runAz(command.args);
    const commandText = displayCommand(command);
    executedCommands.push(commandText);
    if (result.status !== 0) {
      throw new MachineCommandError(
        "provision-failed",
        `Command failed: ${commandText}\n${(result.stderr || result.stdout).trim().slice(0, 4000)}`,
        { executedCommands },
        "failed"
      );
    }
    if (command.kind === "deployment" || command.kind === "migration") {
      try {
        const deployment = JSON.parse(result.stdout || "{}");
        deploymentOutputs = deployment.properties?.outputs;
      } catch {
        warnings.push("Could not parse deployment output JSON.");
      }
    }
  }

  if (plan.manifestAfterApply) {
    replaceMigrationManifest(plan.manifestAfterApply, projectRoot);
  }
  deletePlanState(plan.planId, projectRoot);

  return {
    planId: plan.planId,
    resourceGroup: plan.resourceGroup,
    location: plan.location,
    swaLocation: plan.swaLocation,
    executedCommands,
    ...(deploymentOutputs ? { deploymentOutputs } : {}),
    warnings,
  };
}
