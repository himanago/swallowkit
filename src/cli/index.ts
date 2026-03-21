#!/usr/bin/env node

// Ensure UTF-8 console output on Windows (fixes emoji/Unicode garbling in PowerShell 5.1)
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001', { stdio: 'ignore' });
  } catch { /* ignore — non-critical */ }
}

import { Command } from "commander";
import { initCommand, devCommand, devSeedsCommand, scaffoldCommand, createModelCommand } from "./commands";
import { provisionCommand } from "./commands/provision";

const program = new Command();

program
  .name("swallowkit")
  .description("Next.js framework optimized for Azure deployment - Automatically splits SSR into individual Azure Functions")
  .version("1.0.0-beta.8");

// Register commands
program
  .command("init [project-name]")
  .description("Initialize a new SwallowKit project")
  .option("--template <template>", "Template to use", "default")
  .option("--next-version <version>", "Next.js version to install (e.g., 16.0.7, latest)", "latest")
  .option("--cicd <provider>", "CI/CD provider: github | azure | skip")
  .option("--backend-language <language>", "Azure Functions backend language: typescript | csharp | python")
  .option("--cosmos-db-mode <mode>", "Cosmos DB mode: freetier | serverless")
  .option("--vnet <option>", "Network security: outbound | none")
  .action((projectName, options) => {
    initCommand({
      name: projectName || "swallowkit-app",
      template: options.template,
      nextVersion: options.nextVersion,
      cicd: options.cicd,
      backendLanguage: options.backendLanguage,
      cosmosDbMode: options.cosmosDbMode,
      vnet: options.vnet,
    });
  });

program.addCommand(devCommand);
program.addCommand(devSeedsCommand);

program.addCommand(provisionCommand);

program
  .command("create-model <names...>")
  .description("Create model template files with id, createdAt, and updatedAt fields")
  .option("--models-dir <dir>", "Models directory", "shared/models")
  .action((names, options) => {
    createModelCommand({
      names,
      modelsDir: options.modelsDir,
    });
  });

program
  .command("scaffold <model>")
  .description("Generate CRUD code for Azure Functions and Next.js BFF from Zod models")
  .option("--functions-dir <dir>", "Azure Functions directory", "functions")
  .option("--api-dir <dir>", "Next.js API routes directory", "app/api")
  .option("--api-only", "Generate API only, skip UI components", false)
  .action((model, options) => {
    scaffoldCommand({
      model,
      functionsDir: options.functionsDir,
      apiDir: options.apiDir,
      apiOnly: options.apiOnly,
    });
  });

program.parse();
