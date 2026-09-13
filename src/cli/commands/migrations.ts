import { Command } from "commander";
import { ensureSwallowKitProject } from "../../core/config";
import { initializeLegacyMigrations } from "../../core/operations/migration-generator";

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
