/**
 * SwallowKit Create-Model コマンド
 * Zod モデルの雛形を生成
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { toPascalCase } from "../../core/scaffold/model-parser";
import { ensureSwallowKitProject } from "../../core/config";
import { detectFromProject, getCommands } from "../../utils/package-manager";

interface CreateModelOptions {
  names: string[]; // モデル名のリスト（例: ["todo", "user", "post"]）
  modelsDir?: string; // モデルディレクトリ（デフォルト: "shared/models"）
}

/**
 * モデルテンプレートを生成
 */
function generateModelTemplate(modelName: string): string {
  const pascalName = toPascalCase(modelName);
  
  return `import { z } from 'zod/v4';

// ${pascalName} model (Zod official pattern: same name for value and type)
export const ${pascalName} = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ${pascalName} = z.infer<typeof ${pascalName}>;

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

  const modelsDir = options.modelsDir || "shared/models";
  
  // shared/models ディレクトリが存在しなければ作成
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

    // shared/index.ts に re-export を追加
    updateSharedIndex(kebabName, pascalName);
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
    console.log("  1. Customize the generated model fields in shared/models/");
    console.log(`  2. Run '${getCommands(detectFromProject()).dlx} swallowkit scaffold <model>' to generate CRUD code`);
  }
}

/**
 * shared/index.ts に re-export エントリを追加
 */
function updateSharedIndex(kebabName: string, pascalName: string): void {
  const indexPath = path.join("shared", "index.ts");
  
  if (!fs.existsSync(indexPath)) {
    return;
  }
  
  const content = fs.readFileSync(indexPath, "utf-8");
  const exportLine = `export { ${pascalName} } from './models/${kebabName}';`;
  
  // 既に存在する場合はスキップ
  if (content.includes(exportLine)) {
    return;
  }
  
  fs.appendFileSync(indexPath, exportLine + "\n");
}
