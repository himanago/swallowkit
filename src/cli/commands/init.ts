import * as fs from "fs";
import * as path from "path";
import { spawn, execSync } from "child_process";
import prompts from "prompts";
import { BackendLanguage } from "../../types";
import {
  type PackageManager,
  detectFromUserAgent,
  getCommands,
  getWorkspaceConfig,
  getCiSetupStep,
  getAzurePipelinesSetup,
  getBuildScript,
  getFunctionsPrestart,
  getFunctionsStartScript,
} from "../../utils/package-manager";

interface InitOptions {
  name: string;
  template: string;
  nextVersion?: string;
  cicd?: CiCdProvider;
  backendLanguage?: BackendLanguage;
  cosmosDbMode?: CosmosDbMode;
  vnet?: VNetOption;
}

type CiCdProvider = 'github' | 'azure' | 'skip';
type CosmosDbMode = 'freetier' | 'serverless';
type VNetOption = 'none' | 'outbound';

interface AzureConfig {
  cosmosDbMode: CosmosDbMode;
  vnetOption: VNetOption;
}

const BACKEND_LANGUAGE_CHOICES: Array<{ title: string; value: BackendLanguage }> = [
  { title: "TypeScript", value: "typescript" },
  { title: "C#", value: "csharp" },
  { title: "Python", value: "python" },
];

function usesNodeFunctionsProject(backendLanguage: BackendLanguage): boolean {
  return backendLanguage === "typescript";
}

function getBackendLanguageLabel(backendLanguage: BackendLanguage): string {
  return BACKEND_LANGUAGE_CHOICES.find((choice) => choice.value === backendLanguage)?.title || backendLanguage;
}

function getFunctionsWorkerRuntime(backendLanguage: BackendLanguage): string {
  if (backendLanguage === "csharp") {
    return "dotnet-isolated";
  }
  if (backendLanguage === "python") {
    return "python";
  }
  return "node";
}

function getFunctionsRuntimeConfig(backendLanguage: BackendLanguage): { name: string; version: string } {
  if (backendLanguage === "csharp") {
    return { name: "dotnet-isolated", version: "8.0" };
  }
  if (backendLanguage === "python") {
    return { name: "python", version: "3.11" };
  }
  return { name: "node", version: "22" };
}

async function promptBackendLanguage(): Promise<BackendLanguage> {
  const response = await prompts({
    type: "select",
    name: "backendLanguage",
    message: "Azure Functions backend language:",
    choices: BACKEND_LANGUAGE_CHOICES,
    initial: 0,
  });

  return response.backendLanguage || "typescript";
}

async function promptCiCd(): Promise<CiCdProvider> {
  const response = await prompts({
    type: 'select',
    name: 'cicd',
    message: 'CI/CD Setup (choose deployment automation):',
    choices: [
      { title: 'GitHub Actions', value: 'github' },
      { title: 'Azure Pipelines', value: 'azure' },
      { title: 'Skip (manual deployment)', value: 'skip' }
    ],
    initial: 0
  });

  return response.cicd || 'skip';
}

async function promptAzureConfig(): Promise<AzureConfig> {
  const cosmosResponse = await prompts({
    type: 'select',
    name: 'mode',
    message: 'Cosmos DB mode (affects cost):',
    choices: [
      { title: 'Free Tier (1000 RU/s free, best for first project)', value: 'freetier' },
      { title: 'Serverless (pay-per-use, flexible)', value: 'serverless' }
    ],
    initial: 0
  });

  const vnetResponse = await prompts({
    type: 'select',
    name: 'vnet',
    message: 'Network security:',
    choices: [
      { title: 'VNet Integration (recommended) - Cosmos DB via Private Endpoint', value: 'outbound' },
      { title: 'None - Public endpoints, simplest but least secure', value: 'none' }
    ],
    initial: 0
  });

  return {
    cosmosDbMode: cosmosResponse.mode || 'freetier',
    vnetOption: vnetResponse.vnet || 'outbound'
  };
}

const VALID_CICD: CiCdProvider[] = ['github', 'azure', 'skip'];
const VALID_BACKEND_LANGUAGE: BackendLanguage[] = ['typescript', 'csharp', 'python'];
const VALID_COSMOS_DB_MODE: CosmosDbMode[] = ['freetier', 'serverless'];
const VALID_VNET: VNetOption[] = ['none', 'outbound'];

function validateInitFlags(options: InitOptions): void {
  if (options.cicd && !VALID_CICD.includes(options.cicd)) {
    console.error(`❌ Invalid --cicd value: "${options.cicd}". Must be: ${VALID_CICD.join(', ')}`);
    process.exit(1);
  }
  if (options.backendLanguage && !VALID_BACKEND_LANGUAGE.includes(options.backendLanguage)) {
    console.error(`❌ Invalid --backend-language value: "${options.backendLanguage}". Must be: ${VALID_BACKEND_LANGUAGE.join(', ')}`);
    process.exit(1);
  }
  if (options.cosmosDbMode && !VALID_COSMOS_DB_MODE.includes(options.cosmosDbMode)) {
    console.error(`❌ Invalid --cosmos-db-mode value: "${options.cosmosDbMode}". Must be: ${VALID_COSMOS_DB_MODE.join(', ')}`);
    process.exit(1);
  }
  if (options.vnet && !VALID_VNET.includes(options.vnet)) {
    console.error(`❌ Invalid --vnet value: "${options.vnet}". Must be: ${VALID_VNET.join(', ')}`);
    process.exit(1);
  }
}

export async function initCommand(options: InitOptions) {
  // Validate flag values before doing anything
  validateInitFlags(options);

  console.log(`🚀 Initializing SwallowKit project: ${options.name}`);
  console.log(`📋 Template: ${options.template}`);

  // Detect package manager from invocation context (npx → npm, pnpm dlx → pnpm)
  const pm: PackageManager = detectFromUserAgent();
  const pmCmd = getCommands(pm);
  console.log(`📦 Package manager: ${pm}`);

  const projectDir = path.join(process.cwd(), options.name);

  try {
    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      console.error(`❌ Directory "${options.name}" already exists.`);
      process.exit(1);
    }

    // Use flag values if provided, otherwise prompt interactively
    const cicdProvider: CiCdProvider = options.cicd || await promptCiCd();
    const backendLanguage: BackendLanguage = options.backendLanguage || await promptBackendLanguage();

    const azureConfig: AzureConfig = (options.cosmosDbMode && options.vnet)
      ? { cosmosDbMode: options.cosmosDbMode, vnetOption: options.vnet }
      : await promptAzureConfig();

    // Create Next.js project with create-next-app
    await createNextJsProject(options.name, pm);

    // Upgrade Next.js to specified version (or latest) to avoid cached old versions
    await upgradeNextJs(projectDir, options.nextVersion || 'latest', pm);

    // Add SwallowKit specific files
    await addSwallowKitFiles(projectDir, options, cicdProvider, azureConfig, pm, backendLanguage);
    
    // Create infrastructure files (Bicep)
    await createInfrastructure(projectDir, options.name, azureConfig, backendLanguage);
    
    // Create CI/CD files based on choice
    if (cicdProvider === 'github') {
      await createGitHubActionsWorkflows(projectDir, azureConfig, pm, backendLanguage);
    } else if (cicdProvider === 'azure') {
      await createAzurePipelines(projectDir, pm, backendLanguage);
    }

    // Initialize Git repository and create initial commit
    try {
      // Try git init with -b main (Git 2.28+), fallback to git init
      try {
        execSync('git init -b main', { cwd: projectDir, stdio: 'ignore' });
      } catch {
        // Fallback for older Git versions
        execSync('git init', { cwd: projectDir, stdio: 'ignore' });
      }
      
      // Configure git user if not set (required for commits)
      try {
        execSync('git config user.name', { cwd: projectDir, stdio: 'pipe' });
        execSync('git config user.email', { cwd: projectDir, stdio: 'pipe' });
      } catch {
        // Not configured globally, set locally for this repository
        execSync('git config user.name "SwallowKit"', { cwd: projectDir, stdio: 'ignore' });
        execSync('git config user.email "swallowkit@example.com"', { cwd: projectDir, stdio: 'ignore' });
      }
      
      execSync('git add -A', { cwd: projectDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit from SwallowKit"', { cwd: projectDir, stdio: 'ignore' });
      
      // Rename branch to main if git init -b main didn't work
      try {
        const currentBranch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim();
        if (currentBranch !== 'main') {
          execSync('git branch -M main', { cwd: projectDir, stdio: 'ignore' });
        }
      } catch {
        // Ignore errors - branch renaming is not critical
      }
      
      console.log('✅ Git repository initialized with initial commit\n');
    } catch (error) {
      console.warn('⚠️  Could not initialize Git repository (is git installed?)');
      if (error instanceof Error) {
        console.warn(`    Error: ${error.message}`);
      }
    }

    console.log(`\n✅ Project "${options.name}" created successfully!`);
    console.log("\n📝 Next steps:");
    console.log(`  cd ${options.name}`);
    console.log(`  ${pmCmd.dlx} swallowkit create-model <name>  # Create your first model`);
    console.log(`  ${pmCmd.dlx} swallowkit scaffold shared/models/<name>.ts  # Generate CRUD code`);
    console.log(`  ${pmCmd.dlx} swallowkit dev  # Start development servers`);
    console.log("\n🚀 Deploy to Azure:");
    console.log(`  ${pmCmd.dlx} swallowkit provision --resource-group <name>`);
    if (cicdProvider !== 'skip') {
      console.log("  Configure CI/CD secrets and push to repository");
    }
  } catch (error) {
    console.error("❌ Project creation failed:", error);
    // Clean up on failure
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

async function createNextJsProject(projectName: string, pm: PackageManager): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n📦 Creating Next.js project with create-next-app...\n');

    const pmCmd = getCommands(pm);
    
    // Build args: for pnpm use "pnpm dlx create-next-app@latest ... --use-pnpm"
    //             for npm use "npx create-next-app@latest ..."
    const baseArgs = pm === 'pnpm'
      ? ['dlx', 'create-next-app@latest']
      : ['create-next-app@latest'];
    
    const args = [
      ...baseArgs,
      projectName,
      '--typescript',
      '--tailwind',
      '--app',
      '--no-src',
      '--disable-git',
      '--import-alias',
      '@/*',
      ...(pmCmd.createNextAppFlag ? [pmCmd.createNextAppFlag] : []),
      '--yes'
    ];

    // Run create-next-app with recommended options for Azure
    const createNextApp = spawn(
      pm === 'pnpm' ? 'pnpm' : 'npx',
      args,
      {
        stdio: 'inherit',
        shell: true,
      }
    );

    createNextApp.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`create-next-app exited with code ${code}`));
      } else {
        console.log('\n✅ Next.js project created\n');
        resolve();
      }
    });

    createNextApp.on('error', (error: Error) => {
      reject(error);
    });
  });
}

async function upgradeNextJs(projectDir: string, version: string, pm: PackageManager): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Installing Next.js ${version} (to ensure latest security patches)...\n`);
    
    // pnpm: pnpm add next@... ; npm: npm install next@...
    const args = pm === 'pnpm'
      ? ['add', `next@${version}`, `react@latest`, `react-dom@latest`, '--save-exact']
      : ['install', `next@${version}`, `react@latest`, `react-dom@latest`, '--save-exact'];

    const child = spawn(
      pm,
      args,
      {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true,
      }
    );

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`${pm} add next@${version} exited with code ${code}`));
      } else {
        console.log(`\n✅ Next.js ${version} installed\n`);
        resolve();
      }
    });

    child.on('error', (error: Error) => {
      reject(error);
    });
  });
}

async function installDependencies(projectDir: string, pm: PackageManager = 'pnpm'): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n📦 Installing dependencies...\n');
    
    const child = spawn(
      pm,
      ['install'],
      {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true,
      }
    );

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`${pm} install exited with code ${code}`));
      } else {
        console.log('\n✅ Dependencies installed\n');
        resolve();
      }
    });

    child.on('error', (error: Error) => {
      reject(error);
    });
  });
}

export function injectSwallowKitNextConfig(nextConfigContent: string, projectName: string): string {
  return nextConfigContent.replace(
    /(const\s+nextConfig[:\s]*(?::\s*NextConfig\s*)?=\s*\{)(\s*\/\*[^*]*\*\/)?/,
    `$1\n  output: 'standalone',\n  transpilePackages: ['@${projectName}/shared'],\n  serverExternalPackages: ['applicationinsights', 'diagnostic-channel-publishers'],$2`
  );
}

export function buildCSharpFunctionsProgramSource(): string {
  return `using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddApplicationInsightsTelemetryWorkerService();
    })
    .Build();

