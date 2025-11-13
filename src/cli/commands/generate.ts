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
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`📁 Output directory "${outputDir}" already exists. Overwrite? (y/N): `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log('⏹️ Generation cancelled');
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

      // Generate Azure Functions structure
      console.log('\n📦 Generating Azure Functions...');
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
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
        scripts: {
          start: 'func start',
          build: 'tsc',
          'build:production': 'npm run build'
        },
        dependencies: {
          '@azure/functions': '^4.0.0'
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
          rootDir: './',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true
        },
        include: ['**/*.ts'],
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
