/**
 * Plan / Apply Provision — Azure プロビジョニングの事前計画と承認付き実行。
 *
 * - plan provision: Bicep と Azure の現在の状態を確認する。リソースは変更しない。
 * - apply provision: 常に承認(--approve)必須。承認なしでは requires-human で停止する。
 * - 対話的な `swallowkit provision` は同じ計画をメモリ上で作成・表示し、確認後に
 *   executeProvisionPlan で同じ安全確認を経て実行する(計画ファイルは保存しない)。
 */

import * as crypto from "crypto";
import * as fs from "fs";
import { AzCliAvailability, AzCliResult, checkAzCliAvailability, runAzCli, runAzCliAsync } from "../../utils/azure-cli";
import { AzureCliDiagnostic, azureCliDiagnostic, redactAzureText } from "../../utils/azure-diagnostics";
import * as path from "path";
import { MachineCommandError } from "../../machine/errors";
import type { MachineNextAction, MachineOperationStatus } from "../../machine/contracts";
import { getSwallowKitVersion } from "../../version";
import { inspectInfra, InfraInspection } from "../project/infra";
import { deletePlanState, listProvisionRuns, loadPlanState, loadProvisionRun, lockProvisionTarget, savePlanState, saveProvisionRun } from "../project/state";
import { hashFileIfExists } from "./file-session";
import {
  DEFAULT_PROVISION_WAIT_SECONDS, DEPLOYMENT_QUERY, DeploymentObservation, DeploymentReference,
  MAX_PROVISION_WAIT_SECONDS, queryAzureDeployment, queryDeploymentOperationErrors, waitForAzureDeployment,
} from "./provision-deployment";
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
  /** Attach an existing, matching baseline deployment without submitting Bicep again. */
  resumeDeployment?: string;
}

export type ProvisionMode = "offline" | "bootstrap" | "adoption-required" | "adopt" | "migrate" | "noop" | "reconcile" | "recover";

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
  recoveryDeployment?: DeploymentReference;
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
  if (options.resumeDeployment && (!/^[A-Za-z0-9._()-]{1,64}$/.test(options.resumeDeployment) || options.reconcile || options.adoptExisting)) {
    throw new MachineCommandError("invalid-arguments", "--resume-deployment requires a valid deployment name and cannot be combined with adoption or reconcile.", undefined, "blocked");
  }
}

function azCliUnavailableWarning(availability: Exclude<AzCliAvailability, { available: true }>): string {
  return availability.reason === "not-found"
    ? "az-cli-not-found: Azure CLI was not found on PATH. Install it (https://aka.ms/azure-cli) or add it to PATH, then try again."
    : `az-cli-not-runnable: Azure CLI was found but could not be started. ${availability.detail}`;
}

function displayCommand(command: ProvisionCommand): string {
  return [command.file, ...command.args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)].join(" ");
}

function runAz(args: string[], timeout = 60_000): AzCliResult {
  return runAzCli(args, { timeout });
}

function azQueryError(code: string, message: string, result: AzCliResult, secretValues: readonly string[] = []): MachineCommandError {
  const diagnostic = azureCliDiagnostic(result, "azure-state", secretValues);
  const output = (diagnostic.stderr || diagnostic.stdout).trim().slice(0, 2_000);
  if (/az login|not logged in|AADSTS|expired/i.test(output)) {
    return new MachineCommandError(
      "az-not-logged-in",
      `Azure CLI is not signed in (or the session expired). Run "az login", then try again.\n${output.slice(0, 1000)}`,
      { diagnostic },
      "requires-human"
    );
  }
  return new MachineCommandError(code, `${message}: ${output || result.errorCode || result.failureKind || `exit ${result.status}`}`, { diagnostic }, "blocked");
}

function subscriptionArgs(subscription?: string): string[] {
  return subscription ? ["--subscription", subscription] : [];
}

