/**
 * SwallowKit Create-Model コマンド
 * Zod モデルの雛形を生成
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { toPascalCase, toCamelCase } from "../../core/scaffold/model-parser";
import { ensureSwallowKitProject } from "../../core/config";

interface CreateModelOptions {
  names: string[]; // モデル名のリスト（例: ["todo", "user", "post"]）
  modelsDir?: string; // モデルディレクトリ（デフォルト: "lib/models"）
}

/**
 * モデルテンプレートを生成
 */
function generateModelTemplate(modelName: string): string {
  const pascalName = toPascalCase(modelName);
  const camelName = toCamelCase(modelName);
  
  return `import { z } from 'zod';

// ${pascalName} model
export const ${camelName}Schema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${pascalName} = z.infer<typeof ${camelName}Schema>;

// Display name for UI
export const displayName = '${pascalName}';
`;
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
  // SwallowKit プロジェクトディレクトリかどうかを検証
  ensureSwallowKitProject("create-model");

  console.log("🏗️  SwallowKit Create-Model: Generating model templates...\n");

  const modelsDir = options.modelsDir || "lib/models";
  
  // lib/models ディレクトリが存在しなければ作成
  if (!fs.existsSync(modelsDir)) {
    console.log(`📁 Creating directory: ${modelsDir}`);
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const name of options.names) {
    const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const filePath = path.join(modelsDir, `${kebabName}.ts`);
    const pascalName = toPascalCase(name);

    // 既存ファイルチェック
    if (fs.existsSync(filePath)) {
      const shouldOverwrite = await askConfirmation(
        `⚠️  File ${filePath} already exists. Overwrite? (y/N): `
      );
      
      if (!shouldOverwrite) {
        console.log(`⏭️  Skipped: ${kebabName}.ts`);
        skipped.push(kebabName);
        continue;
      }
    }

    // モデルファイルを生成
    const content = generateModelTemplate(name);
    fs.writeFileSync(filePath, content);
    console.log(`✅ Created: ${filePath}`);
    created.push(kebabName);
  }

  // サマリー表示
  console.log("\n📋 Summary:");
  if (created.length > 0) {
    console.log(`  ✅ Created ${created.length} model(s): ${created.join(', ')}.ts`);
  }
  if (skipped.length > 0) {
    console.log(`  ⏭️  Skipped ${skipped.length} model(s): ${skipped.join(', ')}.ts`);
  }

  if (created.length > 0) {
    console.log("\n📝 Next steps:");
    console.log("  1. Customize the generated model fields in lib/models/");
    console.log("  2. Run 'npx swallowkit scaffold lib/models/<model>.ts' to generate CRUD code");
  }
}
