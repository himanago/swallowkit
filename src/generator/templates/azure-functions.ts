// Azure Functions v4 プログラミングモデルのテンプレート
export const AZURE_FUNCTION_V4_TEMPLATE = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from "@azure/cosmos";
import { z } from "zod";

// 生成されたスキーマのインポート
{{SCHEMA_IMPORTS}}

// Cosmos DB クライアント（Managed Identity使用）
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_DB_ENDPOINT!,
  aadCredentials: {} // Managed Identity使用
});

const database = cosmosClient.database(process.env.COSMOS_DB_DATABASE || "swallowkit");

{{FUNCTION_IMPLEMENTATIONS}}

// CRUD API エンドポイント
app.http('swallowkit-crud', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'crud/{schema}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log('SwallowKit CRUD API function processed a request.');

    try {
      const schema = request.params.schema;
      const { operation, data, id } = await request.json() as any;

      let result;
      switch (\`\${schema}_\${operation}\`) {
{{OPERATION_CASES}}
        default:
          return {
            status: 400,
            jsonBody: { error: \`Unknown operation: \${schema}_\${operation}\` }
          };
      }

      return {
        status: 200,
        jsonBody: result
      };
    } catch (error) {
      context.error('Error processing CRUD request:', error);
      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : 'Internal server error' }
      };
    }
  }
});`;

// RPC関数のテンプレート（v4対応）
export const RPC_FUNCTION_V4_TEMPLATE = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

// サーバー関数のインポート
{{SERVER_FUNCTION_IMPORTS}}

// 関数マッピング
const serverFunctions = {
{{FUNCTION_MAPPINGS}}
};

// RPC API エンドポイント
app.http('swallowkit-rpc', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: '_swallowkit',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log('SwallowKit RPC handler processed a request.');

    try {
      const { fnName, args } = await request.json() as any;

      if (!fnName || !serverFunctions[fnName]) {
        return {
          status: 400,
          jsonBody: { error: \`Unknown function: \${fnName}\` }
        };
      }

      const serverFn = serverFunctions[fnName];
      const result = await serverFn(...(args || []));

      return {
        status: 200,
        jsonBody: result
      };
    } catch (error) {
      context.error('Error executing server function:', error);
      return {
        status: 500,
        jsonBody: { error: error instanceof Error ? error.message : 'Internal server error' }
      };
    }
  }
});`;

// CRUD操作のテンプレート（v4対応）
export const CRUD_FUNCTION_V4_TEMPLATE = {
  create: `async function create{{SCHEMA_NAME}}(data: {{SCHEMA_TYPE}}) {
  const schema = {{SCHEMA_NAME}}Schema;
  const validatedData = schema.parse(data);
  
  const container = database.container("{{TABLE_NAME}}");
  const { resource } = await container.items.create({
    ...validatedData,
    id: validatedData.id || Date.now().toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  
  return resource;
}`,

  read: `async function get{{SCHEMA_NAME}}(id: string) {
  const container = database.container("{{TABLE_NAME}}");
  
  try {
    const { resource } = await container.item(id, id).read();
    return resource;
  } catch (error: any) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
}`,

  list: `async function list{{SCHEMA_NAME}}s(options?: { limit?: number; continuationToken?: string }) {
  const container = database.container("{{TABLE_NAME}}");
  const { limit = 50, continuationToken } = options || {};
  
  const querySpec = {
    query: "SELECT * FROM c ORDER BY c.createdAt DESC",
  };
  
  const { resources, continuationToken: nextToken } = await container.items
    .query(querySpec, { maxItemCount: limit, continuationToken })
    .fetchNext();
    
  return {
    items: resources,
    continuationToken: nextToken,
  };
}`,

  update: `async function update{{SCHEMA_NAME}}(id: string, data: Partial<{{SCHEMA_TYPE}}>) {
  const container = database.container("{{TABLE_NAME}}");
  
  // 既存アイテムを取得
  const { resource: existingItem } = await container.item(id, id).read();
  if (!existingItem) {
    throw new Error("Item not found");
  }
  
  // 部分更新データをマージ
  const updatedItem = {
    ...existingItem,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  
  // スキーマで検証
  const schema = {{SCHEMA_NAME}}Schema;
  const validatedData = schema.parse(updatedItem);
  
  const { resource } = await container.item(id, id).replace(validatedData);
  return resource;
}`,

  delete: `async function delete{{SCHEMA_NAME}}(id: string) {
  const container = database.container("{{TABLE_NAME}}");
  
  try {
    await container.item(id, id).delete();
    return { success: true };
  } catch (error: any) {
    if (error.code === 404) {
      throw new Error("Item not found");
    }
    throw error;
  }
}`,
};

// host.json v4対応
export const HOST_JSON_V4_TEMPLATE = `{
  "version": "2.0",
  "functionTimeout": "00:05:00",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  },
  "extensions": {
    "http": {
      "routePrefix": "api"
    }
  },
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true
      }
    }
  }
}`;

// local.settings.json v4対応（Managed Identity用）
export const LOCAL_SETTINGS_V4_TEMPLATE = `{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "FUNCTIONS_WORKER_RUNTIME_VERSION": "~22",
    "languageWorkers:node:arguments": "--no-deprecation",
    "COSMOS_ENDPOINT": "http://localhost:8081",
    "COSMOS_KEY": "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
    "COSMOS_DATABASE": "swallowkit-db",
    "COSMOS_CONTAINER": "todos"
  }
}`;

// tsconfig.json v4対応
export const TSCONFIG_V4_TEMPLATE = `{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es6",
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}`;

// .funcignore v4対応
export const FUNCIGNORE_V4_TEMPLATE = `*.js.map
*.ts
.git*
.vscode
local.settings.json
test
tsconfig.json
.funcignore
*.md
node_modules/@types
src/
*.log`;

// package.json v4対応
export const PACKAGE_JSON_V4_TEMPLATE = `{
  "name": "swallowkit-api",
  "version": "1.0.0",
  "description": "SwallowKit Generated API Functions (v4)",
  "main": "dist/functions/*.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "clean": "rimraf dist",
    "prebuild": "npm run clean",
    "prestart": "npm run build",
    "start": "func start",
    "test": "echo \\"No tests yet\\""
  },
  "dependencies": {
    "@azure/functions": "^4.0.0",
    "@azure/cosmos": "^4.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "rimraf": "^5.0.0"
  }
}`;