function buildBootstrapCommands(options: PlanProvisionOptions, mainBicepPath: string, parametersPath: string): ProvisionCommand[] {
  const commands: ProvisionCommand[] = [];
  commands.push({ file: "az", args: ["group", "create", "--name", options.resourceGroup, "--location", options.location, ...subscriptionArgs(options.subscription), "--query", "id", "-o", "json"], kind: "resource-group" });
  commands.push({
    file: "az",
    args: ["deployment", "group", "create", "--name", "swallowkit-baseline", "--resource-group", options.resourceGroup, "--template-file", mainBicepPath, "--parameters", parametersPath, "--parameters", `location=${options.location}`, `swaLocation=${options.swaLocation}`, ...subscriptionArgs(options.subscription), "--no-wait", "--query", DEPLOYMENT_QUERY, "-o", "json"],
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
  if (existsResult.status !== 0 || existsResult.failureKind || !/^(true|false)$/.test(existsResult.stdout.trim())) {
    throw azQueryError("azure-state-query-failed", "Could not query resource group", existsResult);
  }
  if ((existsResult.stdout || "").trim() !== "true") return { exists: false, tags: {} };
  const showResult = runAz(["group", "show", "--name", options.resourceGroup, ...subscriptionArgs(options.subscription), "--query", "{id:id,tags:tags}", "-o", "json"], 60_000);
  if (showResult.status !== 0 || showResult.failureKind || showResult.stdoutTruncated) {
    throw azQueryError("azure-state-query-failed", "Could not read resource group tags", showResult);
  }
  let parsed: { id?: string; tags?: Record<string, string> };
  try { parsed = JSON.parse(showResult.stdout); } catch {
    throw azQueryError("azure-state-query-failed", "Invalid resource group response", showResult);
  }
  if (!parsed || typeof parsed.id !== "string") {
    throw azQueryError("azure-state-query-failed", "Invalid resource group identity", showResult);
  }
  return { exists: true, id: parsed.id, tags: parsed.tags ?? {} };
}

function tagCommand(resourceId: string, key: string, state: MigrationState, expectedState: MigrationState | null): ProvisionCommand {
  return { file: "az", args: ["tag", "update", "--resource-id", resourceId, "--operation", "Merge", "--tags", `${key}=${encodeMigrationState(state)}`, "-o", "none"], kind: "tag", expectedState };
}

function bootstrapTagCommand(options: PlanProvisionOptions, key: string, state: MigrationState): ProvisionCommand {
  return { file: "az", args: ["group", "update", "--name", options.resourceGroup, "--set", `tags.${key}=${encodeMigrationState(state)}`, ...subscriptionArgs(options.subscription), "-o", "none"], kind: "tag", expectedState: null };
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
    throw azQueryError("what-if-failed", "az deployment group what-if failed", result);
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

function resolveSubscription(options: PlanProvisionOptions): string {
  if (options.subscription) return options.subscription;
  const result = runAz(["account", "show", "--query", "id", "-o", "tsv"]);
  const subscription = result.stdout.trim();
  if (result.status !== 0 || !SUBSCRIPTION_PATTERN.test(subscription)) {
    throw azQueryError("azure-subscription-query-failed", "Could not identify the Azure subscription for this provision run", result);
  }
  return subscription;
}

function canonicalTemplate(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "_generator")
        .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, normalize(entry)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

async function verifyExistingBaseline(
  options: PlanProvisionOptions,
  mainBicepPath: string,
  parametersPath: string
): Promise<DeploymentReference> {
  const projectRoot = path.dirname(path.dirname(mainBicepPath));
  const secretValues = provisionSecretValues({
    fingerprints: Object.fromEntries(collectLegacyBaselineFiles(projectRoot).map(file => [file.path, file.checksum])),
  }, projectRoot);
  const reference: DeploymentReference = {
    subscription: options.subscription!, resourceGroup: options.resourceGroup, name: options.resumeDeployment!,
  };
  const observation = await queryAzureDeployment(reference, { secretValues });
  if (observation.state === "unknown") {
    throw new MachineCommandError("recovery-deployment-unknown", "The existing deployment could not be identified. No Bicep will be submitted.", { deployment: observation }, "blocked");
  }
  const compiled = await runAzCliAsync(["bicep", "build", "--file", mainBicepPath, "--stdout"], { timeout: 60_000, captureBytes: 16_777_216 });
  const exported = await runAzCliAsync([
    "deployment", "group", "export", "--name", reference.name,
    "--resource-group", reference.resourceGroup, "--subscription", reference.subscription,
  ], { timeout: 60_000, captureBytes: 16_777_216 });
  const parameters = await runAzCliAsync([
    "deployment", "group", "show", "--name", reference.name, "--resource-group", reference.resourceGroup,
    "--subscription", reference.subscription, "--query", "properties.parameters", "-o", "json",
  ], { timeout: 30_000 });
  if ([compiled, exported, parameters].some((result) => result.status !== 0 || result.failureKind || result.stdoutTruncated)) {
    throw new MachineCommandError("recovery-evidence-unavailable", "Recovery requires the existing deployment template and parameters to match the local baseline. Evidence could not be read; nothing will be redeployed.", {
      diagnostics: [compiled, exported, parameters].map((result, index) => ({
        ...azureCliDiagnostic(result, ["local-bicep-build", "recovery-template", "recovery-parameters"][index], secretValues),
        stdout: "[template/parameter payload omitted]", stderr: "[template/parameter payload omitted]", outputTruncated: true,
      })),
    }, "blocked");
  }
  let template: Record<string, unknown>;
  let remoteParameters: Record<string, { type?: string; value?: unknown }>;
  let localParameters: Record<string, { value?: unknown }>;
  try {
    template = JSON.parse(compiled.stdout) as Record<string, unknown>;
    if (canonicalTemplate(template) !== canonicalTemplate(JSON.parse(exported.stdout))) {
      throw new MachineCommandError("recovery-template-mismatch", "The deployed ARM template differs from the local Bicep. Restore the matching reviewed files before recovery; do not redeploy to repair migration bookkeeping.", undefined, "blocked");
    }
    remoteParameters = JSON.parse(parameters.stdout) as Record<string, { type?: string; value?: unknown }>;
    localParameters = JSON.parse(fs.readFileSync(parametersPath, "utf-8")).parameters as Record<string, { value?: unknown }>;
    if (!remoteParameters || !localParameters || typeof remoteParameters !== "object" || typeof localParameters !== "object") throw new Error("Invalid parameters");
  } catch (error) {
    if (error instanceof MachineCommandError) throw error;
    throw new MachineCommandError("recovery-invalid-evidence", "Recovery template/parameter evidence is not valid JSON.", undefined, "blocked");
  }
  const declarations = template.parameters as Record<string, { type?: string }> | undefined;
  if (Object.values(declarations ?? {}).some((parameter) => /^secure/i.test(parameter.type ?? ""))) {
    throw new MachineCommandError("recovery-secure-parameters", "This untracked deployment has secure parameters that cannot be verified. Recovery requires the original execution checkpoint; no secret values will be requested or printed.", undefined, "blocked");
  }
  const expected = { ...localParameters, location: { value: options.location }, swaLocation: { value: options.swaLocation } };
  for (const [name, parameter] of Object.entries(expected)) {
    if (!parameter || !Object.prototype.hasOwnProperty.call(parameter, "value")
      || canonicalTemplate(parameter.value) !== canonicalTemplate(remoteParameters[name]?.value)) {
      throw new MachineCommandError("recovery-parameters-mismatch", "The deployed parameters differ from the local reviewed parameters/regions. No tag or ledger will be changed.", undefined, "blocked");
    }
  }
  return observation.reference;
}

/**
 * Builds the provision plan. Machine/MCP callers persist it for a later `apply provision --plan`;
 * the interactive `swallowkit provision` command keeps it in memory and executes it after confirmation.
 */
export async function planProvisionOperation(
  options: PlanProvisionOptions,
  planOptions: { persist?: boolean } = {}
): Promise<ProvisionPlanData> {
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

  const azCli = checkAzCliAvailability();
  const azCliAvailable = azCli.available;
  if (!azCli.available) {
    warnings.push(azCliUnavailableWarning(azCli));
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
  let recoveryDeployment: DeploymentReference | undefined;

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
    options = { ...options, subscription: resolveSubscription(options) };
    const unfinished = readRuns(projectRoot).find((run) =>
      run.outcome !== "succeeded" && run.outcome !== "failed" && run.plan.resourceGroup === options.resourceGroup
      && run.plan.subscription === options.subscription);
    if (unfinished) {
      throw new MachineCommandError(
        "provision-run-pending",
        `Provision run ${unfinished.runId} is unfinished. Inspect or resume that run instead of submitting Bicep again.`,
        { runId: unfinished.runId, outcome: unfinished.outcome },
        "blocked", provisionNextActions(unfinished.runId)
      );
    }
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
    if (options.resumeDeployment) {
      if (!remoteGroup.exists || manifest.baseline.legacy) {
        throw new MachineCommandError("recovery-baseline-required", "--resume-deployment requires an existing resource group and the original non-legacy baseline manifest.", undefined, "blocked");
      }
      const tagValue = remoteGroup.tags[migrationTagKey];
      remoteState = tagValue ? decodeMigrationState(tagValue) : null;
      if (remoteState && remoteState.version !== 0) {
        throw new MachineCommandError("recovery-baseline-only", "Untracked-deployment recovery supports baseline 0 only. Use the original checkpoint to resume migrations.", undefined, "blocked");
      }
      recoveryDeployment = await verifyExistingBaseline(options, mainBicepPath, parametersPath);
      const baselineFiles = collectLegacyBaselineFiles(projectRoot);
      manifestAfterApply = {
        ...manifest,
        baseline: { ...manifest.baseline, files: baselineFiles, checksum: computeBaselineChecksum(baselineFiles) },
      };
      if (remoteState && remoteState.checksum !== manifestAfterApply.baseline.checksum) {
        throw new MachineCommandError("recovery-checksum-mismatch", "The existing baseline tag does not match this project. Nothing will be overwritten.", undefined, "blocked");
      }
      mode = "recover";
      warnings.push("Recovery only observes the matching existing deployment, then records migration state after Azure Succeeded. It never submits Bicep.");
      commandSpecs = [{
        file: "az",
        args: ["deployment", "group", "show", "--name", recoveryDeployment.name, "--resource-group", options.resourceGroup, ...subscriptionArgs(options.subscription), "--query", DEPLOYMENT_QUERY, "-o", "json"],
        kind: "deployment",
      }, tagCommand(remoteGroup.id!, migrationTagKey, { schemaVersion: 1, version: 0, checksum: manifestAfterApply.baseline.checksum }, remoteState)];
    } else if (!remoteGroup.exists) {
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
          warnings.push("Explicit reconcile redeploys the untagged baseline. For an interrupted wait/tag/ledger update use --resume-deployment instead.");
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
              "--name", `swallowkit-migration-${migration.version}-${migration.checksum.slice(0, 12)}`,
              "--resource-group", options.resourceGroup,
              "--template-file", path.join(projectRoot, migration.template),
              ...(migration.parameters ? ["--parameters", path.join(projectRoot, migration.parameters)] : []),
              "--parameters", `projectName=${projectName}`, `location=${options.location}`,
              ...subscriptionArgs(options.subscription),
              "--no-wait", "--query", DEPLOYMENT_QUERY, "-o", "json",
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
  } else if (options.whatIf || options.adoptExisting || options.reconcile || options.resumeDeployment) {
    const detail = azCli.available ? "" : ` ${azCliUnavailableWarning(azCli)}`;
    throw new MachineCommandError(
      !azCli.available && azCli.reason === "not-runnable" ? "az-cli-not-runnable" : "az-cli-not-found",
      `Azure CLI is required for --what-if, --adopt-existing, --reconcile, and --resume-deployment.${detail}`,
      undefined,
      "blocked"
    );
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
        recoveryDeployment,
        nonce: crypto.randomUUID(),
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
    ...(recoveryDeployment ? { recoveryDeployment } : {}),
  };

  if (planOptions.persist !== false) savePlanState(plan, projectRoot);
  return plan;
}

export interface ApplyProvisionOptions {
  planId: string;
  approve?: boolean;
  waitSeconds?: number;
}

export interface ApplyProvisionResult {
  status: MachineOperationStatus;
  outcome: "succeeded" | "in-progress" | "unknown" | "partial" | "failed";
  runId: string;
  planId: string;
  resourceGroup: string;
  location: string;
  swaLocation: string;
  executedCommands: string[];
  warnings: string[];
  diagnostics: AzureCliDiagnostic[];
  deployment?: DeploymentObservation;
  nextActions: MachineNextAction[];
  interrupted?: NodeJS.Signals;
}

export interface ProvisionRun {
  schemaVersion: 1;
  runId: string;
  projectRoot: string;
  plan: ProvisionPlanData;
  cursor: number;
  attemptedIndex?: number;
  deployment?: DeploymentReference;
  observation?: DeploymentObservation;
  outcome: ApplyProvisionResult["outcome"];
  executedCommands: string[];
  warnings: string[];
  diagnostics: AzureCliDiagnostic[];
  updatedAt: string;
}

function statesEqual(left: MigrationState | null | undefined, right: MigrationState | null | undefined): boolean {
  return left?.version === right?.version && left?.checksum === right?.checksum;
}

const MACHINE_RETRY_HINT = "Re-run plan provision.";
export const INTERACTIVE_PROVISION_RETRY_HINT = 'Run "swallowkit provision" again to review the current state.';

export function provisionNextActions(runId: string): MachineNextAction[] {
  return [
    { command: `swallowkit machine inspect provision --plan ${runId}`, description: "Read the original Azure deployment state without creating, cancelling, deleting, tagging, or updating the ledger." },
    { command: `swallowkit machine apply provision --plan ${runId} --approve`, description: "After explicit human approval, resume this checkpoint: observe the original deployment and finish tags/ledger; never resubmit an attempted deployment." },
  ];
}

function resultForRun(run: ProvisionRun, outcome = run.outcome, interrupted?: NodeJS.Signals): ApplyProvisionResult {
  run.warnings = run.warnings.slice(-20);
  run.diagnostics = run.diagnostics.slice(-20);
  return {
    status: outcome === "succeeded" ? "complete" : outcome === "in-progress" ? "in-progress" : outcome === "failed" ? "failed" : "blocked",
    outcome, runId: run.runId, planId: run.plan.planId,
    resourceGroup: run.plan.resourceGroup, location: run.plan.location, swaLocation: run.plan.swaLocation,
    executedCommands: run.executedCommands, warnings: run.warnings, diagnostics: run.diagnostics,
    ...(run.observation ? { deployment: run.observation } : {}),
    nextActions: outcome === "succeeded"
      ? [{ command: "swallowkit machine inspect infra", description: "Inspect local infrastructure assets after deployment and migration bookkeeping completed." }]
      : provisionNextActions(run.runId),
    ...(interrupted ? { interrupted } : {}),
  };
}

function readRun(runId: string, projectRoot: string): ProvisionRun | null {
  let run: ProvisionRun | null;
  try { run = loadProvisionRun<ProvisionRun>(runId, projectRoot); } catch {
    throw new MachineCommandError("invalid-provision-checkpoint", "The execution checkpoint cannot be read. Do not re-submit Bicep; inspect the original deployment first.", { runId }, "blocked");
  }
  if (run && (run.schemaVersion !== 1 || run.runId !== runId || run.plan?.planId !== runId
    || run.projectRoot !== path.resolve(projectRoot) || !Number.isInteger(run.cursor)
    || !Array.isArray(run.plan.commandSpecs) || !run.plan.fingerprints
    || !Array.isArray(run.warnings) || !Array.isArray(run.diagnostics) || !Array.isArray(run.executedCommands)
    || !["succeeded", "in-progress", "unknown", "partial", "failed"].includes(run.outcome)
    || run.cursor < 0 || run.cursor > run.plan.commandSpecs.length)) {
    throw new MachineCommandError("invalid-provision-checkpoint", "The execution checkpoint is invalid or belongs to another checkout. Nothing will be re-submitted.", { runId }, "blocked");
  }
  return run;
}

function readRuns(projectRoot: string): ProvisionRun[] {
  try {
    return listProvisionRuns<ProvisionRun>(projectRoot).map(record => {
      if (!record || typeof record.runId !== "string") throw new Error("Invalid checkpoint identity.");
      const run = readRun(record.runId, projectRoot);
      if (!run) throw new Error("Missing execution checkpoint.");
      return run;
    });
  } catch (error) {
    if (error instanceof MachineCommandError) throw error;
    throw new MachineCommandError("invalid-provision-checkpoint", "An execution checkpoint is corrupt. Preserve it and inspect the original deployment; nothing will be re-submitted.", undefined, "blocked");
  }
}

function validateWaitSeconds(value = DEFAULT_PROVISION_WAIT_SECONDS): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PROVISION_WAIT_SECONDS) {
    throw new MachineCommandError("invalid-arguments", `--wait-seconds must be an integer from 0 to ${MAX_PROVISION_WAIT_SECONDS}.`, undefined, "blocked");
  }
  return value;
}

function assertLocalFiles(plan: ProvisionPlanData, projectRoot: string, retryHint: string, allowRecordedManifest = false): void {
  const changedFiles = Object.entries(plan.fingerprints).filter(([relativePath, expectedHash]) => {
    const file = path.join(projectRoot, relativePath);
    if (allowRecordedManifest && relativePath === MIGRATION_MANIFEST_PATH && plan.manifestAfterApply && fs.existsSync(file)
      && fs.readFileSync(file, "utf-8") === `${JSON.stringify(plan.manifestAfterApply, null, 2)}\n`) return false;
    return hashFileIfExists(file) !== expectedHash;
  }).map(([file]) => file);
  if (changedFiles.length || (plan.baselineSnapshotChecksum
    && computeBaselineChecksum(collectLegacyBaselineFiles(projectRoot)) !== plan.baselineSnapshotChecksum)) {
    throw new MachineCommandError("stale-plan", `${changedFiles.join(", ") || "Baseline infrastructure files"} changed after the preview was computed. ${retryHint}`, { planId: plan.planId, changedFiles }, "blocked");
  }
}

async function readMigrationState(plan: ProvisionPlanData, signal?: AbortSignal, secretValues: readonly string[] = []): Promise<{ group: RemoteGroupState; state: MigrationState | null }> {
  const exists = await runAzCliAsync(["group", "exists", "--name", plan.resourceGroup, ...subscriptionArgs(plan.subscription)], { timeout: 30_000, signal });
  if (exists.status !== 0 || exists.failureKind || !/^(true|false)$/.test(exists.stdout.trim())) {
    throw azQueryError("azure-state-query-failed", "Could not query resource group", exists, secretValues);
  }
  if (exists.stdout.trim() === "false") return { group: { exists: false, tags: {} }, state: null };
  const show = await runAzCliAsync(["group", "show", "--name", plan.resourceGroup, ...subscriptionArgs(plan.subscription), "--query", "{id:id,tags:tags}", "-o", "json"], { timeout: 30_000, signal });
  if (show.status !== 0 || show.failureKind || show.stdoutTruncated) throw azQueryError("azure-state-query-failed", "Could not read resource group tags", show, secretValues);
  let parsed: { id?: unknown; tags?: Record<string, string> };
  try { parsed = JSON.parse(show.stdout); } catch { throw azQueryError("azure-state-query-failed", "Invalid resource group response", show, secretValues); }
  const expectedId = `/subscriptions/${plan.subscription}/resourceGroups/${plan.resourceGroup}`;
  if (typeof parsed.id !== "string" || parsed.id.toLowerCase() !== expectedId.toLowerCase()) {
    throw new MachineCommandError("azure-resource-group-mismatch", "Azure returned a different resource group/subscription. Nothing will be updated.", undefined, "blocked");
  }
  const group = { exists: true, id: parsed.id, tags: parsed.tags ?? {} };
  const tag = plan.migrationTagKey ? group.tags[plan.migrationTagKey] : undefined;
  return { group, state: tag ? decodeMigrationState(tag) : null };
}

function desiredTagState(command: ProvisionCommand, key?: string): MigrationState {
  const value = command.args.find((arg) => arg.startsWith(`${key}=`) || arg.startsWith(`tags.${key}=`));
  if (!value) throw new MachineCommandError("incompatible-plan", "The reviewed migration tag is missing.", undefined, "blocked");
  return decodeMigrationState(value.slice(value.indexOf("=") + 1));
}

function provisionSecretValues(plan: Pick<ProvisionPlanData, "fingerprints">, projectRoot: string): string[] {
  const files = Object.keys(plan.fingerprints);
  const secureBicep = files.filter(file => file.endsWith(".bicep")).some(file => /@secure\s*\(/.test(fs.readFileSync(path.join(projectRoot, file), "utf-8")));
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string" && value) values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const file of files.filter(file => file.endsWith(".json") && file !== MIGRATION_MANIFEST_PATH)) {
    let parsed: { parameters?: Record<string, { value?: unknown }> };
    try { parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, file), "utf-8")); } catch {
      throw new MachineCommandError("invalid-infra-parameters", "Infrastructure JSON is invalid. Correct it before provision; unstructured Azure output cannot safely redact unknown parameter secrets.", undefined, "blocked");
    }
    for (const [name, parameter] of Object.entries(parsed.parameters ?? {})) {
      if (secureBicep || /secret|password|token|key|connection.?string/i.test(name)) collect(parameter?.value);
    }
  }
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function rememberDiagnostic(run: ProvisionRun, result: AzCliResult, phase: string, secretValues: readonly string[]): void {
  run.diagnostics.push(azureCliDiagnostic(result, phase, secretValues));
  run.diagnostics = run.diagnostics.slice(-20);
  if (result.stderr.trim()) {
    run.warnings.push(result.stderrTruncated ? "Azure CLI stderr exceeded the capture limit; output omitted." : redactAzureText(result.stderr, secretValues).slice(0, 4_000));
    run.warnings = run.warnings.slice(-20);
  }
}

