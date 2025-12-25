/**
 * SwallowKit Scaffold コマンド
 * Zod モデルから Azure Functions と Next.js BFF の CRUD コードを生成
 */

import * as fs from "fs";
import * as path from "path";
import { parseModelFile, toKebabCase, toPascalCase } from "../../core/scaffold/model-parser";
import { generateAzureFunctionsCRUD } from "../../core/scaffold/functions-generator";
import { generateNextjsBFFRoutes } from "../../core/scaffold/nextjs-generator";
import {
  generateListPage,
  generateDetailPage,
  generateFormComponent,
  generateNewPage,
  generateEditPage,
} from "../../core/scaffold/ui-generator";

interface ScaffoldOptions {
  model: string; // モデルファイルのパス（例: "lib/models/todo.ts" or "todo"）
  functionsDir?: string; // Azure Functions のディレクトリ（デフォルト: "functions"）
  apiDir?: string; // Next.js API routes のディレクトリ（デフォルト: "app/api"）
  apiOnly?: boolean; // true の場合、UI を生成しない（デフォルト: false）
}

export async function scaffoldCommand(options: ScaffoldOptions) {
  console.log("🏗️  SwallowKit Scaffold: Generating CRUD operations...\n");

  try {
    // 1. Resolve model file path
    const modelPath = resolveModelPath(options.model);
    console.log(`📄 Model file: ${modelPath}`);

    // 2. Parse model file
    console.log("🔍 Parsing model file...");
    const modelInfo = await parseModelFile(modelPath);
    console.log(`✅ Model parsed: ${modelInfo.name} (${modelInfo.schemaName})`);

    // 3. Check for ID field
    if (!modelInfo.hasId) {
      console.warn(
        "⚠️  Warning: Model does not have an 'id' field. CRUD operations may not work correctly."
      );
    }

    // 4. Copy model file to Functions
    const functionsDir = options.functionsDir || "functions";
    await copyModelToFunctions(modelInfo, functionsDir);

    // 5. Generate Azure Functions code
    await generateFunctionsCode(modelInfo, functionsDir);

    // 6. Generate Next.js BFF API Routes
    const apiDir = options.apiDir || "app/api";
    await generateBFFRoutes(modelInfo, apiDir);

    // 7. Generate Cosmos DB container Bicep file
    await generateCosmosContainer(modelInfo);

    // 8. Generate UI components (unless --api-only)
    if (!options.apiOnly) {
      await generateUIComponents(modelInfo);
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
    console.log(`  ${options.apiOnly ? '4' : '6'}. Run 'npx swallowkit dev' to test the generated code`);
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

  // 拡張子がない場合、lib/models/ で探す
  const defaultPath = path.join(cwd, "lib", "models", `${modelInput}.ts`);
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
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
      `    - ${srcPath}\n` +
      `  Please specify a valid model file path.`
  );
}

/**
 * Copy model file to Functions directory
 */
async function copyModelToFunctions(
  modelInfo: any,
  functionsDir: string
): Promise<void> {
  console.log("\n📋 Copying model file to Functions...");

  const modelKebab = toKebabCase(modelInfo.name);
  const functionsModelsDir = path.join(
    process.cwd(),
    functionsDir,
    "src",
    "models"
  );

  // Create models directory
  if (!fs.existsSync(functionsModelsDir)) {
    fs.mkdirSync(functionsModelsDir, { recursive: true });
  }

  // Read original model file
  const originalContent = fs.readFileSync(modelInfo.filePath, "utf-8");

  // Add warning comment at the top
  const warning = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 * 
 * This file is automatically generated from the model in lib/models/${modelKebab}.ts
 * To update this model, modify the original file and run:
 *   npx swallowkit scaffold ${modelKebab}
 * 
 * Any manual changes to this file will be overwritten.
 */

`;

  const modifiedContent = warning + originalContent;

  // Write to Functions models directory
  const targetPath = path.join(functionsModelsDir, `${modelKebab}.ts`);
  fs.writeFileSync(targetPath, modifiedContent, "utf-8");

  console.log(`✅ Copied: ${targetPath}`);
}

/**
 * Generate Azure Functions CRUD code
 */
async function generateFunctionsCode(
  modelInfo: any,
  functionsDir: string
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
  const code = generateAzureFunctionsCRUD(modelInfo);

  // ファイルに書き込み
  fs.writeFileSync(functionFilePath, code, "utf-8");

  console.log(`✅ Created: ${functionFilePath}`);
}

/**
 * Next.js BFF API Routes を生成
 */
async function generateBFFRoutes(
  modelInfo: any,
  apiDir: string
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
  const routes = generateNextjsBFFRoutes(modelInfo);

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
async function generateUIComponents(modelInfo: any): Promise<void> {
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
  const listPage = generateListPage(modelInfo);
  const detailPage = generateDetailPage(modelInfo);
  const formComponent = generateFormComponent(modelInfo);
  const newPage = generateNewPage(modelInfo);
  const editPage = generateEditPage(modelInfo);

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
  const configDir = path.dirname(configPath);
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let config: { models: Array<{ name: string; path: string; label: string }> } = { models: [] };

  // Parse existing TypeScript config if it exists
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const modelsMatch = content.match(/models:\s*\[([\ s\S]*?)\]/);
    if (modelsMatch) {
      try {
        // Extract model entries
        const modelsContent = modelsMatch[1];
        const modelEntries = modelsContent.match(/\{[^}]+\}/g) || [];
        config.models = modelEntries.map(entry => {
          const nameMatch = entry.match(/name:\s*['"]([^'"]+)['"]/);
          const pathMatch = entry.match(/path:\s*['"]([^'"]+)['"]/);
          const labelMatch = entry.match(/label:\s*['"]([^'"]+)['"]/);
          return {
            name: nameMatch?.[1] || '',
            path: pathMatch?.[1] || '',
            label: labelMatch?.[1] || '',
          };
        });
      } catch (e) {
        console.warn('Warning: Could not parse existing config, creating new one');
      }
    }
  }

  // Add model to config if not already present
  if (!config.models.find(m => m.name === modelInfo.name)) {
    config.models.push({
      name: modelInfo.name,
      path: `/${modelKebab}`,
      label: modelInfo.name,
    });

    // Generate TypeScript file content
    const tsContent = `export interface ScaffoldModel {
  name: string;
  path: string;
  label: string;
}

export const scaffoldConfig = {
  models: [
${config.models.map(m => `    { name: '${m.name}', path: '${m.path}', label: '${m.label}' },`).join('\n')}
  ] as ScaffoldModel[]
};
`;

    fs.writeFileSync(configPath, tsContent, "utf-8");
    console.log(`✅ Added ${modelInfo.name} to navigation menu`);
  } else {
    console.log(`ℹ️  ${modelInfo.name} already in navigation menu`);
  }

  // Update homepage to include menu
  const homePagePath = path.join(cwd, "app", "page.tsx");
  
  if (fs.existsSync(homePagePath)) {
    let homePageContent = fs.readFileSync(homePagePath, "utf-8");
    
    // Check if menu component is already added
    if (!homePageContent.includes('scaffoldedModels')) {
      // Add import and menu section
      const menuImport = `import { scaffoldConfig } from '@/lib/scaffold-config';\n`;
      const menuSection = `
      {/* Scaffolded Models Menu */}
      {scaffoldConfig.models.length > 0 && (
        <div className="mt-8">
          <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-gray-100">Models</h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {scaffoldConfig.models.map((model) => (
              <a
                key={model.name}
                href={model.path}
                className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <h3 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">{model.label}</h3>
                <p className="text-gray-600 dark:text-gray-400">Manage {model.label.toLowerCase()}</p>
              </a>
            ))}
          </div>
        </div>
      )}`;

      // Insert import at the beginning
      if (!homePageContent.includes(menuImport.trim())) {
        homePageContent = menuImport + homePageContent;
      }

      // Insert menu section before the closing div of main content
      if (!homePageContent.includes('Scaffolded Models Menu')) {
        // Find the last </div> or end of main section
        const mainEndIndex = homePageContent.lastIndexOf('</div>');
        if (mainEndIndex !== -1) {
          homePageContent = 
            homePageContent.slice(0, mainEndIndex) +
            menuSection +
            '\n' +
            homePageContent.slice(mainEndIndex);
        }
      }

      fs.writeFileSync(homePagePath, homePageContent, "utf-8");
      console.log(`✅ Updated homepage menu`);
    } else {
      console.log(`ℹ️  Homepage menu already configured`);
    }
  }
}
