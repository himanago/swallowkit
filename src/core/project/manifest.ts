import * as fs from "fs";
import * as path from "path";
import { getBackendLanguage, getFullConfig, normalizeAuthConfig, validateConfig } from "../config";
import { getAllModels, toCamelCase, toKebabCase } from "../scaffold/model-parser";
import { AuthConfig, BackendLanguage, ConnectorDefinition, ModelAuthPolicy, ModelConnectorConfig } from "../../types";
import { captureConsoleMessages, withWorkingDirectory } from "../operations/runtime";

const CONFIG_CANDIDATES = [
  "swallowkit.config.js",
  "swallowkit.config.json",
  ".swallowkitrc.json",
] as const;

export const SWALLOWKIT_MANIFEST_PATH = path.join(".swallowkit", "project.json");
export const SWALLOWKIT_MANIFEST_VERSION = 1;

export interface ProjectManifestField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
}

export interface ProjectManifestEntity {
  name: string;
  displayName: string;
  schemaName: string;
  filePath: string;
  partitionKey: string;
  hasId: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  connectorConfig?: ModelConnectorConfig;
  authPolicy?: ModelAuthPolicy;
  nestedModels: string[];
  fields: ProjectManifestField[];
}

export interface ProjectManifestRoute {
  name: string;
  kind: "entity" | "system";
  surface: "bff" | "functions";
  entityName?: string;
  methods: string[];
  publicPath: string;
  filePath: string;
  exists: boolean;
}

export interface ProjectManifestModule {
  name: string;
  kind: "shared-models" | "bff" | "functions" | "ui" | "infrastructure" | "auth";
  rootPath: string;
  exists: boolean;
}

export interface ProjectManifestArtifacts {
  callFunctionHelperPath: string;
  callFunctionHelperExists: boolean;
  openApiSpecs: string[];
  generatedSchemaDirectories: string[];
  proxyPath: string;
  proxyExists: boolean;
  loginPagePath: string;
  loginPageExists: boolean;
  authContextPath: string;
  authContextExists: boolean;
}

export interface ProjectManifestArchitecture {
  pattern: string;
  backendLanguage: BackendLanguage;
  layerBoundaries: string[];
  hasSharedWorkspace: boolean;
  hasConnectors: boolean;
  hasAuth: boolean;
}

export interface ProjectManifest {
  version: number;
  generatedAt: string;
  configPath: string | null;
  backendLanguage: BackendLanguage;
  configValidation: {
    valid: boolean;
    errors: string[];
  };
  connectors: Array<{ name: string; definition: ConnectorDefinition }>;
  auth: AuthConfig | null;
  entities: ProjectManifestEntity[];
  routes: ProjectManifestRoute[];
  modules: ProjectManifestModule[];
  artifacts: ProjectManifestArtifacts;
  architecture: ProjectManifestArchitecture;
}

export interface LoadedProjectManifest {
  manifest: ProjectManifest;
  source: "file" | "reconstructed";
  diagnostics: string[];
}

function resolveConfigPath(projectRoot: string): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const fullPath = path.join(projectRoot, candidate);
    if (fs.existsSync(fullPath)) {
      return candidate;
    }
  }

  return null;
}

function relativeProjectPath(projectRoot: string, targetPath: string): string {
  return path.relative(projectRoot, targetPath).replace(/\\/g, "/");
}

function buildModules(projectRoot: string): ProjectManifestModule[] {
  const candidates: ProjectManifestModule[] = [
    {
      name: "shared-models",
      kind: "shared-models",
      rootPath: "shared/models",
      exists: fs.existsSync(path.join(projectRoot, "shared", "models")),
    },
    {
      name: "bff",
      kind: "bff",
      rootPath: "app/api",
      exists: fs.existsSync(path.join(projectRoot, "app", "api")),
    },
    {
      name: "functions",
      kind: "functions",
      rootPath: "functions",
      exists: fs.existsSync(path.join(projectRoot, "functions")),
    },
    {
      name: "ui",
      kind: "ui",
      rootPath: "app",
      exists: fs.existsSync(path.join(projectRoot, "app")),
    },
    {
      name: "infrastructure",
      kind: "infrastructure",
      rootPath: "infra",
      exists: fs.existsSync(path.join(projectRoot, "infra")),
    },
    {
      name: "auth",
      kind: "auth",
      rootPath: "app/api/auth",
      exists: fs.existsSync(path.join(projectRoot, "app", "api", "auth")),
    },
  ];

  return candidates;
}

