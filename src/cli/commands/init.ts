import * as fs from "fs";
import * as path from "path";
import { spawn, execSync } from "child_process";
import prompts from "prompts";

interface InitOptions {
  name: string;
  template: string;
  nextVersion?: string;
}

type CiCdProvider = 'github' | 'azure' | 'skip';
type FunctionsPlan = 'flex' | 'premium';
type CosmosDbMode = 'freetier' | 'serverless';

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

async function promptAzureConfig(): Promise<{ functionsPlan: FunctionsPlan; cosmosDbMode: CosmosDbMode }> {
  const functionsResponse = await prompts({
    type: 'select',
    name: 'plan',
    message: 'Azure Functions plan (affects performance and cost):',
    choices: [
      { title: 'Flex Consumption (recommended for most apps)', value: 'flex' },
      { title: 'Premium (always-on, VNet support)', value: 'premium' }
    ],
    initial: 0
  });

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

  return {
    functionsPlan: functionsResponse.plan || 'flex',
    cosmosDbMode: cosmosResponse.mode || 'freetier'
  };
}

export async function initCommand(options: InitOptions) {
  console.log(`🚀 Initializing SwallowKit project: ${options.name}`);
  console.log(`📋 Template: ${options.template}`);

  const projectDir = path.join(process.cwd(), options.name);

  try {
    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      console.error(`❌ Directory "${options.name}" already exists.`);
      process.exit(1);
    }

    // Ask for CI/CD choice FIRST (before long operations)
    const cicdProvider = await promptCiCd();
    
    // Ask for Azure infrastructure configuration
    const azureConfig = await promptAzureConfig();

    // Create Next.js project with create-next-app
    await createNextJsProject(options.name);

    // Upgrade Next.js to specified version (or latest) to avoid cached old versions
    await upgradeNextJs(projectDir, options.nextVersion || 'latest');

    // Add SwallowKit specific files
    await addSwallowKitFiles(projectDir, options, cicdProvider, azureConfig);
    
    // Create infrastructure files (Bicep)
    await createInfrastructure(projectDir, options.name, azureConfig);
    
    // Create CI/CD files based on choice
    if (cicdProvider === 'github') {
      await createGitHubActionsWorkflows(projectDir, azureConfig);
    } else if (cicdProvider === 'azure') {
      await createAzurePipelines(projectDir);
    }

    // Rename git branch from master to main
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      try {
        execSync('git branch -M main', { cwd: projectDir, stdio: 'ignore' });
        console.log('✅ Git branch renamed to main\n');
      } catch (error) {
        console.warn('⚠️  Could not rename git branch to main');
      }
    }

    console.log(`\n✅ Project "${options.name}" created successfully!`);
    console.log("\n📝 Next steps:");
    console.log(`  cd ${options.name}`);
    console.log("  npx swallowkit create-model <name>  # Create your first model");
    console.log("  npx swallowkit scaffold lib/models/<name>.ts  # Generate CRUD code");
    console.log("  npx swallowkit dev  # Start development servers");
    console.log("\n🚀 Deploy to Azure:");
    console.log("  npx swallowkit provision --resource-group <name>");
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

