import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import prompts from 'prompts';
import { ensureSwallowKitProject } from '../../core/config';

export const provisionCommand = new Command('provision')
  .description('Provision Azure resources using Bicep templates')
  .requiredOption('-g, --resource-group <name>', 'Resource group name')
  .option('--subscription <id>', 'Azure subscription ID (optional)')
  .action(async (options) => {
    // SwallowKit プロジェクトディレクトリかどうかを検証
    ensureSwallowKitProject("provision");

    console.log('🚀 Starting Azure resource provisioning...\n');

    // Check if Azure CLI is installed
    try {
      execSync('az --version', { stdio: 'ignore' });
    } catch {
      console.error('❌ Azure CLI is not installed. Please install it first: https://aka.ms/azure-cli');
      process.exit(1);
    }

    // Check if Bicep files exist
    const infraDir = path.join(process.cwd(), 'infra');
    const mainBicepPath = path.join(infraDir, 'main.bicep');
    const parametersPath = path.join(infraDir, 'main.parameters.json');

    if (!fs.existsSync(mainBicepPath)) {
      console.error('❌ Bicep files not found. Run "swallowkit init" first to generate infrastructure files.');
      process.exit(1);
    }

    try {
      // Prompt for region selection
      console.log('📍 Select Azure regions for your resources:\n');
      
      const regionChoices = await prompts([
        {
          type: 'select',
          name: 'primaryLocation',
          message: 'Primary location for Functions and Cosmos DB',
          choices: [
            { title: 'Japan East (japaneast)', value: 'japaneast' },
            { title: 'Japan West (japanwest)', value: 'japanwest' },
            { title: 'East Asia (eastasia)', value: 'eastasia' },
            { title: 'Southeast Asia (southeastasia)', value: 'southeastasia' },
            { title: 'East US (eastus)', value: 'eastus' },
            { title: 'East US 2 (eastus2)', value: 'eastus2' },
            { title: 'West US 2 (westus2)', value: 'westus2' },
            { title: 'Central US (centralus)', value: 'centralus' },
            { title: 'West Europe (westeurope)', value: 'westeurope' },
          ],
          initial: 0, // Default to japaneast
        },
        {
          type: 'select',
          name: 'swaLocation',
          message: 'Static Web App location (limited availability)',
          choices: [
            { title: 'East Asia (eastasia) - Recommended for Japan', value: 'eastasia' },
            { title: 'West US 2 (westus2)', value: 'westus2' },
            { title: 'Central US (centralus)', value: 'centralus' },
            { title: 'East US 2 (eastus2)', value: 'eastus2' },
            { title: 'West Europe (westeurope)', value: 'westeurope' },
          ],
          initial: 0, // Default to eastasia
        },
      ], {
        onCancel: () => {
          throw new Error('User cancelled');
        }
      });

      if (!regionChoices.primaryLocation || !regionChoices.swaLocation) {
        console.log('\n❌ Region selection cancelled.');
        process.exit(1);
      }

      const primaryLocation = regionChoices.primaryLocation;
      const swaLocation = regionChoices.swaLocation;

      console.log(`\n✓ Primary location: ${primaryLocation}`);
      console.log(`✓ Static Web App location: ${swaLocation}`);
      
      // Confirmation prompt to prevent accidental wrong selection
      const confirmation = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: `Proceed with deployment to ${primaryLocation} (primary) and ${swaLocation} (SWA)?`,
        initial: true
      }, {
        onCancel: () => {
          throw new Error('User cancelled');
        }
      });

      if (!confirmation.proceed) {
        console.log('\n❌ Deployment cancelled by user.');
        process.exit(0);
      }

      console.log('');
      // Set subscription if provided
      if (options.subscription) {
        console.log(`🔧 Setting subscription: ${options.subscription}`);
        execSync(`az account set --subscription ${options.subscription}`, { stdio: 'inherit' });
      }

      // Create resource group if it doesn't exist (use primary location)
      console.log(`🔧 Ensuring resource group exists: ${options.resourceGroup}`);
      execSync(
        `az group create --name ${options.resourceGroup} --location ${primaryLocation}`,
        { stdio: 'inherit' }
      );

      // Deploy Bicep template with both locations
      console.log('\n📦 Deploying resources (this may take several minutes)...\n');
      const deployCommand = `az deployment group create --resource-group ${options.resourceGroup} --template-file "${mainBicepPath}" --parameters "${parametersPath}" --parameters location=${primaryLocation} --parameters swaLocation=${swaLocation}`;
      
      const output = execSync(deployCommand, { encoding: 'utf-8', stdio: 'pipe' });
      const deployment = JSON.parse(output);

      // Display outputs
      console.log('\n✅ Deployment completed successfully!\n');
      console.log('📋 Resource Information:');
      
      if (deployment.properties?.outputs) {
        const outputs = deployment.properties.outputs;
        
        if (outputs.staticWebAppName) {
          console.log(`  - Static Web App: ${outputs.staticWebAppName.value}`);
          console.log(`  - URL: https://${outputs.staticWebAppUrl.value}`);
        }
        if (outputs.functionsAppName) {
          console.log(`  - Function App: ${outputs.functionsAppName.value}`);
          console.log(`  - URL: https://${outputs.functionsAppUrl.value}`);
        }
        if (outputs.cosmosDbAccountName) {
          console.log(`  - Cosmos DB: ${outputs.cosmosDbAccountName.value}`);
          console.log(`  - Database: ${outputs.cosmosDatabaseName.value}`);
        }
      }

      // Next steps guidance
      console.log('\n📝 Next Steps:');
      console.log('  1. Configure CI/CD secrets/variables:');
      console.log('     - Get Static Web App deployment token:');
      console.log(`       az staticwebapp secrets list --name <swa-name> --resource-group ${options.resourceGroup} --query "properties.apiKey" -o tsv`);
      console.log('     - Get Function App publish profile:');
      console.log(`       az functionapp deployment list-publishing-profiles --name <function-name> --resource-group ${options.resourceGroup} --xml`);
      console.log('  2. Set up your CI/CD pipeline (GitHub Actions or Azure Pipelines)');
      console.log('  3. Push your code to trigger the first deployment\n');

    } catch (error: any) {
      console.error('❌ Deployment failed:');
      console.error(error.message);
      process.exit(1);
    }
  });
