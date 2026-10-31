import { Command } from "commander";
import prompts from "prompts";
import { ensureSwallowKitProject } from "../../core/config";
import {
  INTERACTIVE_PROVISION_RETRY_HINT,
  ProvisionPlanData,
  executeProvisionPlan,
  planProvisionOperation,
} from "../../core/operations/provision-operations";

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
  resourceGroup: string;
  subscription?: string;
  location?: string;
  swaLocation?: string;
  whatIf?: boolean;
  adoptExisting?: boolean;
  baseline?: string;
  reconcile?: boolean;
  approve?: boolean;
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

export const provisionCommand = new Command("provision")
  .description("Bootstrap, adopt, migrate, or explicitly reconcile Azure resources")
  .requiredOption("-g, --resource-group <name>", "Resource group name")
  .option("--subscription <id>", "Azure subscription ID")
  .option("--location <region>", "Primary location for Functions and Cosmos DB")
  .option("--swa-location <region>", "Static Web App location")
  .option("--what-if", "Include Azure what-if evidence in the preview", false)
  .option("--adopt-existing", "Adopt an existing untagged resource group without deploying main.bicep", false)
  .option("--baseline <version>", "Baseline version for adoption (currently 0)")
  .option("--reconcile", "Explicitly redeploy infra/main.bicep", false)
  .option("--approve", "Run the displayed Azure commands without the confirmation prompt", false)
  .action(async (options: ProvisionCliOptions) => {
    ensureSwallowKitProject("provision");
    const locations = await resolveLocations(options);
    const baseline = options.baseline === undefined ? undefined : Number(options.baseline);
    // Preview in memory: the same Azure checks as the agent workflow, but no saved plan file.
    const preview = await planProvisionOperation({
      resourceGroup: options.resourceGroup,
      subscription: options.subscription,
      location: locations.location,
      swaLocation: locations.swaLocation,
      whatIf: options.whatIf,
      adoptExisting: options.adoptExisting,
      baseline,
      reconcile: options.reconcile,
    }, { persist: false });

    for (const warning of preview.warnings) console.warn(`Warning: ${warning}`);

    if (preview.mode === "offline") {
      console.log([
        "",
        "❌ Azure CLI is unavailable, so the current state of Azure could not be checked. Nothing was changed in Azure.",
        "   1. Make sure `az --version` works in this terminal (install: https://aka.ms/azure-cli).",
        "   2. Sign in with `az login` (and `az account set --subscription <id>` if needed).",
        "   3. Run this command again.",
      ].join("\n"));
      process.exitCode = 1;
      return;
    }

    if (preview.mode === "adoption-required") {
      throw new Error('Existing resource group requires: migrations init --legacy-baseline, then provision --adopt-existing --baseline 0 --what-if.');
    }

    if (preview.mode === "noop") {
      console.log(`Resource group ${preview.resourceGroup} is already up to date. Nothing to do.`);
      return;
    }

    console.log(`\n${describeProvisionAction(preview)}`);
    console.log("The following Azure CLI commands will run:");
    for (const command of preview.commands) console.log(`  ${command}`);

    let approved = options.approve === true;
    if (!approved) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("Non-interactive provision requires --approve after reviewing the commands above.");
      }
      const answer = await prompts({
        type: "confirm",
        name: "approved",
        message: "Run these Azure commands? This may create billable resources.",
        initial: false,
      });
      approved = answer.approved === true;
    }
    if (!approved) {
      console.log("Provision cancelled. Nothing was changed in Azure.");
      return;
    }

    const result = await executeProvisionPlan(preview, { approve: true, retryHint: INTERACTIVE_PROVISION_RETRY_HINT });
    console.log(`✅ Provisioning completed. ${result.executedCommands.length} Azure CLI command(s) ran.`);  });