export async function inspectProvisionOperation(options: { planId: string; waitSeconds?: number }): Promise<ApplyProvisionResult> {
  const run = readRun(options.planId, process.cwd());
  if (!run) throw new MachineCommandError("provision-run-not-found", "No execution checkpoint exists for this ID. For an older interrupted bootstrap use plan provision --resume-deployment <name> with the original resource group/subscription/regions.", { runId: options.planId }, "blocked");
  const waitSeconds = validateWaitSeconds(options.waitSeconds ?? 0);
  if (run.deployment) {
    let secretValues: string[] = [];
    let omitOutput = false;
    try {
      assertLocalFiles(run.plan, process.cwd(), "Reviewed files no longer match.", true);
      secretValues = provisionSecretValues(run.plan, process.cwd());
    } catch {
      omitOutput = true;
      run.warnings.push("Reviewed files are unavailable or changed; deployment state is still read, but diagnostic output/causes are omitted to avoid exposing unknown secrets.");
    }
    run.observation = await waitForAzureDeployment(run.deployment, { deadline: Date.now() + waitSeconds * 1_000, secretValues });
    if (omitOutput) {
      run.observation.errors = [];
      run.observation.diagnostic = { ...run.observation.diagnostic, stdout: "[output omitted: reviewed parameters unavailable]", stderr: "", outputTruncated: true };
    }
    run.diagnostics = [...run.diagnostics, run.observation.diagnostic].slice(-20);
    let outcome: ApplyProvisionResult["outcome"] = run.observation.state === "Failed" || run.observation.state === "Canceled" ? "failed"
      : run.observation.state === "Succeeded" ? run.outcome === "succeeded" ? "succeeded" : "partial"
        : run.observation.state === "unknown" ? "unknown" : "in-progress";
    if (outcome === "succeeded") {
      try {
        assertLocalFiles(run.plan, process.cwd(), "The original reviewed files no longer match.", true);
        const tag = [...run.plan.commandSpecs].reverse().find(command => command.kind === "tag");
        if (tag && !statesEqual((await readMigrationState(run.plan, undefined, secretValues)).state, desiredTagState(tag, run.plan.migrationTagKey))) {
          outcome = "partial";
          run.warnings.push("Azure Succeeded, but the completed run's migration tag no longer matches. No bookkeeping or deployment write was performed.");
        }
      } catch {
        outcome = "partial";
        run.warnings.push("Azure Succeeded, but current local files or migration bookkeeping could not be verified. No writes were performed.");
      }
    }
    return resultForRun(run, outcome);
  }
  return resultForRun(run);
}

