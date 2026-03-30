import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CosmosClient, PartitionKeyKind } from '@azure/cosmos';
import { ensureSwallowKitProject, getBackendLanguage, getAuthConfig, getFullConfig } from '../../core/config';
import { ModelInfo } from '../../core/scaffold/model-parser';
import { applyDevSeedEnvironment, getContainerNameForModel, loadProjectModels } from './dev-seeds';
import { BackendLanguage } from '../../types';
import { detectFromProject, getCommands } from '../../utils/package-manager';
import { ConnectorMockServer } from '../../core/mock/connector-mock-server';

interface DevOptions {
  port?: string;
  functionsPort?: string;
  host?: string;
  open?: boolean;
  verbose?: boolean;
  noFunctions?: boolean;
  seedEnv?: string;
  mockConnectors?: boolean;
}

export function buildFunctionsStartArgs(functionsPort: string): string[] {
  return ['start', '--port', functionsPort];
}

export function buildNextDevArgs(pm: string, port: string): string[] {
  const baseArgs = ['next', 'dev', '--port', port, '--webpack'];
  return pm === 'pnpm' ? ['exec', ...baseArgs] : baseArgs;
}

export function getPythonVirtualEnvPaths(functionsDir: string): {
  venvDir: string;
  binDir: string;
  pythonExecutable: string;
} {
  const venvDir = path.join(functionsDir, '.venv');
  const binDir = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts')
    : path.join(venvDir, 'bin');
  const pythonExecutable = process.platform === 'win32'
    ? path.join(binDir, 'python.exe')
    : path.join(binDir, 'python');

  return { venvDir, binDir, pythonExecutable };
}

export function buildPythonFunctionsEnv(baseEnv: NodeJS.ProcessEnv, functionsDir: string): NodeJS.ProcessEnv {
  const { venvDir, binDir, pythonExecutable } = getPythonVirtualEnvPaths(functionsDir);
  const pathKey = getPathEnvKey(baseEnv);
  const currentPath = baseEnv[pathKey] || '';

  return {
    ...baseEnv,
    [pathKey]: currentPath ? `${binDir}${path.delimiter}${currentPath}` : binDir,
    VIRTUAL_ENV: venvDir,
    languageWorkers__python__defaultExecutablePath: pythonExecutable,
  };
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
}

function prependToPathEnv(env: NodeJS.ProcessEnv, entry: string): NodeJS.ProcessEnv {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] || '';

  return {
    ...env,
    [pathKey]: currentPath ? `${entry}${path.delimiter}${currentPath}` : entry,
  };
}

/**
 * Check if Azure Functions Core Tools is installed
 */
async function checkCoreTools(): Promise<boolean> {
  return checkCommand('func', ['--version']);
}

