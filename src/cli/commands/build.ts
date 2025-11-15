import * as fs from "fs";
import * as path from "path";

interface BuildOptions {
  output: string;
}

export async function buildCommand(options: BuildOptions) {
  console.log("🔨 Building Next.js app and Azure Functions...");

  const projectRoot = process.cwd();
  const buildDir = path.join(projectRoot, '.swallowkit', 'build');
  const outputDir = path.join(projectRoot, options.output);

  try {
    // 1. プロジェクトを一時ディレクトリにコピー
    console.log("\n📋 Copying project to build directory...");
    await copyProject(projectRoot, buildDir);

    // 2. Server Actions を /api/* 呼び出しに変換
    console.log("\n🔄 Transforming Server Actions to API calls...");
    await transformServerActions(buildDir);

    // 2.5. Next.js を静的エクスポート設定に変更
    console.log("\n⚙️  Configuring Next.js for static export...");
    await configureNextJsForStatic(buildDir);

    // 3. Azure Functions を生成
    console.log("\n⚡ Generating Azure Functions...");
    await generateFunctions(projectRoot);

    // 4. Next.js をビルド
    console.log("\n📦 Building Next.js application...");
    await buildNextJs(buildDir);

    // 5. Azure Functions をビルド
    const functionsDir = path.join(projectRoot, 'azure-functions');
    if (fs.existsSync(functionsDir)) {
      console.log("\n⚡ Building Azure Functions...");
      await buildAzureFunctions(functionsDir);
    }

    // 6. ビルド成果物をコピー
    console.log("\n📦 Copying build artifacts...");
    await copyBuildArtifacts(buildDir, outputDir);

    console.log(`\n✅ Build completed!`);
    console.log(`📁 Output directory: ${outputDir}`);
    console.log("\n📝 Next steps:");
    console.log("  1. swallowkit deploy (Deploy to Azure)");
  } catch (error) {
    console.error("❌ Build failed:", error);
    if (error instanceof Error) {
      console.error("Details:", error.message);
    }
    process.exit(1);
  }
}

async function buildNextJs(projectRoot: string) {
  const { spawn } = require('child_process');
  
  return new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    build.on('close', (code: number) => {
      if (code === 0) {
        console.log('✅ Next.js build completed');
        resolve();
      } else {
        reject(new Error(`Next.js build failed with code ${code}`));
      }
    });
  });
}

