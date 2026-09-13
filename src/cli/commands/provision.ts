import { Command } from "commander";
import prompts from "prompts";
import { ensureSwallowKitProject } from "../../core/config";
import { applyProvisionOperation, planProvisionOperation } from "../../core/operations/provision-operations";

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
  .option("--what-if", "Include Azure what-if evidence", false)
  .option("--adopt-existing", "Adopt an existing untagged resource group without deploying main.bicep", false)
  .option("--baseline <version>", "Baseline version for adoption (currently 0)")
  .option("--reconcile", "Explicitly redeploy infra/main.bicep", false)
  .option("--approve", "Apply the displayed plan without an interactive confirmation", false)
  .action(async (options: ProvisionCliOptions) => {
    ensureSwallowKitProject("provision");
    const locations = await resolveLocations(options);
    const baseline = options.baseline === undefined ? undefined : Number(options.baseline);
    const plan = await planProvisionOperation({
      resourceGroup: options.resourceGroup,
      subscription: options.subscription,
      location: locations.location,
      swaLocation: locations.swaLocation,
      whatIf: options.whatIf,
      adoptExisting: options.adoptExisting,
      baseline,
      reconcile: options.reconcile,
    });

    console.log(`Provision mode: ${plan.mode}`);
    for (const warning of plan.warnings) console.warn(`Warning: ${warning}`);
    if (plan.pendingMigrations.length > 0) {
      console.log(`Pending migrations: ${plan.pendingMigrations.map((migration) => `${migration.version}-${migration.slug}`).join(", ")}`);
    }
    for (const command of plan.commands) console.log(`  ${command}`);

    if (plan.mode === "adoption-required") {
      throw new Error('Existing resource group requires: migrations init --legacy-baseline, then provision --adopt-existing --baseline 0 --what-if.');
    }

    let approved = options.approve === true;
    if (!approved) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("Non-interactive provision requires --approve after reviewing the plan.");
      }
      const answer = await prompts({
        type: "confirm",
        name: "approved",
        message: `Apply the ${plan.mode} plan?`,
        initial: false,
      });
      approved = answer.approved === true;
    }
    if (!approved) {
      console.log("Provision cancelled.");
      return;
    }

    const result = await applyProvisionOperation({ planId: plan.planId, approve: true });
    console.log(`Provision completed (${plan.mode}). ${result.executedCommands.length} command(s) executed.`);
  });
