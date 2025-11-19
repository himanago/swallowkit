#!/usr/bin/env node

import { Command } from "commander";
import { initCommand, devCommand, buildCommand, generateCommand, analyzeCommand, setupCommand, deployCommand } from "./commands";

const program = new Command();

program
  .name("swallowkit")
  .description("Next.js framework optimized for Azure deployment - Automatically splits SSR into individual Azure Functions")
  .version("0.2.0");

// コマンドの登録
program
  .command("setup")
  .description("必須ツール（Azure CLI, SWA CLI, Cosmos DB Emulator）をインストール")
  .option("-y, --yes", "確認なしで自動インストール", false)
  .action(setupCommand);

program
  .command("init [project-name]")
  .description("新しいSwallowKitプロジェクトを初期化")
  .option("--template <template>", "テンプレート", "default")
  .action((projectName, options) => {
    initCommand({
      name: projectName || "swallowkit-app",
      template: options.template,
    });
  });

program.addCommand(devCommand);

program
  .command("build")
  .description("プロダクション用にビルド")
  .option("--output <dir>", "出力ディレクトリ", "dist")
  .action(buildCommand);

program.addCommand(generateCommand);
program.addCommand(analyzeCommand);
program.addCommand(deployCommand);

program.parse();
