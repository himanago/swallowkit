#!/usr/bin/env node

import { Command } from "commander";
import { initCommand, devCommand, buildCommand, deployCommand, scaffoldCommand, createModelCommand } from "./commands";
import { provisionCommand } from "./commands/provision";

const program = new Command();

program
  .name("swallowkit")
  .description("Next.js framework optimized for Azure deployment - Automatically splits SSR into individual Azure Functions")
  .version("0.2.0");

// Register commands
program
  .command("init [project-name]")
  .description("Initialize a new SwallowKit project")
  .option("--template <template>", "Template to use", "default")
  .option("--next-version <version>", "Next.js version to install (e.g., 16.0.7, latest)", "latest")
  .action((projectName, options) => {
    initCommand({
      name: projectName || "swallowkit-app",
      template: options.template,
      nextVersion: options.nextVersion,
    });
  });

program.addCommand(devCommand);

program.addCommand(provisionCommand);

program
  .command("create-model <names...>")
  .description("Create model template files with id, createdAt, and updatedAt fields")
  .option("--models-dir <dir>", "Models directory", "lib/models")
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

program
  .command("build")
  .description("Build for production")
  .option("--output <dir>", "Output directory", "dist")
  .action(buildCommand);

program.addCommand(deployCommand);

program.parse();
