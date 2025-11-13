import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { ApiGenerator } from '../../generator/api-generator';
import { SchemaParser } from '../../generator/schema-parser';

export const generateCommand = new Command()
  .name('generate')
  .alias('gen')
  .description('Analyze Next.js app and generate individual Azure Functions from Server Components and Server Actions')
  .option('-o, --output <path>', 'Azure Functions output directory', './azure-functions')
  .option('-p, --project <path>', 'Project root directory', '.')
  .option('--dry-run', 'Dry run (analyze only, do not generate)', false)
  .option('--force', 'Force overwrite existing files', false)
  .option('--verbose', 'Show detailed logs', false)
  .action(async (options) => {
    console.log('🚀 Analyzing Next.js app and generating Azure Functions...');
    if (options.verbose) {
      console.log('⚙️ Options:', options);
    }

    try {
      const projectRoot = path.resolve(options.project);
      const outputDir = path.resolve(options.output);

      // Check if Next.js project exists
      const nextConfigPath = path.join(projectRoot, 'next.config.js');
      const nextConfigMjsPath = path.join(projectRoot, 'next.config.mjs');
      const hasNextConfig = fs.existsSync(nextConfigPath) || fs.existsSync(nextConfigMjsPath);
      
      if (!hasNextConfig) {
        console.error('❌ Next.js project not found. Make sure you are in a Next.js project directory.');
        console.error('   Looking for: next.config.js or next.config.mjs');
        process.exit(1);
      }

      // 出力ディレクトリが既に存在し、forceオプションがない場合は確認
      if (fs.existsSync(outputDir) && !options.force && !options.dryRun) {
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`📁 出力ディレクトリ "${outputDir}" は既に存在します。上書きしますか？ (y/N): `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log('⏹️ 生成をキャンセルしました');
          process.exit(0);
        }
      }

      // Dry run mode - analyze only
      if (options.dryRun) {
        console.log('🔍 Dry run mode: Analyzing only, no files will be generated...\n');
        
        // Find Next.js app directory
        const appDir = path.join(projectRoot, 'app');
        const pagesDir = path.join(projectRoot, 'pages');
        
        if (!fs.existsSync(appDir) && !fs.existsSync(pagesDir)) {
          console.error('❌ No app/ or pages/ directory found');
          process.exit(1);
        }

        // TODO: Implement actual Next.js analysis
        console.log('📋 Analysis Results:');
        console.log('  - Detected architecture: App Router (Next.js 13+)');
        console.log('  - Server Components: 0 (analysis to be implemented)');
        console.log('  - Server Actions: 0 (analysis to be implemented)');
        console.log('  - Estimated Azure Functions: 0');
        console.log('  - Estimated total size: N/A');
        
        console.log('\n⚠️  Note: Full analysis implementation is in progress.');
        console.log('   This will analyze:');
        console.log('   - Server Components (async functions in app/ directory)');
        console.log('   - Server Actions (\'use server\' directives)');
        console.log('   - Route Handlers (route.ts files)');
        
        console.log('\n✅ Dry run completed');
        return;
      }

      // API生成を実行
      const generator = new ApiGenerator({
        projectRoot,
        outputDir,
        cosmosDbEndpoint: options.cosmosEndpoint,
        cosmosDbKey: options.cosmosKey,
        cosmosDbDatabase: options.cosmosDatabase,
      });

      await generator.generate();

      console.log('\n🎉 API生成が完了しました!');
      console.log(`📁 出力ディレクトリ: ${outputDir}`);

      // APIの依存関係を自動インストール
      console.log('\n� API依存関係をインストール中...');
      const npmInstall = spawn('npm', ['install'], {
        cwd: outputDir,
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

      console.log('\n📝 次のステップ:');
      console.log('  1. swallowkit dev (統合開発環境を起動)');
      console.log('  または');
      console.log(`  1. cd ${path.relative(process.cwd(), outputDir)}`);
      console.log('  2. npm run build');
      console.log('  3. npm start (ローカル開発)');
      console.log('\n💡 Azure にデプロイするには:');
      console.log('  1. Azure Functions Core Tools をインストール');
      console.log('  2. az login でログイン');
      console.log('  3. func azure functionapp publish <app-name>');

    } catch (error) {
      console.error('❌ Error during Azure Functions generation:', error);
      if (error instanceof Error) {
        console.error('Details:', error.message);
        if (process.env.NODE_ENV === 'development') {
          console.error('Stack trace:', error.stack);
        }
      }
      process.exit(1);
    }
  });

// Subcommand: Analyze Next.js project
export const analyzeCommand = new Command()
  .name('analyze')
  .description('Analyze Next.js project and show deployment size estimation')
  .option('-p, --project <path>', 'Project root directory', '.')
  .option('--json', 'Output in JSON format', false)
  .action(async (options) => {
    try {
      const projectRoot = path.resolve(options.project);
      
      // Check if Next.js project exists
      const nextConfigPath = path.join(projectRoot, 'next.config.js');
      const nextConfigMjsPath = path.join(projectRoot, 'next.config.mjs');
      const hasNextConfig = fs.existsSync(nextConfigPath) || fs.existsSync(nextConfigMjsPath);
      
      if (!hasNextConfig) {
        console.error('❌ Next.js project not found');
        process.exit(1);
      }

      const appDir = path.join(projectRoot, 'app');
      const pagesDir = path.join(projectRoot, 'pages');

      // TODO: Implement actual Next.js analysis
      const result = {
        architecture: fs.existsSync(appDir) ? 'App Router' : 'Pages Router',
        serverComponents: 0,
        serverActions: 0,
        routeHandlers: 0,
        estimatedFunctions: 0,
        estimatedSize: 'N/A',
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('📋 Next.js Project Analysis:');
        console.log(`\n🏗️  Architecture: ${result.architecture}`);
        console.log(`\n📊 Analysis Results:`);
        console.log(`  - Server Components: ${result.serverComponents}`);
        console.log(`  - Server Actions: ${result.serverActions}`);
        console.log(`  - Route Handlers: ${result.routeHandlers}`);
        console.log(`  - Estimated Azure Functions: ${result.estimatedFunctions}`);
        console.log(`  - Estimated Total Size: ${result.estimatedSize}`);
        
        console.log('\n⚠️  Note: Full analysis implementation is in progress.');
        console.log('\n💡 Run "swallowkit generate" to create Azure Functions.');
      }

    } catch (error) {
      console.error('❌ Error during analysis:', error);
      process.exit(1);
    }
  });