host.Run();
`;
}

export function buildCSharpFunctionsProjectSource(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <Compile Remove="generated\\**\\bin\\**\\*.cs;generated\\**\\obj\\**\\*.cs" />
    <EmbeddedResource Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />
    <None Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Cosmos" Version="3.47.0" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Azure.Identity" Version="1.13.2" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.23.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Extensions.Http" Version="3.2.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.18.0" OutputItemType="Analyzer" />
    <PackageReference Include="Microsoft.ApplicationInsights.WorkerService" Version="2.22.0" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.ApplicationInsights" Version="1.2.0" />
  </ItemGroup>
</Project>
`;
}

export function buildSwallowKitConfigSource(backendLanguage: BackendLanguage): string {
  return `module.exports = {
  backend: {
    language: '${backendLanguage}',
  },
  functions: {
    baseUrl: process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071',
  },
  deployment: {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
    swaName: process.env.AZURE_SWA_NAME || '',
  },
}
`;
}

export function buildGeneratedProjectDependencies(projectName: string): Record<string, string> {
  return {
    '@azure/cosmos': '^4.0.0',
    'applicationinsights': '^3.3.0',
    [`@${projectName}/shared`]: '*',
  };
}

async function addSwallowKitFiles(
  projectDir: string,
  options: InitOptions,
  cicdChoice: string,
  azureConfig: AzureConfig,
  pm: PackageManager,
  backendLanguage: BackendLanguage
) {
  console.log('📦 Adding SwallowKit files...\n');
  
  const projectName = options.name;

  // 1. Update package.json to add runtime dependencies for generated projects
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // zod is in the shared workspace package, not here
  packageJson.dependencies = {
    ...packageJson.dependencies,
    ...buildGeneratedProjectDependencies(projectName),
  };

  if (backendLanguage !== "typescript") {
    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      '@openapitools/openapi-generator-cli': '^2.21.0',
    };
  }
  
  packageJson.scripts = {
    ...packageJson.scripts,
    'build': getBuildScript(pm),
    'start': 'next start',
    'functions:start': getFunctionsStartScript(pm, backendLanguage),
  };

  if (pm === 'pnpm') {
    packageJson.packageManager = 'pnpm@latest';
  }
  
  packageJson.engines = {
    node: '20.x',
  };

  // Workspace configuration depends on package manager
  const workspacePackages = usesNodeFunctionsProject(backendLanguage) ? ['shared', 'functions'] : ['shared'];
  const wsConfig = getWorkspaceConfig(pm, workspacePackages);
  if (wsConfig.type === 'file') {
    // pnpm: workspaces are defined in pnpm-workspace.yaml
    delete packageJson.workspaces;
  } else {
    // npm: workspaces are defined in package.json
    packageJson.workspaces = wsConfig.value;
  }
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Create workspace config file if needed (pnpm-workspace.yaml)
  if (wsConfig.type === 'file') {
    fs.writeFileSync(path.join(projectDir, wsConfig.filename), wsConfig.content);
  }

  // Don't install yet — wait until all workspace packages (shared, functions) are created

  // 2. Update next.config to add standalone output
  // Check for both .ts and .js variants
  let nextConfigPath = path.join(projectDir, 'next.config.ts');
  if (!fs.existsSync(nextConfigPath)) {
    nextConfigPath = path.join(projectDir, 'next.config.js');
  }
  
  if (fs.existsSync(nextConfigPath)) {
    let nextConfigContent = fs.readFileSync(nextConfigPath, 'utf-8');
    
    // Add output, transpiled workspace package, and server externals for standalone deployment
    if (!nextConfigContent.includes("output:") && !nextConfigContent.includes('output =')) {
      nextConfigContent = injectSwallowKitNextConfig(nextConfigContent, projectName);
      fs.writeFileSync(nextConfigPath, nextConfigContent);
    }
  }

  // 3. Update tsconfig.json to exclude functions directory
  const tsconfigPath = path.join(projectDir, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
    if (!tsconfig.exclude) {
      tsconfig.exclude = [];
    }
    if (!tsconfig.exclude.includes('functions')) {
      tsconfig.exclude.push('functions');
    }
    if (!tsconfig.exclude.includes('shared')) {
      tsconfig.exclude.push('shared');
    }
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  }

  // 3. Create SwallowKit config
  const swallowkitConfig = buildSwallowKitConfigSource(backendLanguage);
  fs.writeFileSync(path.join(projectDir, 'swallowkit.config.js'), swallowkitConfig);

  // 4. Create shared workspace package for Zod models (Single Source of Truth)
  await createSharedPackage(projectDir, projectName);

  // Create lib directory for Next.js-specific utilities
  const libDir = path.join(projectDir, 'lib');

  // Create lib/api directory for backend utilities
  const apiLibDir = path.join(libDir, 'api');
  fs.mkdirSync(apiLibDir, { recursive: true });

  // Create backend utility for calling Azure Functions
  const backendUtilContent = `// Get Functions base URL at runtime (not at build time)
function getFunctionsBaseUrl(): string {
  return process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';
}

/**
 * Simple HTTP client for calling backend APIs
 * Use this to make requests to BFF API routes (which forward to Azure Functions)
 */
async function request<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: any,
  queryParams?: Record<string, string>
): Promise<T> {
  const functionsBaseUrl = getFunctionsBaseUrl();
  let url = \`\${functionsBaseUrl}\${endpoint}\`;
  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += \`?\${params.toString()}\`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = text || 'Failed to call backend function';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || error.message || text;
      } catch {
        // If not JSON, use text as-is
      }
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await response.text();
      return text as T;
    }

    return await response.json();
  } catch (error) {
    console.error('Error calling backend:', error);
    throw error;
  }
}

/**
 * Generic API client for making HTTP requests
 * Simply calls endpoints - no DB dependencies, no schema validation
 * Validation happens on the backend (BFF/Functions)
 * 
 * @example
 * // Call custom endpoint
 * await api.get('/api/greet?name=World')
 * 
 * // Call scaffolded CRUD endpoints
 * await api.get('/api/todos')
 * await api.post('/api/todos', { title: 'New task' })
 * await api.put('/api/todos/123', { title: 'Updated' })
 * await api.delete('/api/todos/123')
 */
export const api = {
  /**
   * Make a GET request
   */
  get: <T>(endpoint: string, params?: Record<string, string>): Promise<T> => {
    return request<T>(endpoint, 'GET', undefined, params);
  },

  /**
   * Make a POST request
   */
  post: <T>(endpoint: string, body?: any): Promise<T> => {
    return request<T>(endpoint, 'POST', body);
  },

  /**
   * Make a PUT request
   */
  put: <T>(endpoint: string, body?: any): Promise<T> => {
    return request<T>(endpoint, 'PUT', body);
  },

  /**
   * Make a DELETE request
   */
  delete: <T>(endpoint: string): Promise<T> => {
    return request<T>(endpoint, 'DELETE');
  },
};
`;
  fs.writeFileSync(path.join(apiLibDir, 'backend.ts'), backendUtilContent);

  // 5. Create components directory
  const componentsDir = path.join(projectDir, 'components');
  fs.mkdirSync(componentsDir, { recursive: true });

  // 6. Create .env.example
  const envExample = `# Azure Functions Backend URL
BACKEND_FUNCTIONS_BASE_URL=http://localhost:7071

# Azure Configuration
AZURE_RESOURCE_GROUP=your-resource-group
AZURE_SWA_NAME=your-static-web-app-name
`;
  fs.writeFileSync(path.join(projectDir, '.env.example'), envExample);

  // 7. Create instrumentation.ts for Application Insights (Next.js official way)
  const instrumentationContent = `// Application Insights instrumentation for Next.js
// This file is automatically loaded by Next.js when instrumentationHook is enabled
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run on server-side
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    
    if (connectionString) {
      const appInsights = await import('applicationinsights');
      
      appInsights
        .setup(connectionString)
        .setAutoCollectConsole(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectHeartbeat(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectRequests(true)
        .setAutoDependencyCorrelation(true)
        .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
        .setSendLiveMetrics(true)
        .setUseDiskRetryCaching(true);
      
      appInsights.defaultClient.setAutoPopulateAzureProperties();
      appInsights.start();
      
      // Override console methods to send to Application Insights
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      
      console.log = function(...args: any[]) {
        originalConsoleLog.apply(console, args);
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        appInsights.defaultClient.trackTrace({
          message: message,
          severity: '1'
        });
      };
      
      console.error = function(...args: any[]) {
        originalConsoleError.apply(console, args);
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        appInsights.defaultClient.trackTrace({
          message: message,
          severity: '3'
        });
      };
      
      console.warn = function(...args: any[]) {
        originalConsoleWarn.apply(console, args);
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        appInsights.defaultClient.trackTrace({
          message: message,
          severity: '2'
        });
      };
      
      console.log('[App Insights] Initialized for Next.js server-side telemetry with console override');
    } else {
      console.log('[App Insights] Not configured (skipped in development mode)');
    }
  }
}
`;
  fs.writeFileSync(path.join(projectDir, 'instrumentation.ts'), instrumentationContent);

  // 8. Create .env.local for local development
  const envLocalContent = [
    '# Azure Functions Backend URL (Local)',
    'BACKEND_FUNCTIONS_BASE_URL=http://localhost:7071',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(projectDir, '.env.local'), envLocalContent);

  // 8. Create staticwebapp.config.json for Azure Static Web Apps (Next.js Hybrid Rendering)
  const swaConfig = {
    platform: {
      apiRuntime: "node:20"
    },
    routes: [
      {
        route: "/*",
        allowedRoles: ["anonymous"]
      }
    ],
    globalHeaders: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block"
    },
    mimeTypes: {
      ".json": "application/json"
    }
  };
  fs.writeFileSync(
    path.join(projectDir, 'staticwebapp.config.json'),
    JSON.stringify(swaConfig, null, 2)
  );

  // 14. Create Azure Functions project
  await createAzureFunctionsProject(projectDir, pm, backendLanguage);

  // 15. Create BFF API route to call Azure Functions
  await createBffApiRoute(projectDir);

  // 16. Create home page
  await createHomePage(projectDir, pm);

  // 17. Install all workspace dependencies (root + shared + functions)
  console.log('📦 Installing workspace dependencies...\n');
  await installDependencies(projectDir, pm);

  console.log('✅ Project structure created\n');

  // 18. Create README.md
  createReadme(projectDir, projectName, cicdChoice, azureConfig, pm, backendLanguage);

  // 19. Create AI agent instruction files (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, etc.)
  createAiAgentFiles(projectDir, projectName, backendLanguage);
}