export async function applyProvisionOperation(options: ApplyProvisionOptions): Promise<ApplyProvisionResult> {
  const projectRoot = process.cwd();
  const run = /^[a-f0-9]{12}$/.test(options.planId) ? readRun(options.planId, projectRoot) : null;
  const plan = run?.plan ?? loadPlanState<ProvisionPlanData>(options.planId, projectRoot);
  if (!plan) {
    throw new MachineCommandError(
      "plan-not-found",
      `Plan "${options.planId}" was not found. Run "plan provision" to create a new plan.`,
      { planId: options.planId },
      "blocked"
    );
  }

  const result = await executeProvisionPlan(plan, { approve: options.approve, waitSeconds: options.waitSeconds, retryHint: MACHINE_RETRY_HINT, projectRoot });
  if (result.status === "complete") {
    try { deletePlanState(plan.planId, projectRoot); } catch {
      result.warnings.push("Azure and migration bookkeeping completed, but the old preview could not be removed. The completed execution checkpoint prevents replay.");
    }
  }
  return result;
}

/**
 * Runs an approved provision plan with every safety check: local files and Azure state must still
 * match the reviewed preview, and each migration/tag step re-checks Azure state before it runs.
 */
export async function executeProvisionPlan(
  plan: ProvisionPlanData,
  options: { approve?: boolean; retryHint?: string; projectRoot?: string; waitSeconds?: number; signal?: AbortSignal; pollIntervalMs?: number } = {}
): Promise<ApplyProvisionResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const retryHint = options.retryHint ?? MACHINE_RETRY_HINT;
  const waitSeconds = validateWaitSeconds(options.waitSeconds);
  if (!options.approve) {
    throw new MachineCommandError(
      "approval-required",
      "Provisioning creates billable Azure resources and always requires human approval. Review plan.commands and re-run with --approve.",
      { planId: plan.planId, commands: plan.commands },
      "requires-human",
      [{ command: `swallowkit machine apply provision --plan ${plan.planId} --approve`, description: "Review the commands and obtain explicit human consent before applying or resuming." }]
    );
  }
  if (!plan.mode || !plan.commandSpecs) {
    throw new MachineCommandError("incompatible-plan", `This provision plan was created by an older SwallowKit version. ${retryHint}`, undefined, "blocked");
  }
  if (plan.mode === "offline") {
    throw new MachineCommandError(
      "online-plan-required",
      `Azure state was not read because Azure CLI was unavailable, so nothing can be applied. Make az available and signed in (az login). ${retryHint}`,
      { planId: plan.planId, warnings: plan.warnings },
      "blocked"
    );
  }

  if (plan.mode === "adoption-required") {
    throw new MachineCommandError(
      "adoption-required",
      'This resource group has no migration tag. Recover a matching existing baseline with --resume-deployment <name>; adoption applies only to a legacy manifest. Do not reconcile just to repair bookkeeping.',
      { planId: plan.planId },
      "requires-human"
    );
  }
  let run = readRun(plan.planId, projectRoot);
  const resuming = run !== null;
  if (run) plan = run.plan;
  try {
    assertLocalFiles(plan, projectRoot, run ? "Restore the original reviewed files before resuming this checkpoint; do not resubmit Bicep." : retryHint, run?.cursor === plan.commandSpecs.length);
  } catch (error) {
    if (run && error instanceof MachineCommandError) {
      throw new MachineCommandError(error.code, error.message, { ...resultForRun(run), cause: error.details }, error.status, provisionNextActions(run.runId));
    }
    throw error;
  }
  const secretValues = provisionSecretValues(plan, projectRoot);
  if (!plan.subscription || plan.commandSpecs.some((command) => (command.kind === "deployment" || command.kind === "migration")
    && !plan.recoveryDeployment && !command.args.includes("--no-wait"))) {
    throw new MachineCommandError("incompatible-plan", `Create a fresh preview with bounded deployment tracking. For an older interrupted deployment use --resume-deployment instead of resubmitting Bicep. ${retryHint}`, undefined, "blocked");
  }
  const azCli = checkAzCliAvailability();
  if (!azCli.available) {
    throw new MachineCommandError(azCli.reason === "not-found" ? "az-cli-not-found" : "az-cli-not-runnable", azCliUnavailableWarning(azCli), undefined, "blocked");
  }

  const targetKey = crypto.createHash("sha256").update(`${plan.subscription}/${plan.resourceGroup.toLowerCase()}`).digest("hex");
  let unlock: () => void;
  try { unlock = lockProvisionTarget(targetKey, projectRoot); } catch (error) {
    throw new MachineCommandError("provision-target-locked", error instanceof Error ? error.message : "Provision target is locked.", { runId: plan.planId }, "blocked", provisionNextActions(plan.planId));
  }
  const controller = new AbortController();
  let interrupted: NodeJS.Signals | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = signal;
    controller.abort();
  };
  const sigint = () => interrupt("SIGINT");
  const sigterm = () => interrupt("SIGTERM");
  const externalAbort = () => controller.abort();
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const signal = controller.signal;
  const deadline = Date.now() + waitSeconds * 1_000;
  const persist = () => {
    if (!run) return;
    run.warnings = run.warnings.slice(-20);
    run.diagnostics = run.diagnostics.slice(-20);
    run.updatedAt = new Date().toISOString();
    saveProvisionRun(run, projectRoot);
  };
  const pause = (outcome: ApplyProvisionResult["outcome"], warning: string) => {
    run!.outcome = outcome;
    run!.warnings.push(warning);
    persist();
    return resultForRun(run!, outcome, interrupted);
  };
  const observe = async () => {
    const observation = await waitForAzureDeployment(run!.deployment!, {
      deadline: signal.aborted ? Date.now() : deadline,
      // A final short read after Ctrl+C must not inherit the aborted wait signal.
      ...(signal.aborted ? {} : { signal }),
      ...(signal.aborted ? { queryTimeoutMs: 5_000 } : {}),
      pollIntervalMs: options.pollIntervalMs,
      secretValues,
      onObservation: (value) => {
        run!.observation = value;
        if (value.state !== "unknown") run!.deployment = value.reference;
        persist();
      },
    });
    run!.observation = observation;
    run!.diagnostics.push(observation.diagnostic);
    run!.diagnostics = run!.diagnostics.slice(-20);
    return observation;
  };
  try {
    if (!run) {
      const unfinished = readRuns(projectRoot).find((other) =>
        other.outcome !== "succeeded" && other.outcome !== "failed"
        && other.plan.resourceGroup === plan.resourceGroup && other.plan.subscription === plan.subscription);
      if (unfinished) throw new MachineCommandError("provision-run-pending", "Resume the existing execution checkpoint instead of creating another deployment.", { runId: unfinished.runId }, "blocked", provisionNextActions(unfinished.runId));
      const current = await readMigrationState(plan, signal, secretValues);
      if (plan.mode === "bootstrap" ? current.group.exists : !current.group.exists || !statesEqual(current.state, plan.remoteState)) {
        throw new MachineCommandError("stale-azure-state", plan.mode === "bootstrap"
          ? `The resource group was created after the preview was computed. ${retryHint}`
          : `Azure migration state changed after the preview was computed. ${retryHint}`, { expected: plan.remoteState, actual: current.state }, "blocked");
      }
      const checkpointPlan = { ...plan };
      delete checkpointPlan.whatIfResult;
      run = {
        schemaVersion: 1, runId: plan.planId, projectRoot: path.resolve(projectRoot), plan: checkpointPlan,
        cursor: 0, outcome: "in-progress", executedCommands: [], warnings: [...plan.warnings], diagnostics: [],
        updatedAt: new Date().toISOString(),
      };
      persist();
    }
    for (; run.cursor < plan.commandSpecs.length;) {
      if (signal.aborted) return pause(run.observation?.state === "Succeeded" ? "partial" : "unknown", "Local provisioning was interrupted. Azure may continue; use status/resume. No Azure cancel/delete was requested and the ledger is not marked successful.");
      assertLocalFiles(plan, projectRoot, "Restore the original reviewed files before resuming; do not resubmit Bicep.");
      const command = plan.commandSpecs[run.cursor];
      if (command.kind === "deployment" || command.kind === "migration") {
        if (command.kind === "migration" && run.attemptedIndex !== run.cursor && run.observation?.state === "Succeeded" && Date.now() >= deadline) {
          return pause("partial", "The bounded wait budget ended before the next reviewed migration. Resume this checkpoint after approval; completed deployments will not be re-submitted.");
        }
        if (run.attemptedIndex !== run.cursor) {
          let observationOnly = Boolean(plan.recoveryDeployment);
          if (plan.recoveryDeployment) {
            run.deployment = plan.recoveryDeployment;
          } else {
            const current = await readMigrationState(plan, signal, secretValues);
            if (!current.group.exists || !statesEqual(current.state, command.expectedState ?? plan.remoteState)) {
              throw new MachineCommandError("stale-azure-state", `Azure migration state changed before deployment. ${retryHint}`, { expected: command.expectedState ?? plan.remoteState, actual: current.state }, "blocked");
            }
            const name = command.args[command.args.indexOf("--name") + 1];
            const reference: DeploymentReference = { name, resourceGroup: plan.resourceGroup, subscription: plan.subscription! };
            const previous = await queryAzureDeployment(reference, { signal, secretValues });
            if (previous.state === "unknown" && previous.reason !== "not-found") {
              run.deployment = reference;
              run.observation = previous;
              return pause("unknown", "The deployment name could not be checked before submission. No create request was sent; inspect the original deployment before proceeding.");
            }
            if (previous.state !== "unknown" && (plan.mode !== "reconcile" || previous.state === "Running" || previous.state === "Accepted")) {
              run.deployment = previous.reference;
              run.observation = previous;
              if (!resuming || command.kind !== "deployment") {
                return pause("unknown", "A deployment already exists under the reviewed name. No create request was sent. Resume only after matching its template/parameters; do not overwrite or re-submit it.");
              }
              run.deployment = await verifyExistingBaseline({ ...plan, resumeDeployment: name },
                path.join(projectRoot, "infra", "main.bicep"), path.join(projectRoot, "infra", "main.parameters.json"));
              observationOnly = true;
            } else {
              run.deployment = {
                ...reference,
                ...(previous.state !== "unknown" ? { previousCorrelationId: previous.reference.correlationId } : {}),
              };
            }
          }
          // Persist intent before spawn: even a hard process termination must never replay this create.
          run.attemptedIndex = run.cursor;
          persist();
          if (!observationOnly) {
            const result = await runAzCliAsync(command.args, { timeout: 60_000, signal });
            run.executedCommands.push(displayCommand(command));
            rememberDiagnostic(run, result, command.kind === "migration" ? "migration-submit" : "baseline-submit", secretValues);
            persist();
          }
        }
        const observation = await observe();
        if (signal.aborted) return pause(observation.state === "Succeeded" ? "partial" : observation.state === "Running" || observation.state === "Accepted" ? "in-progress" : "unknown", "Local provisioning was interrupted. Azure may continue. The original deployment is tracked; no cancellation or successful ledger update was performed.");
        if (observation.state === "Failed" || observation.state === "Canceled") {
          const operations = await queryDeploymentOperationErrors(observation.reference, secretValues, signal);
          observation.errors.push(...operations.errors);
          run.diagnostics.push(operations.diagnostic);
          run.outcome = "failed";
          persist();
          throw new MachineCommandError("azure-deployment-failed",
            `Azure deployment ${observation.reference.name} is ${observation.state}.${observation.errors.length ? `\n${observation.errors.map((error) => `${error.code}: ${error.message}`).join("\n")}` : " Azure did not return a structured cause; inspect deployment operations."}`,
            resultForRun(run), "failed", provisionNextActions(run.runId));
        }
        if (observation.state !== "Succeeded") {
          return pause(observation.state === "unknown" ? "unknown" : "in-progress",
            observation.state === "unknown" ? `Azure deployment result is unknown (${observation.reason}); a local az error is not proof that Azure failed. No create will be automatically retried.`
              : `Azure deployment is ${observation.state}. The bounded local wait ended; status/resume tracks the same deployment without submitting Bicep again.`);
        }
      } else if (command.kind === "tag") {
        if (run.deployment) {
          const observation = await queryAzureDeployment(run.deployment, { signal, secretValues });
          run.observation = observation;
          if (observation.state !== "Succeeded") return pause("partial", "Azure Succeeded was previously observed, but its identity/terminal state could not be confirmed before migration tagging. No tag or ledger update was performed.");
        }
        const current = await readMigrationState(plan, signal, secretValues);
        const desired = desiredTagState(command, plan.migrationTagKey);
        if (!current.group.exists) throw new MachineCommandError("stale-azure-state", "The resource group disappeared before tagging.", undefined, "blocked");
        if (!statesEqual(current.state, desired)) {
          if (!statesEqual(current.state, command.expectedState)) {
            throw new MachineCommandError("stale-azure-state", `Azure migration state changed before its tag could be updated. ${retryHint}`, { expected: command.expectedState, actual: current.state }, "blocked");
          }
          run.attemptedIndex = run.cursor;
          persist();
          const result = await runAzCliAsync(command.args, { timeout: 60_000, signal });
          run.executedCommands.push(displayCommand(command));
          rememberDiagnostic(run, result, "migration-tag", secretValues);
          if (result.status !== 0 || result.failureKind || signal.aborted) {
            return pause("partial", "Azure deployment succeeded, but migration tagging did not complete locally. Resume this checkpoint to verify/finish tagging; do not redeploy the baseline.");
          }
          const after = await readMigrationState(plan, signal, secretValues);
          if (!statesEqual(after.state, desired)) return pause("partial", "The tag update returned successfully but its version/checksum could not be confirmed. Resume bookkeeping without redeploying Bicep.");
        }
      } else {
        const current = await readMigrationState(plan, signal, secretValues);
        if (run.attemptedIndex === run.cursor) {
          if (!current.group.exists) return pause("unknown", "Resource group creation was attempted, but its result is unknown. Inspect the target before resuming; nothing will be re-created automatically.");
        } else {
          if (current.group.exists) throw new MachineCommandError("stale-azure-state", `The resource group was created after the preview was computed. ${retryHint}`, undefined, "blocked");
          run.attemptedIndex = run.cursor;
          persist();
          const result = await runAzCliAsync(command.args, { timeout: 60_000, signal });
          run.executedCommands.push(displayCommand(command));
          rememberDiagnostic(run, result, "resource-group-create", secretValues);
          if (result.status !== 0 || result.failureKind || signal.aborted) return pause("unknown", "Local resource-group creation did not complete. Azure may have accepted it; inspect/resume this checkpoint, not a new bootstrap.");
        }
      }
      run.cursor++;
      delete run.attemptedIndex;
      persist();
    }
    if (signal.aborted) return pause("partial", "Local provisioning was interrupted before ledger completion. Resume bookkeeping; no deployment will be submitted again.");
    assertLocalFiles(plan, projectRoot, "Restore the reviewed files before completing the local ledger.", true);
    const finalTag = [...plan.commandSpecs].reverse().find((command) => command.kind === "tag");
    if (finalTag) {
      const current = await readMigrationState(plan, signal, secretValues);
      if (!statesEqual(current.state, desiredTagState(finalTag, plan.migrationTagKey))) return pause("partial", "The final remote migration version/checksum changed before local ledger completion. No ledger success was recorded.");
    }
    if (run.deployment) {
      run.observation = await queryAzureDeployment(run.deployment, { signal, secretValues });
      if (run.observation.state !== "Succeeded") return pause("partial", "The original deployment identity/terminal state could not be confirmed before local ledger completion. No successful ledger update was performed.");
    }
    if (plan.manifestAfterApply && run.outcome !== "succeeded") replaceMigrationManifest(plan.manifestAfterApply, projectRoot);
    run.outcome = "succeeded";
    persist();
    return resultForRun(run);
  } catch (error) {
    if (!run) throw error;
    if (error instanceof MachineCommandError && error.code === "azure-deployment-failed") throw error;
    run.outcome = run.observation?.state === "Succeeded" ? "partial" : "unknown";
    run.warnings.push(`Provisioning stopped: ${redactAzureText(error instanceof Error ? error.message : "Unknown local error", secretValues)}. Azure deployment and local bookkeeping are separate; inspect/resume this checkpoint.`);
    try { persist(); } catch {
      run.warnings.push("The checkpoint could not be updated. Preserve the existing checkpoint; inspect the original Azure deployment before any further write.");
    }
    if (error instanceof MachineCommandError) {
      throw new MachineCommandError(error.code, error.message, { ...resultForRun(run), cause: error.details }, error.status ?? "blocked", provisionNextActions(run.runId));
    }
    return resultForRun(run, run.outcome, interrupted);
  } finally {
    process.removeListener("SIGINT", sigint);
    process.removeListener("SIGTERM", sigterm);
    options.signal?.removeEventListener("abort", externalAbort);
    try { unlock(); } catch {
      run?.warnings.push("The local execution lock could not be removed. Inspect its owner before retrying; Azure deployment/ledger results are unchanged.");
      console.warn("Provision lock cleanup failed; inspect the checkpoint before another apply.");
    }
  }
}
