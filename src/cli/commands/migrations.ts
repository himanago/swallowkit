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
  .description("Generate only the Cosmos DB container migration for a model (e.g. after scaffold --skip-infra)")
  .argument("<model>", "Model file or model name")
  .option("--dry-run", "Show the planned infra changes without writing anything", false)
  .action(async (model: string, options: { dryRun?: boolean }) => {
    ensureSwallowKitProject("migrations add-model");
    const result = await addModelContainerMigration(model, { dryRun: options.dryRun });
    for (const operation of result.operations) {
      if (operation.action !== "skip") console.log(`  ${operation.action.padEnd(7)} ${operation.path}`);
    }
    if (!result.migration) {
      console.log(`No migration needed for ${result.model}: ${result.reason}`);
    } else if (result.operations.every((operation) => operation.action === "skip")) {
      console.log(`Migration ${result.migration.version} for ${result.model} already exists: ${result.migration.template}`);
    } else {
      console.log(`${result.dryRun ? "Would create" : "Created"} migration ${result.migration.version} for ${result.model}: ${result.migration.template}`);
      if (!result.dryRun) console.log("Commit the migration, then run provision to plan and apply it.");
    }
  });