async function createSharedPackage(projectDir: string, projectName: string) {
  console.log('📦 Creating shared workspace package for Zod models...\n');

  const sharedDir = path.join(projectDir, 'shared');
  const modelsDir = path.join(sharedDir, 'models');
  fs.mkdirSync(modelsDir, { recursive: true });

  // shared/package.json
  const sharedPackageJson = {
    name: `@${projectName}/shared`,
    version: '1.0.0',
    description: 'Shared Zod models — Single Source of Truth for validation schemas',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      watch: 'tsc --watch',
    },
    dependencies: {
      'zod': '>=3.25.0',
    },
    devDependencies: {
      'typescript': '^5.0.0',
    },
  };
  fs.writeFileSync(
    path.join(sharedDir, 'package.json'),
    JSON.stringify(sharedPackageJson, null, 2)
  );

  // shared/tsconfig.json
  const sharedTsConfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      moduleResolution: 'node',
      lib: ['ES2020'],
      outDir: 'dist',
      rootDir: '.',
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['index.ts', 'models/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  fs.writeFileSync(
    path.join(sharedDir, 'tsconfig.json'),
    JSON.stringify(sharedTsConfig, null, 2)
  );

  // shared/index.ts (empty re-export file, scaffold will add entries)
  fs.writeFileSync(
    path.join(sharedDir, 'index.ts'),
    `// Shared Zod models — auto-managed by SwallowKit scaffold command\n// Do not edit the export list below manually\n`
  );

  // shared/.gitignore
  fs.writeFileSync(
    path.join(sharedDir, '.gitignore'),
    `node_modules\ndist\n`
  );

  console.log('✅ Shared package created\n');
}

async function createAzureFunctionsProject(
  projectDir: string,
  pm: PackageManager = 'pnpm',
  backendLanguage: BackendLanguage = 'typescript'
) {
  console.log(`📦 Creating Azure Functions project (${getBackendLanguageLabel(backendLanguage)})...\n`);

  const functionsDir = path.join(projectDir, 'functions');
  fs.mkdirSync(functionsDir, { recursive: true });

  const projectName = path.basename(projectDir);
  const databaseName = `${projectName.charAt(0).toUpperCase() + projectName.slice(1)}Database`;

  createFunctionsHostFiles(functionsDir, databaseName, backendLanguage);

  if (backendLanguage === 'typescript') {
    createTypeScriptFunctionsProject(projectDir, functionsDir, pm);
  } else if (backendLanguage === 'csharp') {
    createCSharpFunctionsProject(projectDir, functionsDir);
  } else {
    createPythonFunctionsProject(projectDir, functionsDir);
  }

  console.log('✅ Azure Functions project created\n');
}

function createFunctionsHostFiles(functionsDir: string, databaseName: string, backendLanguage: BackendLanguage): void {
  const hostJson = {
    version: '2.0',
    logging: {
      applicationInsights: {
        samplingSettings: {
          isEnabled: true,
          maxTelemetryItemsPerSecond: 20,
        },
      },
    },
    extensionBundle: {
      id: 'Microsoft.Azure.Functions.ExtensionBundle',
      version: '[4.0.0, 4.10.0)',
    },
  };
  fs.writeFileSync(path.join(functionsDir, 'host.json'), JSON.stringify(hostJson, null, 2));

  const localSettings = {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage: '',
      FUNCTIONS_WORKER_RUNTIME: getFunctionsWorkerRuntime(backendLanguage),
      AzureWebJobsFeatureFlags: 'EnableWorkerIndexing',
      CosmosDBConnection: 'AccountEndpoint=http://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
      COSMOS_DB_DATABASE_NAME: databaseName,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    },
  };
  fs.writeFileSync(path.join(functionsDir, 'local.settings.json'), JSON.stringify(localSettings, null, 2));

  const gitignoreLines = [
    'local.settings.json',
    '*.log',
    '.vscode',
    '.DS_Store',
  ];

  if (backendLanguage === 'typescript') {
    gitignoreLines.unshift('node_modules', 'dist');
    fs.writeFileSync(path.join(functionsDir, '.funcignore'), `node_modules
.git
.vscode
local.settings.json
test
tsconfig.json
*.ts
!dist/**/*.js
`);
  } else if (backendLanguage === 'python') {
    gitignoreLines.unshift('.venv', '__pycache__', '.python_packages');
    fs.writeFileSync(path.join(functionsDir, '.funcignore'), `.venv
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
local.settings.json
tests
`);
  } else {
    gitignoreLines.unshift('bin', 'obj');
    fs.writeFileSync(path.join(functionsDir, '.funcignore'), `bin
obj
local.settings.json
tests
`);
  }

  fs.writeFileSync(path.join(functionsDir, '.gitignore'), `${gitignoreLines.join('\n')}\n`);
}

function createTypeScriptFunctionsProject(projectDir: string, functionsDir: string, pm: PackageManager): void {
  const functionsPackageJson = {
    name: 'functions',
    version: '1.0.0',
    description: 'Azure Functions backend',
    main: 'dist/*.js',
    scripts: {
      start: 'func start',
      build: 'tsc',
      prestart: getFunctionsPrestart(pm),
    },
    dependencies: {
      '@azure/functions': '~4.5.0',
      '@azure/cosmos': '^4.0.0',
      '@azure/identity': '^4.0.0',
      zod: '>=3.25.0',
      [`@${path.basename(projectDir)}/shared`]: '*',
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      typescript: '^5.0.0',
    },
  };
  fs.writeFileSync(path.join(functionsDir, 'package.json'), JSON.stringify(functionsPackageJson, null, 2));

  const sharedPkgName = `@${path.basename(projectDir)}/shared`;
  const functionsTsConfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      moduleResolution: 'node',
      lib: ['ES2020'],
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      paths: {
        [sharedPkgName]: ['../shared'],
        [`${sharedPkgName}/*`]: ['../shared/*'],
      },
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };
  fs.writeFileSync(path.join(functionsDir, 'tsconfig.json'), JSON.stringify(functionsTsConfig, null, 2));

  const srcDir = path.join(functionsDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'greet.ts'), `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod/v4';

const greetRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be less than 50 characters'),
});

export async function greet(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger function processed a request.');

  try {
    const name = request.query.get('name') || (await request.text());
    const result = greetRequestSchema.safeParse({ name });

    if (!result.success) {
      return {
        status: 400,
        jsonBody: {
          error: result.error.issues[0].message
        }
      };
    }

    const greeting = \`Hello, \${result.data.name}! This message is from Azure Functions.\`;

    return {
      status: 200,
      jsonBody: {
        message: greeting,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    context.error('Error processing request:', error);
    return {
      status: 500,
      jsonBody: {
        error: 'Internal server error'
      }
    };
  }
}

app.http('greet', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: greet
});
`);
}

function createCSharpFunctionsProject(projectDir: string, functionsDir: string): void {
  const projectBaseName = path.basename(projectDir);
  const projectPascal = projectBaseName.charAt(0).toUpperCase() + projectBaseName.slice(1);
  const csprojName = `${projectPascal}.Functions.csproj`;

  fs.writeFileSync(path.join(functionsDir, csprojName), buildCSharpFunctionsProjectSource());

  fs.writeFileSync(path.join(functionsDir, 'Program.cs'), buildCSharpFunctionsProgramSource());

  const crudDir = path.join(functionsDir, 'Crud');
  fs.mkdirSync(crudDir, { recursive: true });
  fs.writeFileSync(path.join(crudDir, 'GreetFunction.cs'), `using System.Net;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace SwallowKit.Functions;

public sealed class GreetFunction
{
    [Function("greet")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "greet")] HttpRequestData request)
    {
        var query = request.Url.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
        var name = "SwallowKit";
        foreach (var segment in query)
        {
            var parts = segment.Split('=', 2);
            if (parts.Length == 2 && parts[0] == "name")
            {
                name = Uri.UnescapeDataString(parts[1]);
                break;
            }
        }
        var response = request.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(new
        {
            message = $"Hello, {name}! This message is from Azure Functions.",
            timestamp = DateTimeOffset.UtcNow.ToString("O"),
        });
        return response;
    }
}
`);
}

function createPythonFunctionsProject(projectDir: string, functionsDir: string): void {
  fs.writeFileSync(path.join(projectDir, '.python-version'), '3.11\n');

  fs.writeFileSync(path.join(functionsDir, 'requirements.txt'), `azure-functions>=1.20.0
azure-cosmos>=4.9.0
azure-identity>=1.19.0
`);

  const blueprintsDir = path.join(functionsDir, 'blueprints');
  fs.mkdirSync(blueprintsDir, { recursive: true });
  fs.writeFileSync(path.join(blueprintsDir, '__init__.py'), '');

  fs.writeFileSync(path.join(blueprintsDir, 'greet.py'), `import json
from datetime import datetime, timezone

import azure.functions as func

bp = func.Blueprint()


@bp.route(route="greet", methods=["GET", "POST"])
def greet(req: func.HttpRequest) -> func.HttpResponse:
    name = req.params.get("name") or "SwallowKit"
    payload = {
        "message": f"Hello, {name}! This message is from Azure Functions.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False),
        status_code=200,
        mimetype="application/json",
    )
`);

  fs.writeFileSync(path.join(functionsDir, 'function_app.py'), `import azure.functions as func

from blueprints.greet import bp as greet_bp

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

app.register_blueprint(greet_bp)
# SwallowKit scaffold registrations
`);
}

async function createBffApiRoute(projectDir: string) {
  console.log('📦 Creating BFF API route...\n');
  
  const apiDir = path.join(projectDir, 'app', 'api', 'greet');
  fs.mkdirSync(apiDir, { recursive: true });

  // Create API route that calls Azure Functions using shared utility
  const apiRoute = `import { NextRequest, NextResponse } from 'next/server';
import { api } from '@/lib/api/backend';

interface GreetResponse {
  message: string;
  timestamp: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'World';

    const data = await api.get<GreetResponse>('/api/greet', { name });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error calling Azure Functions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to call backend function';
    return NextResponse.json(
      { error: errorMessage, details: 'Make sure Azure Functions is running on port 7071' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const data = await api.post<GreetResponse>('/api/greet', body);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error calling Azure Functions:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to call backend function';
    return NextResponse.json(
      { error: errorMessage, details: 'Make sure Azure Functions is running on port 7071' },
      { status: 500 }
    );
  }
}
`;
  fs.writeFileSync(path.join(apiDir, 'route.ts'), apiRoute);

  // Update .env.example to include BACKEND_FUNCTIONS_BASE_URL
  const envExamplePath = path.join(projectDir, '.env.example');
  let envExample = fs.readFileSync(envExamplePath, 'utf-8');
  
  if (!envExample.includes('BACKEND_FUNCTIONS_BASE_URL')) {
    envExample += `\n# Azure Functions Backend URL\nBACKEND_FUNCTIONS_BASE_URL=http://localhost:7071\n`;
    fs.writeFileSync(envExamplePath, envExample);
  }

  // Update .env.local
  const envLocalPath = path.join(projectDir, '.env.local');
  let envLocal = fs.readFileSync(envLocalPath, 'utf-8');
  
  if (!envLocal.includes('BACKEND_FUNCTIONS_BASE_URL')) {
    envLocal += `\n# Azure Functions Backend URL (Local)\nBACKEND_FUNCTIONS_BASE_URL=http://localhost:7071\n`;
    fs.writeFileSync(envLocalPath, envLocal);
  }

  console.log('✅ BFF API route created\n');
}

