import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CosmosClient, PartitionKeyKind } from '@azure/cosmos';
import { ensureSwallowKitProject } from '../../core/config';
import { detectFromProject, getCommands } from '../../utils/package-manager';

interface DevOptions {
  port?: string;
  functionsPort?: string;
  host?: string;
  open?: boolean;
  verbose?: boolean;
  noFunctions?: boolean;
}

/**
 * Check if Azure Functions Core Tools is installed
 */
async function checkCoreTools(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn('func', ['--version'], {
      shell: true,
      stdio: 'pipe',
    });
    
    checkProcess.on('close', (code) => {
      resolve(code === 0);
    });
    
    checkProcess.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Check if Cosmos DB Emulator is running by checking if port 8081 is open
 */
async function checkCosmosDBEmulator(): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
    
    socket.connect(8081, 'localhost');
  });
}

export const devCommand = new Command()
  .name('dev')
  .description('Start SwallowKit development server (Cosmos DB + Next.js + Azure Functions)')
  .option('-p, --port <port>', 'Next.js port', '3000')
  .option('-f, --functions-port <port>', 'Azure Functions port', '7071')
  .option('--host <host>', 'Host name', 'localhost')
  .option('--open', 'Open browser automatically', false)
  .option('--verbose', 'Show verbose logs', false)
  .option('--no-functions', 'Skip Azure Functions startup', false)
  .action(async (options: DevOptions & { functionsPort?: string; noFunctions?: boolean }) => {
    // SwallowKit プロジェクトディレクトリかどうかを検証
    ensureSwallowKitProject("dev");

    console.log('🚀 Starting SwallowKit development environment...');
    if (options.verbose) {
      console.log('⚙️  Options:', options);
    }

    await startDevEnvironment(options);
  });

