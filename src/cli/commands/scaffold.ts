/**
 * SwallowKit Scaffold コマンド
 * Zod モデルから Azure Functions と Next.js BFF の CRUD コードを生成
 */

import * as fs from "fs";
import * as path from "path";
import { parseModelFile, toKebabCase, toPascalCase } from "../../core/scaffold/model-parser";
import { generateCompactAzureFunctionsCRUD } from "../../core/scaffold/functions-generator";
import { generateCompactBFFRoutes, generateBFFCallFunction } from "../../core/scaffold/nextjs-generator";
import {
  generateListPage,
  generateDetailPage,
  generateFormComponent,
  generateNewPage,
  generateEditPage,
} from "../../core/scaffold/ui-generator";
import { ensureSwallowKitProject } from "../../core/config";
import { detectFromProject, getCommands } from "../../utils/package-manager";

interface ScaffoldOptions {
  model: string; // モデルファイルのパス（例: "lib/models/todo.ts" or "todo"）
  functionsDir?: string; // Azure Functions のディレクトリ（デフォルト: "functions"）
  apiDir?: string; // Next.js API routes のディレクトリ（デフォルト: "app/api"）
  apiOnly?: boolean; // true の場合、UI を生成しない（デフォルト: false）
}

export async function scaffoldCommand(options: ScaffoldOptions) {
  // SwallowKit プロジェクトディレクトリかどうかを検証
  ensureSwallowKitProject("scaffold");

  console.log("🏗️  SwallowKit Scaffold: Generating CRUD operations...\n");

  try {
    // 1. Resolve model file path
    const modelPath = resolveModelPath(options.model);
    console.log(`📄 Model file: ${modelPath}`);

    // 2. Parse model file
    console.log("🔍 Parsing model file...");
    const modelInfo = await parseModelFile(modelPath);
    console.log(`✅ Model parsed: ${modelInfo.name} (${modelInfo.schemaName})`);
    
    // ネストスキーマ参照があれば表示
    if (modelInfo.nestedSchemaRefs.length > 0) {
      console.log(`🔗 Nested schema references detected:`);
      for (const ref of modelInfo.nestedSchemaRefs) {
        const relType = ref.isArray ? 'array' : 'single';
        const optional = ref.isOptional ? ' (optional)' : '';
        console.log(`   - ${ref.fieldName}: ${ref.modelName} [${relType}]${optional}`);
      }
    }

    // 3. Check for ID field
    if (!modelInfo.hasId) {
      console.warn(
        "⚠️  Warning: Model does not have an 'id' field. CRUD operations may not work correctly."
      );
    }

    // 4. Read shared package name
    const functionsDir = options.functionsDir || "functions";
    const sharedPackageName = readSharedPackageName();

    // 5. Generate BFF callFunction helper
    await generateCallFunctionHelper();

    // 6. Generate Azure Functions code
    await generateFunctionsCode(modelInfo, functionsDir, sharedPackageName);

    // 7. Generate Next.js BFF API Routes
    const apiDir = options.apiDir || "app/api";
    await generateBFFRoutes(modelInfo, apiDir, sharedPackageName);

    // 8. Generate Cosmos DB container Bicep file
    await generateCosmosContainer(modelInfo);

    // 9. Generate UI components (unless --api-only)
    if (!options.apiOnly) {
      await generateUIComponents(modelInfo, sharedPackageName);
      await updateNavigationMenu(modelInfo);
    }

    console.log("\n✅ Scaffold completed successfully!");
    console.log("\n📝 Next steps:");
    console.log(
      `  1. Review generated files in ${functionsDir}/src/ and ${apiDir}/`
    );
    if (!options.apiOnly) {
      console.log(`  2. Check the generated UI pages in app/${toKebabCase(modelInfo.name)}/`);
      console.log("  3. Navigate to the model from the homepage menu");
    }
    console.log(
      `  ${options.apiOnly ? '2' : '4'}. Ensure FUNCTIONS_BASE_URL is set in your .env.local file`
    );
    console.log(
      `  ${options.apiOnly ? '3' : '5'}. Configure CosmosDBConnection in functions/local.settings.json`
    );
    console.log(`  ${options.apiOnly ? '4' : '6'}. Run '${getCommands(detectFromProject()).dlx} swallowkit dev' to test the generated code`);
  } catch (error: any) {
    console.error("\n❌ Scaffold failed:", error.message);
    process.exit(1);
  }
}

/**
 * モデルファイルのパスを解決
 */