async function createHomePage(projectDir: string, pm: PackageManager = 'pnpm') {
  console.log('📦 Creating home page...\n');
  
  const pmCmd = getCommands(pm);
  
  const pageContent = `'use client'

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { scaffoldConfig } from '@/lib/scaffold-config';

export default function Home() {
  const [greetingStatus, setGreetingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const testConnection = async () => {
    setGreetingStatus('loading');
    try {
      const response = await fetch('/api/greet?name=SwallowKit');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || \`Server error: \${response.status}\`);
      }
      setMessage(data.message);
      setGreetingStatus('success');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to connect to Azure Functions');
      setGreetingStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-800 dark:text-white mb-4">
            Welcome to SwallowKit
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Next.js on Azure Static Web Apps + Functions + Cosmos DB — Zod schema sharing
          </p>
        </header>

        {/* Connection Test */}
        <section className="max-w-2xl mx-auto mb-12">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Test BFF → Functions Connection
            </h2>
            <button
              onClick={testConnection}
              disabled={greetingStatus === 'loading'}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
            >
              {greetingStatus === 'loading' ? 'Testing...' : 'Test Connection'}
            </button>
            {greetingStatus === 'success' && (
              <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-green-800 dark:text-green-200 font-medium">✅ Connection successful!</p>
                <p className="text-green-700 dark:text-green-300 text-sm mt-1">{message}</p>
              </div>
            )}
            {greetingStatus === 'error' && (
              <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-red-800 dark:text-red-200 font-medium">❌ Connection failed</p>
                <p className="text-red-700 dark:text-red-300 text-sm mt-1">{message}</p>
              </div>
            )}
          </div>
        </section>

        {/* Scaffolded Models Menu */}
        {scaffoldConfig.models.length > 0 ? (
          <section className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold mb-8 text-gray-900 dark:text-gray-100">Your Models</h2>
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {scaffoldConfig.models.map((model) => (
                <a
                  key={model.name}
                  href={model.path}
                  className="block p-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                >
                  <h3 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">{model.label}</h3>
                  <p className="text-gray-600 dark:text-gray-400">Manage {model.label.toLowerCase()}</p>
                </a>
              ))}
            </div>
          </section>
        ) : (
          <section className="max-w-2xl mx-auto text-center">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-12 border border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Get Started</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Create your first model with Zod and generate CRUD operations automatically.
              </p>
              <code className="block bg-gray-100 dark:bg-gray-900 p-4 rounded text-left text-sm">
                ${pmCmd.dlx} swallowkit scaffold shared/models/your-model.ts
              </code>
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-gray-600 dark:text-gray-400 text-sm">
          <p>Built with SwallowKit</p>
        </footer>
      </div>
    </div>
  );
}
`;
  
  fs.writeFileSync(path.join(projectDir, 'app', 'page.tsx'), pageContent);

  console.log('✅ Home page created\n');
  
  // Create initial scaffold-config.ts
  const scaffoldConfigDir = path.join(projectDir, 'lib');
  if (!fs.existsSync(scaffoldConfigDir)) {
    fs.mkdirSync(scaffoldConfigDir, { recursive: true });
  }
  
  const scaffoldConfigContent = `export interface ScaffoldModel {
  name: string;
  path: string;
  label: string;
}

export const scaffoldConfig = {
  models: [
    // Scaffolded models will be added here by 'swallowkit scaffold' command
  ] as ScaffoldModel[]
};
`;
  
  fs.writeFileSync(path.join(scaffoldConfigDir, 'scaffold-config.ts'), scaffoldConfigContent);
  console.log('✅ Scaffold config created\n');
}

function createReadme(
  projectDir: string,
  projectName: string,
  cicdChoice: string,
  azureConfig: AzureConfig,
  pm: PackageManager,
  backendLanguage: BackendLanguage
) {
  console.log('📝 Creating README.md...\n');

  const pmCmd = getCommands(pm);
  const cosmosDbModeLabel = azureConfig.cosmosDbMode === 'freetier' ? 'Free Tier (1000 RU/s)' : 'Serverless';
  const cicdLabel = cicdChoice === 'github' ? 'GitHub Actions' : cicdChoice === 'azure' ? 'Azure Pipelines' : 'None';
  const vnetLabel = azureConfig.vnetOption === 'none' ? 'None (public endpoints)' : 
                    'Outbound VNet (Cosmos DB Private Endpoint)';
  const backendLanguageLabel = getBackendLanguageLabel(backendLanguage);
  const schemaBridgeDescription = backendLanguage === 'typescript'
    ? 'Zod (shared between frontend and backend)'
    : `Zod + OpenAPI bridge (Zod in shared/, generated ${backendLanguageLabel} schemas in functions/generated/)`;
  const functionsTree = backendLanguage === 'typescript'
    ? `│   └── src/\n│       └── greet.ts      # Sample function`
    : backendLanguage === 'csharp'
      ? `│   ├── Crud/\n│   │   └── GreetFunction.cs\n│   └── generated/       # OpenAPI-derived C# models`
      : `│   ├── blueprints/\n│   │   └── greet.py\n│   └── generated/       # OpenAPI-derived Python models`;
  const backendScaffoldNote = backendLanguage === 'typescript'
    ? '- Azure Functions CRUD endpoints'
    : `- Azure Functions ${backendLanguageLabel} CRUD handlers\n- OpenAPI spec + generated ${backendLanguageLabel} schema assets`;
  const pythonLocalDevNote = backendLanguage === 'python'
    ? `\n**Python local dev note**: SwallowKit uses \`functions/.venv\` for local Azure Functions development. If \`uv\` is installed, \`swallowkit dev\` uses it to create/manage that virtual environment; otherwise it falls back to the standard \`venv\` + \`pip\` workflow. Keep \`functions/requirements.txt\` as the dependency source of truth for Azure Functions compatibility.\n`
    : '';

  const readme = `# ${projectName}

A full-stack application built with **SwallowKit** - Next.js on Azure Static Web Apps + Functions + Cosmos DB with Zod schema sharing.

## 🚀 Tech Stack

- **Frontend**: Next.js 15 (App Router), React, TypeScript, Tailwind CSS
- **BFF (Backend for Frontend)**: Next.js API Routes
- **Backend**: Azure Functions (${backendLanguageLabel})
- **Database**: Azure Cosmos DB
- **Schema Validation**: ${schemaBridgeDescription}
- **Infrastructure**: Bicep (Infrastructure as Code)
- **CI/CD**: ${cicdLabel}

## 📋 Project Configuration

This project was initialized with the following settings:

- **Azure Functions Plan**: Flex Consumption
- **Cosmos DB Mode**: ${cosmosDbModeLabel}
- **Network Security**: ${vnetLabel}
- **CI/CD**: ${cicdLabel}

## ✅ Prerequisites

Before you begin, ensure you have the following installed:

1. **Node.js 18+**: [Download](https://nodejs.org/)${pm === 'pnpm' ? `\n2. **pnpm**: \`corepack enable\` or \`npm install -g pnpm\`` : ''}
${pm === 'pnpm' ? '3' : '2'}. **Azure CLI**: Required for provisioning Azure resources
   - Install: \`winget install Microsoft.AzureCLI\` (Windows)
   - Or: [Download](https://aka.ms/installazurecliwindows)
${pm === 'pnpm' ? '4' : '3'}. **Azure Cosmos DB Emulator**: Required for local development
   - Windows: \`winget install Microsoft.Azure.CosmosEmulator\`
   - Or: [Download](https://aka.ms/cosmosdb-emulator)
   - Docker: \`docker pull mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator\`
${pm === 'pnpm' ? '6' : '5'}. **Azure Functions Core Tools**: Automatically installed with project dependencies

## 📁 Project Structure

\`\`\`
${projectName}/
├── app/                    # Next.js App Router (frontend)
│   ├── api/               # BFF API routes (proxy to Functions)
│   └── page.tsx           # Home page
├── functions/             # Azure Functions (backend)
${functionsTree}
├── lib/
│   └── api/               # API client utilities
├── infra/                 # Bicep infrastructure files
│   ├── main.bicep
│   └── modules/           # Bicep modules for each resource
└── .github/workflows/     # CI/CD workflows
\`\`\`

## 🏗️ Getting Started

### 1. Create Your First Model

Define your data model with Zod schema:

\`\`\`bash
${pmCmd.dlx} swallowkit create-model <model-name>
\`\`\`

This creates a model file in \`shared/models/<model-name>.ts\`. Edit it to define your schema.

### 2. Generate CRUD Code

Generate complete CRUD operations (Functions, API routes, UI):

\`\`\`bash
${pmCmd.dlx} swallowkit scaffold shared/models/<model-name>.ts
\`\`\`

This generates:
${backendScaffoldNote}
- Next.js BFF API routes
- React UI components (list, detail, create, edit)
- Navigation menu integration

### 3. Start Development Servers

\`\`\`bash
${pmCmd.dlx} swallowkit dev
\`\`\`

This starts:
- Next.js dev server (http://localhost:3000)
- Azure Functions (http://localhost:7071)
- Cosmos DB Emulator check (must be running separately)

**Note**: You need to start Cosmos DB Emulator manually before running \`swallowkit dev\`.
${pythonLocalDevNote}

## ☁️ Deploy to Azure

### Provision Azure Resources

Create all required Azure resources using Bicep:

\`\`\`bash
${pmCmd.dlx} swallowkit provision --resource-group <rg-name>
\`\`\`

This creates:
- Static Web App (\`swa-${projectName}\`)
- Azure Functions (\`func-${projectName}\`)
- Cosmos DB (\`cosmos-${projectName}\`)
- Storage Account

You will be prompted to select Azure regions:
1. **Primary location**: For Functions and Cosmos DB (default: Japan East)
2. **Static Web App location**: Limited availability (default: East Asia)

### CI/CD Setup

${cicdChoice === 'github' ? `#### GitHub Actions

1. Get Static Web App deployment token:
   \`\`\`bash
   az staticwebapp secrets list --name swa-${projectName} --resource-group <rg-name> --query "properties.apiKey" -o tsv
   \`\`\`

2. Get Function App publish profile:
   \`\`\`bash
   az webapp deployment list-publishing-profiles --name func-${projectName} --resource-group <rg-name> --xml
   \`\`\`

3. Add secrets to GitHub repository:
   - \`AZURE_STATIC_WEB_APPS_API_TOKEN\`: SWA deployment token (from step 1)
   - \`AZURE_FUNCTIONAPP_NAME\`: \`func-${projectName}\`
   - \`AZURE_FUNCTIONAPP_PUBLISH_PROFILE\`: Functions publish profile (from step 2)

4. Push to \`main\` branch to trigger deployment (or use **Actions** → **Run workflow** for manual deployment)` : cicdChoice === 'azure' ? `#### Azure Pipelines

1. Set up service connection in Azure DevOps
2. Update \`azure-pipelines.yml\` with your resource names
3. Configure pipeline variables:
   - \`azureSubscription\`: Service connection name
   - \`resourceGroupName\`: Resource group name
4. Run pipeline to deploy` : `CI/CD is not configured. You can manually deploy:

**Deploy Static Web App:**
\`\`\`bash
${pmCmd.run} build
az staticwebapp deploy --name swa-${projectName} --resource-group <rg-name> --app-location ./
\`\`\`

**Deploy Functions:**
\`\`\`bash
cd functions
${pmCmd.run} build
func azure functionapp publish func-${projectName}
\`\`\``}

## 🔧 Available Commands

- \`${pmCmd.dlx} swallowkit create-model <name>\` - Create a new data model
- \`${pmCmd.dlx} swallowkit scaffold <model-file>\` - Generate CRUD code
- \`${pmCmd.dlx} swallowkit dev\` - Start development servers
- \`${pmCmd.dlx} swallowkit provision -g <rg-name>\` - Provision Azure resources
${azureConfig.vnetOption !== 'none' ? `
## 🔒 Network Security (VNet Configuration)

This project is configured with **${vnetLabel}**.

### Architecture

\`\`\`
Static Web App ──(public)──> Azure Functions ──(VNet/PE)──> Cosmos DB
                                    │
                              VNet Integration
                              (outbound only)
\`\`\`

- **Functions → Cosmos DB**: Connected via Private Endpoint (private connection)
- **SWA → Functions**: Connected via public endpoint (secured with CORS + IP restrictions)

### VNet Resources

| Resource | Purpose |
|----------|---------|
| \`vnet-${projectName}\` | Virtual Network (10.0.0.0/16) |
| \`snet-functions\` | Functions subnet (10.0.1.0/24) |
| \`snet-private-endpoints\` | Private Endpoints subnet (10.0.2.0/24) |
| \`pe-cosmos-${projectName}\` | Cosmos DB Private Endpoint |

### Private DNS Zones

- \`privatelink.documents.azure.com\` (Cosmos DB)
` : ''}
## 📚 Learn More

