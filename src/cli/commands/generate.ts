import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';

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

      // Check if output directory already exists
      if (fs.existsSync(outputDir) && !options.force && !options.dryRun) {
        console.log(`📁 Output directory "${outputDir}" already exists.`);
        console.log('🔄 Cleaning and regenerating...');
        fs.rmSync(outputDir, { recursive: true, force: true });
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

      // Generate Azure Functions structure
      console.log('\n📦 Generating Azure Functions...');
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Server Actions を検出
      console.log('🔍 Server Actions を検出中...');
      const appDir = path.join(projectRoot, 'app');
      const serverActions = findServerActions(appDir);
      
      console.log(`✅ ${serverActions.length} 個の Server Actions を検出しました`);
      if (serverActions.length > 0) {
        serverActions.forEach(action => {
          console.log(`   - ${action.name} (${action.file})`);
        });
      }

      // Create host.json for Azure Functions v4
      const hostJson = {
        version: '2.0',
        logging: {
          applicationInsights: {
            samplingSettings: {
              isEnabled: true,
              maxTelemetryItemsPerSecond: 20
            }
          }
        },
        extensionBundle: {
          id: 'Microsoft.Azure.Functions.ExtensionBundle',
          version: '[4.*, 5.0.0)'
        }
      };

      fs.writeFileSync(
        path.join(outputDir, 'host.json'),
        JSON.stringify(hostJson, null, 2)
      );

      // Create package.json for Azure Functions
      const packageJson = {
        name: 'azure-functions',
        version: '1.0.0',
        description: 'Generated Azure Functions from Next.js app',
        main: 'dist/functions/*.js',
        scripts: {
          start: 'func start',
          build: 'tsc',
          'build:production': 'npm run build',
          'watch': 'tsc --watch',
          prestart: 'npm run build'
        },
        dependencies: {
          '@azure/functions': '^4.0.0',
          '@azure/cosmos': '^4.0.0',
          'zod': '^3.25.0',
          'swallowkit': 'file:../..'
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          'typescript': '^5.0.0',
          'azure-functions-core-tools': '^4.0.0'
        }
      };

      fs.writeFileSync(
        path.join(outputDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Create tsconfig.json
      const tsconfigJson = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          baseUrl: './src',
          paths: {
            '@/*': ['./*']
          }
        },
        include: ['src/**/*.ts'],
        exclude: ['node_modules', 'dist']
      };

      fs.writeFileSync(
        path.join(outputDir, 'tsconfig.json'),
        JSON.stringify(tsconfigJson, null, 2)
      );

      // Create .funcignore
      const funcignore = `*.js.map
*.ts
.git*
.vscode
local.settings.json
test
tsconfig.json
.DS_Store
node_modules
`;

      fs.writeFileSync(
        path.join(outputDir, '.funcignore'),
        funcignore
      );

      // Create local.settings.json
      const localSettings = {
        IsEncrypted: false,
        Values: {
          AzureWebJobsStorage: '',
          FUNCTIONS_WORKER_RUNTIME: 'node',
          AzureWebJobsFeatureFlags: 'EnableWorkerIndexing',
          COSMOS_DB_ENDPOINT: 'https://localhost:8081',
          COSMOS_DB_KEY: 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==',
          NODE_TLS_REJECT_UNAUTHORIZED: '0'
        }
      };

      fs.writeFileSync(
        path.join(outputDir, 'local.settings.json'),
        JSON.stringify(localSettings, null, 2)
      );

      // SwallowKit のソースコードを Azure Functions にコピー
      console.log('\n📦 SwallowKit のソースコードをコピー中...');
      // __dirname は dist/cli/commands を指すので、src は ../../../src
      const swallowkitSrcDir = path.join(__dirname, '../../../src');
      const targetSrcDir = path.join(outputDir, 'src');
      
      // 必要なファイルをコピー
      const filesToCopy = [
        'index.ts',
        'core/config.ts',
        'database/client.ts',
        'database/base-model.ts',
        'database/runtime-check.ts',
        'database/repository.ts',
        'types/index.ts'
      ];
      
      for (const file of filesToCopy) {
        const sourcePath = path.join(swallowkitSrcDir, file);
        const targetPath = path.join(targetSrcDir, file);
        const targetDir = path.dirname(targetPath);
        
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
        } else {
          console.warn(`⚠️  Warning: Could not find ${sourcePath}`);
        }
      }

      // Server Actions から Azure Functions を生成
      if (serverActions.length > 0) {
        console.log('\n🔨 Azure Functions を生成中...');
        for (const action of serverActions) {
          generateAzureFunction(outputDir, action, projectRoot);
          console.log(`   ✅ ${action.name} → src/functions/${action.name}.ts`);
        }
      }

      console.log('\n🎉 Azure Functions generation completed!');
      console.log(`📁 Output directory: ${outputDir}`);
      console.log('\n⚠️  Note: Full Next.js analysis and function generation is in progress.');
      console.log('   Currently generated: Basic Azure Functions v4 structure');
      
      console.log('\n📝 Next steps:');
      console.log('  1. swallowkit build (Build Next.js app and Azure Functions)');
      console.log('  2. swallowkit deploy (Deploy to Azure)');
      console.log('\n💡 For local development:');
      console.log('  1. swallowkit dev (Start integrated development server)');

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