function buildArtifacts(projectRoot: string): ProjectManifestArtifacts {
  const openApiDir = path.join(projectRoot, "functions", "openapi");
  const generatedDir = path.join(projectRoot, "functions", "generated");

  return {
    callFunctionHelperPath: "lib/api/call-function.ts",
    callFunctionHelperExists: fs.existsSync(path.join(projectRoot, "lib", "api", "call-function.ts")),
    openApiSpecs: fs.existsSync(openApiDir)
      ? fs.readdirSync(openApiDir)
          .filter((entry) => entry.endsWith(".json"))
          .map((entry) => `functions/openapi/${entry}`)
          .sort()
      : [],
    generatedSchemaDirectories: fs.existsSync(generatedDir)
      ? fs.readdirSync(generatedDir)
          .map((entry) => `functions/generated/${entry}`)
          .sort()
      : [],
    proxyPath: "proxy.ts",
    proxyExists: fs.existsSync(path.join(projectRoot, "proxy.ts")),
    loginPagePath: "app/login/page.tsx",
    loginPageExists: fs.existsSync(path.join(projectRoot, "app", "login", "page.tsx")),
    authContextPath: "lib/auth/auth-context.tsx",
    authContextExists: fs.existsSync(path.join(projectRoot, "lib", "auth", "auth-context.tsx")),
  };
}

function buildEntityRoutes(
  projectRoot: string,
  backendLanguage: BackendLanguage,
  entity: ProjectManifestEntity
): ProjectManifestRoute[] {
  const modelCamel = toCamelCase(entity.name);
  const modelKebab = toKebabCase(entity.name);
  const isConnectorEntity = Boolean(entity.connectorConfig);
  const functionFilePath = backendLanguage === "typescript"
    ? `functions/src/${modelKebab}.ts`
    : backendLanguage === "csharp"
      ? isConnectorEntity
        ? `functions/Connectors/${entity.name}ConnectorFunctions.cs`
        : `functions/Crud/${entity.name}CrudFunctions.cs`
      : `functions/blueprints/${modelKebab.replace(/-/g, "_")}.py`;

  const operations = entity.connectorConfig?.operations ?? ["getAll", "getById", "create", "update", "delete"];
  const listMethods: string[] = [];
  const detailMethods: string[] = [];

  if (operations.includes("getAll")) {
    listMethods.push("GET");
  }
  if (operations.includes("create")) {
    listMethods.push("POST");
  }
  if (operations.includes("getById")) {
    detailMethods.push("GET");
  }
  if (operations.includes("update")) {
    detailMethods.push("PUT");
  }
  if (operations.includes("delete")) {
    detailMethods.push("DELETE");
  }

  return [
    {
      name: `${entity.name}-bff-list`,
      kind: "entity",
      surface: "bff",
      entityName: entity.name,
      methods: listMethods,
      publicPath: `/api/${modelCamel}`,
      filePath: `app/api/${modelCamel}/route.ts`,
      exists: fs.existsSync(path.join(projectRoot, "app", "api", modelCamel, "route.ts")),
    },
    {
      name: `${entity.name}-bff-detail`,
      kind: "entity",
      surface: "bff",
      entityName: entity.name,
      methods: detailMethods,
      publicPath: `/api/${modelCamel}/{id}`,
      filePath: `app/api/${modelCamel}/[id]/route.ts`,
      exists: fs.existsSync(path.join(projectRoot, "app", "api", modelCamel, "[id]", "route.ts")),
    },
    {
      name: `${entity.name}-functions`,
      kind: "entity",
      surface: "functions",
      entityName: entity.name,
      methods: Array.from(new Set([...listMethods, ...detailMethods])),
      publicPath: `/api/${modelCamel}`,
      filePath: functionFilePath,
      exists: fs.existsSync(path.join(projectRoot, functionFilePath)),
    },
  ];
}

function buildSystemRoutes(projectRoot: string): ProjectManifestRoute[] {
  return [
    {
      name: "auth-login",
      kind: "system",
      surface: "bff",
      methods: ["POST"],
      publicPath: "/api/auth/login",
      filePath: "app/api/auth/login/route.ts",
      exists: fs.existsSync(path.join(projectRoot, "app", "api", "auth", "login", "route.ts")),
    },
    {
      name: "auth-logout",
      kind: "system",
      surface: "bff",
      methods: ["POST"],
      publicPath: "/api/auth/logout",
      filePath: "app/api/auth/logout/route.ts",
      exists: fs.existsSync(path.join(projectRoot, "app", "api", "auth", "logout", "route.ts")),
    },
    {
      name: "auth-me",
      kind: "system",
      surface: "bff",
      methods: ["GET"],
      publicPath: "/api/auth/me",
      filePath: "app/api/auth/me/route.ts",
      exists: fs.existsSync(path.join(projectRoot, "app", "api", "auth", "me", "route.ts")),
    },
  ];
}

