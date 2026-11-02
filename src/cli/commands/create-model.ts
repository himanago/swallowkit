import * as readline from "readline";
import { createModelOperation } from "../../core/operations/create-model";
import { detectFromProject, getCommands } from "../../utils/package-manager";

interface CreateModelOptions {
  names: string[]; // モデル名のリスト（例: ["todo", "user", "post"]）
  modelsDir?: string; // モデルディレクトリ（デフォルト: "shared/models"）
  connector?: string; // コネクタ名（例: "mysql", "backlog"）
}

/**
 * ユーザーに確認を求める
 */
function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * create-model コマンド
 */
export async function createModelCommand(options: CreateModelOptions) {
  console.log("🏗️  SwallowKit Create-Model: Generating model templates...\n");

  const result = await createModelOperation({
    names: options.names,
    modelsDir: options.modelsDir,
    connector: options.connector,
    overwriteMode: "prompt",
    confirmOverwrite: async (filePath) => askConfirmation(`⚠️  File ${filePath} already exists. Overwrite? (y/N): `),
  });

  // サマリー表示
  console.log("\n📋 Summary:");
  if (result.connectorType && options.connector) {
    console.log(`  🔌 Connector: ${options.connector} (${result.connectorType})`);
  }
  if (result.createdFiles.length > 0) {
    console.log(`  ✅ Created ${result.createdFiles.length} model(s): ${result.createdFiles.join(", ")}`);
  }
  if (result.skippedFiles.length > 0) {
    console.log(`  ⏭️  Skipped ${result.skippedFiles.length} model(s): ${result.skippedFiles.join(", ")}`);
  }
  if (result.updatedIndex) {
    console.log("  📦 Updated shared/index.ts");
  }
  if (result.infrastructureFiles.length > 0) {
    console.log(`  🏗️  Registered Cosmos container migration: ${result.infrastructureFiles.join(", ")}`);
  }

  if (result.createdFiles.length > 0) {
    console.log("\n📝 Next steps:");
    console.log("  1. Customize the model fields and partitionKey in shared/models/.");
    if (result.infrastructureFiles.length > 0) {
      console.log(
        `  2. If you change partitionKey, preview then register a pending migration refresh with '${getCommands(detectFromProject()).exec} swallowkit migrations add-model <model> --refresh-pending --resource-group <name> [--subscription <id>] [--dry-run]'.`
      );
      console.log(
        `  3. Run '${getCommands(detectFromProject()).exec} swallowkit scaffold <model>' only when generated CRUD is needed.`
      );
      console.log("  4. Review the infrastructure with provision; model generation does not deploy to Azure.");
    } else {
      console.log(`  2. Run '${getCommands(detectFromProject()).exec} swallowkit scaffold <model>' only when generated CRUD is needed.`);
    }
  }
}
