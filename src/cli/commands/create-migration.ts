import { Command } from "commander";
import { ensureSwallowKitProject } from "../../core/config";
import { createCustomMigration } from "../../core/operations/migration-generator";

export const createMigrationCommand = new Command("create-migration")
  .description("Create a versioned Bicep migration for additional Azure resources")
  .argument("<slug>", "Kebab-case migration name")
  .action((slug: string) => {
    ensureSwallowKitProject("create-migration");
    const migration = createCustomMigration(slug);
    console.log(`Created migration ${migration.version}: ${migration.template}`);
    console.log("Edit the Bicep file, then run provision to plan and apply it.");
  });
