import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { ApiGenerator } from '../../generator/api-generator';
import { SchemaParser } from '../../generator/schema-parser';

export const generateCommand = new Command()
  .name('generate')
  .alias('gen')
  .description('SwallowKit API自動生成（Azure Functions v4）')
  .option('-o, --output <path>', 'API出力ディレクトリ', './api')
  .option('-p, --project <path>', 'プロジェクトルートディレクトリ', '.')
  .option('--cosmos-endpoint <url>', 'Cosmos DB エンドポイント')
  .option('--cosmos-key <key>', 'Cosmos DB キー')
  .option('--cosmos-database <name>', 'Cosmos DB データベース名', 'swallowkit')
  .option('--dry-run', 'ドライラン（実際には生成しない）', false)
  .option('--force', '既存ファイルを強制上書き', false)
  .action(async (options) => {
    console.log('🚀 SwallowKit API自動生成を開始します...');
    console.log('⚙️ オプション:', options);

    try {
      const projectRoot = path.resolve(options.project);
      const outputDir = path.resolve(options.output);

      // プロジェクトルートが存在するかチェック
      if (!fs.existsSync(projectRoot)) {
        console.error('❌ プロジェクトルートが見つかりません:', projectRoot);
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

      // ドライランの場合は解析のみ実行
      if (options.dryRun) {
        console.log('🔍 ドライランモード: ファイル解析のみ実行します...');
        
        const schemaFiles = SchemaParser.findSchemaFiles(projectRoot);
        const serverFunctionFiles = SchemaParser.findServerFunctionFiles(projectRoot);

        console.log('\n📋 検出されたファイル:');
        console.log(`  スキーマファイル: ${schemaFiles.length}個`);
        schemaFiles.forEach(file => console.log(`    - ${path.relative(projectRoot, file)}`));
        
        console.log(`  サーバー関数ファイル: ${serverFunctionFiles.length}個`);
        serverFunctionFiles.forEach(file => console.log(`    - ${path.relative(projectRoot, file)}`));

        // スキーマ解析結果を表示
        const schemas = [];
        for (const file of schemaFiles) {
          const fileSchemas = SchemaParser.parseSchemaFile(file);
          schemas.push(...fileSchemas);
        }

        if (schemas.length > 0) {
          console.log('\n🎯 検出されたスキーマ:');
          schemas.forEach(schema => {
            console.log(`  - ${schema.name}`);
            console.log(`    テーブル名: ${schema.tableName}`);
            console.log(`    操作: ${schema.operations.map(op => op.name).join(', ')}`);
          });
        }

        // サーバー関数解析結果を表示
        const serverFunctions = [];
        for (const file of serverFunctionFiles) {
          const fileFunctions = SchemaParser.parseServerFunctions(file);
          serverFunctions.push(...fileFunctions);
        }

        if (serverFunctions.length > 0) {
          console.log('\n⚡ 検出されたサーバー関数:');
          serverFunctions.forEach(fn => {
            console.log(`  - ${fn.name}(${fn.parameters.map(p => `${p.name}: ${p.type}`).join(', ')}) => ${fn.returnType}`);
          });
        }

        console.log('\n✅ ドライラン完了');
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
      console.error('❌ API生成中にエラーが発生しました:', error);
      if (error instanceof Error) {
        console.error('詳細:', error.message);
        if (process.env.NODE_ENV === 'development') {
          console.error('スタックトレース:', error.stack);
        }
      }
      process.exit(1);
    }
  });

// サブコマンド: スキーマ解析のみ
export const analyzeCommand = new Command()
  .name('analyze')
  .description('プロジェクト内のスキーマとサーバー関数を解析')
  .option('-p, --project <path>', 'プロジェクトルートディレクトリ', '.')
  .option('--json', 'JSON形式で出力', false)
  .action(async (options) => {
    try {
      const projectRoot = path.resolve(options.project);
      
      const schemaFiles = SchemaParser.findSchemaFiles(projectRoot);
      const serverFunctionFiles = SchemaParser.findServerFunctionFiles(projectRoot);

      const result = {
        schemaFiles: schemaFiles.map((f: string) => path.relative(projectRoot, f)),
        serverFunctionFiles: serverFunctionFiles.map((f: string) => path.relative(projectRoot, f)),
        schemas: [] as any[],
        serverFunctions: [] as any[],
      };

      // スキーマ解析
      for (const file of schemaFiles) {
        const fileSchemas = SchemaParser.parseSchemaFile(file);
        result.schemas.push(...fileSchemas.map(s => ({
          name: s.name,
          tableName: s.tableName,
          operations: s.operations.map(op => op.name),
          file: path.relative(projectRoot, file),
        })));
      }

      // サーバー関数解析
      for (const file of serverFunctionFiles) {
        const fileFunctions = SchemaParser.parseServerFunctions(file);
        result.serverFunctions.push(...fileFunctions.map(fn => ({
          name: fn.name,
          parameters: fn.parameters,
          returnType: fn.returnType,
          isAsync: fn.isAsync,
          file: path.relative(projectRoot, file),
        })));
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('📋 プロジェクト解析結果:');
        console.log(`\n📁 スキーマファイル (${result.schemaFiles.length}個):`);
        result.schemaFiles.forEach(file => console.log(`  - ${file}`));
        
        console.log(`\n📁 サーバー関数ファイル (${result.serverFunctionFiles.length}個):`);
        result.serverFunctionFiles.forEach(file => console.log(`  - ${file}`));
        
        console.log(`\n🎯 スキーマ (${result.schemas.length}個):`);
        result.schemas.forEach((schema: any) => {
          console.log(`  - ${schema.name} (${schema.file})`);
          console.log(`    テーブル: ${schema.tableName}`);
          console.log(`    操作: ${schema.operations.join(', ')}`);
        });
        
        console.log(`\n⚡ サーバー関数 (${result.serverFunctions.length}個):`);
        result.serverFunctions.forEach((fn: any) => {
          console.log(`  - ${fn.name} (${fn.file})`);
          console.log(`    パラメータ: ${fn.parameters.map((p: any) => `${p.name}: ${p.type}`).join(', ')}`);
          console.log(`    戻り値: ${fn.returnType}`);
        });
      }

    } catch (error) {
      console.error('❌ 解析中にエラーが発生しました:', error);
      process.exit(1);
    }
  });
