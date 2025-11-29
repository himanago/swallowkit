import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

interface InitOptions {
  name: string;
  template: string;
}

export async function initCommand(options: InitOptions) {
  console.log(`噫 Initializing SwallowKit project: ${options.name}`);
  console.log(`逃 Template: ${options.template}`);

  const projectDir = path.join(process.cwd(), options.name);

  try {
    // Check if directory already exists
    if (fs.existsSync(projectDir)) {
      console.error(`笶・Directory "${options.name}" already exists.`);
      process.exit(1);
    }

    // Create Next.js project with create-next-app
    await createNextJsProject(options.name);

    // Add SwallowKit specific files
    await addSwallowKitFiles(projectDir, options);

    console.log(`\n笨・Project "${options.name}" created successfully!`);
    console.log("\n統 Next steps:");
    console.log(`  cd ${options.name}`);
    console.log("  npm install");
    console.log("  npx swallowkit dev  # Cosmos DB + Next.js");
    console.log("\n庁 Build and deploy to Azure:");
    console.log("  npx swallowkit build");
    console.log("  npx swallowkit deploy --swa-name <name> --resource-group <group>");
  } catch (error) {
    console.error("笶・Project creation failed:", error);
    // Clean up on failure
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

async function createNextJsProject(projectName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('\n逃 Creating Next.js project with create-next-app...\n');
    
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

    createNextApp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`create-next-app exited with code ${code}`));
      } else {
        console.log('\n笨・Next.js project created\n');
        resolve();
      }
    });

    createNextApp.on('error', (error) => {
      reject(error);
    });
  });
}

