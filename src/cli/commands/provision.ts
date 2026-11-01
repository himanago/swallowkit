import { Command } from "commander";
import prompts from "prompts";
import { spawnSync } from "child_process";
import { ensureSwallowKitProject } from "../../core/config";
import { applyProvisionOperation, planProvisionOperation, ProvisionPlanData } from "../../core/operations/provision-operations";

function readAzOutput(args: string[]): string | undefined {
  try {
    const result = spawnSync("az", args, {
      shell: false,
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status === 0 && !result.error && !result.signal) {
      const value = result.stdout?.trim();
      if (value && value !== "null") return value;
    }
  } catch {
    // Callers report a safe fallback without displaying credential-bearing output.
  }
  return undefined;
}

function manualAzCommand(args: string[]): string {
  return `az ${args.map((arg) => /^[A-Za-z0-9._:/=-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(" ")}`;
}

function readCiCdSecret(args: string[], resourceKnown: boolean, xml = false): string {
  const value = resourceKnown ? readAzOutput(args) : undefined;
  const valid = value && (xml
    ? /^(?:<\?xml[^>]*\?>\s*)?<publishData(?:\s[^>]*)?>[\s\S]*<\/publishData>$/.test(value)
      && /<publishProfile\s[^>]+(?:\/>|>[\s\S]*<\/publishProfile>)/.test(value)
    : /^\S+$/.test(value));
  if (valid) return `    ${value}\n`;
  return `    Could not retrieve automatically${resourceKnown ? "" : " (resource name missing)"}.\n    Run manually: ${manualAzCommand(args)}\n`;
}

// Human CLI only: called after deployment, migration tags, and ledger writes succeed.
function printProvisionSetup(plan: ProvisionPlanData, subscription: string): void {
  if (!["bootstrap", "reconcile", "migrate"].includes(plan.mode)) return;
  const target = ["--resource-group", plan.resourceGroup, "--subscription", subscription];
  const fields = ["staticWebAppName", "staticWebAppUrl", "functionsAppName", "functionsAppUrl", "cosmosDbAccountName", "cosmosDatabaseName"] as const;
  const outputArgs = [
    "deployment", "group", "show", "--name", "swallowkit-baseline", ...target,
    "--query", `{${fields.map((field) => `${field}:properties.outputs.${field}.value`).join(",")}}`, "-o", "json",
  ];
  let outputs: Record<string, unknown> = {};
  const raw = readAzOutput(outputArgs);
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid outputs.");
    outputs = parsed as Record<string, unknown>;
    if (!fields.every((field) => typeof outputs[field] === "string" && outputs[field])) {
      throw new Error("Resource outputs missing.");
    }
  } catch {
    console.warn(`Provision succeeded, but resource information could not be read. Do not redeploy to retrieve it.\nRun manually: ${manualAzCommand(outputArgs)}`);
  }
  console.log("\nResource information:");
  console.log(`  resourceGroup: ${plan.resourceGroup}`);
  console.log(`  subscription: ${subscription}`);
  for (const field of fields) {
    if (typeof outputs[field] === "string" && outputs[field]) console.log(`  ${field}: ${outputs[field]}`);
  }
  const knownName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]+$/.test(value);
  const swaKnown = knownName(outputs.staticWebAppName);
  const functionsKnown = knownName(outputs.functionsAppName);
  const swaName = swaKnown ? String(outputs.staticWebAppName) : "<swa-name>";
  const functionsName = functionsKnown ? String(outputs.functionsAppName) : "<functions-app-name>";
  console.log("\nCI/CD settings (save these as secrets in GitHub Actions or Azure Pipelines):\n");
  console.log("  [AZURE_STATIC_WEB_APPS_API_TOKEN]");
  console.log(readCiCdSecret(["staticwebapp", "secrets", "list", "--name", swaName, ...target, "--query", "properties.apiKey", "-o", "tsv"], swaKnown));
  console.log("  [AZURE_FUNCTIONAPP_NAME]");
  console.log(functionsKnown ? `    ${functionsName}\n` : "    Resource name missing; inspect the deployment outputs using the command above.\n");
  console.log("  [AZURE_FUNCTIONAPP_PUBLISH_PROFILE]");
  console.log(readCiCdSecret(["webapp", "deployment", "list-publishing-profiles", "--name", functionsName, ...target, "--xml"], functionsKnown, true));
  console.log("  These values are shown only in this terminal; SwallowKit does not store them. Treat them as secrets.");
  console.log("  Next: configure your CI/CD pipeline and manually trigger the first deployment.");
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

export function createProvisionCommand(): Command {
  return new Command("provision")
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
    const subscription = options.subscription ?? readAzOutput(["account", "show", "--query", "id", "-o", "tsv"]);
    if (!subscription || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(subscription)) {
      throw new Error("Could not determine the Azure subscription. Run az account show --query id -o tsv, then retry with --subscription <id>.");
    }
    const baseline = options.baseline === undefined ? undefined : Number(options.baseline);
    const plan = await planProvisionOperation({
      resourceGroup: options.resourceGroup,
      subscription,
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
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    printProvisionSetup(plan, subscription);
  });
}

export const provisionCommand = createProvisionCommand();