async function buildAzureFunctions(functionsDir: string) {
  const { spawn } = require('child_process');
  
  // Check if package.json exists
  const packageJsonPath = path.join(functionsDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.log('⚠️  No package.json found in azure-functions/');
    return;
  }

  // Install dependencies
  console.log('📦 Installing Azure Functions dependencies...');
  await new Promise<void>((resolve, reject) => {
    const install = spawn('npm', ['install'], {
      cwd: functionsDir,
      stdio: 'inherit',
      shell: true
    });

    install.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install failed with code ${code}`));
      }
    });
  });

  // Build TypeScript
  const tsconfigPath = path.join(functionsDir, 'tsconfig.json');
  if (fs.existsSync(tsconfigPath)) {
    console.log('🔨 Compiling TypeScript...');
    await new Promise<void>((resolve, reject) => {
      const build = spawn('npm', ['run', 'build'], {
        cwd: functionsDir,
        stdio: 'inherit',
        shell: true
      });

      build.on('close', (code: number) => {
        if (code === 0) {
          console.log('✅ Azure Functions build completed');
          resolve();
        } else {
          reject(new Error(`Azure Functions build failed with code ${code}`));
        }
      });
    });
  }
}

async function buildFrontend(outputDir: string) {
  // 実際の実装ではViteやWebpackを使用
  const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SwallowKit App</title>
</head>
<body>
  <div id="root"></div>
  <script>
    // ビルドされたアプリのエントリーポイント
    console.log("SwallowKit アプリが読み込まれました");
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(outputDir, "index.html"), indexHtml);
}

async function buildFunctions(outputDir: string) {
  const apiDir = path.join(outputDir, "api");
  fs.mkdirSync(apiDir, { recursive: true });

  // SwallowKit RPC エンドポイント用のAzure Function
  const functionJson = {
    bindings: [
      {
        authLevel: "anonymous",
        type: "httpTrigger",
        direction: "in",
        name: "req",
        methods: ["post"],
        route: "_swallowkit",
      },
      {
        type: "http",
        direction: "out",
        name: "res",
      },
    ],
  };

  const swallowkitDir = path.join(apiDir, "_swallowkit");
  fs.mkdirSync(swallowkitDir, { recursive: true });

  fs.writeFileSync(
    path.join(swallowkitDir, "function.json"),
    JSON.stringify(functionJson, null, 2)
  );

  // Azure Function のコード
  const functionCode = `const { app } = require('@azure/functions');

app.http('_swallowkit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: '_swallowkit',
  handler: async (request, context) => {
    try {
      const { fnName, args } = await request.json();
      
      // サーバー関数を実行
      const serverFns = require('../serverFns');
      const fn = serverFns[fnName];
      
      if (!fn || typeof fn !== 'function') {
        return {
          status: 400,
          jsonBody: {
            success: false,
            error: \`Function \${fnName} not found\`
          }
        };
      }
      
      const result = await fn(...args);
      
      return {
        status: 200,
        jsonBody: {
          success: true,
          data: result
        }
      };
    } catch (error) {
      return {
        status: 500,
        jsonBody: {
          success: false,
          error: error.message
        }
      };
    }
  }
});
`;

  fs.writeFileSync(path.join(swallowkitDir, "index.js"), functionCode);

  // package.json for Azure Functions
  const apiPackageJson = {
    name: "swallowkit-api",
    version: "1.0.0",
    dependencies: {
      "@azure/functions": "^4.0.0",
    },
  };

  fs.writeFileSync(
    path.join(apiDir, "package.json"),
    JSON.stringify(apiPackageJson, null, 2)
  );
}

async function generateStaticWebAppConfig(outputDir: string) {
  const config = {
    routes: [
      {
        route: "/api/*",
        allowedRoles: ["anonymous"],
      },
      {
        route: "/*",
        serve: "/index.html",
        statusCode: 200,
      },
    ],
    navigationFallback: {
      rewrite: "/index.html",
    },
  };

  fs.writeFileSync(
    path.join(outputDir, "staticwebapp.config.json"),
    JSON.stringify(config, null, 2)
  );
}

// プロジェクトを一時ディレクトリにコピー
async function copyProject(projectRoot: string, buildDir: string) {
  const { spawn } = require('child_process');
  
  // ビルドディレクトリをクリーンアップ
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // 除外するディレクトリ・ファイル
  const excludePatterns = [
    'node_modules',
    '.next',
    '.git',
    '.swallowkit',
    'azure-functions',
    '.env.local',
    '.env.*.local'
  ];

  // rsync でコピー（高速）
  const excludeArgs = excludePatterns.flatMap(p => ['--exclude', p]);
  
  return new Promise<void>((resolve, reject) => {
    const rsync = spawn('rsync', [
      '-a',
      ...excludeArgs,
      `${projectRoot}/`,
      `${buildDir}/`
    ], {
      stdio: 'pipe',
      shell: true
    });

    rsync.on('close', (code: number) => {
      if (code === 0) {
        console.log('✅ Project copied to build directory');
        resolve();
      } else {
        reject(new Error(`rsync failed with code ${code}`));
      }
    });
  });
}

// Server Actions を /api/* 呼び出しに変換
async function transformServerActions(buildDir: string) {
  const appDir = path.join(buildDir, 'app');
  
  if (!fs.existsSync(appDir)) {
    console.log('⚠️  No app directory found, skipping transformation');
    return;
  }

  // Server Actions を検出
  const serverActions = findServerActionsInDir(appDir);
  
  if (serverActions.length === 0) {
    console.log('⚠️  No Server Actions found');
    return;
  }

  console.log(`   Found ${serverActions.length} Server Actions`);

  // Server Actions の呼び出しを変換
  transformServerActionCalls(appDir, serverActions);
  
  console.log('✅ Server Actions transformed to API calls');
}

// Next.js を静的エクスポート設定に変更
async function configureNextJsForStatic(buildDir: string) {
  const nextConfigPath = path.join(buildDir, 'next.config.js');
  const nextConfigMjsPath = path.join(buildDir, 'next.config.mjs');
  
  let configPath = nextConfigPath;
  if (!fs.existsSync(nextConfigPath) && fs.existsSync(nextConfigMjsPath)) {
    configPath = nextConfigMjsPath;
  }

  // next.config.js を生成または上書き
  const configContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true
  },
  trailingSlash: true
};

module.exports = nextConfig;
`;

  fs.writeFileSync(configPath, configContent, 'utf-8');
  console.log('✅ Next.js configured for static export');
}

// ディレクトリ内の Server Actions を検出
function findServerActionsInDir(dir: string): string[] {
  const actions: string[] = [];
  
  function scanDir(currentDir: string) {
    const files = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(currentDir, file.name);
      
      if (file.isDirectory()) {
        scanDir(fullPath);
      } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        if (content.includes("'use server'") || content.includes('"use server"')) {
          // export されている関数名を抽出
          const functionRegex = /export\s+async\s+function\s+(\w+)/g;
          let match;
          
          while ((match = functionRegex.exec(content)) !== null) {
            actions.push(match[1]);
          }
        }
      }
    }
  }
  
  scanDir(dir);
  return actions;
}

// Server Actions の呼び出しを /api/* に変換
function transformServerActionCalls(appDir: string, serverActions: string[]) {
  function transformFile(filePath: string) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // Server 側のインポートを検出（lib/server など）
    const serverImportRegex = /import\s+{([^}]+)}\s+from\s+['"]@\/lib\/server\/\w+['"]/g;
    const serverImports: string[] = [];
    let match;
    
    while ((match = serverImportRegex.exec(content)) !== null) {
      const imports = match[1].split(',').map(i => i.trim());
      serverImports.push(...imports);
    }
    
    // Server 側のインポートを削除
    if (serverImports.length > 0) {
      content = content.replace(serverImportRegex, '');
      modified = true;
    }

    // Server Actions のインポートを検出して削除
    for (const action of serverActions) {
      const importRegex = new RegExp(`import\\s+{[^}]*${action}[^}]*}\\s+from\\s+['"].*actions['"]`, 'g');
      if (importRegex.test(content)) {
        content = content.replace(importRegex, '');
        modified = true;
      }
    }
    
    // Server 関数の呼び出し（await getTodos() など）を削除
    if (serverImports.length > 0) {
      // try-catch ブロック全体を削除
      content = content.replace(
        /try\s*{\s*todos\s*=\s*await\s+\w+\(\)\s*}\s*catch\s*\([^)]*\)\s*{[^}]*}/gs,
        ''
      );
      
      // todos = [] のような代入も削除
      content = content.replace(/\s*todos\s*=\s*\[.*?\]/g, '');
      
      // export const dynamic などを削除
      content = content.replace(/export\s+const\s+dynamic\s*=\s*['"][^'"]*['"]/g, '');
      content = content.replace(/export\s+const\s+revalidate\s*=\s*\d+/g, '');
      
      modified = true;
    }

    // form action={serverAction} を onSubmit に変換
    for (const action of serverActions) {
      const formActionRegex = new RegExp(`<form\\s+action={${action}}`, 'g');
      if (formActionRegex.test(content)) {
        // Server Components の async を削除（Client Components では使えない）
        content = content.replace(
          /(export\s+default\s+)async\s+(function\s+)/,
          '$1$2'
        );
        
        // 'use client' ディレクティブを追加（最初に）
        if (!content.includes("'use client'") && !content.includes('"use client"')) {
          content = `'use client'\n\n${content}`;
          modified = true;
        }
        
        // React の useState と useEffect をインポート
        if (!content.includes('useState')) {
          // 既存の import の直後に追加
          content = content.replace(
            /^('use client'\s*\n+)/m,
            `$1import { useState, useEffect } from 'react'\n`
          );
        }
        
        // fetch を使った onSubmit に変換
        const submitHandler = `
const [todos, setTodos] = useState<Array<{ id: string; text: string; completed: boolean }>>([]);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  // Initial data fetch would go here
  // For now, starting with empty array
}, []);

const handle${action} = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
  await fetch('/api/${action}', {
    method: 'POST',
    body: formData
  });
  window.location.reload();
};`;

        // 関数定義を追加（async function に対応）
        content = content.replace(
          /(export\s+(?:default\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*{)/,
          `$1${submitHandler}\n`
        );
        
        // let todos = [] などの宣言を削除
        content = content.replace(/let\s+todos:\s*Array<[^>]+>\s*=\s*\[\]/g, '');
        content = content.replace(/let\s+error:\s*string\s*\|\s*null\s*=\s*null/g, '');

        // form の action を onSubmit に変更
        content = content.replace(
          formActionRegex,
          `<form onSubmit={handle${action}}`
        );

        modified = true;
      }
      
      // action={serverAction.bind(null, id)} パターンも変換
      const bindActionRegex = new RegExp(`<form\\s+action={${action}\\.bind\\(null,\\s*([^)]+)\\)}`, 'g');
      if (bindActionRegex.test(content)) {
        // 'use client' を追加（まだなければ）
        if (!content.includes("'use client'") && !content.includes('"use client"')) {
          content = `'use client'\n\n${content}`;
          modified = true;
        }
        
        // Server Components の async を削除
        content = content.replace(
          /(export\s+default\s+)async\s+(function\s+)/,
          '$1$2'
        );
        
        // React の useState と useEffect をインポート
        if (!content.includes('useState')) {
          content = content.replace(
            /^('use client'\s*\n+)/m,
            `$1import { useState, useEffect } from 'react'\n`
          );
        }
        
        // ハンドラ関数を追加（id パラメータ付き）
        const bindSubmitHandler = `
const handle${action}WithId = (id: string) => async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  await fetch('/api/${action}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  window.location.reload();
};`;

        // 関数定義を追加
        if (!content.includes(`handle${action}WithId`)) {
          content = content.replace(
            /(export\s+(?:default\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*{)/,
            `$1${bindSubmitHandler}\n`
          );
        }
        
        // form の action を onSubmit に変更
        content = content.replace(
          bindActionRegex,
          `<form onSubmit={handle${action}WithId($1)}`
        );
        
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`   ✅ Transformed: ${path.relative(appDir, filePath)}`);
    }
  }

  function scanAndTransform(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        scanAndTransform(fullPath);
      } else if (file.name.endsWith('.tsx')) {
        transformFile(fullPath);
      }
    }
  }

  scanAndTransform(appDir);
}

// Azure Functions を生成
async function generateFunctions(projectRoot: string) {
  const { spawn } = require('child_process');
  
  return new Promise<void>((resolve, reject) => {
    const generate = spawn('node', [
      path.join(__dirname, '../index.js'),
      'generate'
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true
    });

    generate.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`generate command failed with code ${code}`));
      }
    });
  });
}

// ビルド成果物をコピー
async function copyBuildArtifacts(buildDir: string, outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Next.js の out ディレクトリをコピー
  const nextOutDir = path.join(buildDir, 'out');
  if (fs.existsSync(nextOutDir)) {
    const { spawn } = require('child_process');
    
    await new Promise<void>((resolve, reject) => {
      const cp = spawn('cp', ['-r', nextOutDir, outputDir], {
        stdio: 'inherit',
        shell: true
      });

      cp.on('close', (code: number) => {
        if (code === 0) {
          console.log('✅ Next.js artifacts copied');
          resolve();
        } else {
          reject(new Error(`copy failed with code ${code}`));
        }
      });
    });
  }
}
