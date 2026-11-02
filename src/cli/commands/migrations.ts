import { Command } from "commander";
import { ensureSwallowKitProject } from "../../core/config";
import { initializeLegacyMigrations } from "../../core/operations/migration-generator";
import { addModelMigrationOperation, AddModelMigrationOptions } from "../../core/operations/model-infrastructure";

export const migrationsCommand = new Command("migrations")
  .description("Manage versioned Azure infrastructure migrations");

migrationsCommand
  .command("add-model <model>")
  .description("Register Cosmos infrastructure for an existing model without rewriting its schema or generating CRUD")
  .option("--dry-run", "Preview all migration and metadata writes without changing files", false)
  .option("--refresh-pending", "Refresh an unmodified generated migration only after Azure tag/checksum and deployment-history proof", false)
  .option("-g, --resource-group <name>", "Azure resource group for the read-only pending-state check")
  .option("--subscription <id>", "Azure subscription for the read-only pending-state check")
  .action(async (model: string, options: AddModelMigrationOptions) => {
    console.log(JSON.stringify(await addModelMigrationOperation(model, options), null, 2));
  });

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