// Server Actions を検出する関数
interface ServerAction {
  name: string;
  file: string;
  relativePath: string;
  functionBody: string;
  params: string[]; // 関数のパラメータ
}

function findServerActions(appDir: string): ServerAction[] {
  const actions: ServerAction[] = [];
  
  if (!fs.existsSync(appDir)) {
    return actions;
  }

  function scanDirectory(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        scanDirectory(fullPath);
      } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // 'use server' ディレクティブを含むファイルを検出
        if (content.includes("'use server'") || content.includes('"use server"')) {
          // export されている関数を抽出
          const functionRegex = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)\s*{/g;
          let match;
          
          while ((match = functionRegex.exec(content)) !== null) {
            const functionName = match[1];
            const paramsStr = match[2];
            const relativePath = path.relative(appDir, fullPath);
            
            // パラメータを解析
            const params = paramsStr
              .split(',')
              .map(p => p.trim())
              .filter(p => p.length > 0)
              .map(p => p.split(':')[0].trim());
            
            actions.push({
              name: functionName,
              file: fullPath,
              relativePath,
              functionBody: content,
              params
            });
          }
        }
      }
    }
  }

  scanDirectory(appDir);
  return actions;
}

// Azure Function を生成する関数
function generateAzureFunction(outputDir: string, action: ServerAction, projectRoot: string) {
  const srcDir = path.join(outputDir, 'src');
  const functionsDir = path.join(srcDir, 'functions');
  
  if (!fs.existsSync(functionsDir)) {
    fs.mkdirSync(functionsDir, { recursive: true });
  }

  // Server Action の実装を抽出
  const actionImpl = extractServerActionImplementation(action);
  
  // 依存するモジュールを検出してコピー
  const dependencies = detectDependencies(action, projectRoot);
  copyDependencies(dependencies, outputDir, projectRoot);

  const functionCode = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
${generateImportsForDependencies(dependencies)}

export async function ${action.name}(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(\`Http function processed request for url "\${request.url}"\`);

    try {
        ${generateFunctionBody(action, actionImpl)}
        
        return {
            status: 200,
            jsonBody: {
                success: true
            }
        };
    } catch (error) {
        context.error('Error executing ${action.name}:', error);
        return {
            status: 500,
            jsonBody: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        };
    }
};

app.http('${action.name}', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: ${action.name}
});
`;

  fs.writeFileSync(
    path.join(functionsDir, `${action.name}.ts`),
    functionCode
  );
}

// Server Action の実装コードを抽出
function extractServerActionImplementation(action: ServerAction): string {
  const content = action.functionBody;
  
  // 関数の開始位置を見つける
  const functionStart = content.indexOf(`export async function ${action.name}`);
  if (functionStart === -1) {
    return '// Could not find function';
  }
  
  // 関数本体の開始位置（最初の {）を見つける
  const bodyStart = content.indexOf('{', functionStart);
  if (bodyStart === -1) {
    return '// Could not find function body';
  }
  
  // 対応する閉じ括弧を見つける
  let braceCount = 1;
  let bodyEnd = bodyStart + 1;
  
  while (bodyEnd < content.length && braceCount > 0) {
    if (content[bodyEnd] === '{') {
      braceCount++;
    } else if (content[bodyEnd] === '}') {
      braceCount--;
    }
    bodyEnd++;
  }
  
  if (braceCount !== 0) {
    return '// Could not find closing brace';
  }
  
  // 関数本体を抽出（{ と } を除く）
  const body = content.substring(bodyStart + 1, bodyEnd - 1).trim();
  return body;
}

// 依存モジュールを検出
function detectDependencies(action: ServerAction, projectRoot: string): Array<{from: string, imports: string[]}> {
  const dependencies: Array<{from: string, imports: string[]}> = [];
  const content = action.functionBody;
  
  // import 文を検出
  const importRegex = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const imports = match[1].split(',').map(i => i.trim());
    const from = match[2];
    
    // @/ は Next.js のエイリアス（プロジェクトルート）
    if (from.startsWith('@/')) {
      const relativePath = from.replace('@/', '');
      dependencies.push({ from: relativePath, imports });
    }
  }
  
  return dependencies;
}

// 依存ファイルを Functions プロジェクトにコピー
function copyDependencies(dependencies: Array<{from: string, imports: string[]}>, outputDir: string, projectRoot: string) {
  for (const dep of dependencies) {
    const sourcePath = path.join(projectRoot, dep.from + '.ts');
    const sourcePathTsx = path.join(projectRoot, dep.from + '.tsx');
    
    let actualSourcePath = sourcePath;
    if (!fs.existsSync(sourcePath) && fs.existsSync(sourcePathTsx)) {
      actualSourcePath = sourcePathTsx;
    }
    
    if (fs.existsSync(actualSourcePath)) {
      const targetPath = path.join(outputDir, 'src', dep.from + '.ts');
      const targetDir = path.dirname(targetPath);
      
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // ファイルをコピーして、swallowkit のインポートを書き換え
      let content = fs.readFileSync(actualSourcePath, 'utf-8');
      
      // swallowkit からのインポートを相対パスに書き換え
      // dep.from = 'lib/models/todo' の場合、targetPath = outputDir/src/lib/models/todo.ts
      // index.ts は outputDir/src/index.ts にある
      // したがって相対パス = ../../index
      const relativePathToIndex = path.relative(
        path.dirname(targetPath),
        path.join(outputDir, 'src', 'index')
      ).replace(/\\/g, '/');
      
      content = content.replace(
        /import\s*{([^}]+)}\s*from\s*['"]swallowkit['"]/g,
        `import {$1} from '${relativePathToIndex}'`
      );
      
      fs.writeFileSync(targetPath, content);
    }
  }
}

// 依存モジュールの import 文を生成
function generateImportsForDependencies(dependencies: Array<{from: string, imports: string[]}>) {
  return dependencies
    .map(dep => `import { ${dep.imports.join(', ')} } from '../${dep.from}';`)
    .join('\n');
}

// Azure Function の本体を生成
function generateFunctionBody(action: ServerAction, actionImpl: string): string {
  // Next.js 固有の関数を削除
  let processedImpl = actionImpl
    .replace(/revalidatePath\([^)]*\)/g, '// revalidatePath removed (Next.js specific)')
    .replace(/import\s+{[^}]*revalidatePath[^}]*}\s+from\s+['"][^'"]+['"]/g, '');
  
  // Server Action の return 文を Azure Functions の形式に変換
  // return { error: "..." } → return { status: 400, jsonBody: { success: false, error: "..." } }
  processedImpl = processedImpl.replace(
    /return\s*{\s*error:\s*([^}]+)\s*}/g,
    'return { status: 400, jsonBody: { success: false, error: $1 } }'
  );
  
  // return { success: true } → return { status: 200, jsonBody: { success: true } }
  processedImpl = processedImpl.replace(
    /return\s*{\s*success:\s*true\s*}/g,
    'return { status: 200, jsonBody: { success: true } }'
  );
  
  // FormData のパラメータを抽出
  if (actionImpl.includes('formData.get') || action.params.includes('formData')) {
    const params = extractFormDataParams(actionImpl);
    
    // 早期 return を削除（改行を含む）
    processedImpl = processedImpl.replace(
      /if\s*\([^)]+\)\s*{\s*return\s*[\n\s]*}/g,
      ''
    );
    
    // 単独の return 文も削除
    processedImpl = processedImpl.replace(
      /^\s*return\s*$/gm,
      ''
    );
    
    // FormData.get() の呼び出しを変数参照に置き換え
    params.forEach(p => {
      processedImpl = processedImpl.replace(
        new RegExp(`const\\s+${p}\\s*=\\s*formData\\.get\\(['"]${p}['"]\\)\\s*as\\s*string`, 'g'),
        ''
      );
      processedImpl = processedImpl.replace(
        new RegExp(`formData\\.get\\(['"]${p}['"]\\)\\s*as\\s*string`, 'g'),
        p
      );
    });
    
    return `
        // FormData から値を取得
        const formData = await request.formData();
        ${params.map(p => `const ${p} = formData.get('${p}') as string;`).join('\n        ')}
        
        // バリデーション
        ${params.map(p => `if (!${p} || ${p}.trim().length === 0) {
          return {
            status: 400,
            jsonBody: { success: false, error: '${p} is required' }
          };
        }`).join('\n        ')}
        
        // 元の Server Action のロジックを実行
        ${processedImpl.trim()}`;
  } else if (action.params.length > 0) {
    // パラメータがある場合（id など）
    const paramsList = action.params.join(', ');
    const paramsType = action.params.map(p => `${p}: string`).join(', ');
    return `
        const { ${paramsList} } = (await request.json()) as { ${paramsType} };
        
        // 元の Server Action のロジックを実行
        ${processedImpl}`;
  }
  
  return `
        // 元の Server Action のロジックを実行
        ${processedImpl}`;
}

// FormData のパラメータを抽出
function extractFormDataParams(code: string): string[] {
  const params: string[] = [];
  const regex = /formData\.get\(['"](\w+)['"]\)/g;
  let match;
  
  while ((match = regex.exec(code)) !== null) {
    if (!params.includes(match[1])) {
      params.push(match[1]);
    }
  }
  
  return params;
}

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
