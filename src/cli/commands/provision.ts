import { Command, Option } from "commander";
import prompts from "prompts";
import { ensureSwallowKitProject } from "../../core/config";
import {
  INTERACTIVE_PROVISION_RETRY_HINT,
  ApplyProvisionResult,
  ProvisionPlanData,
  applyProvisionOperation,
  executeProvisionPlan,
  inspectProvisionOperation,
  planProvisionOperation,
} from "../../core/operations/provision-operations";
import { MachineCommandError } from "../../machine/errors";
import { formatAzureDiagnostic } from "../../utils/azure-diagnostics";
import { runAzCliAsync } from "../../utils/azure-cli";

function humanProvisionMessage(message: string): string {
  return message
    .replace(/swallowkit machine inspect provision --plan/g, "swallowkit provision --status")
    .replace(/swallowkit machine apply provision --plan/g, "swallowkit provision --resume")
    .replace(/plan provision/g, "swallowkit provision")
    .replace(/\b[Pp]lan\b/g, "Execution")
    .replace(/preview/g, "deployment preparation")
    .replace(/after approval/g, "")
    .replace(/--approve/g, "")
    .replace(/ {2,}/g, " ");
}

export function formatProvisionError(error: unknown): string {
  if (!(error instanceof MachineCommandError)) return error instanceof Error ? error.message : String(error);
  const message = error.code === "azure-deployment-failed" ? error.message : humanProvisionMessage(error.message);
  const lines = [...new Set(message.split("\n"))];
  const details = error.details as Partial<ApplyProvisionResult> | undefined;
  if (details?.deployment) {
    lines.push(`Deployment: ${details.deployment.reference.name}; state: ${details.deployment.state}`);
  }
  for (const diagnostic of details?.diagnostics ?? []) {
    if (diagnostic.failureKind || diagnostic.outputTruncated) lines.push(formatAzureDiagnostic(diagnostic));
  }
  const runId = details?.runId;
  if (runId) {
    lines.push(`Check: swallowkit provision --status ${runId}`);
    if (error.code !== "azure-deployment-failed") lines.push(`Resume: swallowkit provision --resume ${runId}`);
    else lines.push("Azure reported a terminal failure. Resuming only observes that failed deployment; correct its cause before explicitly deploying again.");
  } else {
    for (const action of error.nextActions ?? []) {
      const command = humanProvisionMessage(action.command);
      if (!command.includes("machine ")) lines.push(command);
    }
  }
  return lines.join("\n");
}

async function printProvisionSetup(result: ApplyProvisionResult): Promise<void> {
  if (!result.deployment || result.status !== "complete") return;
  const reference = result.deployment.reference;
  const fields = ["staticWebAppName", "staticWebAppUrl", "functionsAppName", "functionsAppUrl", "cosmosDbAccountName", "cosmosDatabaseName"] as const;
  let outputs: Record<string, unknown>;
  try {
    const response = await runAzCliAsync(
      [
        "deployment",
        "group",
        "show",
        "--name",
        reference.name.startsWith("swallowkit-migration-") ? "swallowkit-baseline" : reference.name,
        "--resource-group",
        reference.resourceGroup,
        "--subscription",
        reference.subscription,
        "--query",
        `{${fields.map((field) => `${field}:properties.outputs.${field}.value`).join(",")}}`,
        "-o",
        "json",
      ],
      { timeout: 30_000 }
    );
    if (response.status !== 0 || response.failureKind || response.stdoutTruncated) throw new Error("Output query did not complete.");
    const parsed: unknown = JSON.parse(response.stdout);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid resource output.");
    outputs = parsed as Record<string, unknown>;
  } catch {
    console.warn(
      "Deployment succeeded, but resource information could not be read. Inspect the deployment's named outputs in Azure Portal; do not redeploy just to retrieve them."
    );
    return;
  }
  console.log("\nResource information:");
  for (const field of fields) {
    if (typeof outputs[field] === "string") console.log(`  ${field}: ${outputs[field]}`);
  }
  console.log("\nCI/CD settings:");
  console.log(`  AZURE_FUNCTIONAPP_NAME: ${typeof outputs.functionsAppName === "string" ? outputs.functionsAppName : "<functions-app-name>"}`);
  console.log("  Retrieve AZURE_STATIC_WEB_APPS_API_TOKEN and AZURE_FUNCTIONAPP_PUBLISH_PROFILE privately from Azure Portal and save them in your CI/CD secrets.");
  console.log("  Secret values are not printed or stored by SwallowKit. Trigger the first application deployment after configuring CI/CD.");
}

