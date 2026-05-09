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

  if (result.createdFiles.length > 0) {
    console.log("\n📝 Next steps:");
    console.log("  1. Customize the generated model fields in shared/models/");
    console.log(`  2. Run '${getCommands(detectFromProject()).dlx} swallowkit scaffold <model>' to generate CRUD code`);
  }
}