- [SwallowKit Documentation](https://github.com/himanago/swallowkit)
- [Azure Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/)
- [Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/)
- [Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/)
- [Next.js](https://nextjs.org/)
- [Zod](https://zod.dev/)

## 💭 Feedback

This project was generated by SwallowKit. If you encounter any issues or have suggestions for improvements, please open an issue on the [SwallowKit repository](https://github.com/himanago/swallowkit).
`;

  fs.writeFileSync(path.join(projectDir, 'README.md'), readme);
  console.log('✅ README.md created\n');
}

function createAiAgentFiles(projectDir: string, projectName: string, backendLanguage: BackendLanguage) {
  console.log('🤖 Creating AI agent instruction files...\n');
  const backendLanguageLabel = getBackendLanguageLabel(backendLanguage);
  const functionsStructureLine = backendLanguage === 'typescript'
    ? `│   └── src/               # HTTP trigger handlers with Cosmos DB bindings`
    : backendLanguage === 'csharp'
      ? `│   ├── Crud/              # C# HTTP trigger handlers\n│   └── generated/         # OpenAPI-derived C# schema assets`
      : `│   ├── blueprints/        # Python HTTP trigger handlers\n│   └── generated/         # OpenAPI-derived Python schema assets`;
  const backendSchemaNote = backendLanguage === 'typescript'
    ? `- The shared package (\`@${projectName}/shared\`) is consumed by both Next.js and Azure Functions as a workspace dependency.`
    : `- The frontend/BFF source of truth stays in \`shared/models/\` as Zod schemas.\n- \`swallowkit scaffold\` exports OpenAPI into \`functions/openapi/\` and generates ${backendLanguageLabel} schema assets into \`functions/generated/\` for backend use.`;
  const backendRulesNote = backendLanguage === 'typescript'
    ? `- All CRUD operations and business logic live in \`functions/src/\`.\n- Use Azure Functions Cosmos DB **input/output bindings** (\`extraInputs\`/\`extraOutputs\`) for reads and writes.\n- Use the Cosmos DB SDK client directly **only** for delete operations (bindings do not support delete).\n- Validate all data against Zod schemas before writing to Cosmos DB.\n- The backend auto-generates \`id\` (UUID), \`createdAt\`, and \`updatedAt\` — never trust client-sent values for these fields.`
    : `- All business logic lives in \`functions/\` and the generated handlers perform real Cosmos DB CRUD.\n- Keep Zod schemas in \`shared/models/\` as the source of truth.\n- Regenerate backend contracts with \`swallowkit scaffold shared/models/<name>.ts\` whenever a schema changes.\n- Use the generated OpenAPI-derived models in \`functions/generated/\` to keep backend contracts aligned.\n- The backend should still own \`id\`, \`createdAt\`, and \`updatedAt\`.`;

  // ── 1. AGENTS.md (Codex / generic agents) ──────────────────────────

  const agentsMd = `# AGENTS.md

This project was generated by **SwallowKit**.
All coding agents **must** follow the architecture and conventions described below.

## Architecture Overview

This is a full-stack application deployed on Azure with a TypeScript frontend/BFF and an Azure Functions backend in ${backendLanguageLabel}.

\`\`\`
Frontend (React / Next.js App Router)
  ↓ fetch('/api/{model}', ...)
BFF Layer (Next.js API Routes)
  ↓ HTTP → Azure Functions
Backend (Azure Functions)
  ↓
Azure Cosmos DB (Document Database)
\`\`\`

### Project Structure

\`\`\`
${projectName}/
├── app/                    # Next.js App Router
│   ├── api/               # BFF API routes (proxy to Azure Functions)
│   └── {model}/           # UI pages per model (list, detail, create, edit)
├── functions/             # Azure Functions (backend)
${functionsStructureLine}
├── shared/                # Shared workspace package
│   ├── models/            # Zod schema definitions (single source of truth)
│   └── index.ts           # Re-exports all models
├── lib/
│   └── api/               # API client utilities (backend.ts, call-function.ts)
├── components/            # Shared React components
├── infra/                 # Bicep infrastructure-as-code files
│   ├── main.bicep
│   └── modules/
└── .github/workflows/     # CI/CD workflows (if configured)
\`\`\`

## Critical Design Principles

### 1. Next.js API Routes Are Strictly a BFF (Backend for Frontend)

- \`app/api/\` routes exist **only** to proxy requests to Azure Functions.
- **Never** place business logic, database access, or direct Cosmos DB calls in Next.js API routes.
- The BFF layer may validate input/output with Zod schemas before forwarding to Functions.
- Use the \`callFunction\` helper (\`lib/api/call-function.ts\`) or the \`api\` client (\`lib/api/backend.ts\`) to call Azure Functions.

Example BFF route pattern:

\`\`\`typescript
// app/api/{model}/route.ts
import { callFunction } from '@/lib/api/call-function';
import { ModelSchema } from '@${projectName}/shared';
import { z } from 'zod/v4';

export async function GET() {
  return callFunction({
    method: 'GET',
    path: '/api/{model}',
    responseSchema: z.array(ModelSchema),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return callFunction({
    method: 'POST',
    path: '/api/{model}',
    body,
    inputSchema: ModelSchema.omit({ id: true, createdAt: true, updatedAt: true }),
    responseSchema: ModelSchema,
    successStatus: 201,
  });
}
\`\`\`

### 2. Zod Schemas Are the Single Source of Truth

- All data models are defined **once** as Zod schemas in \`shared/models/\`.
- TypeScript types are derived with \`z.infer<typeof Schema>\` — never define types separately.
- ${backendSchemaNote}

Model definition pattern:

\`\`\`typescript
// shared/models/{model}.ts
import { z } from 'zod/v4';

export const Todo = z.object({
  id: z.string(),
  name: z.string().min(1),
  // ... your fields
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Todo = z.infer<typeof Todo>;
export const displayName = 'Todo';
\`\`\`

Key rules:
- Use the **Zod official pattern**: the schema constant and the TypeScript type share the same name.
- \`id\`, \`createdAt\`, and \`updatedAt\` are auto-managed by the backend. Mark them as \`optional()\` in the schema.
- Always re-export models from \`shared/index.ts\`.

### 3. Azure Functions Own All Business Logic and Data Access

- ${backendRulesNote}

${backendLanguage === 'typescript' ? 'Azure Functions handler pattern:' : `Generated ${backendLanguageLabel} handlers live under \`functions/\`. Re-run \`swallowkit scaffold shared/models/<name>.ts\` after schema changes to keep generated CRUD handlers and \`functions/generated/\` in sync.`}

${backendLanguage === 'typescript' ? `\`\`\`typescript
// functions/src/{model}.ts
import { app } from '@azure/functions';
import { ModelSchema } from '@${projectName}/shared';

const containerName = 'Models'; // PascalCase + 's'

app.http('{model}-get-all', {
  methods: ['GET'],
  route: '{model}',
  authLevel: 'anonymous',
  extraInputs: [{ type: 'cosmosDB', name: 'cosmosInput', containerName, ... }],
  handler: async (request, context) => {
    const documents = context.extraInputs.get('cosmosInput');
    const validated = z.array(ModelSchema).parse(documents);
    return { status: 200, jsonBody: validated };
  },
});
\`\`\`` : ''}

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Model schema file | \`shared/models/{kebab-case}.ts\` | \`shared/models/todo.ts\` |
| Schema/type name | PascalCase (same name for both) | \`export const Todo = z.object({...}); export type Todo = z.infer<typeof Todo>;\` |
| Functions handler file | backend-language specific under \`functions/\` | \`${backendLanguage === 'typescript' ? 'functions/src/todo.ts' : backendLanguage === 'csharp' ? 'functions/Crud/TodoFunctions.cs' : 'functions/blueprints/todo.py'}\` |
| Functions handler name | \`{camelCase}-{operation}\` | \`todo-get-all\`, \`todo-create\` |
| API route path | \`/api/{camelCase}\` | \`/api/todo\`, \`/api/todo/{id}\` |
| BFF route file | \`app/api/{kebab-case}/route.ts\` | \`app/api/todo/route.ts\` |
| BFF detail route | \`app/api/{kebab-case}/[id]/route.ts\` | \`app/api/todo/[id]/route.ts\` |
| UI page directory | \`app/{kebab-case}/\` | \`app/todo/page.tsx\` |
| React component | PascalCase | \`TodoForm.tsx\` |
| Cosmos DB container | PascalCase + 's' | \`Todos\` |
| Cosmos DB partition key | \`/id\` (default) | Custom: \`export const partitionKey = '/field'\` |
| Bicep container file | \`infra/containers/{kebab-case}-container.bicep\` | \`infra/containers/todo-container.bicep\` |

## Adding New Models (SwallowKit CLI Skills)

Use the SwallowKit CLI — do **not** manually create model files or CRUD boilerplate.

### Skill: Create a new data model

\`\`\`bash
npx swallowkit create-model <name>
# Multiple models at once:
npx swallowkit create-model user post comment
\`\`\`

Creates \`shared/models/<name>.ts\` with a Zod schema template including \`id\`, \`createdAt\`, \`updatedAt\`.
Edit the generated file to add your domain-specific fields, then run scaffold.

### Skill: Generate full CRUD from a model

\`\`\`bash
npx swallowkit scaffold shared/models/<name>.ts
\`\`\`

Generates:
- Azure Functions handlers (${backendLanguage === 'typescript' ? '\`functions/src/<name>.ts\`' : '\`functions/\` language-specific CRUD files + \`functions/generated/\` schema assets'})
- BFF API routes (\`app/api/<name>/route.ts\`, \`app/api/<name>/[id]/route.ts\`)
- UI pages (\`app/<name>/page.tsx\`, detail, create, edit pages)
- Cosmos DB Bicep container config (\`infra/containers/<name>-container.bicep\`)

### Skill: Start development servers

\`\`\`bash
npx swallowkit dev
\`\`\`

Runs Next.js (http://localhost:3000) and Azure Functions (http://localhost:7071) concurrently.
Checks for Cosmos DB Emulator availability.

### Skill: Provision Azure resources

\`\`\`bash
npx swallowkit provision --resource-group <name> --location <region>
\`\`\`

Deploys Bicep infrastructure: Static Web Apps, Functions, Cosmos DB, Storage, Managed Identity.

### Typical workflow for "add a new feature/model"

1. \`npx swallowkit create-model <name>\`
2. Edit \`shared/models/<name>.ts\` — add fields
3. \`npx swallowkit scaffold shared/models/<name>.ts\`
4. \`npx swallowkit dev\` — verify at http://localhost:3000/<name>

## Do NOT

- **Do not** put business logic or database calls in \`app/api/\` routes. They are BFF only.
- **Do not** define TypeScript interfaces/types separately from Zod schemas. Always derive types with \`z.infer<>\`.
- **Do not** manually duplicate model definitions across layers. Use the shared package.
- **Do not** manually create CRUD boilerplate. Use \`swallowkit scaffold\`.
- **Do not** hardcode Cosmos DB connection strings. Use Managed Identity (\`CosmosDBConnection__accountEndpoint\`) in production and emulator settings locally.
- By default, all containers use \`/id\` as the partition key. To use a custom partition key, add \`export const partitionKey = '/yourField'\` to the model file. The scaffold command will apply it across all layers.

## Technology Stack

- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS
- **BFF**: Next.js API Routes (proxy only)
- **Backend**: Azure Functions (${backendLanguageLabel})
- **Database**: Azure Cosmos DB (NoSQL)
- **Schema**: Zod (shared across all layers via workspace package)
- **Infrastructure**: Bicep (IaC)
- **Hosting**: Azure Static Web Apps (frontend) + Azure Functions Flex Consumption (backend)
- **Auth**: Azure Managed Identity (no connection strings in production)
- **Monitoring**: Application Insights
`;

  fs.writeFileSync(path.join(projectDir, 'AGENTS.md'), agentsMd);
  console.log('  ✅ AGENTS.md (Codex / generic agents)');

  // ── 2. CLAUDE.md (Claude Code) ─────────────────────────────────────

  const claudeMd = `# CLAUDE.md

This file is for Claude Code. Read AGENTS.md in the project root for the full architecture, conventions, and rules.

## Quick Reference

- **Architecture**: Next.js (frontend) → BFF (API routes, proxy only) → Azure Functions (backend) → Cosmos DB
- **Schema**: Zod schemas in \`shared/models/\` are the single source of truth. Never define types separately.
- **BFF rule**: \`app/api/\` routes must ONLY proxy to Azure Functions via \`callFunction()\`. No business logic.
- **Backend language**: ${backendLanguageLabel}
- **Backend rule**: Regenerate backend contracts with \`swallowkit scaffold\` after schema changes and keep \`functions/generated/\` in sync.

## SwallowKit CLI Commands

| Task | Command |
|------|---------|
| Create model | \`npx swallowkit create-model <name>\` |
| Generate CRUD | \`npx swallowkit scaffold shared/models/<name>.ts\` |
| Dev servers | \`npx swallowkit dev\` |
| Provision Azure | \`npx swallowkit provision --resource-group <rg> --location <region>\` |

## Workflow: Add a new model

1. \`npx swallowkit create-model <name>\`
2. Edit \`shared/models/<name>.ts\` — add your fields
3. \`npx swallowkit scaffold shared/models/<name>.ts\`
4. \`npx swallowkit dev\` — verify at http://localhost:3000/<name>
`;

  fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), claudeMd);
  console.log('  ✅ CLAUDE.md (Claude Code)');

  // ── 3. .github/copilot-instructions.md (GitHub Copilot) ────────────

  const ghDir = path.join(projectDir, '.github');
  fs.mkdirSync(ghDir, { recursive: true });

  const copilotInstructions = `# Copilot Instructions

This project was generated by **SwallowKit**. See \`AGENTS.md\` in the project root for the full specification.

## Architecture (3-layer)

\`\`\`
Frontend (Next.js App Router) → BFF (Next.js API Routes) → Backend (Azure Functions) → Cosmos DB
\`\`\`

## Key Rules

1. **BFF is proxy only** — \`app/api/\` routes call Azure Functions via \`callFunction()\`. No business logic, no direct DB access.
2. **Zod = single source of truth** — Models live in \`shared/models/\`. Types are derived with \`z.infer<>\`. Never define types separately.
3. **Backend owns data** — All CRUD and business logic stay in \`functions/\`, and generated contract assets under \`functions/generated/\` must stay aligned with \`shared/models/\`.
4. **Use the CLI** — Run \`npx swallowkit create-model <name>\` then \`npx swallowkit scaffold shared/models/<name>.ts\` to add models. Do not create boilerplate manually.

## Naming

- Schema/type: PascalCase, same name for both (\`export const Todo = z.object({...}); export type Todo = z.infer<typeof Todo>;\`)
- Files: kebab-case (\`shared/models/todo.ts\`, backend handlers under \`functions/\`)
- Cosmos DB containers: PascalCase + 's' (\`Todos\`), partition key default \`/id\` (customizable via \`export const partitionKey\`)

## Managed Fields

\`id\`, \`createdAt\`, \`updatedAt\` are auto-managed by the backend. Define them as \`optional()\` in schemas. Never trust client-sent values.
`;

  fs.writeFileSync(path.join(ghDir, 'copilot-instructions.md'), copilotInstructions);
  console.log('  ✅ .github/copilot-instructions.md (GitHub Copilot)');

  // ── 4. .github/instructions/*.instructions.md (Copilot layer-specific) ──

  const instructionsDir = path.join(ghDir, 'instructions');
  fs.mkdirSync(instructionsDir, { recursive: true });

  // 4a. shared/models — Zod schema layer
  const sharedModelsInstructions = `---
applyTo: "shared/models/**"
---

# Shared Models — Zod Schema Rules

Files in this directory are the **single source of truth** for data models across the entire application.

## Rules

- Define Zod schemas using \`zod/v4\` (\`import { z } from 'zod/v4'\`).
- Use the **Zod official pattern**: the schema constant and the TypeScript type share the same name.
  \`\`\`typescript
  export const Todo = z.object({ ... });
  export type Todo = z.infer<typeof Todo>;
  \`\`\`
- Always include \`id: z.string()\`, \`createdAt: z.string().optional()\`, \`updatedAt: z.string().optional()\`. These are managed by the backend.
- Export a \`displayName\` string constant for UI display.
- Re-export every model from \`shared/index.ts\`.
- For relationships, use **nested schemas** (import and embed the related schema), not ID references.
- After editing a model, run \`npx swallowkit scaffold shared/models/<name>.ts\` to regenerate CRUD code.
`;

  fs.writeFileSync(
    path.join(instructionsDir, 'shared-models.instructions.md'),
    sharedModelsInstructions
  );

  // 4b. app/api — BFF layer
  const bffInstructions = `---
applyTo: "app/api/**"
---

# BFF API Routes — Rules

Files in \`app/api/\` are the **BFF (Backend for Frontend)** layer. They exist solely to proxy requests to Azure Functions.

## Rules

- **Never** put business logic, database access, or direct Cosmos DB calls here.
- Use \`callFunction()\` from \`@/lib/api/call-function\` to forward requests to Azure Functions.
- You may validate input/output with Zod schemas before forwarding.
- Import schemas from \`@${projectName}/shared\`.

## Pattern

\`\`\`typescript
import { callFunction } from '@/lib/api/call-function';
import { ModelSchema } from '@${projectName}/shared';
import { z } from 'zod/v4';

export async function GET() {
  return callFunction({
    method: 'GET',
    path: '/api/{model}',
    responseSchema: z.array(ModelSchema),
  });
}
\`\`\`
`;

  fs.writeFileSync(
    path.join(instructionsDir, 'bff-routes.instructions.md'),
    bffInstructions
  );

  // 4c. functions — Azure Functions backend layer
  const functionsInstructions = `---
applyTo: "functions/**"
---

# Azure Functions — Backend Rules

Files in \`functions/\` contain all business logic and data access for this application.

## Rules

- Keep backend contracts aligned with \`shared/models/\` by rerunning \`swallowkit scaffold\` after schema changes.
- For TypeScript backends, use Cosmos DB **input/output bindings** (\`extraInputs\`/\`extraOutputs\`) for reads and writes.
- For C#/Python backends, consume the generated OpenAPI-derived assets in \`functions/generated/\`.
- Auto-generate \`id\` (UUID), \`createdAt\`, and \`updatedAt\` on the backend. Never trust client-sent values.
- Container names are PascalCase + 's' (e.g., \`Todos\`). Partition key defaults to \`/id\` but can be customized per model.

## Handler Pattern

\`\`\`typescript
import { app } from '@azure/functions';
import { ModelSchema } from '@${projectName}/shared';

app.http('{model}-get-all', {
  methods: ['GET'],
  route: '{model}',
  authLevel: 'anonymous',
  extraInputs: [cosmosInput],
  handler: async (request, context) => {
    const documents = context.extraInputs.get(cosmosInput);
    const validated = z.array(ModelSchema).parse(documents);
    return { status: 200, jsonBody: validated };
  },
});
\`\`\`
`;

  fs.writeFileSync(
    path.join(instructionsDir, 'azure-functions.instructions.md'),
    functionsInstructions
  );

  console.log('  ✅ .github/instructions/ (Copilot layer-specific instructions)');
  console.log('     - shared-models.instructions.md');
  console.log('     - bff-routes.instructions.md');
  console.log('     - azure-functions.instructions.md');

  console.log('\n✅ AI agent files created\n');
  console.log('   Supported agents:');
  console.log('   - OpenAI Codex          → AGENTS.md');
  console.log('   - Claude Code           → CLAUDE.md (+ AGENTS.md)');
  console.log('   - GitHub Copilot        → .github/copilot-instructions.md');
  console.log('   - GitHub Copilot (edit) → .github/instructions/*.instructions.md');
  console.log('');
}