export function describeProvisionAction(plan: Pick<ProvisionPlanData, "mode" | "resourceGroup" | "location" | "pendingMigrations">): string {
  switch (plan.mode) {
    case "bootstrap":
      return `Resource group ${plan.resourceGroup} does not exist yet. It will be created in ${plan.location} and the infrastructure in infra/main.bicep will be deployed.`;
    case "migrate":
      return `${plan.pendingMigrations.length} infrastructure migration(s) will be deployed to ${plan.resourceGroup}: ${plan.pendingMigrations.map((migration) => `${migration.version}-${migration.slug}`).join(", ")}.`;
    case "adopt":
      return `The existing resource group ${plan.resourceGroup} will be recorded as SwallowKit baseline 0. Nothing will be deployed.`;
    case "reconcile":
      return `infra/main.bicep will be redeployed to ${plan.resourceGroup}. Template-managed settings may be reset.`;
    case "recover":
      return `The existing baseline deployment in ${plan.resourceGroup} will be observed and its migration tag/ledger completed after Azure Succeeded. Bicep will not be submitted again.`;
    default:
      return `Resource group ${plan.resourceGroup}:`;
  }
}

const PRIMARY_REGIONS = [
  { title: "Japan East (japaneast)", value: "japaneast" },
  { title: "Japan West (japanwest)", value: "japanwest" },
  { title: "East Asia (eastasia)", value: "eastasia" },
  { title: "Southeast Asia (southeastasia)", value: "southeastasia" },
  { title: "East US (eastus)", value: "eastus" },
  { title: "East US 2 (eastus2)", value: "eastus2" },
  { title: "West US 2 (westus2)", value: "westus2" },
  { title: "Central US (centralus)", value: "centralus" },
  { title: "West Europe (westeurope)", value: "westeurope" },
];

const SWA_REGIONS = [
  { title: "East Asia (eastasia) - Recommended for Japan", value: "eastasia" },
  { title: "West US 2 (westus2)", value: "westus2" },
  { title: "Central US (centralus)", value: "centralus" },
  { title: "East US 2 (eastus2)", value: "eastus2" },
  { title: "West Europe (westeurope)", value: "westeurope" },
];

interface ProvisionCliOptions {
  resourceGroup?: string;
  subscription?: string;
  location?: string;
  swaLocation?: string;
  whatIf?: boolean;
  adoptExisting?: boolean;
  baseline?: string;
  reconcile?: boolean;
  approve?: boolean;
  resume?: string;
  status?: string;
  resumeDeployment?: string;
  waitSeconds?: string;
}

export function formatProvisionResult(result: ApplyProvisionResult): string {
  const outcome =
    result.outcome === "succeeded"
      ? "✅ Provisioning completed, including migration tags and the local ledger."
      : result.outcome === "in-progress"
        ? "⏳ Azure deployment is still in progress. The local wait ended; this is not an Azure failure."
        : result.outcome === "partial"
          ? "⚠️ Provisioning is partially complete. Finish migration bookkeeping from the checkpoint; do not redeploy the baseline."
          : result.outcome === "failed"
            ? "❌ Azure deployment reached a failed/cancelled terminal state."
            : "⚠️ Azure deployment result is unknown. A local az interruption does not prove an Azure failure.";
  const lines = [outcome, `Resource group: ${result.resourceGroup}`];
  if (result.deployment) {
    const reference = result.deployment.reference;
    lines.push(`Deployment: ${reference.name}; subscription: ${reference.subscription}; state: ${result.deployment.state}${reference.id ? `; ID: ${reference.id}` : ""}`);
    for (const error of result.deployment.errors) lines.push(`${error.code}: ${error.message}`);
  }
  for (const warning of result.warnings) lines.push(`Warning: ${humanProvisionMessage(warning)}`);
  for (const diagnostic of result.diagnostics.filter((entry) => entry.failureKind || entry.outputTruncated)) {
    lines.push(formatAzureDiagnostic(diagnostic));
  }
  if (result.status !== "complete") {
    lines.push(`Check status: swallowkit provision --status ${result.runId}`);
    if (result.outcome !== "failed") lines.push(`Resume and wait until completion: swallowkit provision --resume ${result.runId}`);
    if (result.outcome !== "failed") lines.push("Azure may continue after Ctrl+C or process termination. No Azure cancellation or deletion is performed.");
    else lines.push("Azure reported a terminal failure. Correct its cause before explicitly deploying again; resuming does not repair a failed deployment.");
  }
  return lines.join("\n");
}

async function resolveLocations(options: ProvisionCliOptions): Promise<{ location: string; swaLocation: string }> {
  if (options.location && options.swaLocation) {
    return { location: options.location, swaLocation: options.swaLocation };
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Non-interactive provision requires --location and --swa-location.");
  }
  const answer = await prompts([
    {
      type: options.location ? null : "select",
      name: "location",
      message: "Primary location for Functions and Cosmos DB",
      choices: PRIMARY_REGIONS,
      initial: 0,
    },
    {
      type: options.swaLocation ? null : "select",
      name: "swaLocation",
      message: "Static Web App location",
      choices: SWA_REGIONS,
      initial: 0,
    },
  ]);
  const location = options.location ?? answer.location;
  const swaLocation = options.swaLocation ?? answer.swaLocation;
  if (!location || !swaLocation) throw new Error("Region selection cancelled.");
  return { location, swaLocation };
}

