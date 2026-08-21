/**
 * Plan / Apply Provision — Azure プロビジョニングの事前計画と承認付き実行。
 *
 * - plan provision: ローカルの決定論的プリフライト(Bicep 解析・az CLI 有無)のみ。
 *   ネットワークアクセスや az login を必要とする操作は行わない。
 *   --what-if を明示した場合のみ az deployment group what-if を実行する。
 * - apply provision: 常に承認(--approve)必須。承認なしでは requires-human で停止する。
 */

import * as crypto from "crypto";
import * as path from "path";
import { spawnSync } from "child_process";
import { MachineCommandError } from "../../machine/errors";
import { getSwallowKitVersion } from "../../version";
import { inspectInfra, InfraInspection } from "../project/infra";
import { deletePlanState, loadPlanState, savePlanState } from "../project/state";
import { hashFileIfExists } from "./file-session";

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
  infra: InfraInspection;
  /** apply 時に実行されるコマンド(レビュー用) */
  commands: string[];
  whatIfResult?: string;
  warnings: string[];
  /** provision は常に人間の承認が必要 */
  requiresApproval: true;
  fingerprints: Record<string, string | null>;
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
    const result = spawnSync("az", ["--version"], { shell: true, stdio: "ignore", timeout: 30_000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

function buildProvisionCommands(options: PlanProvisionOptions, mainBicepPath: string, parametersPath: string): string[] {
  const commands: string[] = [];
  if (options.subscription) {
    commands.push(`az account set --subscription ${options.subscription}`);
  }
  commands.push(`az group create --name ${options.resourceGroup} --location ${options.location}`);
  commands.push(
    `az deployment group create --resource-group ${options.resourceGroup} --template-file "${mainBicepPath}" --parameters "${parametersPath}" --parameters location=${options.location} --parameters swaLocation=${options.swaLocation}`
  );
  return commands;
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
  const commands = buildProvisionCommands(options, mainBicepPath, parametersPath);

  let whatIfResult: string | undefined;
  if (options.whatIf) {
    if (!azCliAvailable) {
      throw new MachineCommandError(
        "az-cli-not-found",
        "Azure CLI is required for --what-if. Install it first: https://aka.ms/azure-cli",
        undefined,
        "blocked"
      );
    }
    const whatIfArgs = [
      "deployment", "group", "what-if",
      "--resource-group", options.resourceGroup,
      "--template-file", `"${mainBicepPath}"`,
      "--parameters", `"${parametersPath}"`,
      "--parameters", `location=${options.location}`,
      "--parameters", `swaLocation=${options.swaLocation}`,
      "--no-pretty-print",
    ];
    const result = spawnSync("az", whatIfArgs, { shell: true, encoding: "utf-8", timeout: 300_000 });
    if (result.status !== 0) {
      throw new MachineCommandError(
        "what-if-failed",
        `az deployment group what-if failed: ${(result.stderr || result.stdout || "").trim().slice(0, 2000)}`,
        undefined,
        "blocked"
      );
    }
    whatIfResult = (result.stdout || "").trim();
  }

  const fingerprints: Record<string, string | null> = {
    "infra/main.bicep": hashFileIfExists(mainBicepPath),
    "infra/main.parameters.json": hashFileIfExists(parametersPath),
  };

  const planId = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        resourceGroup: options.resourceGroup,
        location: options.location,
        swaLocation: options.swaLocation,
        subscription: options.subscription,
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
    infra,
    commands,
    ...(whatIfResult !== undefined ? { whatIfResult } : {}),
    warnings,
    requiresApproval: true,
    fingerprints,
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

  if (!options.approve) {
    throw new MachineCommandError(
      "approval-required",
      "Provisioning creates billable Azure resources and always requires human approval. Review plan.commands and re-run with --approve.",
      { planId: plan.planId, commands: plan.commands },
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

  for (const command of plan.commands) {
    const result = spawnSync(command, [], { shell: true, encoding: "utf-8" });
    executedCommands.push(command);
    if (result.status !== 0) {
      throw new MachineCommandError(
        "provision-failed",
        `Command failed: ${command}\n${(result.stderr || result.stdout || "").trim().slice(0, 4000)}`,
        { executedCommands },
        "failed"
      );
    }
    if (command.includes("deployment group create")) {
      try {
        const deployment = JSON.parse(result.stdout || "{}");
        deploymentOutputs = deployment.properties?.outputs;
      } catch {
        warnings.push("Could not parse deployment output JSON.");
      }
    }
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
