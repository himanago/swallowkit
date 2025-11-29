import { Command } from 'commander';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

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
  .description('SwallowKit 開発サーバーを起動（Cosmos DB + Next.js + Azure Functions）')
  .option('-p, --port <port>', 'Next.js ポート', '3000')
  .option('-f, --functions-port <port>', 'Azure Functions ポート', '7071')
  .option('--host <host>', 'ホスト名', 'localhost')
  .option('--open', 'ブラウザを自動で開く', false)
  .option('--verbose', '詳細ログを表示', false)
  .option('--no-functions', 'Azure Functions の起動をスキップ', false)
  .action(async (options: DevOptions & { functionsPort?: string; noFunctions?: boolean }) => {
    console.log('🚀 SwallowKit 開発環境を起動中...');
    if (options.verbose) {
      console.log('⚙️  オプション:', options);
    }

    await startDevEnvironment(options);
  });

async function startDevEnvironment(options: DevOptions) {
  const port = options.port || '3000';
  const functionsPort = options.functionsPort || '7071';
  
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
    const nextConfigPathJs = path.join(process.cwd(), 'next.config.js');
    const nextConfigPathTs = path.join(process.cwd(), 'next.config.ts');
    const nextConfigPathMjs = path.join(process.cwd(), 'next.config.mjs');
    
    if (!fs.existsSync(packageJsonPath)) {
      console.log('❌ package.json が見つかりません。');
      console.log('💡 Next.js プロジェクトのルートディレクトリで実行してください。');
      process.exit(1);
    }

    if (!fs.existsSync(nextConfigPathJs) && !fs.existsSync(nextConfigPathTs) && !fs.existsSync(nextConfigPathMjs)) {
      console.log('⚠️  next.config ファイルが見つかりません。Next.js プロジェクトですか？');
    }

    // 2. Azure Functions が存在するかチェック
    const functionsDir = path.join(process.cwd(), 'functions');
    const hasFunctions = fs.existsSync(functionsDir) && 
                        fs.existsSync(path.join(functionsDir, 'package.json'));

    if (hasFunctions && !options.noFunctions) {
      console.log('');
      console.log('🚀 Azure Functions を起動中...');
      
      // functionsディレクトリで npm install が実行されているか確認
      const functionsNodeModules = path.join(functionsDir, 'node_modules');
      if (!fs.existsSync(functionsNodeModules)) {
        console.log('📦 Azure Functions の依存関係をインストール中...');
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
        stdio: options.verbose ? 'inherit' : 'pipe',
        env: { ...process.env, FUNCTIONS_PORT: functionsPort }
      });

      // Functions の出力を整形して表示
      if (!options.verbose && funcProcess.stdout) {
        funcProcess.stdout.on('data', (data) => {
          const output = data.toString();
          // 重要なメッセージのみ表示
          if (output.includes('Worker process started') || 
              output.includes('Host started') ||
              output.includes('Functions:') ||
              output.includes('For detailed output')) {
            process.stdout.write(`[Functions] ${output}`);
          }
        });
      }

      if (funcProcess.stderr) {
        funcProcess.stderr.on('data', (data) => {
          console.error(`[Functions Error] ${data}`);
        });
      }

      processes.push(funcProcess);

      funcProcess.on('error', (error) => {
        console.error('⚠️  Azure Functions 起動エラー:', error.message);
        console.log('💡 Azure Functions Core Tools がインストールされているか確認してください');
        console.log('   npm install -g azure-functions-core-tools@4');
      });

      funcProcess.on('close', (code) => {
        if (code !== 0) {
          console.log(`\n⏹️  Azure Functions が終了しました (終了コード: ${code})`);
        }
      });

      console.log(`✅ Azure Functions が起動しました (ポート: ${functionsPort})`);
    } else if (!hasFunctions) {
      console.log('');
      console.log('ℹ️  functions/ ディレクトリが見つかりません。Next.js のみ起動します。');
    } else if (options.noFunctions) {
      console.log('');
      console.log('ℹ️  --no-functions が指定されているため、Azure Functions はスキップします。');
    }

    console.log('');
    console.log('🚀 Next.js 開発サーバーを起動中...');

    // 5. Next.js 開発サーバーを起動
    const nextArgs = ['next', 'dev', '--port', port];
    
    if (options.open) {
      // Next.js 14+ では --open オプションが非推奨になったため、手動でブラウザを開く
      setTimeout(() => {
        const url = `http://${options.host || 'localhost'}:${port}`;
        console.log(`\n🌐 ブラウザを開いています: ${url}`);
        
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
      console.error('❌ Next.js 起動エラー:', error.message);
      process.exit(1);
    });

    nextProcess.on('close', (code) => {
      if (code !== 0) {
        console.log(`\n⏹️  Next.js が終了しました (終了コード: ${code})`);
      }
      // Next.js が終了したら全プロセスを終了
      processes.forEach((proc) => {
        if (proc && !proc.killed) {
          proc.kill();
        }
      });
      process.exit(code || 0);
    });

    console.log('');
    console.log('✅ SwallowKit 開発環境が起動しました！');
    console.log('');
    console.log(`📱 Next.js: http://${options.host || 'localhost'}:${port}`);
    if (hasFunctions && !options.noFunctions) {
      console.log(`⚡ Azure Functions: http://${options.host || 'localhost'}:${functionsPort}`);
    }
    console.log('');
    if (hasFunctions && !options.noFunctions) {
      console.log('💡 Azure Functions と Next.js BFF が連携しています');
    }
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