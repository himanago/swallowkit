import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface DevOptions {
  port?: string;
  apiPort?: string;
  host?: string;
  open?: boolean;
  verbose?: boolean;
}

/**
 * Cosmos DB のデータベースとコンテナを初期化
 */
async function initializeCosmosDB() {
  try {
    // @azure/cosmosをdynamic importで読み込み
    const { CosmosClient, PartitionKeyKind } = await import('@azure/cosmos');
    
    const client = new CosmosClient({
      endpoint: 'http://localhost:8081',
      key: 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=='
    });
    
    const databaseId = 'swallowkit-db';
    const containerId = 'todos';
    
    console.log('📦 Cosmos DB のセットアップ中...');
    
    // データベース作成
    const { database } = await client.databases.createIfNotExists({ id: databaseId });
    
    // コンテナ作成
    await database.containers.createIfNotExists({
      id: containerId,
      partitionKey: { 
        paths: ['/id'],
        kind: PartitionKeyKind.Hash
      }
    });
    
    console.log('✅ Cosmos DB セットアップ完了');
  } catch (error: any) {
    if (error.code === 409) {
      // 既に存在する場合は無視
      console.log('✅ Cosmos DB は既にセットアップ済みです');
    } else {
      console.warn('⚠️  Cosmos DB セットアップでエラーが発生しましたが、続行します:', error.message);
    }
  }
}

export const devCommand = new Command()
  .name('dev')
  .description('SwallowKit 開発サーバーを起動（SWA CLI統合）')
  .option('-p, --port <port>', 'フロントエンドポート', '4280')
  .option('--api-port <port>', 'Azure Functions APIポート', '7071')
  .option('--host <host>', 'ホスト名', 'localhost')
  .option('--open', 'ブラウザを自動で開く', false)
  .option('--verbose', '詳細ログを表示', false)
  .action(async (options: DevOptions) => {
    console.log('🚀 SwallowKit 開発環境を起動中...');
    console.log('⚙️  オプション:', options);

    await startDevEnvironment(options);
  });

