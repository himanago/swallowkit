import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { CosmosClient, PartitionKeyKind } from '@azure/cosmos';

interface DevOptions {
  port?: string;
  functionsPort?: string;
  host?: string;
  open?: boolean;
  verbose?: boolean;
  noFunctions?: boolean;
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

    const client = new CosmosClient({
      endpoint: endpointMatch[1],
      key: keyMatch[1]
    });

    // Create database if not exists
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    console.log(`✅ Database "${dbName}" ready`);

    // Read scaffold.json to get list of models
    const scaffoldConfigPath = path.join(process.cwd(), '.swallowkit', 'scaffold.json');
    if (fs.existsSync(scaffoldConfigPath)) {
      const scaffoldConfig = JSON.parse(fs.readFileSync(scaffoldConfigPath, 'utf-8'));
      
      if (scaffoldConfig.models && Array.isArray(scaffoldConfig.models)) {
        for (const model of scaffoldConfig.models) {
          const modelName = typeof model === 'string' ? model : model.name;
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
      // Initialize Cosmos DB before starting Functions
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const appName = packageJson.name || 'App';
      const databaseName = `${appName.charAt(0).toUpperCase() + appName.slice(1)}Database`;
      
      await initializeCosmosDB(databaseName);

      console.log('');
      console.log('🚀 Starting Azure Functions...');
      
      // Check if npm install has been run in functions directory
      const functionsNodeModules = path.join(functionsDir, 'node_modules');
      if (!fs.existsSync(functionsNodeModules)) {
        console.log('📦 Installing Azure Functions dependencies...');
        const npmInstall = spawn('npm', ['install'], {
          cwd: functionsDir,
          shell: true,
          stdio: 'inherit',
        });
        
        await new Promise<void>((resolve, reject) => {
          npmInstall.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`npm install failed with code ${code}`));
            }
          });
          npmInstall.on('error', reject);
        });
      }

      // Azure Functions を起動
      const funcProcess = spawn('npm', ['start'], {
        cwd: functionsDir,
        shell: true,
        stdio: 'pipe', // Always pipe to capture output
        env: { ...process.env, FUNCTIONS_PORT: functionsPort }
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
        console.log('   npm install -g azure-functions-core-tools@4');
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
    const nextArgs = ['next', 'dev', '--port', port];
    
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

    const nextProcess = spawn('npx', nextArgs, {
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