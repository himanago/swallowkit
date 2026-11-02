import { Command } from "commander";
import { ensureSwallowKitProject } from "../../core/config";
import { initializeLegacyMigrations } from "../../core/operations/migration-generator";
import { addModelContainerMigration } from "../../core/operations/model-migration";

export const migrationsCommand = new Command("migrations")
  .description("Manage versioned Azure infrastructure migrations");

migrationsCommand
  .command("init")
  .description("Initialize migration tracking for an existing SwallowKit project")
  .option("--legacy-baseline", "Record the current infra directory as version 0")
  .action((options: { legacyBaseline?: boolean }) => {
    ensureSwallowKitProject("migrations init");
    if (!options.legacyBaseline) {
      throw new Error("Existing projects must be initialized with --legacy-baseline.");
    }
    const manifest = initializeLegacyMigrations();
    console.log(`Migration baseline 0 created for project ${manifest.projectId}.`);
    console.log("Commit infra/migrations/manifest.json, then run provision with --adopt-existing --baseline 0.");
  });

migrationsCommand
  .command("add-model")
  .description("Register, backfill, or preview a model's Cosmos DB container migration without changing its schema")
  .argument("<model>", "Model file or model name")
  .option("--dry-run", "Show the planned infra changes without writing anything", false)
  .option("--refresh-pending", "Refresh only when Azure tags and complete deployment history prove the migration is pending and unattempted", false)
  .option("--resource-group <name>", "Azure resource group used for the read-only migration-state and deployment-history check")
  .option("--subscription <id>", "Azure subscription used for the read-only migration-state check")
  .action(async (model: string, options: { dryRun?: boolean; refreshPending?: boolean; resourceGroup?: string; subscription?: string }) => {
    ensureSwallowKitProject("migrations add-model");
    const result = await addModelContainerMigration(model, {
      dryRun: options.dryRun,
      refreshPending: options.refreshPending,
      resourceGroup: options.resourceGroup,
      subscription: options.subscription,
    });
    for (const operation of result.operations) {
      if (operation.action !== "skip") console.log(`  ${operation.action.padEnd(7)} ${operation.path}`);
    }
    if (!result.migration) {
      console.log(`No migration needed for ${result.model}: ${result.reason}`);
    } else if (result.operations.every((operation) => operation.action === "skip")) {
      console.log(`Migration ${result.migration.version} for ${result.model} already exists: ${result.migration.template}`);
    } else {
      const updating = result.operations.some((operation) => operation.action === "modify");
      const verb = result.dryRun
        ? updating ? "Would update" : "Would create"
        : updating ? "Updated" : "Created";
      console.log(`${verb} migration ${result.migration.version} for ${result.model}: ${result.migration.template}`);
      if (result.dryRun) {
        console.log("Review the listed writes, then repeat without --dry-run to register them locally. This does not deploy to Azure.");
      } else {
        console.log("Review the pending migration with provision; Azure deployment still follows the separate human-approval workflow.");
      }
    }
  });