async function startDevEnvironment(options: DevOptions) {
  const port = options.port || '4280';
  const apiPort = options.apiPort || '7071';
  const apiDir = path.join(process.cwd(), 'api');
  
  // プロセスを管理する配列
  const processes: ChildProcess[] = [];

  // Ctrl+Cでプロセスをクリーンアップ
  process.on('SIGINT', () => {
    console.log('\n🛑 開発サーバーを停止中...');
    processes.forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill();
      }
    });
    process.exit(0);
  });

  try {
    // 1. APIディレクトリの存在確認
    if (!fs.existsSync(apiDir)) {
      console.log('⚠️  APIディレクトリが見つかりません。');
      console.log('💡 まず `swallowkit generate` を実行してAPIを生成してください。');
      process.exit(1);
    }

    // 2. APIの依存関係がインストールされているか確認
    const apiNodeModules = path.join(apiDir, 'node_modules');
    if (!fs.existsSync(apiNodeModules)) {
      console.log('');
      console.log('📦 API依存関係をインストール中...');
      const npmInstall = spawn('npm', ['install'], {
        cwd: apiDir,
        stdio: 'inherit',
        shell: true,
      });

      await new Promise<void>((resolve, reject) => {
        npmInstall.on('close', (code) => {
          if (code === 0) {
            console.log('✅ API依存関係のインストール完了');
            resolve();
          } else {
            console.error('❌ API依存関係のインストールに失敗しました');
            reject(new Error(`npm install failed with code ${code}`));
          }
        });
      });
    }

    // 3. SWA CLIがインストールされているか確認
    const swaCliInstalled = await checkSWACLI();
    
    if (!swaCliInstalled) {
      console.log('⚠️  Azure Static Web Apps CLI (SWA CLI) がインストールされていません。');
      console.log('📦 インストールコマンド: npm install -g @azure/static-web-apps-cli');
      console.log('');
      console.log('💡 または、個別に起動することもできます:');
      console.log('   1. フロントエンド: npm run dev (Vite)');
      console.log('   2. バックエンド: cd api && npm start');
      process.exit(1);
    }

    // 4. Cosmos DB Emulatorが起動しているか確認
    console.log('🔍 Cosmos DB Emulator の起動を確認中...');
    const cosmosEmulatorRunning = await checkCosmosDBEmulator();
    
    if (!cosmosEmulatorRunning) {
      console.log('⚠️  Cosmos DB Emulator が起動していません。');
      console.log('');
      console.log('📦 Cosmos DB Emulator をインストール:');
      console.log('   https://docs.microsoft.com/azure/cosmos-db/local-emulator');
      console.log('');
      console.log('🚀 起動後、以下のエンドポイントで接続できることを確認:');
      console.log('   https://localhost:8081');
      console.log('');
      console.log('💡 Cosmos DB Emulator は SwallowKit の必須コンポーネントです。');
      process.exit(1);
    }
    console.log('✅ Cosmos DB Emulator が起動しています');
    
    // 5. Cosmos DB のデータベース/コンテナをセットアップ
    await initializeCosmosDB();

    console.log('');
    console.log('📦 Azure Functions APIをビルド中...');
    
    // 5. Azure Functions APIをビルド
    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: apiDir,
      shell: true,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });

    await new Promise<void>((resolve, reject) => {
      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ APIビルド完了');
          resolve();
        } else {
          reject(new Error(`APIビルドに失敗しました (終了コード: ${code})`));
        }
      });
    });

    console.log('');
    console.log('🚀 Vite 開発サーバーを起動中...');
    
    // 6. Vite開発サーバーを起動
    const vitePort = '5173';
    const viteProcess = spawn('npx', ['vite', '--port', vitePort, '--host'], {
      cwd: process.cwd(),
      shell: true,
      stdio: options.verbose ? 'inherit' : 'pipe',
    });

    processes.push(viteProcess);

    viteProcess.on('error', (error) => {
      console.error('❌ Vite起動エラー:', error.message);
      console.log('💡 Viteがインストールされているか確認してください: npm install -D vite @vitejs/plugin-react');
      process.exit(1);
    });

    // Viteの起動を待つ（簡易版）
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ Vite開発サーバー起動完了');

    console.log('');
    console.log('🚀 SWA CLI で統合開発環境を起動中...');
    console.log('');

    // 7. SWA CLI で起動（Vite開発サーバーをプロキシ）
    const swaArgs = [
      'start',
      `http://localhost:${vitePort}`,
      '--api-location', './api',
      '--port', port,
      '--api-port', apiPort,
      '--devserver-timeout', '120000',
    ];

    if (options.open) {
      swaArgs.push('--open');
    }

    if (options.verbose) {
      swaArgs.push('--verbose');
    }

    const swaProcess = spawn('swa', swaArgs, {
      cwd: process.cwd(),
      shell: true,
      stdio: 'inherit',
    });

    processes.push(swaProcess);

    swaProcess.on('error', (error) => {
      console.error('❌ SWA CLI起動エラー:', error.message);
      process.exit(1);
    });

    swaProcess.on('close', (code) => {
      if (code !== 0) {
        console.log(`\n⏹️  SWA CLI が終了しました (終了コード: ${code})`);
      }
      process.exit(code || 0);
    });

    console.log('');
    console.log('✅ SwallowKit 開発環境が起動しました！');
    console.log('');
    console.log(`📱 フロントエンド: http://${options.host || 'localhost'}:${port}`);
    console.log(`⚡ バックエンドAPI: http://${options.host || 'localhost'}:${port}/api/*`);
    console.log(`🔧 Azure Functions: http://${options.host || 'localhost'}:${apiPort}`);
    console.log('');
    console.log('💡 SWA CLIがフロントエンドとバックエンドを統合しています');
    console.log('💡 /api/* へのリクエストは自動的にAzure Functionsにルーティングされます');
    console.log('');
    console.log('🛑 停止するには Ctrl+C を押してください');
    console.log('');

  } catch (error) {
    console.error('❌ 開発環境の起動に失敗しました:', error instanceof Error ? error.message : error);
    processes.forEach((proc) => {
      if (proc && !proc.killed) {
        proc.kill();
      }
    });
    process.exit(1);
  }
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
  // HTTPSで試行
  const httpsResult = await tryCosmosConnection(true);
  if (httpsResult) return true;
  
  // HTTPで試行（Docker版など）
  return await tryCosmosConnection(false);
}

async function tryCosmosConnection(useHttps: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = useHttps ? require('https') : require('http');
    const options = {
      hostname: 'localhost',
      port: 8081,
      path: '/',
      method: 'GET',
      rejectUnauthorized: false, // Emulatorの自己署名証明書を許可
      timeout: 3000,
    };

    const req = protocol.request(options, (res: any) => {
      resolve(res.statusCode === 200 || res.statusCode === 401); // 401もEmulatorが起動している証拠
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
