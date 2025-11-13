import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface DeployOptions {
  swaName?: string;
  functionsName?: string;
  resourceGroup?: string;
  location?: string;
  skipBuild?: boolean;
}

export const deployCommand = new Command()
  .name('deploy')
  .description('Deploy to Azure Static Web Apps and Azure Functions')
  .option('--swa-name <name>', 'Azure Static Web Apps resource name')
  .option('--functions-name <name>', 'Azure Functions resource name')
  .option('--resource-group <name>', 'Azure resource group name')
  .option('--location <location>', 'Azure region', 'japaneast')
  .option('--skip-build', 'Skip build step', false)
  .action(async (options: DeployOptions) => {
    console.log('🚀 Deploying to Azure...\n');

    try {
      const projectRoot = process.cwd();

      // Check if Azure CLI is installed
      await checkAzureCli();

      // Check if logged in to Azure
      await checkAzureLogin();

      // Build if not skipped
      if (!options.skipBuild) {
        console.log('📦 Building project...\n');
        await runBuild(projectRoot);
      }

      // Deploy Static Web Apps
      if (options.swaName && options.resourceGroup) {
        await deploySwa(options, projectRoot);
      } else {
        console.log('⚠️  Skipping Static Web Apps deployment (missing --swa-name or --resource-group)');
      }

      // Deploy Azure Functions
      if (options.functionsName && options.resourceGroup) {
        await deployFunctions(options, projectRoot);
      } else {
        console.log('⚠️  Skipping Azure Functions deployment (missing --functions-name or --resource-group)');
      }

      console.log('\n🎉 Deployment completed!');
      console.log('\n📝 Next steps:');
      console.log('  1. Visit Azure Portal to verify deployment');
      console.log('  2. Check application logs if needed');

    } catch (error) {
      console.error('❌ Deployment failed:', error);
      if (error instanceof Error) {
        console.error('Details:', error.message);
      }
      process.exit(1);
    }
  });

async function checkAzureCli() {
  return new Promise<void>((resolve, reject) => {
    const check = spawn('az', ['--version'], {
      stdio: 'pipe',
      shell: true
    });

    check.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Azure CLI is installed');
        resolve();
      } else {
        reject(new Error('Azure CLI is not installed. Please install it from https://aka.ms/installazurecliwindows'));
      }
    });
  });
}

async function checkAzureLogin() {
  return new Promise<void>((resolve, reject) => {
    const check = spawn('az', ['account', 'show'], {
      stdio: 'pipe',
      shell: true
    });

    check.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Logged in to Azure');
        resolve();
      } else {
        reject(new Error('Not logged in to Azure. Please run: az login'));
      }
    });
  });
}

async function runBuild(projectRoot: string) {
  return new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    build.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

async function deploySwa(options: DeployOptions, projectRoot: string) {
  console.log('\n📦 Deploying to Azure Static Web Apps...');
  console.log(`   Resource: ${options.swaName}`);
  console.log(`   Resource Group: ${options.resourceGroup}\n`);

  // Check if SWA CLI is installed
  const swaCliCheck = spawn('swa', ['--version'], {
    stdio: 'pipe',
    shell: true
  });

  await new Promise<void>((resolve, reject) => {
    swaCliCheck.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('SWA CLI is not installed. Install it with: npm install -g @azure/static-web-apps-cli'));
      }
    });
  });

  // Deploy using SWA CLI
  const appLocation = './';
  const outputLocation = '.next';
  const apiLocation = './azure-functions';

  const deployArgs = [
    'deploy',
    appLocation,
    '--app-location', appLocation,
    '--output-location', outputLocation,
    '--api-location', apiLocation,
    '--resource-group', options.resourceGroup!,
    '--app-name', options.swaName!,
  ];

  return new Promise<void>((resolve, reject) => {
    const deploy = spawn('swa', deployArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    deploy.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Static Web Apps deployment completed');
        resolve();
      } else {
        reject(new Error(`SWA deployment failed with code ${code}`));
      }
    });
  });
}

async function deployFunctions(options: DeployOptions, projectRoot: string) {
  console.log('\n⚡ Deploying Azure Functions...');
  console.log(`   Function App: ${options.functionsName}`);
  console.log(`   Resource Group: ${options.resourceGroup}\n`);

  const functionsDir = path.join(projectRoot, 'azure-functions');

  if (!fs.existsSync(functionsDir)) {
    console.log('⚠️  No azure-functions/ directory found. Skipping...');
    return;
  }

  // Deploy using Azure Functions Core Tools
  const deployArgs = [
    'azure',
    'functionapp',
    'publish',
    options.functionsName!,
    '--typescript'
  ];

  return new Promise<void>((resolve, reject) => {
    const deploy = spawn('func', deployArgs, {
      cwd: functionsDir,
      stdio: 'inherit',
      shell: true
    });

    deploy.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Azure Functions deployment completed');
        resolve();
      } else {
        reject(new Error(`Functions deployment failed with code ${code}`));
      }
    });
  });
}
