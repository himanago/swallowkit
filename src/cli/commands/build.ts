import * as fs from "fs";
import * as path from "path";

interface BuildOptions {
  output: string;
}

export async function buildCommand(options: BuildOptions) {
  console.log("🔨 Building Next.js app and Azure Functions...");

  const projectRoot = process.cwd();
  const outputDir = path.join(projectRoot, options.output);

  try {
    // Build Next.js app
    console.log("\n📦 Building Next.js application...");
    await buildNextJs(projectRoot);

    // Build Azure Functions
    const functionsDir = path.join(projectRoot, 'azure-functions');
    if (fs.existsSync(functionsDir)) {
      console.log("\n⚡ Building Azure Functions...");
      await buildAzureFunctions(functionsDir);
    } else {
      console.log("\n⚠️  No Azure Functions found. Run 'swallowkit generate' first.");
    }

    console.log(`\n✅ Build completed!`);
    console.log("\n📝 Next steps:");
    console.log("  1. swallowkit deploy (Deploy to Azure)");
    console.log("  2. Or manually deploy:");
    console.log("     - Next.js: .next/ directory");
    console.log("     - Azure Functions: azure-functions/ directory");
  } catch (error) {
    console.error("❌ Build failed:", error);
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