async function createInfrastructure(
  projectDir: string,
  projectName: string,
  azureConfig: AzureConfig,
  backendLanguage: BackendLanguage
) {
  console.log('📦 Creating infrastructure files (Bicep)...\n');
  
  const infraDir = path.join(projectDir, 'infra');
  const modulesDir = path.join(infraDir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });

  const enableVNet = azureConfig.vnetOption !== 'none';
  const functionsRuntime = getFunctionsRuntimeConfig(backendLanguage);

  // main.bicep
  const mainBicep = `targetScope = 'resourceGroup'

@description('Project name')
param projectName string

@description('Location for Functions and Cosmos DB')
param location string = resourceGroup().location

@description('Location for Static Web App (must be explicitly provided)')
param swaLocation string

@description('Cosmos DB mode')
@allowed(['freetier', 'serverless'])
param cosmosDbMode string = '${azureConfig.cosmosDbMode}'

@description('Enable VNet integration')
param enableVNet bool = ${enableVNet}

// Shared Log Analytics Workspace (in Functions region for data residency)
module logAnalytics 'modules/loganalytics.bicep' = {
  name: 'logAnalytics'
  params: {
    name: 'log-\${projectName}'
    location: location
  }
}

// Application Insights for Static Web App (must be in same region as SWA)
module appInsightsSwa 'modules/appinsights.bicep' = {
  name: 'appInsightsSwa'
  params: {
    name: 'appi-\${projectName}-swa'
    location: swaLocation
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
  }
}

// Application Insights for Functions (in same region as Functions)
module appInsightsFunctions 'modules/appinsights.bicep' = {
  name: 'appInsightsFunctions'
  params: {
    name: 'appi-\${projectName}-func'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
  }
}

// Static Web App
module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticWebApp'
  params: {
    name: 'swa-\${projectName}'
    location: swaLocation
    sku: 'Standard'
    appInsightsConnectionString: appInsightsSwa.outputs.connectionString
  }
}

// VNet (conditional)
module vnet 'modules/vnet.bicep' = if (enableVNet) {
  name: 'vnet'
  params: {
    name: 'vnet-\${projectName}'
    location: location
  }
}

// Cosmos DB (conditional based on mode) - Deploy BEFORE Functions
module cosmosDbFreeTier 'modules/cosmosdb-freetier.bicep' = if (cosmosDbMode == 'freetier') {
  name: 'cosmosDb'
  params: {
    accountName: 'cosmos-\${projectName}'
    databaseName: '\${projectName}Database'
    location: location
    publicNetworkAccess: enableVNet ? 'Disabled' : 'Enabled'
  }
}

module cosmosDbServerless 'modules/cosmosdb-serverless.bicep' = if (cosmosDbMode == 'serverless') {
  name: 'cosmosDb'
  params: {
    accountName: 'cosmos-\${projectName}'
    databaseName: '\${projectName}Database'
    location: location
    publicNetworkAccess: enableVNet ? 'Disabled' : 'Enabled'
  }
}

// Cosmos DB Private Endpoint (conditional)
module cosmosPrivateEndpoint 'modules/private-endpoint-cosmos.bicep' = if (enableVNet) {
  name: 'cosmosPrivateEndpoint'
  params: {
    name: 'pe-cosmos-\${projectName}'
    location: location
    cosmosAccountId: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.id : cosmosDbServerless.outputs.id
    cosmosAccountName: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.accountName : cosmosDbServerless.outputs.accountName
    subnetId: vnet.outputs.privateEndpointSubnetId
    vnetId: vnet.outputs.id
  }
  dependsOn: [
    cosmosDbFreeTier
    cosmosDbServerless
    vnet
  ]
}

// Azure Functions (Flex Consumption) - Deploy AFTER Cosmos DB
module functionsFlex 'modules/functions-flex.bicep' = {
  name: 'functionsApp'
    params: {
      name: 'func-\${projectName}'
      location: location
      storageAccountName: 'stg\${uniqueString(resourceGroup().id, projectName)}'
      appInsightsConnectionString: appInsightsFunctions.outputs.connectionString
      swaDefaultHostname: staticWebApp.outputs.defaultHostname
      cosmosDbEndpoint: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.endpoint : cosmosDbServerless.outputs.endpoint
      cosmosDbDatabaseName: cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.databaseName : cosmosDbServerless.outputs.databaseName
      functionsRuntimeName: '${functionsRuntime.name}'
      functionsRuntimeVersion: '${functionsRuntime.version}'
      enableVNet: enableVNet
      vnetSubnetId: enableVNet ? vnet.outputs.functionsSubnetId : ''
  }
  dependsOn: [
    cosmosDbFreeTier
    cosmosDbServerless
    cosmosPrivateEndpoint
  ]
}

// Cosmos DB role assignment for Functions (after Functions is created)
module cosmosDbRoleAssignmentFreeTier 'modules/cosmosdb-role-assignment.bicep' = if (cosmosDbMode == 'freetier') {
  name: 'cosmosDbRoleAssignment'
  params: {
    cosmosAccountName: cosmosDbFreeTier.outputs.accountName
    functionsPrincipalId: functionsFlex.outputs.principalId
  }
  dependsOn: [
    functionsFlex
  ]
}

module cosmosDbRoleAssignmentServerless 'modules/cosmosdb-role-assignment.bicep' = if (cosmosDbMode == 'serverless') {
  name: 'cosmosDbRoleAssignment'
  params: {
    cosmosAccountName: cosmosDbServerless.outputs.accountName
    functionsPrincipalId: functionsFlex.outputs.principalId
  }
  dependsOn: [
    functionsFlex
  ]
}

// Update SWA config with Functions hostname (after Functions deployment)
module staticWebAppConfig 'modules/staticwebapp-config.bicep' = {
  name: 'staticWebAppConfig'
  params: {
    staticWebAppName: staticWebApp.outputs.name
    functionsDefaultHostname: functionsFlex.outputs.defaultHostname
    appInsightsConnectionString: appInsightsSwa.outputs.connectionString
  }
  dependsOn: [
    functionsFlex
  ]
}

output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppUrl string = staticWebApp.outputs.defaultHostname
output functionsAppName string = functionsFlex.outputs.name
output functionsAppUrl string = functionsFlex.outputs.defaultHostname
output cosmosDbAccountName string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.accountName : cosmosDbServerless.outputs.accountName
output cosmosDbEndpoint string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.endpoint : cosmosDbServerless.outputs.endpoint
output cosmosDatabaseName string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.databaseName : cosmosDbServerless.outputs.databaseName
output logAnalyticsWorkspaceName string = logAnalytics.outputs.name
output logAnalyticsWorkspaceId string = logAnalytics.outputs.id
output appInsightsSwaName string = appInsightsSwa.outputs.name
output appInsightsSwaConnectionString string = appInsightsSwa.outputs.connectionString
output appInsightsFunctionsName string = appInsightsFunctions.outputs.name
output appInsightsFunctionsConnectionString string = appInsightsFunctions.outputs.connectionString
output vnetEnabled bool = enableVNet
output vnetName string = enableVNet ? vnet.outputs.name : ''
`;
  
  fs.writeFileSync(path.join(infraDir, 'main.bicep'), mainBicep);
  
  // main.parameters.json
  const params = `{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "projectName": {
      "value": "${projectName}"
    },
    "cosmosDbMode": {
      "value": "${azureConfig.cosmosDbMode}"
    },
    "enableVNet": {
      "value": ${enableVNet}
    }
  }
}
`;
  fs.writeFileSync(path.join(infraDir, 'main.parameters.json'), params);
  
  // modules/staticwebapp.bicep
  const staticWebAppBicep = `@description('Static Web App name')
param name string

@description('Location for the Static Web App')
param location string

@description('SKU name (Free or Standard)')
@allowed([
  'Free'
  'Standard'
])
param sku string = 'Standard'

@description('Application Insights connection string')
param appInsightsConnectionString string

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: name
  location: location
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// Link Application Insights to Static Web App (for both client and server-side telemetry)
resource staticWebAppConfig 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
  }
}

output id string = staticWebApp.id
output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
`;
  fs.writeFileSync(path.join(modulesDir, 'staticwebapp.bicep'), staticWebAppBicep);

  // modules/staticwebapp-config.bicep (for updating config after Functions deployment)
  const staticWebAppConfigBicep = `@description('Static Web App name')
param staticWebAppName string

@description('Functions App default hostname for backend API calls')
param functionsDefaultHostname string

@description('Application Insights connection string for SWA')
param appInsightsConnectionString string

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' existing = {
  name: staticWebAppName
}

resource staticWebAppConfig 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
    BACKEND_FUNCTIONS_BASE_URL: 'https://\${functionsDefaultHostname}'
  }
}

output configName string = staticWebAppConfig.name
`;
  fs.writeFileSync(path.join(modulesDir, 'staticwebapp-config.bicep'), staticWebAppConfigBicep);
  
  // modules/loganalytics.bicep (Shared Log Analytics Workspace)
  const logAnalyticsBicep = `@description('Log Analytics workspace name')
param name string

@description('Location for Log Analytics workspace')
param location string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

output id string = logAnalytics.id
output name string = logAnalytics.name
`;
  fs.writeFileSync(path.join(modulesDir, 'loganalytics.bicep'), logAnalyticsBicep);
  
  // modules/appinsights.bicep (Application Insights only, connects to shared Log Analytics)
  const appInsightsBicep = `@description('Application Insights name')
param name string

@description('Location for Application Insights')
param location string

@description('Log Analytics workspace resource ID')
param logAnalyticsWorkspaceId string

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: name
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceId
    RetentionInDays: 30
  }
}

output id string = appInsights.id
output name string = appInsights.name
output connectionString string = appInsights.properties.ConnectionString
output instrumentationKey string = appInsights.properties.InstrumentationKey
`;
  fs.writeFileSync(path.join(modulesDir, 'appinsights.bicep'), appInsightsBicep);
  
  // modules/functions-flex.bicep (Flex Consumption)
  const functionsFlexBicep = `@description('Functions App name')
param name string

@description('Location for the Functions App')
param location string

@description('Storage account name for Functions')
param storageAccountName string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Static Web App default hostname for CORS')
param swaDefaultHostname string

@description('Cosmos DB endpoint')
param cosmosDbEndpoint string

@description('Cosmos DB database name')
param cosmosDbDatabaseName string

@description('Enable VNet integration')
param enableVNet bool = false

@description('VNet subnet ID for Functions (required if enableVNet is true)')
param vnetSubnetId string = ''

@description('Functions runtime name')
param functionsRuntimeName string

@description('Functions runtime version')
param functionsRuntimeVersion string

// Storage Account for Functions
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// Blob Service for deployment package container
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// Deployment package container
resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'deploymentpackage'
  properties: {
    publicAccess: 'None'
  }
}

// App Service Plan (Flex Consumption)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '\${name}-plan'
  location: location
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true // Required for Linux
  }
}

// Azure Functions App
resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    reserved: true
    virtualNetworkSubnetId: enableVNet ? vnetSubnetId : null
    vnetContentShareEnabled: enableVNet
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '\${storageAccount.properties.primaryEndpoints.blob}deploymentpackage'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 100
        instanceMemoryMB: 2048
      }
      runtime: {
        name: functionsRuntimeName
        version: functionsRuntimeVersion
      }
    }
    siteConfig: {
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccount.name
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'CosmosDBConnection__accountEndpoint'
          value: cosmosDbEndpoint
        }
        {
          name: 'COSMOS_DB_DATABASE_NAME'
          value: cosmosDbDatabaseName
        }
      ]
      cors: {
        allowedOrigins: [
          'https://\${swaDefaultHostname}'
        ]
      }
      ipSecurityRestrictions: [
        {
          action: 'Allow'
          ipAddress: 'AzureCloud'
          tag: 'ServiceTag'
          priority: 100
        }
      ]
    }
    httpsOnly: true
  }
}

// Role Assignment: Storage Blob Data Contributor
resource blobDataContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(functionApp.id, storageAccount.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output id string = functionApp.id
output name string = functionApp.name
output defaultHostname string = functionApp.properties.defaultHostName
output principalId string = functionApp.identity.principalId
`;
  fs.writeFileSync(path.join(modulesDir, 'functions-flex.bicep'), functionsFlexBicep);
  
  // modules/cosmosdb-freetier.bicep (Free Tier)
  const cosmosDbFreeTierBicep = `@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string

@description('Location for Cosmos DB')
param location string

@description('Public network access')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'

// Cosmos DB Account (Free Tier)
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
    enableFreeTier: true
    publicNetworkAccess: publicNetworkAccess
    disableLocalAuth: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    disableKeyBasedMetadataWriteAccess: true
  }
}

// Cosmos DB Database
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
    options: {
      throughput: 1000
    }
  }
}

output id string = cosmosAccount.id
output accountName string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output databaseName string = database.name
`;
  fs.writeFileSync(path.join(modulesDir, 'cosmosdb-freetier.bicep'), cosmosDbFreeTierBicep);
  
  // modules/cosmosdb-serverless.bicep (Serverless)
  const cosmosDbServerlessBicep = `@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string

@description('Location for Cosmos DB')
param location string

@description('Public network access')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'

// Cosmos DB Account (Serverless)
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
    publicNetworkAccess: publicNetworkAccess
    disableLocalAuth: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    disableKeyBasedMetadataWriteAccess: true
  }
}

// Cosmos DB Database
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

output id string = cosmosAccount.id
output accountName string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output databaseName string = database.name
`;
  fs.writeFileSync(path.join(modulesDir, 'cosmosdb-serverless.bicep'), cosmosDbServerlessBicep);

  // modules/cosmosdb-role-assignment.bicep (Role Assignment Module)
  const cosmosDbRoleAssignmentBicep = `@description('Cosmos DB account name')
param cosmosAccountName string

@description('Functions App Managed Identity Principal ID')
param functionsPrincipalId string

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: cosmosAccountName
}

// Built-in Cosmos DB Data Contributor role definition
var cosmosDbDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// Role assignment for Functions to access Cosmos DB
resource roleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionsPrincipalId, cosmosDbDataContributorRoleId)
  properties: {
    roleDefinitionId: '\${cosmosAccount.id}/sqlRoleDefinitions/\${cosmosDbDataContributorRoleId}'
    principalId: functionsPrincipalId
    scope: cosmosAccount.id
  }
}

output roleAssignmentId string = roleAssignment.id
`;
  fs.writeFileSync(path.join(modulesDir, 'cosmosdb-role-assignment.bicep'), cosmosDbRoleAssignmentBicep);

  // VNet modules (only generate if VNet is enabled)
  if (enableVNet) {
    // modules/vnet.bicep
    const vnetBicep = `@description('VNet name')
param name string

@description('Location for VNet')
param location string

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: name
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'snet-functions'
        properties: {
          addressPrefix: '10.0.1.0/24'
          delegations: [
            {
              name: 'delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: '10.0.2.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

output id string = vnet.id
output name string = vnet.name
output functionsSubnetId string = vnet.properties.subnets[0].id
output privateEndpointSubnetId string = vnet.properties.subnets[1].id
`;
    fs.writeFileSync(path.join(modulesDir, 'vnet.bicep'), vnetBicep);

    // modules/private-endpoint-cosmos.bicep
    const cosmosPrivateEndpointBicep = `@description('Private endpoint name')
param name string

@description('Location')
param location string

@description('Cosmos DB account resource ID')
param cosmosAccountId string

@description('Cosmos DB account name')
param cosmosAccountName string

@description('Subnet ID for private endpoint')
param subnetId string

@description('VNet ID for DNS zone link')
param vnetId string

// Private DNS Zone for Cosmos DB
resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.documents.azure.com'
  location: 'global'
}

// Link DNS Zone to VNet
resource privateDnsZoneVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: '\${cosmosAccountName}-vnet-link'
  location: 'global'
  properties: {
    virtualNetwork: {
      id: vnetId
    }
    registrationEnabled: false
  }
}

// Private Endpoint for Cosmos DB
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-09-01' = {
  name: name
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '\${cosmosAccountName}-connection'
        properties: {
          privateLinkServiceId: cosmosAccountId
          groupIds: [
            'Sql'
          ]
        }
      }
    ]
  }
}

// DNS Zone Group
resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-09-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos-dns-config'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}

output privateEndpointId string = privateEndpoint.id
output privateDnsZoneId string = privateDnsZone.id
`;
    fs.writeFileSync(path.join(modulesDir, 'private-endpoint-cosmos.bicep'), cosmosPrivateEndpointBicep);

    console.log('✅ VNet modules created\n');
  }

  console.log('✅ Infrastructure files created\n');
}

