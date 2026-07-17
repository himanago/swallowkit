import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";
import { AuthConfig, AuthProvider, BackendLanguage, ConnectorDefinition, NormalizedAuthConfig, SwallowKitConfig } from "../types";
import { detectFromProject, getCommands } from "../utils/package-manager";

const requireFromHere = createRequire(__filename);

function unwrapConfigModule(
  loadedConfig: Partial<SwallowKitConfig> | { default?: Partial<SwallowKitConfig> }
): Partial<SwallowKitConfig> {
  if (typeof loadedConfig === "object" && loadedConfig !== null && "default" in loadedConfig) {
    return loadedConfig.default ?? {};
  }
  return loadedConfig as Partial<SwallowKitConfig>;
}

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
export function loadConfig(configPath?: string, throwOnError = false): SwallowKitConfig {
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
          delete requireFromHere.cache[fullPath];
          const loadedConfig = requireFromHere(fullPath) as Partial<SwallowKitConfig> | { default?: Partial<SwallowKitConfig> };
          return mergeConfig(DEFAULT_CONFIG, unwrapConfigModule(loadedConfig));
        }
      } catch (error) {
        if (throwOnError) throw error;
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
    connectors: userConfig.connectors ?? defaultConfig.connectors,
    auth: userConfig.auth
      ? { ...defaultConfig.auth, ...userConfig.auth }
      : defaultConfig.auth,
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
 * 認証設定を取得
 */
export function getAuthConfig(configPath?: string): AuthConfig | undefined {
  const config = getFullConfig(configPath);
  return config.auth;
}

/** Load configuration for mutating/generation commands and fail instead of silently falling back. */
export function getValidatedFullConfig(configPath?: string): SwallowKitConfig {
  const config = mergeConfig(loadConfig(configPath, true), loadConfigFromEnv());
  const validation = validateConfig(config);
  if (!validation.valid) throw new Error(`Invalid SwallowKit configuration:\n${validation.errors.map(error => `- ${error}`).join("\n")}`);
  return config;
}

const VALID_AUTH_PROVIDERS: AuthProvider[] = ["custom-jwt", "swa", "external-token", "swa-custom", "none"];
const AUTH_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Convert the legacy single-provider shape to the canonical named-scheme shape. */
export function normalizeAuthConfig(auth?: AuthConfig): NormalizedAuthConfig | undefined {
  if (!auth) return undefined;
  const schemes = { ...(auth.schemes ?? {}) };
  if (auth.provider && auth.provider !== "none" && !schemes.default) {
    schemes.default = { provider: auth.provider, customJwt: auth.customJwt, swa: auth.swa };
  }
  const rawDefault = auth.authorization?.defaultPolicy ?? (Object.keys(schemes).length ? "authenticated" : "anonymous");
  return {
    ...auth,
    schemes,
    authorization: {
      ...auth.authorization,
      defaultPolicy: rawDefault === "public" ? "anonymous" : rawDefault,
      policies: { ...(auth.authorization?.policies ?? {}) },
    },
  };
}

export function getNormalizedAuthConfig(configPath?: string): NormalizedAuthConfig | undefined {
  return normalizeAuthConfig(getAuthConfig(configPath));
}

/**
 * 設定の検証
 */
const VALID_CONNECTOR_TYPES = ["rdb", "api"];
const VALID_RDB_PROVIDERS = ["mysql", "postgres", "sqlserver"];
const VALID_API_AUTH_TYPES = ["apiKey", "bearer", "oauth2"];

function hasConfiguredDatabase(config: SwallowKitConfig): boolean {
  return Boolean(config.database && Object.keys(config.database).length > 0);
}

export function validateConfig(config: SwallowKitConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const auth = normalizeAuthConfig(config.auth);
  if (auth) {
    for (const [name, scheme] of Object.entries(auth.schemes)) {
      const base = `auth.schemes.${name}`;
      if (!AUTH_NAME.test(name)) errors.push(`${base}: scheme name must match ${AUTH_NAME}; rename the scheme`);
      if (!VALID_AUTH_PROVIDERS.includes(scheme.provider)) errors.push(`${base}.provider: unsupported provider '${scheme.provider}'; use ${VALID_AUTH_PROVIDERS.join(", ")}`);
      if (scheme.provider === "none" || scheme.provider === "swa-custom") errors.push(`${base}.provider: '${scheme.provider}' cannot be used as a named scheme; use swa, external-token, or custom-jwt`);
      if (scheme.provider === "custom-jwt") {
        const jwt = scheme.customJwt ?? (name === "default" ? auth.customJwt : undefined);
        for (const key of ["userConnector", "userTable", "loginIdColumn", "passwordHashColumn", "rolesColumn"] as const) {
          if (!jwt?.[key]) errors.push(`${base}.customJwt.${key}: required for custom-jwt; configure this value`);
        }
      }
    }
    for (const [name, policy] of Object.entries(auth.authorization.policies)) {
      const base = `auth.authorization.policies.${name}`;
      if (!AUTH_NAME.test(name)) errors.push(`${base}: policy name must match ${AUTH_NAME}; rename the policy`);
      if (!Array.isArray(policy.schemes) || policy.schemes.length === 0) errors.push(`${base}.schemes: provide at least one named scheme`);
      for (const scheme of policy.schemes ?? []) if (!auth.schemes[scheme]) errors.push(`${base}.schemes: undefined scheme '${scheme}'; define auth.schemes.${scheme}`);
      const sources = new Map<string, string>();
      for (const schemeName of policy.schemes ?? []) {
        const provider = auth.schemes[schemeName]?.provider;
        const source = provider === "swa" ? "x-ms-client-principal" : provider === "custom-jwt" || provider === "external-token" ? "authorization-bearer" : provider;
        if (source && sources.has(source)) errors.push(`${base}.schemes: '${sources.get(source)}' and '${schemeName}' both use ${source}; split the policy so credential selection is deterministic`);
        else if (source) sources.set(source, schemeName);
      }
    }
    const defaultPolicy = auth.authorization.defaultPolicy;
    if (defaultPolicy === "authenticated" && !auth.schemes.default && Object.keys(auth.schemes).length !== 1) errors.push("auth.authorization.defaultPolicy: 'authenticated' requires auth.schemes.default (or exactly one scheme); set a default scheme or use a named policy");
    else if (!["anonymous", "authenticated"].includes(defaultPolicy) && !auth.authorization.policies[defaultPolicy]) errors.push(`auth.authorization.defaultPolicy: undefined policy '${defaultPolicy}'; define auth.authorization.policies.${defaultPolicy}`);
  }

  // データベース設定の検証
  if (hasConfiguredDatabase(config) && !config.database?.connectionString) {
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