async function initializeCosmosDB(databaseName: string): Promise<void> {
  try {
    // Read local.settings.json from functions directory
    const functionsDir = path.join(process.cwd(), 'functions');
    const localSettingsPath = path.join(functionsDir, 'local.settings.json');
    
    if (!fs.existsSync(localSettingsPath)) {
      console.log('⚠️  local.settings.json not found. Skipping Cosmos DB initialization.');
      return;
    }

    const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    const connectionString = localSettings.Values?.CosmosDBConnection;
    const dbName = localSettings.Values?.COSMOS_DB_DATABASE_NAME || databaseName;
    
    if (!connectionString) {
      console.log('⚠️  CosmosDBConnection not found in local.settings.json. Skipping Cosmos DB initialization.');
      return;
    }

    console.log('🗄️  Initializing Cosmos DB...');

    // Parse connection string
    const endpointMatch = connectionString.match(/AccountEndpoint=([^;]+)/);
    const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
    
    if (!endpointMatch || !keyMatch) {
      console.log('⚠️  Invalid CosmosDB connection string format.');
      return;
    }

    const endpoint = endpointMatch[1];

    const client = new CosmosClient({
      endpoint: endpoint,
      key: keyMatch[1]
    });

    // Create database if not exists
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    console.log(`✅ Database "${dbName}" ready`);

    // Read lib/scaffold-config.ts to get list of models
    const scaffoldConfigPath = path.join(process.cwd(), 'lib', 'scaffold-config.ts');
    if (fs.existsSync(scaffoldConfigPath)) {
      const scaffoldConfigContent = fs.readFileSync(scaffoldConfigPath, 'utf-8');
      
      // Parse TypeScript file to extract models array
      const modelsMatch = scaffoldConfigContent.match(/models:\s*\[([\s\S]*?)\]\s*as\s*ScaffoldModel\[\]/);
      if (modelsMatch) {
        const modelsArrayContent = modelsMatch[1];
        // Extract model names from objects like { name: 'Task', path: '/task', label: 'Task' }
        const modelMatches = modelsArrayContent.matchAll(/\{\s*name:\s*['"](\w+)['"]/g);
        const models = Array.from(modelMatches, m => m[1]);
        
        for (const modelName of models) {
          const containerName = `${modelName}s`; // Pluralize model name
          
          // Try creating container with full partition key definition first
          let containerCreated = false;
          
          try {
            console.log(`🔧 Creating container "${containerName}" with partition key /id...`);
            const containerResponse = await database.containers.createIfNotExists({
              id: containerName,
              partitionKey: {
                paths: ['/id'],
                kind: PartitionKeyKind.Hash,
                version: 2
              }
            });
            console.log(`✅ Container "${containerName}" ready (status: ${containerResponse.statusCode})`);
            containerCreated = true;
          } catch (error: any) {
            console.log(`⚠️  Failed with full partition key definition: ${error.message}`);
            console.log(`🔄 Retrying with simple partition key...`);
          }
          
          // If first attempt failed, try with simple partition key definition
          if (!containerCreated) {
            try {
              const containerResponse = await database.containers.createIfNotExists({
                id: containerName,
                partitionKey: {
                  paths: ['/id']
                }
              });
              console.log(`✅ Container "${containerName}" ready (status: ${containerResponse.statusCode})`);
            } catch (containerError: any) {
              console.error(`❌ Failed to create container "${containerName}":`, containerError.message);
              console.error(`Error code: ${containerError.code}`);
              if (containerError.body) {
                console.error(`Response body:`, JSON.stringify(containerError.body, null, 2));
              }
              // Continue with other containers
            }
          }
        }
      }
    }

    console.log('✅ Cosmos DB initialization complete\n');
  } catch (error: any) {
    console.error('⚠️  Cosmos DB initialization failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.log('💡 Make sure Cosmos DB Emulator is running');
  }
}

async function startDevEnvironment(options: DevOptions) {
  const port = options.port || '3000';
  const functionsPort = options.functionsPort || '7071';
  
  // Detect package manager from project lockfile
  const pm = detectFromProject();
  const pmCmd = getCommands(pm);
  
  // プロセスを管理する配列
  const processes: ChildProcess[] = [];

  // Cleanup processes on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping development servers...');
    processes.forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill();
      }
    });
    process.exit(0);
  });

  try {
    // 1. Check for Next.js project
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const nextConfigPathJs = path.join(process.cwd(), 'next.config.js');
    const nextConfigPathTs = path.join(process.cwd(), 'next.config.ts');
    const nextConfigPathMjs = path.join(process.cwd(), 'next.config.mjs');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.log('❌ package.json not found.');
      console.log('💡 Please run this command in the root directory of a Next.js project.');
      process.exit(1);
    }

    if (!fs.existsSync(nextConfigPathJs) && !fs.existsSync(nextConfigPathTs) && !fs.existsSync(nextConfigPathMjs)) {
      console.log('⚠️  next.config file not found. Is this a Next.js project?');
    }

    // 2. Check if Azure Functions exists
    const functionsDir = path.join(process.cwd(), 'functions');
    const hasFunctions = fs.existsSync(functionsDir) && 
                        fs.existsSync(path.join(functionsDir, 'package.json'));

    if (hasFunctions && !options.noFunctions) {
      // Check if Azure Functions Core Tools is installed
      const coreToolsInstalled = await checkCoreTools();
      
      if (!coreToolsInstalled) {
        console.log('');
        console.log('⚠️  Azure Functions Core Tools not found.');
        console.log('');
        
        // Prompt user for installation
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>((resolve) => {
          rl.question('Would you like to install Azure Functions Core Tools? (y/n): ', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          console.log('📦 Installing Azure Functions Core Tools...');
          console.log('   This may take a few minutes.');
          
          const installProcess = spawn(pm, pm === 'pnpm' ? ['add', '-g', 'azure-functions-core-tools@4'] : ['install', '-g', 'azure-functions-core-tools@4'], {
            shell: true,
            stdio: 'inherit',
          });
          
          await new Promise<void>((resolve, reject) => {
            installProcess.on('close', (code) => {
              if (code === 0) {
                console.log('✅ Azure Functions Core Tools installed successfully.');
                resolve();
              } else {
                console.error('❌ Installation failed.');
                console.log('💡 Please install manually:');
                console.log(`   ${pmCmd.addGlobal} azure-functions-core-tools@4`);
                reject(new Error(`Installation failed with code ${code}`));
              }
            });
            installProcess.on('error', reject);
          });
        } else {
          console.log('');
          console.log('ℹ️  Skipping Azure Functions startup.');
          console.log('💡 To install later:');
          console.log(`   ${pmCmd.addGlobal} azure-functions-core-tools@4`);
          console.log('');
          // Skip Azure Functions startup
          options.noFunctions = true;
        }
      }
      
      if (!options.noFunctions) {
        // Check if Cosmos DB Emulator is running
        const cosmosRunning = await checkCosmosDBEmulator();
        
        if (!cosmosRunning) {
          console.log('');
          console.log('❌ Cosmos DB Emulator is not running.');
          console.log('');
          console.log('💡 Please start Cosmos DB Emulator manually:');
          console.log('   C:\\Program Files\\Azure Cosmos DB Emulator\\CosmosDB.Emulator.exe');
          console.log('');
          console.log('   Or search for "Azure Cosmos DB Emulator" in the Start menu.');
          console.log('');
          process.exit(1);
        }
        
        // Initialize Cosmos DB before starting Functions
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const appName = packageJson.name || 'App';
        const databaseName = `${appName.charAt(0).toUpperCase() + appName.slice(1)}Database`;
        
        await initializeCosmosDB(databaseName);

        console.log('');
        console.log('🚀 Starting Azure Functions...');
        
        // Check if pnpm install has been run in functions directory
        const functionsNodeModules = path.join(functionsDir, 'node_modules');
        if (!fs.existsSync(functionsNodeModules)) {
          console.log('📦 Installing Azure Functions dependencies...');
          const depInstall = spawn(pm, ['install'], {
            cwd: functionsDir,
            shell: true,
            stdio: 'inherit',
          });
          
          await new Promise<void>((resolve, reject) => {
            depInstall.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`${pm} install failed with code ${code}`));
              }
            });
            depInstall.on('error', reject);
          });
        }
      }
    }

    if (hasFunctions && !options.noFunctions) {
      // Build shared package before starting Functions
      const sharedDir = path.join(process.cwd(), 'shared');
      if (fs.existsSync(sharedDir) && fs.existsSync(path.join(sharedDir, 'package.json'))) {
        console.log('📦 Building shared package...');
        const filterArgs = pm === 'pnpm'
          ? ['run', '--filter', 'shared', 'build']
          : ['run', '--workspace=shared', 'build'];
        const sharedBuild = spawn(pm, filterArgs, {
          cwd: process.cwd(),
          shell: true,
          stdio: 'inherit',
        });

        await new Promise<void>((resolve, reject) => {
          sharedBuild.on('close', (code) => {
            if (code === 0) {
              console.log('✅ Shared package built successfully');
              resolve();
            } else {
              reject(new Error(`Shared package build failed with code ${code}`));
            }
          });
          sharedBuild.on('error', reject);
        });
      }

      // Azure Functions を起動
      const funcEnv: NodeJS.ProcessEnv = { ...process.env, FUNCTIONS_PORT: functionsPort };
      
      const funcProcess = spawn(pm, ['start'], {
        cwd: functionsDir,
        shell: true,
        stdio: 'pipe', // Always pipe to capture output
        env: funcEnv
      });

      // Functions の出力をそのまま表示（プレフィックス付き）
      if (funcProcess.stdout) {
        funcProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // 各行にプレフィックスを付けて出力
          const lines = output.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            console.log(`[Functions] ${line}`);
          });
        });
      }

      if (funcProcess.stderr) {
        funcProcess.stderr.on('data', (data) => {
          const output = data.toString();
          const lines = output.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            console.error(`[Functions Error] ${line}`);
          });
        });
      }

      processes.push(funcProcess);

      funcProcess.on('error', (error) => {
        console.error('⚠️  Azure Functions startup error:', error.message);
        console.log('💡 Please ensure Azure Functions Core Tools is installed');
        console.log(`   ${pmCmd.addGlobal} azure-functions-core-tools@4`);
      });

      funcProcess.on('close', (code) => {
        if (code !== 0) {
          console.log(`\n⏹️  Azure Functions exited (exit code: ${code})`);
        }
      });

      console.log(`✅ Azure Functions started (port: ${functionsPort})`);
    } else if (!hasFunctions) {
      console.log('');
      console.log('ℹ️  functions/ directory not found. Starting Next.js only.');
    } else if (options.noFunctions) {
      console.log('');
      console.log('ℹ️  --no-functions specified. Skipping Azure Functions.');
    }

    console.log('');
    console.log('🚀 Starting Next.js development server...');

    // 5. Start Next.js development server
    const nextArgs = pm === 'pnpm'
      ? ['exec', 'next', 'dev', '--port', port]
      : ['next', 'dev', '--port', port];
    
    if (options.open) {
      // Next.js 14+ deprecated --open option, so we open browser manually
      setTimeout(() => {
        const url = `http://${options.host || 'localhost'}:${port}`;
        console.log(`\n🌐 Opening browser: ${url}`);
        
        const start = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(start, [url], { shell: true });
      }, 3000);
    }

    const nextProcess = spawn(pm === 'pnpm' ? 'pnpm' : 'npx', nextArgs, {
      cwd: process.cwd(),
      shell: true,
      stdio: options.verbose ? 'inherit' : 'inherit',
    });

    processes.push(nextProcess);

    nextProcess.on('error', (error) => {
      console.error('❌ Next.js startup error:', error.message);
      process.exit(1);
    });

    nextProcess.on('close', (code) => {
      if (code !== 0) {
        console.log(`\n⏹️  Next.js exited (exit code: ${code})`);
      }
      // Exit all processes when Next.js exits
      processes.forEach((proc) => {
        if (proc && !proc.killed) {
          proc.kill();
        }
      });
      process.exit(code || 0);
    });

    console.log('');
    console.log('✅ SwallowKit development environment is running!');
    console.log('');
    console.log(`📱 Next.js: http://${options.host || 'localhost'}:${port}`);
    if (hasFunctions && !options.noFunctions) {
      console.log(`⚡ Azure Functions: http://${options.host || 'localhost'}:${functionsPort}`);
    }
    console.log('');
    if (hasFunctions && !options.noFunctions) {
      console.log('💡 Azure Functions and Next.js BFF are connected');
    }
    console.log('');
    console.log('🛑 Press Ctrl+C to stop');
    console.log('');

  } catch (error) {
    console.error('❌ Failed to start development environment:', error instanceof Error ? error.message : error);
    processes.forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill();
      }
    });
    process.exit(1);
  }
}