async function createNextJsProject(projectName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n📦 Creating Next.js project with create-next-app...\n');
    
    // Run create-next-app with recommended options for Azure
    const createNextApp = spawn(
      'npx',
      [
        'create-next-app@latest',
        projectName,
        '--typescript',
        '--tailwind',
        '--app',
        '--no-src',
        '--import-alias',
        '@/*',
        '--use-npm',
        '--yes'
      ],
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

async function upgradeNextJs(projectDir: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Installing Next.js ${version} (to ensure latest security patches)...\n`);
    
    const npmInstall = spawn(
      'npm',
      [
        'install',
        `next@${version}`,
        `react@latest`,
        `react-dom@latest`,
        '--save-exact'
      ],
      {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true,
      }
    );

    npmInstall.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`npm install next@${version} exited with code ${code}`));
      } else {
        console.log(`\n✅ Next.js ${version} installed\n`);
        resolve();
      }
    });

    npmInstall.on('error', (error: Error) => {
      reject(error);
    });
  });
}

async function installDependencies(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n📦 Installing dependencies...\n');
    
    const npmInstall = spawn(
      'npm',
      ['install'],
      {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true,
      }
    );

    npmInstall.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`npm install exited with code ${code}`));
      } else {
        console.log('\n✅ Dependencies installed\n');
        resolve();
      }
    });

    npmInstall.on('error', (error: Error) => {
      reject(error);
    });
  });
}

async function addSwallowKitFiles(projectDir: string, options: InitOptions, cicdChoice: string, azureConfig: { functionsPlan: FunctionsPlan; cosmosDbMode: CosmosDbMode }) {
  console.log('📦 Adding SwallowKit files...\n');
  
  const projectName = options.name;

  // 1. Update package.json to add swallowkit and @azure/cosmos dependencies
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // Add SwallowKit dependencies (Next.js version already upgraded by upgradeNextJs)
  packageJson.dependencies = {
    ...packageJson.dependencies,
    'swallowkit': 'latest',
    '@azure/cosmos': '^4.0.0',
    'zod': '^3.25.0',
    'applicationinsights': '^3.3.0',
  };
  
  packageJson.scripts = {
    ...packageJson.scripts,
    'build': 'next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/',
    'start': 'node --require ./load-appinsights.js node_modules/next/dist/compiled/cli/next-start.js',
    'build:azure': 'swallowkit build',
    'deploy': 'swallowkit deploy',
    'functions:start': 'cd functions && npm start',
  };
  
  packageJson.engines = {
    node: '20.x',
  };
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Install dependencies to update package-lock.json
  await installDependencies(projectDir);

  // 2. Update next.config to add standalone output
  // Check for both .ts and .js variants
  let nextConfigPath = path.join(projectDir, 'next.config.ts');
  if (!fs.existsSync(nextConfigPath)) {
    nextConfigPath = path.join(projectDir, 'next.config.js');
  }
  
  if (fs.existsSync(nextConfigPath)) {
    let nextConfigContent = fs.readFileSync(nextConfigPath, 'utf-8');
    
    // Add output: 'standalone', experimental.turbopackUseSystemTlsCerts, and serverExternalPackages
    if (!nextConfigContent.includes("output:") && !nextConfigContent.includes('output =')) {
      // Handle TypeScript config format: const nextConfig: NextConfig = {
      // Handle JavaScript config format: const nextConfig = {
      nextConfigContent = nextConfigContent.replace(
        /(const\s+nextConfig[:\s]*(?::\s*NextConfig\s*)?=\s*\{)(\s*\/\*[^*]*\*\/)?/,
        `$1\n  output: 'standalone',\n  experimental: {\n    turbopackUseSystemTlsCerts: true,\n  },\n  serverExternalPackages: ['applicationinsights'],$2`
      );
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
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  }

  // 3. Create SwallowKit config
  const swallowkitConfig = `/** @type {import('swallowkit').SwallowKitConfig} */
module.exports = {
  functions: {
    baseUrl: process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071',
  },
  deployment: {
    resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
    swaName: process.env.AZURE_SWA_NAME || '',
  },
}
`;
  fs.writeFileSync(path.join(projectDir, 'swallowkit.config.js'), swallowkitConfig);

  // 4. Create lib directory for shared models
  const libDir = path.join(projectDir, 'lib');
  const modelsDir = path.join(libDir, 'models');
  
  fs.mkdirSync(modelsDir, { recursive: true });

  // Create lib/api directory for backend utilities
  const apiLibDir = path.join(libDir, 'api');
  fs.mkdirSync(apiLibDir, { recursive: true });

  // Create backend utility for calling Azure Functions
  const backendUtilContent = `const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

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
  let url = \`\${FUNCTIONS_BASE_URL}\${endpoint}\`;
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
FUNCTIONS_BASE_URL=http://localhost:7071

# Azure Configuration
AZURE_RESOURCE_GROUP=your-resource-group
AZURE_SWA_NAME=your-static-web-app-name
`;
  fs.writeFileSync(path.join(projectDir, '.env.example'), envExample);

  // 7. Create load-appinsights.js for Application Insights (Azure production only)
  // Note: Named load-appinsights.js instead of instrumentation.js to avoid Next.js auto-detection in dev mode
  const appInsightsLoaderContent = `// Application Insights loader for Next.js server-side telemetry
// Only loaded in production via 'npm start' script (not in dev mode)
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  const appInsights = require('applicationinsights');
  
  appInsights
    .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
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
  
  appInsights.defaultClient.setAutoPopulateAzureProperties(true);
  appInsights.start();
  
  // Override console methods to send to Application Insights
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    appInsights.defaultClient.trackTrace({
      message: message,
      severity: appInsights.Contracts.SeverityLevel.Information
    });
  };
  
  console.error = function(...args) {
    originalConsoleError.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    appInsights.defaultClient.trackTrace({
      message: message,
      severity: appInsights.Contracts.SeverityLevel.Error
    });
  };
  
  console.warn = function(...args) {
    originalConsoleWarn.apply(console, args);
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    appInsights.defaultClient.trackTrace({
      message: message,
      severity: appInsights.Contracts.SeverityLevel.Warning
    });
  };
  
  console.log('[App Insights] Initialized for Next.js server-side telemetry with console override');
} else {
  console.log('[App Insights] Not configured (skipped in development mode)');
}
`;
  fs.writeFileSync(path.join(projectDir, 'load-appinsights.js'), appInsightsLoaderContent);

  // 8. Create .env.local for local development
  const envLocalContent = [
    '# Azure Functions Backend URL (Local)',
    'FUNCTIONS_BASE_URL=http://localhost:7071',
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
  await createAzureFunctionsProject(projectDir);

  // 15. Create BFF API route to call Azure Functions
  await createBffApiRoute(projectDir);

  // 16. Create home page
  await createHomePage(projectDir);

  console.log('✅ Project structure created\n');

  // 17. Create README.md
  createReadme(projectDir, projectName, cicdChoice, azureConfig);
}

async function createAzureFunctionsProject(projectDir: string) {
  console.log('📦 Creating Azure Functions project...\n');
  
  const functionsDir = path.join(projectDir, 'functions');
  fs.mkdirSync(functionsDir, { recursive: true });

  // Create functions package.json
  const functionsPackageJson = {
    name: 'functions',
    version: '1.0.0',
    description: 'Azure Functions backend',
    main: 'dist/*.js',
    scripts: {
      start: 'func start',
      build: 'tsc',
      prestart: 'npm run build'
    },
    dependencies: {
      '@azure/functions': '^4.0.0',
      '@azure/cosmos': '^4.0.0',
      'zod': '^3.25.0'
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      'typescript': '^5.0.0'
    }
  };
  fs.writeFileSync(
    path.join(functionsDir, 'package.json'),
    JSON.stringify(functionsPackageJson, null, 2)
  );

  // Create functions tsconfig.json
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
      forceConsistentCasingInFileNames: true
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist']
  };
  fs.writeFileSync(
    path.join(functionsDir, 'tsconfig.json'),
    JSON.stringify(functionsTsConfig, null, 2)
  );

  // Create host.json
  const hostJson = {
    version: '2.0',
    logging: {
      applicationInsights: {
        samplingSettings: {
          isEnabled: true,
          maxTelemetryItemsPerSecond: 20
        }
      }
    },
    extensionBundle: {
      id: 'Microsoft.Azure.Functions.ExtensionBundle',
      version: '[4.*, 5.0.0)'
    }
  };
  fs.writeFileSync(
    path.join(functionsDir, 'host.json'),
    JSON.stringify(hostJson, null, 2)
  );

  // Create .funcignore
  const funcignore = `node_modules
.git
.vscode
local.settings.json
test
tsconfig.json
*.ts
!dist/**/*.js
`;
  fs.writeFileSync(path.join(functionsDir, '.funcignore'), funcignore);

  // Create .gitignore for functions directory
  const functionsGitignore = `node_modules
dist
local.settings.json
*.log
.vscode
.DS_Store
`;
  fs.writeFileSync(path.join(functionsDir, '.gitignore'), functionsGitignore);

  // Create local.settings.json
  const projectName = path.basename(projectDir);
  const databaseName = `${projectName.charAt(0).toUpperCase() + projectName.slice(1)}Database`;
  const localSettings = {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage: '',
      FUNCTIONS_WORKER_RUNTIME: 'node',
      AzureWebJobsFeatureFlags: 'EnableWorkerIndexing',
      CosmosDBConnection: 'AccountEndpoint=http://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
      COSMOS_DB_DATABASE_NAME: databaseName,
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    }
  };
  fs.writeFileSync(
    path.join(functionsDir, 'local.settings.json'),
    JSON.stringify(localSettings, null, 2)
  );

  // Create src directory
  const srcDir = path.join(functionsDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // Create greet function directly in src

  const greetFunction = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';

// Zod schema for request validation
const greetRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name must be less than 50 characters'),
});

export async function greet(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log('HTTP trigger function processed a request.');

  try {
    // Get name from query or body
    const name = request.query.get('name') || (await request.text());
    
    // Validate with Zod
    const result = greetRequestSchema.safeParse({ name });
    
    if (!result.success) {
      return {
        status: 400,
        jsonBody: {
          error: result.error.errors[0].message
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
`;
  fs.writeFileSync(path.join(srcDir, 'greet.ts'), greetFunction);

  console.log('✅ Azure Functions project created\n');
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

  // Update .env.example to include FUNCTIONS_BASE_URL
  const envExamplePath = path.join(projectDir, '.env.example');
  let envExample = fs.readFileSync(envExamplePath, 'utf-8');
  
  if (!envExample.includes('FUNCTIONS_BASE_URL')) {
    envExample += `\n# Azure Functions Backend URL\nFUNCTIONS_BASE_URL=http://localhost:7071\n`;
    fs.writeFileSync(envExamplePath, envExample);
  }

  // Update .env.local
  const envLocalPath = path.join(projectDir, '.env.local');
  let envLocal = fs.readFileSync(envLocalPath, 'utf-8');
  
  if (!envLocal.includes('FUNCTIONS_BASE_URL')) {
    envLocal += `\n# Azure Functions Backend URL (Local)\nFUNCTIONS_BASE_URL=http://localhost:7071\n`;
    fs.writeFileSync(envLocalPath, envLocal);
  }

  console.log('✅ BFF API route created\n');
}

async function createHomePage(projectDir: string) {
  console.log('📦 Creating home page...\n');
  
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
      setMessage(data.message);
      setGreetingStatus('success');
    } catch (error) {
      setMessage('Failed to connect to Azure Functions');
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
            Full-stack TypeScript with Next.js + Azure Functions + Zod
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
                npx swallowkit scaffold lib/models/your-model.ts
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
    // Scaffolded models will be added here by 'npx swallowkit scaffold' command
  ] as ScaffoldModel[]
};
`;
  
  fs.writeFileSync(path.join(scaffoldConfigDir, 'scaffold-config.ts'), scaffoldConfigContent);
  console.log('✅ Scaffold config created\n');
}

function createReadme(projectDir: string, projectName: string, cicdChoice: string, azureConfig: { functionsPlan: FunctionsPlan; cosmosDbMode: CosmosDbMode }) {
  console.log('📝 Creating README.md...\n');

  const functionsPlanLabel = azureConfig.functionsPlan === 'flex' ? 'Flex Consumption' : 'Premium';
  const cosmosDbModeLabel = azureConfig.cosmosDbMode === 'freetier' ? 'Free Tier (1000 RU/s)' : 'Serverless';
  const cicdLabel = cicdChoice === 'github' ? 'GitHub Actions' : cicdChoice === 'azure' ? 'Azure Pipelines' : 'None';

  const readme = `# ${projectName}

A full-stack application built with **SwallowKit** - a modern TypeScript framework for building Next.js + Azure Functions applications.

## 🚀 Tech Stack

- **Frontend**: Next.js 15 (App Router), React, TypeScript, Tailwind CSS
- **BFF (Backend for Frontend)**: Next.js API Routes
- **Backend**: Azure Functions (TypeScript)
- **Database**: Azure Cosmos DB
- **Schema Validation**: Zod (shared between frontend and backend)
- **Infrastructure**: Bicep (Infrastructure as Code)
- **CI/CD**: ${cicdLabel}

## 📋 Project Configuration

This project was initialized with the following settings:

- **Azure Functions Plan**: ${functionsPlanLabel}
- **Cosmos DB Mode**: ${cosmosDbModeLabel}
- **CI/CD**: ${cicdLabel}

## ✅ Prerequisites

Before you begin, ensure you have the following installed:

1. **Node.js 18+**: [Download](https://nodejs.org/)
2. **Azure CLI**: Required for provisioning Azure resources
   - Install: \`winget install Microsoft.AzureCLI\` (Windows)
   - Or: [Download](https://aka.ms/installazurecliwindows)
3. **Azure Cosmos DB Emulator**: Required for local development
   - Windows: \`winget install Microsoft.Azure.CosmosEmulator\`
   - Or: [Download](https://aka.ms/cosmosdb-emulator)
   - Docker: \`docker pull mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator\`
4. **Azure Functions Core Tools**: Automatically installed with project dependencies

## 📁 Project Structure

\`\`\`
${projectName}/
├── app/                    # Next.js App Router (frontend)
│   ├── api/               # BFF API routes (proxy to Functions)
│   └── page.tsx           # Home page
├── functions/             # Azure Functions (backend)
│   └── src/
│       ├── models/        # Data models (copied from lib/models)
│       └── hello.ts       # Sample function
├── lib/
│   ├── models/            # Shared Zod schemas
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
npx swallowkit create-model <model-name>
\`\`\`

This creates a model file in \`lib/models/<model-name>.ts\`. Edit it to define your schema.

### 2. Generate CRUD Code

Generate complete CRUD operations (Functions, API routes, UI):

\`\`\`bash
npx swallowkit scaffold lib/models/<model-name>.ts
\`\`\`

This generates:
- Azure Functions CRUD endpoints
- Next.js BFF API routes
- React UI components (list, detail, create, edit)
- Navigation menu integration

### 3. Start Development Servers

\`\`\`bash
npx swallowkit dev
\`\`\`

This starts:
- Next.js dev server (http://localhost:3000)
- Azure Functions (http://localhost:7071)
- Cosmos DB Emulator check (must be running separately)

**Note**: You need to start Cosmos DB Emulator manually before running \`swallowkit dev\`.

## ☁️ Deploy to Azure

### Provision Azure Resources

Create all required Azure resources using Bicep:

\`\`\`bash
npx swallowkit provision --resource-group <rg-name>
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
   az functionapp deployment list-publishing-profiles --name func-${projectName} --resource-group <rg-name> --xml
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
npm run build
az staticwebapp deploy --name swa-${projectName} --resource-group <rg-name> --app-location ./
\`\`\`

**Deploy Functions:**
\`\`\`bash
cd functions
npm run build
func azure functionapp publish func-${projectName}
\`\`\``}

## 🔧 Available Commands

- \`npx swallowkit create-model <name>\` - Create a new data model
- \`npx swallowkit scaffold <model-file>\` - Generate CRUD code
- \`npx swallowkit dev\` - Start development servers
- \`npx swallowkit provision -g <rg-name>\` - Provision Azure resources

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

async function createInfrastructure(projectDir: string, projectName: string, azureConfig: { functionsPlan: FunctionsPlan; cosmosDbMode: CosmosDbMode }) {
  console.log('📦 Creating infrastructure files (Bicep)...\n');
  
  const infraDir = path.join(projectDir, 'infra');
  const modulesDir = path.join(infraDir, 'modules');
  fs.mkdirSync(modulesDir, { recursive: true });

  // main.bicep
  const mainBicep = `targetScope = 'resourceGroup'

@description('Project name')
param projectName string

@description('Location for Functions and Cosmos DB')
param location string = resourceGroup().location

@description('Location for Static Web App (must be explicitly provided)')
param swaLocation string

@description('Functions plan type')
@allowed(['flex', 'premium'])
param functionsPlan string = '${azureConfig.functionsPlan}'

@description('Cosmos DB mode')
@allowed(['freetier', 'serverless'])
param cosmosDbMode string = '${azureConfig.cosmosDbMode}'

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

// Azure Functions (conditional based on plan)
module functionsFlex 'modules/functions-flex.bicep' = if (functionsPlan == 'flex') {
  name: 'functionsApp'
  params: {
    name: 'func-\${projectName}'
    location: location
    storageAccountName: 'stg\${uniqueString(resourceGroup().id, projectName)}'
    appInsightsConnectionString: appInsightsFunctions.outputs.connectionString
    swaDefaultHostname: staticWebApp.outputs.defaultHostname
  }
}

module functionsPremium 'modules/functions-premium.bicep' = if (functionsPlan == 'premium') {
  name: 'functionsApp'
  params: {
    name: 'func-\${projectName}'
    location: location
    storageAccountName: 'stg\${uniqueString(resourceGroup().id, projectName)}'
    appInsightsConnectionString: appInsightsFunctions.outputs.connectionString
    swaDefaultHostname: staticWebApp.outputs.defaultHostname
  }
}

// Cosmos DB (conditional based on mode)
module cosmosDbFreeTier 'modules/cosmosdb-freetier.bicep' = if (cosmosDbMode == 'freetier') {
  name: 'cosmosDb'
  params: {
    accountName: 'cosmos-\${projectName}'
    databaseName: '\${projectName}Database'
    location: location
    functionsPrincipalId: functionsPlan == 'flex' ? functionsFlex.outputs.principalId : functionsPremium.outputs.principalId
  }
}

module cosmosDbServerless 'modules/cosmosdb-serverless.bicep' = if (cosmosDbMode == 'serverless') {
  name: 'cosmosDb'
  params: {
    accountName: 'cosmos-\${projectName}'
    databaseName: '\${projectName}Database'
    location: location
    functionsPrincipalId: functionsPlan == 'flex' ? functionsFlex.outputs.principalId : functionsPremium.outputs.principalId
  }
}

// Update SWA config with Functions hostname (after Functions deployment)
module staticWebAppConfig 'modules/staticwebapp-config.bicep' = {
  name: 'staticWebAppConfig'
  params: {
    staticWebAppName: staticWebApp.outputs.name
    functionsDefaultHostname: functionsPlan == 'flex' ? functionsFlex.outputs.defaultHostname : functionsPremium.outputs.defaultHostname
    appInsightsConnectionString: appInsightsSwa.outputs.connectionString
  }
  dependsOn: [
    functionsFlex
    functionsPremium
  ]
}

output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppUrl string = staticWebApp.outputs.defaultHostname
output functionsAppName string = functionsPlan == 'flex' ? functionsFlex.outputs.name : functionsPremium.outputs.name
output functionsAppUrl string = functionsPlan == 'flex' ? functionsFlex.outputs.defaultHostname : functionsPremium.outputs.defaultHostname
output cosmosDbAccountName string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.accountName : cosmosDbServerless.outputs.accountName
output cosmosDbEndpoint string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.endpoint : cosmosDbServerless.outputs.endpoint
output cosmosDatabaseName string = cosmosDbMode == 'freetier' ? cosmosDbFreeTier.outputs.databaseName : cosmosDbServerless.outputs.databaseName
output logAnalyticsWorkspaceName string = logAnalytics.outputs.name
output logAnalyticsWorkspaceId string = logAnalytics.outputs.id
output appInsightsSwaName string = appInsightsSwa.outputs.name
output appInsightsSwaConnectionString string = appInsightsSwa.outputs.connectionString
output appInsightsFunctionsName string = appInsightsFunctions.outputs.name
output appInsightsFunctionsConnectionString string = appInsightsFunctions.outputs.connectionString
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
    "functionsPlan": {
      "value": "${azureConfig.functionsPlan}"
    },
    "cosmosDbMode": {
      "value": "${azureConfig.cosmosDbMode}"
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
        name: 'node'
        version: '22'
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
  
  // modules/functions-premium.bicep (Premium Plan)
  const functionsPremiumBicep = `@description('Functions App name')
param name string

@description('Location for the Functions App')
param location string

@description('Storage account name for Functions')
param storageAccountName string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Static Web App default hostname for CORS')
param swaDefaultHostname string

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

// App Service Plan (Premium)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '\${name}-plan'
  location: location
  sku: {
    name: 'EP1'
    tier: 'ElasticPremium'
  }
  properties: {
    reserved: true // Required for Linux
    maximumElasticWorkerCount: 20
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
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=\${storageAccount.name};EndpointSuffix=\${environment().suffixes.storage};AccountKey=\${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=\${storageAccount.name};EndpointSuffix=\${environment().suffixes.storage};AccountKey=\${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(name)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~22'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
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
      alwaysOn: true
    }
    httpsOnly: true
  }
}

output id string = functionApp.id
output name string = functionApp.name
output defaultHostname string = functionApp.properties.defaultHostName
output principalId string = functionApp.identity.principalId
`;
  fs.writeFileSync(path.join(modulesDir, 'functions-premium.bicep'), functionsPremiumBicep);
  
  // modules/cosmosdb-freetier.bicep (Free Tier)
  const cosmosDbFreeTierBicep = `@description('Cosmos DB account name')
param accountName string

@description('Database name')
param databaseName string

@description('Location for Cosmos DB')
param location string

@description('Functions App Managed Identity Principal ID')
param functionsPrincipalId string

// Cosmos DB Account (Free Tier)
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
    enableFreeTier: true
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
    disableKeyBasedMetadataWriteAccess: false
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

@description('Functions App Managed Identity Principal ID')
param functionsPrincipalId string

// Cosmos DB Account (Serverless)
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
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
    disableKeyBasedMetadataWriteAccess: false
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

output accountName string = cosmosAccount.name
output endpoint string = cosmosAccount.properties.documentEndpoint
output databaseName string = database.name
`;
  fs.writeFileSync(path.join(modulesDir, 'cosmosdb-serverless.bicep'), cosmosDbServerlessBicep);

  console.log('✅ Infrastructure files created\n');
}

async function createGitHubActionsWorkflows(projectDir: string, azureConfig: { functionsPlan: FunctionsPlan; cosmosDbMode: CosmosDbMode }) {
  console.log('📦 Creating GitHub Actions workflows...\n');
  
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
  const functionsWorkflow = `name: Deploy Azure Functions

on:
  push:
    branches:
      - main
    paths:
      - 'functions/**'
  pull_request:
    branches:
      - main
    paths:
      - 'functions/**'
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    name: Build and Deploy Functions
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Install dependencies
        run: |
          cd functions
          npm install
      
      - name: Build Functions
        run: |
          cd functions
          npm run build
      
      - name: Deploy to Azure Functions
        if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
        uses: Azure/functions-action@v1
        with:
          app-name: \${{ secrets.AZURE_FUNCTIONAPP_NAME }}
          package: './functions'
          publish-profile: \${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}${azureConfig.functionsPlan === 'flex' ? `
          sku: flexconsumption` : ''}
`;
  fs.writeFileSync(path.join(workflowsDir, 'deploy-functions.yml'), functionsWorkflow);

  console.log('✅ GitHub Actions workflows created\n');
}

async function createAzurePipelines(projectDir: string) {
  console.log('📦 Creating Azure Pipelines...\n');
  
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

  - script: |
      npm ci
    displayName: 'Install dependencies'

  - script: |
      npm run build
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
  const functionsPipeline = `trigger:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**

pr:
  branches:
    include:
      - main
  paths:
    include:
      - functions/**

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: azure-deployment

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '22.x'
    displayName: 'Install Node.js'

  - script: |
      cd functions
      npm ci
    displayName: 'Install Functions dependencies'

  - script: |
      cd functions
      npm run build
    displayName: 'Build Functions'

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
  fs.writeFileSync(path.join(pipelinesDir, 'functions.yml'), functionsPipeline);

  console.log('✅ Azure Pipelines created\n');
}