export async function buildProjectManifest(projectRoot: string = process.cwd()): Promise<{
  manifest: ProjectManifest;
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];

  return withWorkingDirectory(projectRoot, async () => {
    const configPath = resolveConfigPath(projectRoot);
    const backendLanguage = getBackendLanguage(configPath || undefined);
    const config = getFullConfig(configPath || undefined);
    const configValidation = validateConfig(config);
    const { result: entities, messages } = await captureConsoleMessages(async () => {
      const models = await getAllModels("shared/models");
      return models.map((model) => ({
        name: model.name,
        displayName: model.displayName,
        schemaName: model.schemaName,
        filePath: relativeProjectPath(projectRoot, model.filePath),
        partitionKey: model.partitionKey,
        hasId: model.hasId,
        hasCreatedAt: model.hasCreatedAt,
        hasUpdatedAt: model.hasUpdatedAt,
        connectorConfig: model.connectorConfig,
        authPolicy: model.authPolicy,
        nestedModels: model.nestedSchemaRefs.map((ref) => ref.modelName),
        fields: model.fields.map((field) => ({
          name: field.name,
          type: field.type,
          isOptional: field.isOptional,
          isArray: field.isArray,
        })),
      }));
    });

    diagnostics.push(
      ...messages.warnings.map((warning) => `warning:${warning}`),
      ...messages.errors.map((error) => `error:${error}`)
    );

    const routes = [
      ...entities.flatMap((entity) => buildEntityRoutes(projectRoot, backendLanguage, entity)),
      ...buildSystemRoutes(projectRoot),
    ].sort((left, right) => left.name.localeCompare(right.name));

    const manifest: ProjectManifest = {
      version: SWALLOWKIT_MANIFEST_VERSION,
      generatedAt: new Date().toISOString(),
      configPath,
      backendLanguage,
      configValidation,
      connectors: Object.entries(config.connectors || {})
        .map(([name, definition]) => ({ name, definition }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      auth: normalizeAuthConfig(config.auth) || null,
      entities: entities.sort((left, right) => left.name.localeCompare(right.name)),
      routes,
      modules: buildModules(projectRoot),
      artifacts: buildArtifacts(projectRoot),
      architecture: {
        pattern: "Next.js BFF + Azure Functions + shared Zod models",
        backendLanguage,
        layerBoundaries: [
          "shared/models -> schema source of truth",
          "app/api -> BFF layer only",
          "functions -> backend logic and data access",
          "app -> UI and pages",
        ],
        hasSharedWorkspace: fs.existsSync(path.join(projectRoot, "shared", "package.json")),
        hasConnectors: Object.keys(config.connectors || {}).length > 0,
        hasAuth: Boolean(config.auth && (config.auth.provider !== "none" || Object.keys(config.auth.schemes ?? {}).length > 0)),
      },
    };

    return { manifest, diagnostics };
  });
}

export function readProjectManifest(projectRoot: string = process.cwd()): ProjectManifest | null {
  const manifestPath = path.join(projectRoot, SWALLOWKIT_MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const raw = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw) as ProjectManifest;
}

export async function loadProjectManifest(projectRoot: string = process.cwd()): Promise<LoadedProjectManifest> {
  const manifestPath = path.join(projectRoot, SWALLOWKIT_MANIFEST_PATH);
  if (fs.existsSync(manifestPath)) {
    return {
      manifest: readProjectManifest(projectRoot)!,
      source: "file",
      diagnostics: [],
    };
  }

  const { manifest, diagnostics } = await buildProjectManifest(projectRoot);
  diagnostics.unshift("manifest:not-found-reconstructed");
  return {
    manifest,
    source: "reconstructed",
    diagnostics,
  };
}

export async function syncProjectManifest(projectRoot: string = process.cwd()): Promise<ProjectManifest> {
  const { manifest } = await buildProjectManifest(projectRoot);
  const manifestPath = path.join(projectRoot, SWALLOWKIT_MANIFEST_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  return manifest;
}