function getGitHubFunctionsWorkflow(pm: PackageManager, backendLanguage: BackendLanguage): string {
  const pmCmd = getCommands(pm);
  const pnpmSetupStep = getCiSetupStep(pm);

  const commonSetup = `      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
${pnpmSetupStep ? `\n${pnpmSetupStep}\n` : ''}
      - name: Install dependencies
        run: |
          ${pmCmd.ci}
      
      - name: Build shared package
        run: |
          ${pmCmd.runFilter('shared')} build
`;

  if (backendLanguage === 'typescript') {
    return `name: Deploy Azure Functions

on:
  push:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  pull_request:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy Functions
    
    steps:
${commonSetup}      - name: Build Functions
        run: |
          ${pmCmd.runFilter('functions')} build
      
      - name: Prepare functions for deployment
        run: |
          SHARED_PKG_NAME=$(node -p "require('./shared/package.json').name")
          mkdir -p /tmp/fn-deps
          node -e "const p=JSON.parse(require('fs').readFileSync('./functions/package.json','utf8'));Object.keys(p.dependencies).filter(k=>k.endsWith('/shared')).forEach(k=>delete p.dependencies[k]);require('fs').writeFileSync('/tmp/fn-deps/package.json',JSON.stringify(p,null,2));"
          cd /tmp/fn-deps && ${pmCmd.installProd} && cd -
          rm -rf ./functions/node_modules
          mv /tmp/fn-deps/node_modules ./functions/node_modules
          SHARED_DEST="./functions/node_modules/$SHARED_PKG_NAME"
          mkdir -p "$SHARED_DEST"
          cp -r ./shared/dist "$SHARED_DEST/dist"
          cp ./shared/package.json "$SHARED_DEST/package.json"
      
      - name: Deploy to Azure Functions
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/functions-action@v1
        with:
          app-name: \${{ secrets.AZURE_FUNCTIONAPP_NAME }}
          package: './functions'
          publish-profile: \${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
          sku: flexconsumption
`;
  }

  if (backendLanguage === 'csharp') {
    return `name: Deploy Azure Functions

on:
  push:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  pull_request:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy Functions
    
    steps:
${commonSetup}      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Publish Functions
        run: |
          dotnet publish ./functions -c Release -o ./functions/publish
      
      - name: Deploy to Azure Functions
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/functions-action@v1
        with:
          app-name: \${{ secrets.AZURE_FUNCTIONAPP_NAME }}
          package: './functions/publish'
          publish-profile: \${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
          sku: flexconsumption
`;
  }

  return `name: Deploy Azure Functions

on:
  push:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  pull_request:
    branches:
      - main
    paths:
      - 'functions/**'
      - 'shared/**'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy Functions
    
    steps:
${commonSetup}      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Functions dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r ./functions/requirements.txt --target "./functions/.python_packages/lib/site-packages"
      
      - name: Deploy to Azure Functions
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/functions-action@v1
        with:
          app-name: \${{ secrets.AZURE_FUNCTIONAPP_NAME }}
          package: './functions'
          publish-profile: \${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
          sku: flexconsumption
`;
}

