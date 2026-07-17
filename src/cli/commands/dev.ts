import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { CosmosClient, PartitionKeyKind } from '@azure/cosmos';
import { ensureSwallowKitProject, getBackendLanguage, getAuthConfig } from '../../core/config';
import { ModelInfo } from '../../core/scaffold/model-parser';
import {
  applyDevSeedEnvironment,
  getContainerNameForModel,
  getDefaultCosmosDatabaseName,
  loadProjectModels,
  resolveLocalCosmosConnectionInfo,
} from './dev-seeds';
import { BackendLanguage } from '../../types';
import { detectFromProject, getCommands } from '../../utils/package-manager';
import {
  buildProjectLocalUvEnv,
  buildProjectLocalUvInstallerEnv,
  buildUvPipInstallArgs,
  buildUvVenvArgs,
  getProjectLocalUvInstallerCommand,
  getProjectLocalUvPaths,
  getPythonProjectRoot,
} from '../../utils/python-uv';
import { ConnectorMockServer } from '../../core/mock/connector-mock-server';

export interface DevOptions {
  port?: string;
  functionsPort?: string;
  host?: string;
  open?: boolean;
  verbose?: boolean;
  noFunctions?: boolean;
  seedEnv?: string;
  mockConnectors?: boolean;
  swaPort?: string;
  noSwa?: boolean;
}

type ParsedDevActionOptions = DevOptions & {
  functions?: boolean;
  swa?: boolean;
};

interface FunctionsCoreToolsCommand {
  command: string;
  argsPrefix: string[];
  label: string;
}

const MINIMUM_CSHARP_CORE_TOOLS_VERSION = '4.6.0';
const NPM_CORE_TOOLS_PACKAGE = 'azure-functions-core-tools@4';

function normalizeParsedDevOptions(options: ParsedDevActionOptions): DevOptions {
  return {
    ...options,
    noFunctions: options.noFunctions ?? options.functions === false,
    noSwa: options.noSwa ?? options.swa === false,
  };
}

export function buildFunctionsStartArgs(functionsPort: string): string[] {
  return ['start', '--port', functionsPort];
}

export function parseCoreToolsVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