export function createProvisionCommand(): Command {
  return new Command("provision")
    .description("Deploy Azure infrastructure and show resource information and CI/CD setup")
    .option("-g, --resource-group <name>", "Resource group name (required for deployment)")
    .option("--subscription <id>", "Azure subscription ID")
    .option("--location <region>", "Primary location for Functions and Cosmos DB")
    .option("--swa-location <region>", "Static Web App location")
    .option("--what-if", "Check Azure what-if before deployment", false)
    .option("--adopt-existing", "Adopt an existing untagged resource group without deploying main.bicep", false)
    .option("--baseline <version>", "Baseline version for adoption (currently 0)")
    .option("--reconcile", "Explicitly redeploy infra/main.bicep", false)
    .addOption(new Option("--approve", "Compatibility option; invoking provision already requests execution").hideHelp())
    .option("--status <runId>", "Read an existing execution checkpoint and Azure deployment state without writes")
    .option("--resume <runId>", "Continue the original execution without resubmitting attempted deployments")
    .option("--resume-deployment <name>", "Recover an older untracked baseline deployment after verifying its template and parameters")
    .addOption(new Option("--wait-seconds <seconds>", "Optional limit on waiting, 0-3600 seconds (default: wait until Azure finishes; status: 0)").hideHelp())
    .action(async (options: ProvisionCliOptions) => {
      try {
        ensureSwallowKitProject("provision");
        const waitSeconds = options.waitSeconds === undefined ? undefined : Number(options.waitSeconds);
        if (
          (options.resume && options.status) ||
          ((options.resume || options.status) &&
            (options.resourceGroup ||
              options.resumeDeployment ||
              options.reconcile ||
              options.adoptExisting ||
              options.subscription ||
              options.location ||
              options.swaLocation ||
              options.whatIf ||
              options.baseline !== undefined))
        ) {
          throw new MachineCommandError(
            "invalid-arguments",
            "Use --status or --resume with the checkpoint ID alone; its original Azure target and reviewed files are preserved.",
            undefined,
            "blocked"
          );
        }
        if (options.status) {
          const result = await inspectProvisionOperation({
            planId: options.status,
            waitSeconds,
          });
          console.log(formatProvisionResult(result));
          if (result.status === "blocked" || result.status === "failed") process.exitCode = 1;
          return;
        }
        if (options.resume) {
          const result = await applyProvisionOperation({
            planId: options.resume,
            approve: true,
            waitSeconds,
            waitUntilComplete: waitSeconds === undefined,
          });
          console.log(formatProvisionResult(result));
          await printProvisionSetup(result);
          if (result.status === "blocked" || result.status === "failed") process.exitCode = 1;
          return;
        }
        if (!options.resourceGroup) throw new MachineCommandError("invalid-arguments", "Provision requires --resource-group.", undefined, "blocked");
        const locations = await resolveLocations(options);
        const baseline = options.baseline === undefined ? undefined : Number(options.baseline);
        // Preview in memory: the same Azure checks as the agent workflow, but no saved plan file.
        const preview = await planProvisionOperation(
          {
            resourceGroup: options.resourceGroup,
            subscription: options.subscription,
            location: locations.location,
            swaLocation: locations.swaLocation,
            whatIf: options.whatIf,
            adoptExisting: options.adoptExisting,
            baseline,
            reconcile: options.reconcile,
            resumeDeployment: options.resumeDeployment,
          },
          { persist: false }
        );

        for (const warning of preview.warnings) console.warn(`Warning: ${warning}`);

        if (preview.mode === "offline") {
          console.log(
            [
              "",
              "❌ Azure CLI is unavailable, so the current state of Azure could not be checked. Nothing was changed in Azure.",
              "   1. Make sure `az --version` works in this terminal (install: https://aka.ms/azure-cli).",
              "   2. Sign in with `az login` (and `az account set --subscription <id>` if needed).",
              "   3. Run this command again.",
            ].join("\n")
          );
          process.exitCode = 1;
          return;
        }

        if (preview.mode === "adoption-required") {
          throw new Error(
            "The existing resource group has no migration tag. For an interrupted baseline use --resume-deployment <original-name> to verify/observe it without redeploying. Legacy adoption applies only to a legacy manifest; do not replace an existing manifest."
          );
        }

        if (preview.mode === "noop") {
          console.log(`Resource group ${preview.resourceGroup} is already up to date. Nothing to do.`);
          return;
        }

        console.log(`\n${describeProvisionAction(preview)}`);
        console.log("Deploying Azure infrastructure. Azure resources may incur charges.");
        console.log("Waiting for the Azure deployment to finish. This often takes 10-20 minutes; resource information and CI/CD settings are shown when it completes.");

        const result = await executeProvisionPlan(preview, {
          approve: true,
          retryHint: INTERACTIVE_PROVISION_RETRY_HINT,
          waitSeconds,
          waitUntilComplete: waitSeconds === undefined,
        });
        console.log(formatProvisionResult(result));
        await printProvisionSetup(result);
        if (result.status === "blocked" || result.status === "failed") process.exitCode = 1;
      } catch (error) {
        throw new Error(formatProvisionError(error));
      }
    });
}

export const provisionCommand = createProvisionCommand();
