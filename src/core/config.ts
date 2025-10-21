import * as fs from "fs";
import * as path from "path";
import { SwallowKitConfig } from "../types";

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: SwallowKitConfig = {
  database: {
    type: "mock",
  },
  api: {
    endpoint: "/api/_swallowkit",
    cors: {
      origin: "*",
      credentials: true,
    },
  },
  functions: {
    outputDir: "api",
  },
};

/**
 * 設定ファイルを読み込み
 */
export function loadConfig(configPath?: string): SwallowKitConfig {
  const defaultPaths = [
    "swallowkit.config.json",
    "swallowkit.config.js",
    ".swallowkitrc.json",
  ];

  const paths = configPath ? [configPath] : defaultPaths;

  for (const filePath of paths) {
    const fullPath = path.resolve(process.cwd(), filePath);
    
    if (fs.existsSync(fullPath)) {
      try {
        console.log(`📋 設定ファイルを読み込み: ${filePath}`);
        
        if (filePath.endsWith(".json")) {
          const configData = fs.readFileSync(fullPath, "utf-8");
          const userConfig = JSON.parse(configData);
          return mergeConfig(DEFAULT_CONFIG, userConfig);
        } else if (filePath.endsWith(".js")) {
          delete require.cache[fullPath];
          const userConfig = require(fullPath);
          return mergeConfig(DEFAULT_CONFIG, userConfig.default || userConfig);
        }
      } catch (error) {
        console.warn(`⚠️ 設定ファイルの読み込みに失敗: ${filePath}`, error);
      }
    }
  }

  console.log("📋 デフォルト設定を使用");
  return DEFAULT_CONFIG;
}

/**
 * 設定をマージ
 */
function mergeConfig(defaultConfig: SwallowKitConfig, userConfig: Partial<SwallowKitConfig>): SwallowKitConfig {
  return {
    database: {
      ...defaultConfig.database,
      ...userConfig.database,
    },
    api: {
      ...defaultConfig.api,
      ...userConfig.api,
      cors: {
        ...defaultConfig.api?.cors,
        ...userConfig.api?.cors,
      },
    },
    functions: {
      ...defaultConfig.functions,
      ...userConfig.functions,
    },
  };
}

/**
 * 設定ファイルを生成
 */
export function generateConfig(outputPath: string = "swallowkit.config.json"): void {
  const config = {
    $schema: "https://swallowkit.dev/schema.json",
    database: {
      type: "cosmos",
      connectionString: "your-cosmos-connection-string",
      databaseName: "SwallowKitDB",
    },
    api: {
      endpoint: "/api/_swallowkit",
      cors: {
        origin: ["http://localhost:3000"],
        credentials: true,
      },
    },
    functions: {
      outputDir: "api",
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
  console.log(`✅ 設定ファイルを生成しました: ${outputPath}`);
}

/**
 * 環境変数からの設定読み込み
 */
export function loadConfigFromEnv(): Partial<SwallowKitConfig> {
  const config: Partial<SwallowKitConfig> = {};

  // データベース設定
  if (process.env.SWALLOWKIT_DB_TYPE) {
    config.database = {
      ...config.database,
      type: process.env.SWALLOWKIT_DB_TYPE as "cosmos" | "mock",
    };
  }

  if (process.env.SWALLOWKIT_DB_CONNECTION_STRING) {
    config.database = {
      ...config.database,
      connectionString: process.env.SWALLOWKIT_DB_CONNECTION_STRING,
    };
  }

  if (process.env.SWALLOWKIT_DB_NAME) {
    config.database = {
      ...config.database,
      databaseName: process.env.SWALLOWKIT_DB_NAME,
    };
  }

  // API設定
  if (process.env.SWALLOWKIT_API_ENDPOINT) {
    config.api = {
      ...config.api,
      endpoint: process.env.SWALLOWKIT_API_ENDPOINT,
    };
  }

  return config;
}

/**
 * 完全な設定を取得（ファイル + 環境変数）
 */
export function getFullConfig(configPath?: string): SwallowKitConfig {
  const fileConfig = loadConfig(configPath);
  const envConfig = loadConfigFromEnv();
  
  return mergeConfig(fileConfig, envConfig);
}

/**
 * 設定の検証
 */
export function validateConfig(config: SwallowKitConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // データベース設定の検証
  if (config.database?.type === "cosmos") {
    if (!config.database.connectionString) {
      errors.push("Cosmos DB connection string is required when type is 'cosmos'");
    }
  }

  // API設定の検証
  if (config.api?.endpoint && !config.api.endpoint.startsWith("/")) {
    errors.push("API endpoint must start with '/'");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
