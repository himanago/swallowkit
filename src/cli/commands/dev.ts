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
  build?: boolean;
}

/**
 * Cosmos DB のデータベースとコンテナを初期化
 */
async function initializeCosmosDB() {
  try {
    // @azure/cosmosをdynamic importで読み込み
    const { CosmosClient, PartitionKeyKind } = await import('@azure/cosmos');
    
    // Cosmos DB Emulator の自己署名証明書を許可
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    
    console.log('📦 Cosmos DB のセットアップ中...');
    
    const client = new CosmosClient({
      endpoint: 'https://localhost:8081',
      key: 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
      connectionPolicy: {
        enableEndpointDiscovery: false,
      }
    });
    
    const databaseId = 'TodosDB';
    const containerId = 'Todos';
    
    console.log('   データベース作成中...');
    // データベース作成（タイムアウト付き）
    const { database } = await Promise.race([
      client.databases.createIfNotExists({ id: databaseId }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database creation timeout')), 30000)
      )
    ]) as any;
    
    console.log('   コンテナ作成中...');
    // コンテナ作成（タイムアウト付き）
    await Promise.race([
      database.containers.createIfNotExists({
        id: containerId,
        partitionKey: { 
          paths: ['/id'],
          kind: PartitionKeyKind.Hash
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Container creation timeout')), 30000)
      )
    ]);
    
    console.log('✅ Cosmos DB セットアップ完了');
  } catch (error: any) {
    if (error.code === 409) {
      // 既に存在する場合は無視
      console.log('✅ Cosmos DB は既にセットアップ済みです');
    } else if (error.message?.includes('timeout')) {
      console.warn('⚠️  Cosmos DB セットアップがタイムアウトしました');
      console.warn('   Cosmos DB Emulator が正常に動作しているか確認してください');
      throw error;
    } else {
      console.warn('⚠️  Cosmos DB セットアップエラー:', error.message);
      console.warn('   詳細:', error);
      throw error;
    }
  }
}

export const devCommand = new Command()
  .name('dev')
  .description('SwallowKit 開発サーバーを起動（Next.js + SWA CLI + Azure Functions）')
  .option('-p, --port <port>', 'SWA プロキシポート', '4280')
  .option('--api-port <port>', 'Azure Functions APIポート', '7071')
  .option('--host <host>', 'ホスト名', 'localhost')
  .option('--open', 'ブラウザを自動で開く', false)
  .option('--verbose', '詳細ログを表示', false)
  .option('--build', 'ビルド済みの静的ファイルを使用（本番環境に近い動作確認）', false)
  .action(async (options: DevOptions) => {
    console.log('🚀 SwallowKit 開発環境を起動中...');
    if (options.verbose) {
      console.log('⚙️  オプション:', options);
    }

    await startDevEnvironment(options);
  });

async function startDevEnvironment(options: DevOptions) {
  const port = options.port || '4280';
  const apiPort = options.apiPort || '7071';
  const apiDir = path.join(process.cwd(), 'azure-functions');
  const nextPort = '3000';
  
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
    // 1. Next.js プロジェクトの確認
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const nextConfigPath = path.join(process.cwd(), 'next.config.js');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.log('❌ package.json が見つかりません。');
      console.log('💡 Next.js プロジェクトのルートディレクトリで実行してください。');
      process.exit(1);
    }

    if (!fs.existsSync(nextConfigPath)) {
      console.log('⚠️  next.config.js が見つかりません。Next.js プロジェクトですか？');
    }

    // 2. Azure Functions ディレクトリの存在確認
    if (!fs.existsSync(apiDir)) {
      console.log('⚠️  Azure Functions ディレクトリが見つかりません。');
      console.log('💡 まず `npx swallowkit generate` を実行して Azure Functions を生成してください。');
      console.log('');
      console.log('📝 現在は Next.js のみで起動します（Functions なし）');
      console.log('');
      
      // Functions なしで Next.js のみ起動
      await startNextJsOnly(options, processes);
      return;
    }

    // 3. Azure Functions の依存関係がインストールされているか確認
    const apiNodeModules = path.join(apiDir, 'node_modules');
    if (!fs.existsSync(apiNodeModules)) {
      console.log('');
      console.log('📦 Azure Functions 依存関係をインストール中...');
      const npmInstall = spawn('npm', ['install'], {
        cwd: apiDir,
        stdio: 'inherit',
        shell: true,
      });

      await new Promise<void>((resolve, reject) => {
        npmInstall.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Azure Functions 依存関係のインストール完了');
            resolve();
          } else {
            console.error('❌ Azure Functions 依存関係のインストールに失敗しました');
            reject(new Error(`npm install failed with code ${code}`));
          }
        });
      });
    }

    // 3.5. Azure Functions の TypeScript をコンパイル
    const apiSrcDir = path.join(apiDir, 'src');
    if (fs.existsSync(apiSrcDir)) {
      console.log('');
      console.log('🔨 Azure Functions TypeScript をコンパイル中...');
      const tscBuild = spawn('npm', ['run', 'build'], {
        cwd: apiDir,
        stdio: options.verbose ? 'inherit' : 'pipe',
        shell: true,
      });

      await new Promise<void>((resolve, reject) => {
        tscBuild.on('close', (code) => {
          if (code === 0) {
            console.log('✅ Azure Functions コンパイル完了');
            resolve();
          } else {
            console.error('❌ Azure Functions コンパイルに失敗しました');
            reject(new Error(`tsc build failed with code ${code}`));
          }
        });
      });
    }

    // 4. SWA CLI がインストールされているか確認
    console.log('🔍 Azure Static Web Apps CLI (SWA CLI) を確認中...');
    const swaCliInstalled = await checkSWACLI();
    
    if (!swaCliInstalled) {
      console.log('⚠️  Azure Static Web Apps CLI (SWA CLI) がインストールされていません。');
      console.log('📦 インストールコマンド: npm install -g @azure/static-web-apps-cli');
      console.log('');
      console.log('💡 SWA CLI がないと、Next.js と Azure Functions の統合動作確認ができません。');
      process.exit(1);
    }
    console.log('✅ SWA CLI が利用可能です');

    // 5. Cosmos DB Emulator が起動しているか確認
    console.log('🔍 Cosmos DB Emulator の起動を確認中...');
    const cosmosEmulatorRunning = await checkCosmosDBEmulator();
    
    if (!cosmosEmulatorRunning) {
      console.log('⚠️  Cosmos DB Emulator が起動していません。');
      console.log('');
      console.log('📦 Docker で起動する場合:');
      console.log('   docker run -d --name cosmos-emulator \\');
      console.log('     -p 8081:8081 -p 10250-10255:10250-10255 \\');
      console.log('     mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest');
      console.log('');
      console.log('💡 Windows の場合:');
      console.log('   https://aka.ms/cosmosdb-emulator');
      console.log('');
      process.exit(1);
    }
    console.log('✅ Cosmos DB Emulator が起動しています');
    
    // 6. Cosmos DB のデータベース/コンテナをセットアップ
    await initializeCosmosDB();

    console.log('');
    
    // 7. ビルドモードの場合は静的ファイルを使用
    let outputDir = '';
    if (options.build) {
      console.log('🔨 プロジェクトをビルド中...');
      const { buildCommand } = require('./build');
      await buildCommand({ output: 'dist' });
      outputDir = path.join(process.cwd(), '.swallowkit', 'build', 'out');
      
      if (!fs.existsSync(outputDir)) {
        console.error('❌ ビルド成果物が見つかりません:', outputDir);
        process.exit(1);
      }
      
      console.log('✅ ビルド完了。静的ファイルを使用します');
      console.log(`📁 ${outputDir}`);
    } else {
      console.log('🚀 Next.js 開発サーバーを起動中...');
      
      // Next.js 開発サーバーを起動
      const nextProcess = spawn('npm', ['run', 'dev', '--', '--port', nextPort], {
        cwd: process.cwd(),
        shell: true,
        stdio: options.verbose ? 'inherit' : 'pipe',
      });

      processes.push(nextProcess);

      nextProcess.on('error', (error) => {
        console.error('❌ Next.js 起動エラー:', error.message);
        process.exit(1);
      });

      // Next.js の起動を待つ
      console.log(`   待機中... (http://localhost:${nextPort})`);
      await waitForServer('localhost', parseInt(nextPort), 30000);
      console.log('✅ Next.js 開発サーバー起動完了');
    }

    console.log('');
    console.log('🚀 SWA CLI で統合開発環境を起動中...');
    console.log('');

    // 8. SWA CLI で起動
    const swaArgs = [
      'start',
      options.build ? outputDir : `http://localhost:${nextPort}`,
      '--api-location', './azure-functions',
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
      console.error('❌ SWA CLI 起動エラー:', error.message);
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
    console.log(`📱 統合環境: http://${options.host || 'localhost'}:${port}`);
    console.log(`   - フロントエンド: Next.js (プロキシ経由)`);
    console.log(`   - バックエンドAPI: /api/* → Azure Functions`);
    console.log('');
    console.log(`🔧 個別アクセス:`);
    console.log(`   - Next.js: http://localhost:${nextPort}`);
    console.log(`   - Azure Functions: http://localhost:${apiPort}`);
    console.log('');
    console.log('💡 SWA CLI が Next.js と Azure Functions を統合しています');
    console.log('💡 本番環境と同じ /api/* ルーティングで動作確認できます');
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

// Next.js のみで起動する関数（Functions 未生成時）
async function startNextJsOnly(options: DevOptions, processes: ChildProcess[]) {
  const nextPort = '3000';
  
  console.log('🚀 Next.js 開発サーバーを起動中...');
  
  const nextProcess = spawn('npm', ['run', 'dev', '--', '--port', nextPort], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
  });

  processes.push(nextProcess);

  nextProcess.on('error', (error) => {
    console.error('❌ Next.js 起動エラー:', error.message);
    process.exit(1);
  });

  nextProcess.on('close', (code) => {
    if (code !== 0) {
      console.log(`\n⏹️  Next.js が終了しました (終了コード: ${code})`);
    }
    process.exit(code || 0);
  });

  console.log('');
  console.log('✅ Next.js 開発サーバーが起動しました！');
  console.log('');
  console.log(`📱 フロントエンド: http://localhost:${nextPort}`);
  console.log('');
  console.log('💡 Azure Functions を使用するには:');
  console.log('   1. npx swallowkit generate を実行');
  console.log('   2. 再度 npx swallowkit dev を実行');
  console.log('');
  console.log('🛑 停止するには Ctrl+C を押してください');
  console.log('');
}

// サーバーの起動を待つヘルパー関数
async function waitForServer(host: string, port: number, timeout: number): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const http = require('http');
        const req = http.get(`http://${host}:${port}`, (res: any) => {
          resolve();
        });
        
        req.on('error', () => {
          reject();
        });
        
        req.setTimeout(1000, () => {
          req.destroy();
          reject();
        });
      });
      
      return; // 接続成功
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  throw new Error(`サーバーが ${timeout}ms 以内に起動しませんでした`);
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
      path: '/_explorer/emulator.pem',
      method: 'GET',
      rejectUnauthorized: false, // Emulatorの自己署名証明書を許可
      timeout: 5000,
    };

    const req = protocol.request(options, (res: any) => {
      // 200, 401, 404 など、何らかのレスポンスがあれば起動している
      resolve(res.statusCode >= 200 && res.statusCode < 500);
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