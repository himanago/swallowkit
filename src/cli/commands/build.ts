import * as fs from "fs";
import * as path from "path";

interface BuildOptions {
  output: string;
}

export async function buildCommand(options: BuildOptions) {
  console.log("🔨 SwallowKit プロジェクトをビルド中...");

  const outputDir = path.join(process.cwd(), options.output);

  try {
    // 出力ディレクトリを作成
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Azure Static Web Apps用のファイル構造を作成
    await buildForAzureStaticWebApps(outputDir);

    console.log(`✅ ビルドが完了しました: ${outputDir}`);
    console.log("\n📦 Azure Static Web Appsにデプロイする準備ができました！");
  } catch (error) {
    console.error("❌ ビルドに失敗しました:", error);
    process.exit(1);
  }
}

async function buildForAzureStaticWebApps(outputDir: string) {
  // 1. フロントエンドアプリをビルド
  console.log("📦 フロントエンドアプリをビルド中...");
  await buildFrontend(outputDir);

  // 2. Azure Functions用のAPIをビルド
  console.log("⚡ Azure Functions APIをビルド中...");
  await buildFunctions(outputDir);

  // 3. staticwebapp.config.json を生成
  console.log("⚙️ Azure Static Web Apps設定を生成中...");
  await generateStaticWebAppConfig(outputDir);

  console.log("📁 ビルド構造:");
  console.log("  dist/");
  console.log("  ├── index.html          # フロントエンドアプリ");
  console.log("  ├── assets/             # 静的アセット");
  console.log("  ├── api/                # Azure Functions");
  console.log("  └── staticwebapp.config.json # SWA設定");
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