async function addSwallowKitFiles(projectDir: string, options: InitOptions) {
  console.log('逃 Adding SwallowKit files...\n');

  // 1. Update package.json to add swallowkit and @azure/cosmos dependencies
  const packageJsonPath = path.join(projectDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // Fix Next.js version to 16.0.5 (current latest)
  packageJson.dependencies = {
    ...packageJson.dependencies,
    'next': '16.0.5',
    'swallowkit': 'latest',
    '@azure/cosmos': '^4.0.0',
    'zod': '^3.25.0',
  };
  
  packageJson.scripts = {
    ...packageJson.scripts,
    'build:azure': 'swallowkit build',
    'deploy': 'swallowkit deploy',
    'functions:start': 'cd functions && npm start',
  };
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // 2. Update next.config to add standalone output
  // Check for both .ts and .js variants
  let nextConfigPath = path.join(projectDir, 'next.config.ts');
  if (!fs.existsSync(nextConfigPath)) {
    nextConfigPath = path.join(projectDir, 'next.config.js');
  }
  
  if (fs.existsSync(nextConfigPath)) {
    let nextConfigContent = fs.readFileSync(nextConfigPath, 'utf-8');
    
    // Add output: 'standalone' to the config
    if (!nextConfigContent.includes("output:") && !nextConfigContent.includes('output =')) {
      // Handle both JS and TS config formats
      nextConfigContent = nextConfigContent.replace(
        /(const nextConfig[:\s]*=\s*\{)/,
        `$1\n  output: 'standalone',`
      );
      fs.writeFileSync(nextConfigPath, nextConfigContent);
    }
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

  // 4. Create lib directory for shared schemas (optional)
  const libDir = path.join(projectDir, 'lib');
  const schemasDir = path.join(libDir, 'schemas');
  
  fs.mkdirSync(schemasDir, { recursive: true });
  
  // Create example schema file
  const exampleSchemaContent = `import { z } from 'zod';

// Example schema - customize for your needs
export const exampleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string().optional(),
});

export type Example = z.infer<typeof exampleSchema>;
`;
  fs.writeFileSync(path.join(schemasDir, 'example.ts'), exampleSchemaContent);

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

  // 7. Create .env.local for local development
  const envLocal = `# Azure Functions Backend URL (Local)
FUNCTIONS_BASE_URL=http://localhost:7071
`;
  fs.writeFileSync(path.join(projectDir, '.env.local'), envLocal);

  // 8. Create staticwebapp.config.json for Azure Static Web Apps
  const swaConfig = {
    navigationFallback: {
      rewrite: "/index.html"
    },
    routes: [
      {
        route: "/api/*",
        allowedRoles: ["anonymous"]
      }
    ],
    responseOverrides: {
      "404": {
        rewrite: "/404.html"
      }
    },
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

  // 16. Create GreetingDemo component
  await createGreetingDemo(projectDir);

  // 17. Update app/page.tsx to include demos
  await updateHomePage(projectDir);

  console.log('✅ Project structure created\n');
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
      'zod': '^3.25.0'
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      'typescript': '^5.0.0',
      'azure-functions-core-tools': '^4.0.0'
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

  // Create local.settings.json
  const localSettings = {
    IsEncrypted: false,
    Values: {
      AzureWebJobsStorage: '',
      FUNCTIONS_WORKER_RUNTIME: 'node',
      AzureWebJobsFeatureFlags: 'EnableWorkerIndexing'
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

  // Create API route that calls Azure Functions
  const apiRoute = `import { NextRequest, NextResponse } from 'next/server';

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'World';

    // Call Azure Functions backend
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/greet?name=\${encodeURIComponent(name)}\`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Read response body once as text, then try to parse as JSON
      const text = await response.text();
      let errorMessage = text || 'Failed to call backend function';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || error.message || text;
      } catch {
        // If not JSON, use text as-is
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    // Check if response has content before parsing JSON
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await response.text();
      return NextResponse.json({ message: text });
    }

    const data = await response.json();
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
    const name = body.name || 'World';

    // Call Azure Functions backend
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/greet\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      // Read response body once as text, then try to parse as JSON
      const text = await response.text();
      let errorMessage = text || 'Failed to call backend function';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || error.message || text;
      } catch {
        // If not JSON, use text as-is
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    // Check if response has content before parsing JSON
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      const text = await response.text();
      return NextResponse.json({ message: text });
    }

    const data = await response.json();
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

async function createGreetingDemo(projectDir: string) {
  console.log('📦 Creating GreetingDemo component...\n');
  
  const componentsDir = path.join(projectDir, 'components');
  
  const greetingDemoContent = `'use client'

import { useState } from 'react';

export function GreetingDemo() {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      // Call BFF API route (which calls Azure Functions)
      const response = await fetch(\`/api/greet?name=\${encodeURIComponent(name || 'World')}\`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch greeting');
      }

      const data = await response.json();
      setMessage(data.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
      <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
        BFF → Azure Functions Demo
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        This demo shows the BFF (Backend For Frontend) pattern: Next.js API Route → Azure Functions
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            disabled={loading}
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading...' : 'Call Azure Function'}
        </button>
      </form>

      {message && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-green-800 dark:text-green-200">{message}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">Error: {error}</p>
        </div>
      )}
    </div>
  );
}
`;
  fs.writeFileSync(path.join(componentsDir, 'GreetingDemo.tsx'), greetingDemoContent);

  console.log('✅ GreetingDemo component created\n');
}

async function updateHomePage(projectDir: string) {
  console.log('📦 Updating app/page.tsx...\n');
  
  const pageContent = `import { GreetingDemo } from '@/components/GreetingDemo';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-4">
            SwallowKit Demo
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Full-stack TypeScript with Next.js (BFF) + Azure Functions + Zod
          </p>
        </header>

        {/* BFF → Azure Functions Demo */}
        <section>
          <GreetingDemo />
        </section>

        <footer className="mt-12 text-center text-gray-600 dark:text-gray-400 text-sm">
          <p>Built with SwallowKit - Next.js BFF + Azure Functions</p>
          <p className="mt-2 text-xs">
            Frontend → BFF (Next.js API Routes) → Azure Functions → Response
          </p>
        </footer>
      </div>
    </div>
  );
}
`;
  
  fs.writeFileSync(path.join(projectDir, 'app', 'page.tsx'), pageContent);

  console.log('✅ app/page.tsx updated\n');
}