function resolveModelPath(modelInput: string): string {
  const cwd = process.cwd();

  // 絶対パスの場合
  if (path.isAbsolute(modelInput)) {
    return modelInput;
  }

  // 拡張子がある場合（相対パス）
  if (modelInput.endsWith(".ts")) {
    const fullPath = path.join(cwd, modelInput);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // 拡張子がない場合、shared/models/ で探す
  const defaultPath = path.join(cwd, "shared", "models", `${modelInput}.ts`);
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  // lib/models/ でも探す（後方互換性）
  const libPath = path.join(cwd, "lib", "models", `${modelInput}.ts`);
  if (fs.existsSync(libPath)) {
    return libPath;
  }

  // src/models/ でも探す
  const srcPath = path.join(cwd, "src", "models", `${modelInput}.ts`);
  if (fs.existsSync(srcPath)) {
    return srcPath;
  }

  // 見つからない場合はエラー
  throw new Error(
    `Model file not found: ${modelInput}\n` +
      `  Tried:\n` +
      `    - ${modelInput}\n` +
      `    - ${defaultPath}\n` +
      `    - ${libPath}\n` +
      `    - ${srcPath}\n` +
      `  Please specify a valid model file path.`
  );
}

/**
 * Read shared package name from shared/package.json
 */
function readSharedPackageName(): string {
  const cwd = process.cwd();
  const sharedPkgPath = path.join(cwd, "shared", "package.json");

  if (!fs.existsSync(sharedPkgPath)) {
    throw new Error(
      "shared/package.json not found.\n" +
        "The shared package is required for model imports.\n" +
        `Run "${getCommands(detectFromProject()).dlx} swallowkit init" to set up your project.`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(sharedPkgPath, "utf-8"));
  return pkg.name;
}

/**
 * Generate BFF callFunction helper (lib/api/call-function.ts)
 */
async function generateCallFunctionHelper(): Promise<void> {
  console.log("\n📦 Generating BFF callFunction helper...");

  const cwd = process.cwd();

  const helperDir = path.join(cwd, "lib", "api");
  const helperPath = path.join(helperDir, "call-function.ts");

  if (!fs.existsSync(helperDir)) {
    fs.mkdirSync(helperDir, { recursive: true });
  }

  const helperCode = generateBFFCallFunction();
  fs.writeFileSync(helperPath, helperCode, "utf-8");
  console.log(`✅ Created: ${helperPath}`);
}

/**
 * Generate Azure Functions CRUD code
 */
async function generateFunctionsCode(
  modelInfo: any,
  functionsDir: string,
  sharedPackageName: string
): Promise<void> {
  console.log("\n🔨 Generating Azure Functions CRUD code...");

  const modelKebab = toKebabCase(modelInfo.name);
  const functionFilePath = path.join(
    process.cwd(),
    functionsDir,
    "src",
    `${modelKebab}.ts`
  );

  // ディレクトリを作成
  const functionDir = path.dirname(functionFilePath);
  if (!fs.existsSync(functionDir)) {
    fs.mkdirSync(functionDir, { recursive: true });
  }

  // コードを生成
  const code = generateCompactAzureFunctionsCRUD(modelInfo, sharedPackageName);

  // ファイルに書き込み
  fs.writeFileSync(functionFilePath, code, "utf-8");

  console.log(`✅ Created: ${functionFilePath}`);
}

/**
 * Next.js BFF API Routes を生成
 */
async function generateBFFRoutes(
  modelInfo: any,
  apiDir: string,
  sharedPackageName: string
): Promise<void> {
  console.log("\n🔨 Generating Next.js BFF API routes...");

  const modelKebab = toKebabCase(modelInfo.name);
  const modelCamel = modelInfo.name.charAt(0).toLowerCase() + modelInfo.name.slice(1);

  // List route: app/api/[model]/route.ts
  const listRoutePath = path.join(
    process.cwd(),
    apiDir,
    modelCamel,
    "route.ts"
  );

  // Detail route: app/api/[model]/[id]/route.ts
  const detailRoutePath = path.join(
    process.cwd(),
    apiDir,
    modelCamel,
    "[id]",
    "route.ts"
  );

  // ディレクトリを作成
  const listRouteDir = path.dirname(listRoutePath);
  const detailRouteDir = path.dirname(detailRoutePath);

  if (!fs.existsSync(listRouteDir)) {
    fs.mkdirSync(listRouteDir, { recursive: true });
  }

  if (!fs.existsSync(detailRouteDir)) {
    fs.mkdirSync(detailRouteDir, { recursive: true });
  }

  // コードを生成
  const routes = generateCompactBFFRoutes(modelInfo, sharedPackageName);

  // ファイルに書き込み
  fs.writeFileSync(listRoutePath, routes.listRoute, "utf-8");
  fs.writeFileSync(detailRoutePath, routes.detailRoute, "utf-8");

  console.log(`✅ Created: ${listRoutePath}`);
  console.log(`✅ Created: ${detailRoutePath}`);
}

/**
 * Generate Cosmos DB container Bicep file
 */
async function generateCosmosContainer(modelInfo: any): Promise<void> {
  console.log("\n🗄️  Generating Cosmos DB container Bicep file...");

  const modelKebab = toKebabCase(modelInfo.name);
  const modelPascal = toPascalCase(modelInfo.name);
  const cwd = process.cwd();

  // Check if infra directory exists
  const infraDir = path.join(cwd, "infra");
  if (!fs.existsSync(infraDir)) {
    console.log("ℹ️  infra directory not found. Skipping Cosmos DB container generation.");
    return;
  }

  // Check if containers directory exists, if not create it
  const containersDir = path.join(infraDir, "containers");
  if (!fs.existsSync(containersDir)) {
    fs.mkdirSync(containersDir, { recursive: true });
  }

  // Generate container Bicep file
  const containerFileName = `${modelKebab}-container.bicep`;
  const containerFilePath = path.join(containersDir, containerFileName);

  const bicepContent = `@description('Cosmos DB account name')
param cosmosAccountName string

@description('Database name')
param databaseName string

@description('Container name')
param containerName string = '${modelPascal}s'

@description('Partition key path')
param partitionKeyPath string = '/id'

@description('Throughput (RU/s) - only used for Free Tier')
param throughput int = 400

@description('Cosmos DB mode: freetier or serverless')
param cosmosDbMode string

// Reference existing Cosmos DB account
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: cosmosAccountName
}

// Reference existing database
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' existing = {
  parent: cosmosAccount
  name: databaseName
}

// Container for ${modelPascal}
resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [
          partitionKeyPath
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/_etag/?'
          }
        ]
      }
    }
    options: cosmosDbMode == 'freetier' ? {
      throughput: throughput
    } : {}
  }
}

output containerName string = container.name
`;

  // Write Bicep file (overwrite if exists)
  fs.writeFileSync(containerFilePath, bicepContent, "utf-8");
  console.log(`✅ Created: ${containerFilePath}`);

  // Update main.bicep to include this container module
  await updateMainBicepWithContainer(modelKebab, modelPascal);
}

/**
 * Update main.bicep to include new container module
 */
async function updateMainBicepWithContainer(modelKebab: string, modelPascal: string): Promise<void> {
  const cwd = process.cwd();
  const mainBicepPath = path.join(cwd, "infra", "main.bicep");

  if (!fs.existsSync(mainBicepPath)) {
    console.log("ℹ️  main.bicep not found. Please manually add the container module.");
    return;
  }

  let mainBicepContent = fs.readFileSync(mainBicepPath, "utf-8");

  // Check if container module already exists
  const containerModuleName = `${modelKebab.replace(/-/g, '')}Container`;
  if (mainBicepContent.includes(`module ${containerModuleName}`)) {
    console.log(`ℹ️  Container module '${containerModuleName}' already exists in main.bicep`);
    return;
  }

  // Find the position to insert the container module (after cosmosDb modules)
  // Look for the end of both cosmosDb modules (FreeTier and Serverless)
  const cosmosModulePattern = /module cosmosDbServerless ['"]modules\/cosmosdb-serverless\.bicep['"] = if \(cosmosDbMode == 'serverless'\) \{[\s\S]*?\n\}/;
  const cosmosModuleMatch = mainBicepContent.match(cosmosModulePattern);
  
  if (!cosmosModuleMatch) {
    console.log("⚠️  Could not find Cosmos DB Serverless module in main.bicep. Please manually add the container module:");
    console.log(`\nmodule ${containerModuleName} 'containers/${modelKebab}-container.bicep' = {
  name: '${modelKebab}-container'
  params: {
    cosmosAccountName: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.accountName : cosmosDbServerless.outputs.accountName
    databaseName: databaseName
    cosmosDbMode: cosmosDbMode
  }
  dependsOn: [
    cosmosDbFreeTier
    cosmosDbServerless
  ]
}\n`);
    return;
  }

  // Find the end of the cosmosDbServerless module
  const insertPosition = cosmosModuleMatch.index! + cosmosModuleMatch[0].length;

  // Create the container module declaration
  const containerModule = `

// ${modelPascal} Container
module ${containerModuleName} 'containers/${modelKebab}-container.bicep' = {
  name: '${modelKebab}-container'
  params: {
    cosmosAccountName: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.accountName : cosmosDbServerless.outputs.accountName
    databaseName: '$` + `{projectName}Database'
    cosmosDbMode: cosmosDbMode
  }
  dependsOn: [
    cosmosDbFreeTier
    cosmosDbServerless
  ]
}`;

  // Insert the module
  mainBicepContent = 
    mainBicepContent.slice(0, insertPosition) +
    containerModule +
    mainBicepContent.slice(insertPosition);

  fs.writeFileSync(mainBicepPath, mainBicepContent, "utf-8");
  console.log(`✅ Added container module to main.bicep`);
}

/**
 * Generate UI components (list, detail, form, create, edit pages)
 */
async function generateUIComponents(modelInfo: any, sharedPackageName: string): Promise<void> {
  console.log("\n🎨 Generating UI components...");

  const modelKebab = toKebabCase(modelInfo.name);
  const modelName = modelInfo.name;
  const cwd = process.cwd();

  // Create directory structure: app/[model]/
  const modelDir = path.join(cwd, "app", modelKebab);
  const componentsDir = path.join(modelDir, "_components");
  const newDir = path.join(modelDir, "new");
  const idDir = path.join(modelDir, "[id]");
  const editDir = path.join(idDir, "edit");

  // Create directories
  [componentsDir, newDir, editDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Generate and write files
  const listPage = generateListPage(modelInfo, sharedPackageName);
  const detailPage = generateDetailPage(modelInfo, sharedPackageName);
  const formComponent = generateFormComponent(modelInfo, sharedPackageName);
  const newPage = generateNewPage(modelInfo);
  const editPage = generateEditPage(modelInfo, sharedPackageName);

  fs.writeFileSync(path.join(modelDir, "page.tsx"), listPage, "utf-8");
  fs.writeFileSync(path.join(idDir, "page.tsx"), detailPage, "utf-8");
  fs.writeFileSync(path.join(componentsDir, `${modelName}Form.tsx`), formComponent, "utf-8");
  fs.writeFileSync(path.join(newDir, "page.tsx"), newPage, "utf-8");
  fs.writeFileSync(path.join(editDir, "page.tsx"), editPage, "utf-8");

  console.log(`✅ Created: ${path.join(modelDir, "page.tsx")}`);
  console.log(`✅ Created: ${path.join(idDir, "page.tsx")}`);
  console.log(`✅ Created: ${path.join(componentsDir, `${modelName}Form.tsx`)}`);
  console.log(`✅ Created: ${path.join(newDir, "page.tsx")}`);
  console.log(`✅ Created: ${path.join(editDir, "page.tsx")}`);
}

/**
 * Update navigation menu on the homepage
 */
async function updateNavigationMenu(modelInfo: any): Promise<void> {
  console.log("\n📋 Updating navigation menu...");

  const modelKebab = toKebabCase(modelInfo.name);
  const cwd = process.cwd();

  // Update scaffold config
  const configPath = path.join(cwd, "lib", "scaffold-config.ts");
  
  if (!fs.existsSync(configPath)) {
    console.log("⚠️  scaffold-config.ts not found. Skipping navigation menu update.");
    return;
  }

  // Read existing config
  const configContent = fs.readFileSync(configPath, "utf-8");
  
  // Parse models array - extract each model entry
  const models: Array<{ name: string; path: string; label: string }> = [];
  const modelsMatch = configContent.match(/models:\s*\[([\s\S]*?)\]\s*as\s*ScaffoldModel\[\]/);
  
  if (modelsMatch) {
    const modelsArrayContent = modelsMatch[1];
    // Match each object in the array: { name: '...', path: '...', label: '...' }
    const modelPattern = /\{\s*name:\s*['"]([^'"]+)['"]\s*,\s*path:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]\s*\}/g;
    let match;
    while ((match = modelPattern.exec(modelsArrayContent)) !== null) {
      models.push({
        name: match[1],
        path: match[2],
        label: match[3]
      });
    }
  }

  // Check if model already exists
  if (models.find(m => m.name === modelInfo.name)) {
    console.log(`ℹ️  ${modelInfo.name} already in navigation menu`);
    return;
  }

  // Add new model
  models.push({
    name: modelInfo.name,
    path: `/${modelKebab}`,
    label: modelInfo.displayName
  });

  // Generate new scaffold-config.ts content
  const newConfigContent = `export interface ScaffoldModel {
  name: string;
  path: string;
  label: string;
}

export const scaffoldConfig = {
  models: [
${models.map(m => `    { name: '${m.name}', path: '${m.path}', label: '${m.label}' },`).join('\n')}
  ] as ScaffoldModel[]
};
`;

  fs.writeFileSync(configPath, newConfigContent, "utf-8");
  console.log(`✅ Added ${modelInfo.name} to navigation menu`);
}