async function checkCommand(command: string, args: string[] = ['--version']): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn(command, args, {
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

async function resolvePythonBootstrapCommand(): Promise<{ command: string; argsPrefix: string[]; label: string }> {
  const candidates = process.platform === 'win32'
    ? [
        { command: 'py', argsPrefix: ['-3.11'], label: 'py -3.11' },
        { command: 'python', argsPrefix: [], label: 'python' },
      ]
    : [
        { command: 'python3', argsPrefix: [], label: 'python3' },
        { command: 'python', argsPrefix: [], label: 'python' },
      ];

  for (const candidate of candidates) {
    if (await checkCommand(candidate.command, [...candidate.argsPrefix, '--version'])) {
      return candidate;
    }
  }

  throw new Error(
    'Python 3.11 was not found. Install Python 3.11 and make sure `python`, `python3`, or `py -3.11` is available.'
  );
}

async function getCommandPath(command: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = await captureCommandOutput(locator, [command]);
  const firstLine = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || null;
}

async function captureCommandOutput(
  command: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `${command} exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

async function resolvePythonRuntimeDetails(
  functionsDir: string,
  env: NodeJS.ProcessEnv
): Promise<{ version: string; architecture: string }> {
  const { pythonExecutable } = getPythonVirtualEnvPaths(functionsDir);
  const output = await captureCommandOutput(
    pythonExecutable,
    [
      '-c',
      'import platform; import sys; print(str(sys.version_info.major) + "." + str(sys.version_info.minor)); print(platform.machine())',
    ],
    functionsDir,
    env
  );
  const [version, architecture] = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (!version || !architecture) {
    throw new Error('Failed to determine Python runtime details.');
  }

  return { version, architecture };
}

async function bridgePythonCoreToolsForWindowsArm64(
  functionsDir: string,
  env: NodeJS.ProcessEnv
): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'win32' || process.arch !== 'arm64') {
    return env;
  }

  const funcPath = await getCommandPath('func');
  if (!funcPath) {
    return env;
  }

  const { version, architecture } = await resolvePythonRuntimeDetails(functionsDir, env);
  if (architecture.toUpperCase() !== 'AMD64') {
    return env;
  }

  const coreToolsRoot = path.dirname(funcPath);
  const armWorkerDir = path.join(coreToolsRoot, 'workers', 'python', version, 'WINDOWS', 'Arm64');
  if (fs.existsSync(armWorkerDir)) {
    return env;
  }

  const x64WorkerDir = path.join(coreToolsRoot, 'workers', 'python', version, 'WINDOWS', 'X64');
  if (!fs.existsSync(x64WorkerDir)) {
    return env;
  }

  const patchedRoot = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'SwallowKit',
    'azure-functions-core-tools-python-bridge'
  );

  if (!fs.existsSync(path.join(patchedRoot, 'func.exe'))) {
    console.log('🩹 Creating a local Azure Functions Core Tools bridge for Windows Arm64 Python...');
    fs.mkdirSync(path.dirname(patchedRoot), { recursive: true });
    fs.cpSync(coreToolsRoot, patchedRoot, { recursive: true });
  }

  const patchedArmWorkerDir = path.join(patchedRoot, 'workers', 'python', version, 'WINDOWS', 'Arm64');
  const patchedX64WorkerDir = path.join(patchedRoot, 'workers', 'python', version, 'WINDOWS', 'X64');
  if (!fs.existsSync(patchedArmWorkerDir) && fs.existsSync(patchedX64WorkerDir)) {
    fs.cpSync(patchedX64WorkerDir, patchedArmWorkerDir, { recursive: true });
  }

  console.log(`🩹 Using bridged Azure Functions Core Tools from ${patchedRoot}`);
  return prependToPathEnv(env, patchedRoot);
}

async function preparePythonFunctionsEnvironment(functionsDir: string): Promise<NodeJS.ProcessEnv> {
  const { pythonExecutable } = getPythonVirtualEnvPaths(functionsDir);
  const hasUv = await checkCommand('uv', ['--version']);

  if (!fs.existsSync(pythonExecutable)) {
    if (hasUv) {
      console.log('📦 Creating Python virtual environment with uv...');
      await runCommand('uv', ['venv', '.venv', '--python', '3.11'], functionsDir, 'python virtual environment setup');
    } else {
      const bootstrap = await resolvePythonBootstrapCommand();
      console.log(`📦 Creating Python virtual environment with ${bootstrap.label}...`);
      await runCommand(
        bootstrap.command,
        [...bootstrap.argsPrefix, '-m', 'venv', '.venv'],
        functionsDir,
        'python virtual environment setup'
      );
    }
  }

  const pythonEnv = buildPythonFunctionsEnv(process.env, functionsDir);
  console.log(`📦 Installing Python Azure Functions dependencies${hasUv ? ' with uv' : ''}...`);

  if (hasUv) {
    await runCommand(
      'uv',
      ['pip', 'install', '--python', pythonExecutable, '-r', 'requirements.txt'],
      functionsDir,
      'python dependency installation',
      pythonEnv
    );
  } else {
    await runCommand('python', ['-m', 'pip', 'install', '--upgrade', 'pip'], functionsDir, 'python pip upgrade', pythonEnv);
    await runCommand(
      'python',
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      functionsDir,
      'python dependency installation',
      pythonEnv
    );
  }

  return bridgePythonCoreToolsForWindowsArm64(functionsDir, pythonEnv);
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
  .option('--seed-env <environment>', 'Replace Cosmos DB Emulator data from dev-seeds/<environment> before startup')
  .option('--mock-connectors', 'Start mock server for connector models (serves Zod-generated data)', false)
  .action(async (options: DevOptions & { functionsPort?: string; noFunctions?: boolean; seedEnv?: string; mockConnectors?: boolean }) => {
    // SwallowKit プロジェクトディレクトリかどうかを検証
    ensureSwallowKitProject("dev");

    console.log('🚀 Starting SwallowKit development environment...');
    if (options.verbose) {
      console.log('⚙️  Options:', options);
    }

    await startDevEnvironment(options);
  });

interface CosmosInitializationResult {
  endpoint: string;
  key: string;
  databaseName: string;
  models: ModelInfo[];
}

async function initializeCosmosDB(databaseName: string): Promise<CosmosInitializationResult | null> {
  try {
    // Read local.settings.json from functions directory
    const functionsDir = path.join(process.cwd(), 'functions');
    const localSettingsPath = path.join(functionsDir, 'local.settings.json');
    
    if (!fs.existsSync(localSettingsPath)) {
      console.log('⚠️  local.settings.json not found. Skipping Cosmos DB initialization.');
      return null;
    }

    const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    const connectionString = localSettings.Values?.CosmosDBConnection;
    const dbName = localSettings.Values?.COSMOS_DB_DATABASE_NAME || databaseName;
    
    if (!connectionString) {
      console.log('⚠️  CosmosDBConnection not found in local.settings.json. Skipping Cosmos DB initialization.');
      return null;
    }

    console.log('🗄️  Initializing Cosmos DB...');

    // Parse connection string
    const endpointMatch = connectionString.match(/AccountEndpoint=([^;]+)/);
    const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
    
    if (!endpointMatch || !keyMatch) {
      console.log('⚠️  Invalid CosmosDB connection string format.');
      return null;
    }

    const endpoint = endpointMatch[1];

    const client = new CosmosClient({
      endpoint: endpoint,
      key: keyMatch[1]
    });

    // Create database if not exists
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    console.log(`✅ Database "${dbName}" ready`);

    const models = await loadProjectModels();
    for (const model of models) {
      const containerName = getContainerNameForModel(model);
      
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`⚠️  Failed with full partition key definition: ${message}`);
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

    console.log('✅ Cosmos DB initialization complete\n');
    return { endpoint, key: keyMatch[1], databaseName: dbName, models };
  } catch (error: any) {
    console.error('⚠️  Cosmos DB initialization failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.log('💡 Make sure Cosmos DB Emulator is running');
    return null;
  }
}

async function startDevEnvironment(options: DevOptions) {
  const port = options.port || '3000';
  const functionsPort = options.functionsPort || '7071';
  
  // Detect package manager from project lockfile
  const pm = detectFromProject();
  const pmCmd = getCommands(pm);
  const backendLanguage = getBackendLanguage();
  
  // プロセスを管理する配列
  const processes: ChildProcess[] = [];
  let functionsEnv: NodeJS.ProcessEnv = process.env;
  let mockServer: ConnectorMockServer | null = null;

  // Cleanup processes on Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping development servers...');
    if (mockServer) {
      await mockServer.stop();
    }
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
    const hasFunctions = fs.existsSync(functionsDir) && hasFunctionsProject(functionsDir, backendLanguage);

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
        
        const cosmosInitialization = await initializeCosmosDB(databaseName);
        if (options.seedEnv && cosmosInitialization) {
          await applyDevSeedEnvironment({
            client: new CosmosClient({
              endpoint: cosmosInitialization.endpoint,
              key: cosmosInitialization.key,
            }),
            databaseName: cosmosInitialization.databaseName,
            environment: options.seedEnv,
            models: cosmosInitialization.models,
          });
        }

        console.log('');
        console.log('🚀 Starting Azure Functions...');

        if (backendLanguage === 'typescript') {
          const functionsNodeModules = path.join(functionsDir, 'node_modules');
          if (!fs.existsSync(functionsNodeModules)) {
            console.log('📦 Installing Azure Functions dependencies...');
            await runCommand(pm, ['install'], functionsDir, `${pm} install`);
          }
        } else if (backendLanguage === 'csharp') {
          console.log('📦 Building C# Azure Functions project...');
          await runCommand('dotnet', ['build'], functionsDir, 'dotnet build');
        } else {
          functionsEnv = await preparePythonFunctionsEnvironment(functionsDir);
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
      const funcProcess = spawn('func', buildFunctionsStartArgs(functionsPort), {
        cwd: functionsDir,
        shell: true,
        stdio: 'pipe', // Always pipe to capture output
        env: functionsEnv
      });
      let pythonWorkerMissing = false;

      // Functions の出力をそのまま表示（プレフィックス付き）
      if (funcProcess.stdout) {
        funcProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // 各行にプレフィックスを付けて出力
          const lines = output.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            if (
              backendLanguage === 'python' &&
              (line.includes('WorkerConfig for runtime: python not found') || line.includes('DefaultWorkerPath:'))
            ) {
              pythonWorkerMissing = true;
            }
            console.log(`[Functions] ${line}`);
          });
        });
      }

      if (funcProcess.stderr) {
        funcProcess.stderr.on('data', (data) => {
          const output = data.toString();
          const lines = output.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            if (
              backendLanguage === 'python' &&
              (line.includes('WorkerConfig for runtime: python not found') || line.includes('DefaultWorkerPath:'))
            ) {
              pythonWorkerMissing = true;
            }
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
          if (backendLanguage === 'python' && pythonWorkerMissing) {
            console.log('💡 Your Azure Functions Core Tools installation is missing the Python worker for this OS/architecture.');
            console.log('   Reinstall a matching Core Tools v4 package (Windows users should prefer the official x64/x86 MSI for their machine).');
            console.log('   SwallowKit local Python dev uses functions/.venv and requirements.txt, but Core Tools still needs its own bundled Python worker.');
          }
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

    // Mock connector server — start proxy if --mock-connectors is enabled
    let bffTargetPort = functionsPort;

    if (options.mockConnectors) {
      const allModels = await loadProjectModels();
      const connectorModels = allModels.filter((m) => m.connectorConfig);

      // Resolve auth config — auth functions use RDB connectors, mocked alongside other models
      const authConfig = getAuthConfig();
      let mockAuthConfig: { jwtSecret: string; tokenExpiry?: string; customJwt?: { userTable: string; loginIdColumn: string; passwordHashColumn: string; rolesColumn: string }; defaultPolicy?: "authenticated" | "anonymous" } | undefined;
      if (authConfig?.provider === 'custom-jwt' && authConfig.customJwt) {
        const fullConfig = getFullConfig();
        // Read JWT_SECRET from functions/local.settings.json if available
        let jwtSecret = 'dev-jwt-secret-change-in-production-min-32-chars!!';
        try {
          const localSettingsPath = path.join(process.cwd(), 'functions', 'local.settings.json');
          if (fs.existsSync(localSettingsPath)) {
            const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
            jwtSecret = localSettings.Values?.[authConfig.customJwt.jwtSecretEnv || 'JWT_SECRET'] || jwtSecret;
          }
        } catch { /* ignore */ }
        mockAuthConfig = {
          jwtSecret,
          tokenExpiry: authConfig.customJwt.tokenExpiry,
          customJwt: {
            userTable: authConfig.customJwt.userTable,
            loginIdColumn: authConfig.customJwt.loginIdColumn,
            passwordHashColumn: authConfig.customJwt.passwordHashColumn,
            rolesColumn: authConfig.customJwt.rolesColumn,
          },
          defaultPolicy: authConfig.authorization?.defaultPolicy,
        };
      }

      if (connectorModels.length > 0 || mockAuthConfig) {
        const mockPort = parseInt(functionsPort, 10) + 1;
        mockServer = new ConnectorMockServer({
          port: mockPort,
          functionsTarget: `${options.host || 'localhost'}:${functionsPort}`,
          connectorModels,
          allModels,
          seedEnv: options.seedEnv,
          host: options.host || 'localhost',
          authConfig: mockAuthConfig,
        });

        await mockServer.start();
        bffTargetPort = String(mockPort);

        const modelCount = connectorModels.length + (mockAuthConfig ? 1 : 0);
        console.log('');
        console.log(`🔌 Mock server started (port: ${mockPort}) — ${modelCount} model(s) mocked via Zod/seed data`);
        for (const m of connectorModels) {
          const ops = m.connectorConfig!.operations.join(', ');
          console.log(`     - ${m.name} [${ops}]`);
        }
        if (mockAuthConfig) {
          console.log(`     - auth [login, me, logout]`);
        }
        console.log(`   Other routes → proxied to Azure Functions (port: ${functionsPort})`);
      } else {
        console.log('');
        console.log('ℹ️  --mock-connectors specified but no connector models found. Skipping mock server.');
      }
    }

    // 5. Start Next.js development server
    const nextArgs = buildNextDevArgs(pm, port);
    
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

    const nextEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BACKEND_FUNCTIONS_BASE_URL: `http://${options.host || 'localhost'}:${bffTargetPort}`,
      FUNCTIONS_BASE_URL: `http://${options.host || 'localhost'}:${bffTargetPort}`,
    };

    const nextProcess = spawn(pm === 'pnpm' ? 'pnpm' : 'npx', nextArgs, {
      cwd: process.cwd(),
      shell: true,
      stdio: options.verbose ? 'inherit' : 'inherit',
      env: nextEnv,
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
      if (mockServer) {
        mockServer.stop().catch(() => {});
      }
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
    if (mockServer) {
      console.log(`🔌 Mock Proxy: http://${options.host || 'localhost'}:${bffTargetPort} (BFF → here)`);
    }
    console.log('');
    if (hasFunctions && !options.noFunctions) {
      console.log('💡 Azure Functions and Next.js BFF are connected');
    }
    if (mockServer) {
      console.log('💡 Connector models served from mock server (Zod-generated data)');
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

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

function hasFunctionsProject(functionsDir: string, backendLanguage: BackendLanguage): boolean {
  if (backendLanguage === 'typescript') {
    return fs.existsSync(path.join(functionsDir, 'package.json'));
  }

  return fs.existsSync(path.join(functionsDir, 'host.json'));
}