export function compareVersionNumbers(left: string, right: string): number {
  const leftParts = left.split('.').map((value) => Number.parseInt(value, 10));
  const rightParts = right.split('.').map((value) => Number.parseInt(value, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

export function buildFunctionsCoreToolsCommand(
  backendLanguage: BackendLanguage,
  installedVersion: string | null
): FunctionsCoreToolsCommand {
  if (
    backendLanguage === 'csharp' &&
    (!installedVersion || compareVersionNumbers(installedVersion, MINIMUM_CSHARP_CORE_TOOLS_VERSION) < 0)
  ) {
    const reason = installedVersion
      ? `installed func ${installedVersion} is too old for C# isolated`
      : 'func is not installed';

    return {
      command: 'npm',
      argsPrefix: ['exec', '--yes', NPM_CORE_TOOLS_PACKAGE, '--'],
      label: `npm exec ${NPM_CORE_TOOLS_PACKAGE} (${reason})`,
    };
  }

  return {
    command: 'func',
    argsPrefix: [],
    label: installedVersion ? `func ${installedVersion}` : 'func',
  };
}

export function buildNextDevArgs(pm: string, port: string): string[] {
  const baseArgs = ['next', 'dev', '--port', port, '--webpack'];
  return pm === 'pnpm' ? ['exec', ...baseArgs] : baseArgs;
}

export function buildFunctionsBaseUrl(host: string | undefined, functionsPort: string): string {
  return `http://${host || 'localhost'}:${functionsPort}`;
}

export function buildSwaStartArgs(host: string | undefined, nextPort: string, swaPort: string): string[] {
  return [
    'start',
    `http://${host || 'localhost'}:${nextPort}`,
    '--swa-config-location',
    '.',
    '--port',
    swaPort,
  ];
}

export function getSwaCliInstallCommand(pm: string): string {
  return pm === 'pnpm'
    ? 'pnpm add -Dw @azure/static-web-apps-cli'
    : 'npm install -D @azure/static-web-apps-cli';
}

export function getFunctionsReadinessTimeoutMs(backendLanguage: BackendLanguage): number {
  return backendLanguage === 'csharp' ? 90_000 : 30_000;
}

export async function waitForHttpServerReady(
  url: string,
  timeoutMs = 30_000,
  intervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await probeHttpServer(url)) {
      return true;
    }

    if (Date.now() + intervalMs > deadline) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return probeHttpServer(url);
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

export function getCSharpFunctionsBuildArtifactPaths(functionsDir: string): string[] {
  return [
    path.join(functionsDir, 'bin'),
    path.join(functionsDir, 'obj'),
  ];
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

async function checkCommand(
  command: string,
  args: string[] = ['--version'],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env ?? process.env,
      shell: options?.shell ?? true,
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

async function resolveProjectLocalUvCommand(projectRoot: string): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  const uvEnv = buildProjectLocalUvEnv(process.env, projectRoot);
  const { localUvExecutable } = getProjectLocalUvPaths(projectRoot);

  if (await checkCommand('uv', ['--version'], { shell: false })) {
    return { command: 'uv', env: uvEnv };
  }

  if (fs.existsSync(localUvExecutable) && await checkCommand(localUvExecutable, ['--version'], { shell: false })) {
    return { command: localUvExecutable, env: uvEnv };
  }

  console.log('📦 Installing project-local uv...');
  const installer = getProjectLocalUvInstallerCommand();
  await runCommand(
    installer.command,
    installer.args,
    projectRoot,
    'uv installation',
    buildProjectLocalUvInstallerEnv(process.env, projectRoot),
    false
  );

  if (!(fs.existsSync(localUvExecutable) && await checkCommand(localUvExecutable, ['--version'], { shell: false }))) {
    throw new Error('Failed to install project-local uv.');
  }

  return { command: localUvExecutable, env: uvEnv };
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

async function resolveInstalledCoreToolsVersion(): Promise<string | null> {
  if (!(await checkCoreTools())) {
    return null;
  }

  try {
    return parseCoreToolsVersion(await captureCommandOutput('func', ['--version']));
  } catch {
    return null;
  }
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

async function probeHttpServer(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const target = new URL(url);
    const requestFactory = target.protocol === 'https:' ? https.request : http.request;
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const request = requestFactory(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname || '/',
        method: 'GET',
        timeout: 1000,
      },
      (response) => {
        response.resume();
        finish(true);
      }
    );

    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
    request.on('error', () => finish(false));
    request.end();
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
  const projectRoot = getPythonProjectRoot(functionsDir);
  const { command: uvCommand, env: uvEnv } = await resolveProjectLocalUvCommand(projectRoot);
  const { venvDir, pythonExecutable } = getPythonVirtualEnvPaths(functionsDir);
  const hasUsableVirtualEnv = fs.existsSync(pythonExecutable) && await checkCommand(pythonExecutable, ['--version'], {
    cwd: functionsDir,
    env: uvEnv,
    shell: false,
  });

  if (!hasUsableVirtualEnv) {
    const venvArgs = buildUvVenvArgs('.venv');
    if (fs.existsSync(venvDir)) {
      venvArgs.push('--clear');
    }

    console.log('📦 Creating Python virtual environment with uv...');
    await runCommand(uvCommand, venvArgs, functionsDir, 'python virtual environment setup', uvEnv, false);
  }

  console.log('📦 Installing Python Azure Functions dependencies with uv...');
  await runCommand(
    uvCommand,
    buildUvPipInstallArgs(pythonExecutable, 'requirements.txt'),
    functionsDir,
    'python dependency installation',
    uvEnv,
    false
  );

  const pythonEnv = buildPythonFunctionsEnv(uvEnv, functionsDir);
  return bridgePythonCoreToolsForWindowsArm64(functionsDir, pythonEnv);
}

/**
 * Check if Cosmos DB Emulator is running by checking if port 8081 is open
 */
async function checkCosmosDBEmulator(): Promise<boolean> {
  return new Promise((resolve) => {
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

export function buildDevCommand(
  runDevEnvironment: (options: DevOptions) => Promise<void> = startDevEnvironment,
  verifyProject: (commandName: string, projectRoot?: string) => void = ensureSwallowKitProject
): Command {
  return new Command()
    .name('dev')
    .description('Start SwallowKit development server (Cosmos DB + Next.js + Azure Functions)')
    .option('-p, --port <port>', 'Next.js port', '3000')
    .option('-f, --functions-port <port>', 'Azure Functions port', '7071')
    .option('--host <host>', 'Host name', 'localhost')
    .option('--open', 'Open browser automatically', false)
    .option('--verbose', 'Show verbose logs', false)
    .option('--no-functions', 'Skip Azure Functions startup')
    .option('--seed-env <environment>', 'Replace Cosmos DB Emulator data from dev-seeds/<environment> before startup')
    .option('--mock-connectors', 'Start mock server for connector models (serves Zod-generated data)', false)
    .option('--swa-port <port>', 'SWA authentication emulator port', '4280')
    .option('--no-swa', 'Skip the SWA authentication emulator')
    .action(async (options: ParsedDevActionOptions) => {
      const normalizedOptions = normalizeParsedDevOptions(options);

      // SwallowKit プロジェクトディレクトリかどうかを検証
      verifyProject("dev");

      console.log('🚀 Starting SwallowKit development environment...');
      if (normalizedOptions.verbose) {
        console.log('⚙️  Options:', normalizedOptions);
      }

      await runDevEnvironment(normalizedOptions);
    });
}

export const devCommand = buildDevCommand();

interface CosmosInitializationResult {
  endpoint: string;
  key: string;
  databaseName: string;
  models: ModelInfo[];
}

async function initializeCosmosDB(databaseName: string): Promise<CosmosInitializationResult | null> {
  try {
    const connectionInfoResult = resolveLocalCosmosConnectionInfo(databaseName);
    if (!connectionInfoResult.ok) {
      if (connectionInfoResult.reason === 'missing-local-settings') {
        console.log('⚠️  local.settings.json not found. Skipping Cosmos DB initialization.');
      } else if (connectionInfoResult.reason === 'missing-connection-string') {
        console.log('⚠️  CosmosDBConnection not found in local.settings.json. Skipping Cosmos DB initialization.');
      } else {
        console.log('⚠️  Invalid CosmosDB connection string format.');
      }

      return null;
    }

    console.log('🗄️  Initializing Cosmos DB...');
    const { endpoint, key, databaseName: dbName } = connectionInfoResult.value;

    const client = new CosmosClient({
      endpoint: endpoint,
      key,
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
        console.log(`🔧 Creating container "${containerName}" with partition key ${model.partitionKey}...`);
        const containerResponse = await database.containers.createIfNotExists({
          id: containerName,
          partitionKey: {
            paths: [model.partitionKey],
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
              paths: [model.partitionKey]
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
    return { endpoint, key, databaseName: dbName, models };
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
  const swaPort = options.swaPort || '4280';
  
  // Detect package manager from project lockfile
  const pm = detectFromProject();
  const pmCmd = getCommands(pm);
  const backendLanguage = getBackendLanguage();
  const authConfig = getAuthConfig();
  const useSwaEmulator = authConfig?.provider === 'swa' && !options.noSwa;
  const swaCommand = useSwaEmulator ? await resolveSwaCliCommand(process.cwd()) : null;

  if (useSwaEmulator && !swaCommand) {
    const installCommand = getSwaCliInstallCommand(pm);
    console.error('❌ SWA authentication requires Azure Static Web Apps CLI for local development.');
    console.error('   Install it in this project and retry:');
    console.error(`\n   ${installCommand}\n`);
    process.exitCode = 1;
    return;
  }
  
  // プロセスを管理する配列
  const processes: ChildProcess[] = [];
  let functionsEnv: NodeJS.ProcessEnv = process.env;
  let mockServer: ConnectorMockServer | null = null;
  let envLocalPath = '';
  let envLocalDefaultUrl = ''; // default Functions URL to restore on shutdown
  const functionsBaseUrl = buildFunctionsBaseUrl(options.host, functionsPort);
  let functionsReadinessPromise: Promise<boolean> | null = null;
  let functionsReady = !!options.noFunctions;

  // Cleanup processes on Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping development servers...');
    // Restore .env.local to default Functions port on shutdown
    if (envLocalPath && envLocalDefaultUrl) {
      try {
        if (fs.existsSync(envLocalPath)) {
          const content = fs.readFileSync(envLocalPath, 'utf-8');
          if (content.includes('BACKEND_FUNCTIONS_BASE_URL=') &&
              !content.includes(`BACKEND_FUNCTIONS_BASE_URL=${envLocalDefaultUrl}`)) {
            const restored = content.replace(
              /^BACKEND_FUNCTIONS_BASE_URL=.*/m,
              `BACKEND_FUNCTIONS_BASE_URL=${envLocalDefaultUrl}`
            );
            fs.writeFileSync(envLocalPath, restored, 'utf-8');
          }
        }
      } catch { /* ignore */ }
    }
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

    let functionsCoreToolsCommand: FunctionsCoreToolsCommand | null = null;
    let installedCoreToolsVersion: string | null = null;

    if (hasFunctions && !options.noFunctions) {
      installedCoreToolsVersion = await resolveInstalledCoreToolsVersion();
      functionsCoreToolsCommand = buildFunctionsCoreToolsCommand(backendLanguage, installedCoreToolsVersion);

      if (functionsCoreToolsCommand.command === 'func' && !installedCoreToolsVersion) {
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
      } else if (functionsCoreToolsCommand.command !== 'func') {
        console.log(`ℹ️  Using ${functionsCoreToolsCommand.label}.`);
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
        const databaseName = getDefaultCosmosDatabaseName();
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
          console.log('ℹ️  C# Azure Functions can take longer on cold start while the worker builds.');
        } else {
          functionsEnv = await preparePythonFunctionsEnvironment(functionsDir);
        }
      }
    }

    if (hasFunctions && !options.noFunctions) {
      // Build shared package before starting Functions
      const sharedDir = path.join(process.cwd(), 'shared');
      const sharedPkgPath = path.join(sharedDir, 'package.json');
      if (fs.existsSync(sharedDir) && fs.existsSync(sharedPkgPath)) {
        const sharedPkg = JSON.parse(fs.readFileSync(sharedPkgPath, 'utf-8'));
        if (sharedPkg.scripts?.build) {
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
        } else {
          console.log('⚠️  Shared package has no build script — skipping build. Run "swallowkit add-auth" to fix.');
        }
      }

      // Build TypeScript functions after shared package (functions import from shared)
      if (backendLanguage === 'typescript') {
        const functionsPkgPath = path.join(functionsDir, 'package.json');
        if (fs.existsSync(functionsPkgPath)) {
          const functionsPkg = JSON.parse(fs.readFileSync(functionsPkgPath, 'utf-8'));
          if (functionsPkg.scripts?.build) {
            console.log('📦 Building TypeScript Azure Functions...');
            await runCommand(pm, ['run', 'build'], functionsDir, `${pm} run build`);
          }
        }
      }

      // Azure Functions を起動
      const functionsCommand = functionsCoreToolsCommand ?? buildFunctionsCoreToolsCommand(backendLanguage, installedCoreToolsVersion);
      const funcProcess = spawn(functionsCommand.command, [...functionsCommand.argsPrefix, ...buildFunctionsStartArgs(functionsPort)], {
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

      console.log(`⏳ Waiting for Azure Functions to accept requests at ${functionsBaseUrl}...`);
      functionsReadinessPromise = waitForHttpServerReady(
        functionsBaseUrl,
        getFunctionsReadinessTimeoutMs(backendLanguage)
      );
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
      let mockAuthConfig: { jwtSecret: string; tokenExpiry?: string; customJwt?: { userTable: string; loginIdColumn: string; passwordHashColumn: string; rolesColumn: string }; defaultPolicy?: "authenticated" | "anonymous" } | undefined;
      if (authConfig?.provider === 'custom-jwt' && authConfig.customJwt) {
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
    
    // Ensure .env.local points to bffTargetPort so Next.js reads the correct backend URL.
    // When --mock-connectors is active, bffTargetPort = mock port (7072); otherwise = Functions port (7071).
    // Next.js may load .env.local values that override spawn env vars, so we must keep them in sync.
    envLocalPath = path.join(process.cwd(), '.env.local');
    envLocalDefaultUrl = functionsBaseUrl;
    const bffTargetUrl = buildFunctionsBaseUrl(options.host, bffTargetPort);
    try {
      if (fs.existsSync(envLocalPath)) {
        const envContent = fs.readFileSync(envLocalPath, 'utf-8');
        if (envContent.includes('BACKEND_FUNCTIONS_BASE_URL=') &&
            !envContent.includes(`BACKEND_FUNCTIONS_BASE_URL=${bffTargetUrl}`)) {
          const updated = envContent.replace(
            /^BACKEND_FUNCTIONS_BASE_URL=.*/m,
            `BACKEND_FUNCTIONS_BASE_URL=${bffTargetUrl}`
          );
          fs.writeFileSync(envLocalPath, updated, 'utf-8');
        }
      }
    } catch { /* ignore */ }

    const nextEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BACKEND_FUNCTIONS_BASE_URL: bffTargetUrl,
      FUNCTIONS_BASE_URL: bffTargetUrl,
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

    if (functionsReadinessPromise) {
      functionsReady = await functionsReadinessPromise;
      console.log('');
      if (functionsReady) {
        console.log(`✅ Azure Functions ready (port: ${functionsPort})`);
      } else {
        console.log(`⚠️  Azure Functions is still starting: ${functionsBaseUrl}`);
      }
    }

    let swaReady = false;
    if (useSwaEmulator && swaCommand) {
      const nextUrl = `http://${options.host || 'localhost'}:${port}`;
      console.log(`⏳ Waiting for Next.js before starting the SWA emulator at ${nextUrl}...`);
      const nextReady = await waitForHttpServerReady(nextUrl);
      if (!nextReady) {
        throw new Error(`Next.js did not become ready at ${nextUrl}`);
      }

      console.log(`🔐 Starting SWA authentication emulator (port: ${swaPort})...`);
      const swaProcess = spawn(swaCommand, buildSwaStartArgs(options.host, port, swaPort), {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit',
        env: process.env,
      });
      processes.push(swaProcess);
      swaProcess.on('error', (error) => {
        console.error('❌ SWA CLI startup error:', error.message);
      });

      const swaUrl = `http://${options.host || 'localhost'}:${swaPort}`;
      swaReady = await waitForHttpServerReady(swaUrl);
      if (!swaReady) {
        throw new Error(`SWA authentication emulator did not become ready at ${swaUrl}`);
      }
    }

    console.log('');
    console.log('✅ SwallowKit development environment is running!');
    console.log('');
    if (useSwaEmulator) {
      const swaUrl = `http://${options.host || 'localhost'}:${swaPort}`;
      console.log('🔐 SWA authenticated app:');
      console.log(`   ${swaUrl}`);
      console.log('');
      console.log('🔑 Local sign-in:');
      console.log(`   ${swaUrl}/.auth/login/aad`);
      console.log('   Enter any username and select Login.');
      console.log('   The "authenticated" role is added automatically.');
      console.log('');
      console.log('📱 Next.js direct access (authentication is not emulated):');
      console.log(`   http://${options.host || 'localhost'}:${port}`);
    } else {
      console.log(`📱 Next.js: http://${options.host || 'localhost'}:${port}`);
    }
    if (hasFunctions && !options.noFunctions) {
      console.log(`${functionsReady ? '⚡ Azure Functions' : '⏳ Azure Functions (starting)'}: ${functionsBaseUrl}`);
    }
    if (mockServer) {
      console.log(`🔌 Mock Proxy: ${bffTargetUrl} (BFF → here)`);
    }
    console.log('');
    if (hasFunctions && !options.noFunctions && functionsReady) {
      console.log('💡 Azure Functions and Next.js BFF are connected');
    } else if (hasFunctions && !options.noFunctions) {
      console.log('💡 Azure Functions is still warming up; BFF routes can fail until the backend responds.');
    }
    if (mockServer) {
      console.log('💡 Connector models served from mock server (Zod-generated data)');
    }
    if (swaReady) {
      console.log('💡 Open the app through the SWA port when testing authenticated pages and CRUD APIs.');
    }
    console.log('');

    if (options.open) {
      const url = useSwaEmulator
        ? `http://${options.host || 'localhost'}:${swaPort}`
        : `http://${options.host || 'localhost'}:${port}`;
      console.log(`🌐 Opening browser: ${url}`);
      const start = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(start, [url], { shell: true });
      console.log('');
    }

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

async function resolveSwaCliCommand(projectRoot: string): Promise<string | null> {
  const binaryName = process.platform === 'win32' ? 'swa.cmd' : 'swa';
  const localCommand = path.join(projectRoot, 'node_modules', '.bin', binaryName);
  if (fs.existsSync(localCommand) && await checkCommand(localCommand, ['--version'], {
    cwd: projectRoot,
    shell: process.platform === 'win32',
  })) {
    return localCommand;
  }

  if (await checkCommand('swa', ['--version'], { cwd: projectRoot })) {
    return 'swa';
  }

  return null;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
  env?: NodeJS.ProcessEnv,
  shell = true
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell,
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
