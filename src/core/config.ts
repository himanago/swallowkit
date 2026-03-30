import * as fs from "fs";
import * as path from "path";
import { BackendLanguage, ConnectorDefinition, SwallowKitConfig } from "../types";
import { detectFromProject, getCommands } from "../utils/package-manager";

const VALID_BACKEND_LANGUAGES: BackendLanguage[] = ["typescript", "csharp", "python"];

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: SwallowKitConfig = {
  database: {},
  backend: {
    language: "typescript",
  },
  api: {
    endpoint: "/api/_swallowkit",
    cors: {
      origin: "*",
      credentials: true,
    },
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
    backend: {
      ...defaultConfig.backend,
      ...userConfig.backend,
    },
    api: {
      ...defaultConfig.api,
      ...userConfig.api,
      cors: {
        ...defaultConfig.api?.cors,
        ...userConfig.api?.cors,
      },
    },
    ...(userConfig.connectors ? { connectors: userConfig.connectors } : {}),
  };
}

/**
 * 設定ファイルを生成
 */
export function generateConfig(outputPath: string = "swallowkit.config.json"): void {
  const config = {
    $schema: "https://swallowkit.dev/schema.json",
    database: {
      connectionString: "your-cosmos-connection-string",
      databaseName: "SwallowKitDB",
    },
    backend: {
      language: "typescript",
    },
    api: {
      endpoint: "/api/_swallowkit",
      cors: {
        origin: ["http://localhost:3000"],
        credentials: true,
      },
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

  if (process.env.SWALLOWKIT_BACKEND_LANGUAGE) {
    config.backend = {
      ...config.backend,
      language: process.env.SWALLOWKIT_BACKEND_LANGUAGE as BackendLanguage,
    };
  }

  return config;
}

export function getBackendLanguage(configPath?: string): BackendLanguage {
  const language = getFullConfig(configPath).backend?.language;
  if (language && VALID_BACKEND_LANGUAGES.includes(language)) {
    return language;
  }

  return "typescript";
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
 * コネクタ定義を名前で取得
 */
export function getConnectorDefinition(connectorName: string, configPath?: string): ConnectorDefinition | undefined {
  const config = getFullConfig(configPath);
  return config.connectors?.[connectorName];
}

/**
 * 設定の検証
 */
const VALID_CONNECTOR_TYPES = ["rdb", "api"];
const VALID_RDB_PROVIDERS = ["mysql", "postgres", "sqlserver"];
const VALID_API_AUTH_TYPES = ["apiKey", "bearer", "oauth2"];

export function validateConfig(config: SwallowKitConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // データベース設定の検証
  if (config.database && !config.database.connectionString) {
    errors.push("Cosmos DB connection string is required");
  }

  // API設定の検証
  if (config.api?.endpoint && !config.api.endpoint.startsWith("/")) {
    errors.push("API endpoint must start with '/'");
  }

  if (config.backend?.language && !VALID_BACKEND_LANGUAGES.includes(config.backend.language)) {
    errors.push("Backend language must be one of: typescript, csharp, python");
  }

  // コネクタ設定の検証
  if (config.connectors) {
    for (const [name, connector] of Object.entries(config.connectors)) {
      if (!VALID_CONNECTOR_TYPES.includes(connector.type)) {
        errors.push(`Connector '${name}': type must be one of: ${VALID_CONNECTOR_TYPES.join(", ")}`);
        continue;
      }

      if (connector.type === "rdb") {
        if (!connector.provider || !VALID_RDB_PROVIDERS.includes(connector.provider)) {
          errors.push(`Connector '${name}': provider must be one of: ${VALID_RDB_PROVIDERS.join(", ")}`);
        }
        if (!connector.connectionEnvVar) {
          errors.push(`Connector '${name}': connectionEnvVar is required`);
        }
      }

      if (connector.type === "api") {
        if (!connector.baseUrlEnvVar) {
          errors.push(`Connector '${name}': baseUrlEnvVar is required`);
        }
        if (connector.auth && !VALID_API_AUTH_TYPES.includes(connector.auth.type)) {
          errors.push(`Connector '${name}': auth.type must be one of: ${VALID_API_AUTH_TYPES.join(", ")}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * SwallowKit プロジェクトディレクトリかどうかを検証するための設定ファイルパス一覧
 */
const SWALLOWKIT_PROJECT_MARKERS = [
  "swallowkit.config.js",
  "swallowkit.config.json",
  ".swallowkitrc.json",
];

/**
 * 現在のディレクトリが SwallowKit プロジェクトディレクトリかどうかを検証
 * @param projectRoot 検証するディレクトリパス（省略時は process.cwd()）
 * @returns プロジェクトが有効な場合は true、無効な場合は false
 */
export function isSwallowKitProject(projectRoot?: string): boolean {
  const cwd = projectRoot || process.cwd();
  
  // swallowkit 設定ファイルの存在をチェック
  for (const marker of SWALLOWKIT_PROJECT_MARKERS) {
    const markerPath = path.resolve(cwd, marker);
    if (fs.existsSync(markerPath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * SwallowKit プロジェクトディレクトリかどうかを検証し、無効な場合はエラーメッセージを表示して終了
 * init 以外のコマンドの冒頭で呼び出すこと
 * @param commandName コマンド名（エラーメッセージ用）
 * @param projectRoot 検証するディレクトリパス（省略時は process.cwd()）
 */
export function ensureSwallowKitProject(commandName: string, projectRoot?: string): void {
  if (!isSwallowKitProject(projectRoot)) {
    console.error(`❌ Error: This directory is not a SwallowKit project.`);
    console.error(`\n   The '${commandName}' command must be run from a SwallowKit project directory.`);
    console.error(`   A SwallowKit project should contain one of the following files:`);
    for (const marker of SWALLOWKIT_PROJECT_MARKERS) {
      console.error(`     - ${marker}`);
    }
    const pmCmd = getCommands(detectFromProject());
    console.error(`\n💡 Tip: Run '${pmCmd.dlx} swallowkit init' first to create a new SwallowKit project,`);
    console.error(`   or navigate to an existing SwallowKit project directory.`);
    process.exit(1);
  }
}
