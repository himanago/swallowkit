import { spawn } from 'child_process';
import * as readline from 'readline';

interface SetupOptions {
  yes?: boolean; // 自動承認フラグ
}

export async function setupCommand(options: SetupOptions = {}) {
  console.log('🚀 SwallowKit セットアップを開始します...');
  console.log('');
  console.log('SwallowKit には以下のツールが必要です:');
  console.log('  1. Azure CLI');
  console.log('  2. Azure Static Web Apps CLI (SWA CLI)');
  console.log('  3. Azure Cosmos DB Emulator');
  console.log('');

  const results = {
    azureCli: await checkAzureCLI(),
    swaCli: await checkSWACLI(),
    cosmosEmulator: await checkCosmosDBEmulator(),
  };

  console.log('📋 インストール状況:');
  console.log(`  Azure CLI: ${results.azureCli ? '✅ インストール済み' : '❌ 未インストール'}`);
  console.log(`  SWA CLI: ${results.swaCli ? '✅ インストール済み' : '❌ 未インストール'}`);
  console.log(`  Cosmos DB Emulator: ${results.cosmosEmulator ? '✅ インストール済み' : '❌ 未インストール'}`);
  console.log('');

  const missing = [];
  if (!results.azureCli) missing.push('Azure CLI');
  if (!results.swaCli) missing.push('SWA CLI');
  if (!results.cosmosEmulator) missing.push('Cosmos DB Emulator');

  if (missing.length === 0) {
    console.log('✅ すべての必須ツールがインストールされています！');
    return;
  }

  console.log(`⚠️  ${missing.length} 個のツールが未インストールです: ${missing.join(', ')}`);
  console.log('');

  // Cosmos DB Emulator だけが未インストールの場合
  const onlyCosmosDbMissing = missing.length === 1 && missing[0] === 'Cosmos DB Emulator';
  
  if (onlyCosmosDbMissing) {
    // Cosmos DB Emulator は自動インストールしない
    console.log('📦 Cosmos DB Emulator について:');
    console.log('');
    console.log('SwallowKit は Cosmos DB を標準データストアとして使用します。');
    console.log('以下のいずれかの方法でインストールしてください:');
    console.log('');
    console.log('1. Windows 版 (推奨):');
    console.log('   https://aka.ms/cosmosdb-emulator');
    console.log('   または: winget install Microsoft.Azure.CosmosEmulator');
    console.log('');
    console.log('2. Docker 版:');
    console.log('   docker pull mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator');
    console.log('   docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator');
    console.log('');
    console.log('3. Linux Emulator:');
    console.log('   https://docs.microsoft.com/azure/cosmos-db/linux-emulator');
    console.log('');
    return;
  }

  if (!options.yes) {
    const answer = await askQuestion('Azure CLI / SWA CLI をインストールしますか？ (Y/n): ');
    if (answer.toLowerCase() !== 'y' && answer !== '') {
      console.log('セットアップをキャンセルしました。');
      return;
    }
  }

  console.log('');
  console.log('📦 インストールを開始します...');
  console.log('');

  // Azure CLI
  if (!results.azureCli) {
    console.log('🔄 Azure CLI をインストール中...');
    const azureCliInstalled = await installWithWinget('Microsoft.AzureCLI', 'Azure CLI');
    if (azureCliInstalled) {
      console.log('✅ Azure CLI のインストールが完了しました');
    } else {
      console.log('❌ Azure CLI のインストールに失敗しました');
      console.log('💡 手動インストール: https://aka.ms/installazurecliwindows');
    }
    console.log('');
  }

  // SWA CLI
  if (!results.swaCli) {
    console.log('🔄 SWA CLI をインストール中...');
    const swaCliInstalled = await installWithNpm('@azure/static-web-apps-cli', 'SWA CLI');
    if (swaCliInstalled) {
      console.log('✅ SWA CLI のインストールが完了しました');
    } else {
      console.log('❌ SWA CLI のインストールに失敗しました');
      console.log('💡 手動インストール: npm install -g @azure/static-web-apps-cli');
    }
    console.log('');
  }

  // Cosmos DB Emulator（インストール方法を案内）
  if (!results.cosmosEmulator) {
    console.log('� Cosmos DB Emulator について:');
    console.log('');
    console.log('SwallowKit は Cosmos DB を標準データストアとして使用します。');
    console.log('以下のいずれかの方法でインストールしてください:');
    console.log('');
    console.log('1. Windows 版 (推奨):');
    console.log('   https://aka.ms/cosmosdb-emulator');
    console.log('   または: winget install Microsoft.Azure.CosmosEmulator');
    console.log('');
    console.log('2. Docker 版:');
    console.log('   docker pull mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator');
    console.log('   docker run -p 8081:8081 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator');
    console.log('');
    console.log('3. Linux Emulator:');
    console.log('   https://docs.microsoft.com/azure/cosmos-db/linux-emulator');
    console.log('');
  }

  console.log('🎉 セットアップが完了しました！');
  console.log('');
  console.log('次のステップ:');
  if (!results.cosmosEmulator) {
    console.log('  1. Cosmos DB Emulator をインストールして起動');
    console.log('  2. swallowkit init --name my-app');
    console.log('  3. cd my-app && npm install');
  } else {
    console.log('  1. swallowkit init --name my-app');
    console.log('  2. cd my-app && npm install');
  }
  console.log('  4. swallowkit generate');
  console.log('  5. swallowkit dev');
}

async function checkAzureCLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn('az', ['--version'], {
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

async function checkSWACLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const checkProcess = spawn('swa', ['--version'], {
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

async function checkCosmosDBEmulator(): Promise<boolean> {
  return new Promise((resolve) => {
    const https = require('https');
    const options = {
      hostname: 'localhost',
      port: 8081,
      path: '/',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 3000,
    };

    const req = https.request(options, (res: any) => {
      resolve(res.statusCode === 200 || res.statusCode === 401);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function installWithWinget(packageId: string, displayName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const installProcess = spawn('winget', ['install', '--id', packageId, '--accept-source-agreements', '--accept-package-agreements'], {
      shell: true,
      stdio: 'inherit',
    });

    installProcess.on('close', (code) => {
      resolve(code === 0);
    });

    installProcess.on('error', () => {
      resolve(false);
    });
  });
}

async function installWithNpm(packageName: string, displayName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const installProcess = spawn('npm', ['install', '-g', packageName], {
      shell: true,
      stdio: 'inherit',
    });

    installProcess.on('close', (code) => {
      resolve(code === 0);
    });

    installProcess.on('error', () => {
      resolve(false);
    });
  });
}

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