function getAzureFunctionsPipeline(pm: PackageManager, backendLanguage: BackendLanguage): string {
  const pmCmd = getCommands(pm);
  const azPipelinesSetup = getAzurePipelinesSetup(pm);
  const commonSetup = `  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
    displayName: 'Install Node.js'
${azPipelinesSetup ? `\n${azPipelinesSetup}\n` : ''}
  - script: |
      ${pmCmd.ci}
    displayName: 'Install workspace dependencies'

  - script: |
      ${pmCmd.runFilter('shared')} build
    displayName: 'Build shared package'
`;

  if (backendLanguage === 'typescript') {
    return `trigger:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pr:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: azure-deployment

steps:
${commonSetup}  - script: |
      ${pmCmd.runFilter('functions')} build
    displayName: 'Build Functions'

  - script: |
      SHARED_PKG_NAME=$(node -p "require('./shared/package.json').name")
      mkdir -p /tmp/fn-deps
      node -e "const p=JSON.parse(require('fs').readFileSync('./functions/package.json','utf8'));Object.keys(p.dependencies).filter(k=>k.endsWith('/shared')).forEach(k=>delete p.dependencies[k]);require('fs').writeFileSync('/tmp/fn-deps/package.json',JSON.stringify(p,null,2));"
      cd /tmp/fn-deps && ${pmCmd.installProd} && cd -
      rm -rf ./functions/node_modules
      mv /tmp/fn-deps/node_modules ./functions/node_modules
      SHARED_DEST="./functions/node_modules/$SHARED_PKG_NAME"
      mkdir -p "$SHARED_DEST"
      cp -r ./shared/dist "$SHARED_DEST/dist"
      cp ./shared/package.json "$SHARED_DEST/package.json"
    displayName: 'Prepare functions for deployment'

  - task: ArchiveFiles@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      rootFolderOrFile: '$(System.DefaultWorkingDirectory)/functions'
      includeRootFolder: false
      archiveType: 'zip'
      archiveFile: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Archive Functions'

  - task: PublishBuildArtifacts@1
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      PathtoPublish: '$(Build.ArtifactStagingDirectory)/functions.zip'
      ArtifactName: 'functions'
    displayName: 'Publish Functions artifact'

  - task: AzureFunctionApp@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      azureSubscription: '$(AZURE_SUBSCRIPTION)'
      appType: 'functionAppLinux'
      appName: '$(AZURE_FUNCTIONAPP_NAME)'
      package: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Deploy to Azure Functions'
`;
  }

  if (backendLanguage === 'csharp') {
    return `trigger:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pr:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: azure-deployment

steps:
${commonSetup}  - task: UseDotNet@2
    inputs:
      version: '8.0.x'
    displayName: 'Install .NET SDK'

  - script: |
      dotnet publish ./functions -c Release -o ./functions/publish
    displayName: 'Publish Functions'

  - task: ArchiveFiles@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      rootFolderOrFile: '$(System.DefaultWorkingDirectory)/functions/publish'
      includeRootFolder: false
      archiveType: 'zip'
      archiveFile: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Archive Functions'

  - task: AzureFunctionApp@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      azureSubscription: '$(AZURE_SUBSCRIPTION)'
      appType: 'functionAppLinux'
      appName: '$(AZURE_FUNCTIONAPP_NAME)'
      package: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Deploy to Azure Functions'
`;
  }

  return `trigger:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pr:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**
      - shared/**

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: azure-deployment

steps:
${commonSetup}  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.11'
    displayName: 'Install Python'

  - script: |
      python -m pip install --upgrade pip
      python -m pip install -r ./functions/requirements.txt --target "./functions/.python_packages/lib/site-packages"
    displayName: 'Install Functions dependencies'

  - task: ArchiveFiles@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      rootFolderOrFile: '$(System.DefaultWorkingDirectory)/functions'
      includeRootFolder: false
      archiveType: 'zip'
      archiveFile: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Archive Functions'

  - task: AzureFunctionApp@2
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      azureSubscription: '$(AZURE_SUBSCRIPTION)'
      appType: 'functionAppLinux'
      appName: '$(AZURE_FUNCTIONAPP_NAME)'
      package: '$(Build.ArtifactStagingDirectory)/functions.zip'
    displayName: 'Deploy to Azure Functions'
`;
}

async function createGitHubActionsWorkflows(
  projectDir: string,
  azureConfig: AzureConfig,
  pm: PackageManager,
  backendLanguage: BackendLanguage
) {
  console.log('📦 Creating GitHub Actions workflows...\n');
  
  const pmCmd = getCommands(pm);
  const workflowsDir = path.join(projectDir, '.github', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });

  // deploy-swa.yml
  const swaWorkflow = `name: Deploy Static Web App

on:
  push:
    branches:
      - main
    paths:
      - 'app/**'
      - 'components/**'
      - 'lib/**'
      - 'shared/**'
      - 'public/**'
      - 'package.json'
      - 'next.config.js'
      - 'next.config.ts'
  workflow_dispatch:
  pull_request:
    branches:
      - main
    paths:
      - 'app/**'
      - 'components/**'
      - 'lib/**'
      - 'shared/**'
      - 'public/**'
      - 'package.json'
      - 'next.config.js'
      - 'next.config.ts'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy Static Web App
    
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
      
      - name: Deploy to Azure Static Web Apps
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: \${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: \${{ secrets.GITHUB_TOKEN }}
          action: 'upload'
          app_location: '/'
          api_location: ''
          output_location: ''
        env:
          NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS: '1'
`;
  fs.writeFileSync(path.join(workflowsDir, 'deploy-swa.yml'), swaWorkflow);
  
  // deploy-functions.yml
  const functionsWorkflow = getGitHubFunctionsWorkflow(pm, backendLanguage);
  fs.writeFileSync(path.join(workflowsDir, 'deploy-functions.yml'), functionsWorkflow);

  console.log('✅ GitHub Actions workflows created\n');
}

async function createAzurePipelines(projectDir: string, pm: PackageManager, backendLanguage: BackendLanguage) {
  console.log('📦 Creating Azure Pipelines...\n');
  
  const pmCmd = getCommands(pm);
  const azPipelinesSetup = getAzurePipelinesSetup(pm);
  const pipelinesDir = path.join(projectDir, 'pipelines');
  fs.mkdirSync(pipelinesDir, { recursive: true });

  // swa.yml
  const swaPipeline = `trigger:
  branches:
    include:
      - main
  paths:
    include:
      - app/**
      - components/**
      - lib/**
      - shared/**
      - public/**
      - package.json
      - next.config.js

pr:
  branches:
    include:
      - main
  paths:
    include:
      - app/**
      - components/**
      - lib/**
      - shared/**
      - public/**
      - package.json
      - next.config.js

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: azure-deployment

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
    displayName: 'Install Node.js'
${azPipelinesSetup ? `\n${azPipelinesSetup}\n` : ''}
  - script: |
      ${pmCmd.ci}
    displayName: 'Install dependencies'

  - script: |
      ${pmCmd.run} build
    env:
      NODE_ENV: production
    displayName: 'Build Next.js app'

  - task: AzureStaticWebApp@0
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      app_location: '.'
      output_location: '.next/standalone'
      skip_app_build: true
      azure_static_web_apps_api_token: $(AZURE_STATIC_WEB_APPS_API_TOKEN)
    displayName: 'Deploy to Azure Static Web Apps'
`;
  fs.writeFileSync(path.join(pipelinesDir, 'swa.yml'), swaPipeline);
  
  // functions.yml
  const functionsPipeline = getAzureFunctionsPipeline(pm, backendLanguage);
  fs.writeFileSync(path.join(pipelinesDir, 'functions.yml'), functionsPipeline);

  console.log('✅ Azure Pipelines created\n');
}


