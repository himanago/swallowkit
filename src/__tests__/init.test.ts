import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildGeneratedProjectDependencies,
  buildGeneratedProjectDevDependencies,
  buildSharedTsConfig,
  buildAzureSwaPipeline,
  buildSwallowKitMcpProjectConfigSource,
  buildGitHubSwaWorkflow,
  buildCSharpFunctionsProgramSource,
  buildCSharpFunctionsProjectSource,
  buildSwallowKitConfigSource,
  getAzureFunctionsPipeline,
  getGitHubFunctionsWorkflow,
  injectSwallowKitNextConfig,
  parseIgnoredBuilds,
  buildCosmosDbFreeTierBicepSource,
  buildFunctionsHostKeyBicepExpression,
  buildStaticWebAppConfigBicepSource,
  buildTypeScriptFunctionsPackageJson,
  createInfrastructure,
  getStaticWebAppSku,
  withNpmLockfileSafeManifests,
} from "../cli/commands/init";

describe("injectSwallowKitNextConfig", () => {
  it("adds standalone settings without deprecated experimental options", () => {
    const original = `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
`;

    const updated = injectSwallowKitNextConfig(original, "sample-app");

    expect(updated).toContain("output: 'standalone'");
    expect(updated).toContain("transpilePackages: ['@sample-app/shared']");
    expect(updated).toContain("serverExternalPackages: ['applicationinsights', 'diagnostic-channel-publishers']");
    expect(updated).not.toContain("turbopackUseSystemTlsCerts");
    expect(updated).not.toContain("experimental:");
  });

  it("supports JavaScript next.config format", () => {
    const original = `const nextConfig = {
  /* config options here */
};

module.exports = nextConfig;
`;

    const updated = injectSwallowKitNextConfig(original, "sample-app");

    expect(updated).toContain("transpilePackages: ['@sample-app/shared']");
    expect(updated).toContain("module.exports = nextConfig;");
  });

  it("generates a C# Program.cs compatible with the current worker packages", () => {
    const source = buildCSharpFunctionsProgramSource();

    expect(source).toContain("new HostBuilder()");
    expect(source).toContain(".ConfigureFunctionsWorkerDefaults()");
    expect(source).toContain("services.AddApplicationInsightsTelemetryWorkerService()");
    expect(source).toContain("services.ConfigureFunctionsApplicationInsights()");
    expect(source).toContain("Microsoft.Azure.Functions.Worker.ApplicationInsights");
    expect(source).not.toContain("Microsoft.Azure.Functions.Worker.Builder");
    expect(source).not.toContain("FunctionsApplication.CreateBuilder");
  });

  it("excludes nested generated bin and obj files from the C# Functions project", () => {
    const source = buildCSharpFunctionsProjectSource();

    expect(source).toContain("<TargetFramework>net10.0</TargetFramework>");
    expect(source).toContain('Version="2.52.0"');
    expect(source).toContain('Version="3.3.0"');
    expect(source).toContain('Version="2.0.7"');
    expect(source).toContain('Version="2.50.0"');
    expect(source).toContain('<Compile Remove="generated\\**\\bin\\**\\*.cs;generated\\**\\obj\\**\\*.cs" />');
    expect(source).toContain('<EmbeddedResource Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />');
    expect(source).toContain('<None Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />');
  });

  it("builds swallowkit.config.js without a local swallowkit package type import", () => {
    const source = buildSwallowKitConfigSource("typescript");

    expect(source).toContain("language: 'typescript'");
    expect(source).toContain("baseUrl: process.env.BACKEND_FUNCTIONS_BASE_URL");
    expect(source).not.toContain("import('swallowkit').SwallowKitConfig");
  });

  it("builds shared tsconfig with non-deprecated module resolution settings", () => {
    const tsconfig = buildSharedTsConfig();

    expect(tsconfig.compilerOptions.module).toBe("Node16");
    expect(tsconfig.compilerOptions.moduleResolution).toBe("node16");
  });

  it("does not add swallowkit as a generated project dependency", () => {
    const dependencies = buildGeneratedProjectDependencies("sample-app");

    expect(dependencies).toEqual({
      "@azure/cosmos": "^4.0.0",
      applicationinsights: "^3.3.0",
      zod: "^4.0.0",
      "@sample-app/shared": "workspace:*",
    });
    expect(dependencies).not.toHaveProperty("swallowkit");
  });

  it("uses npm-compatible file dependencies for the shared workspace", () => {
    const dependencies = buildGeneratedProjectDependencies("sample-app", "npm");

    expect(dependencies["@sample-app/shared"]).toBe("file:shared");
    expect(Object.values(dependencies)).not.toContain("workspace:*");
  });

  it("uses an npm-compatible shared dependency in the Functions workspace", () => {
    const packageJson = buildTypeScriptFunctionsPackageJson("sample-app", "npm");

    expect(packageJson.dependencies["@sample-app/shared"]).toBe("file:../shared");
    expect(Object.values(packageJson.dependencies)).not.toContain("workspace:*");
  });

  it("adds swallowkit as a generated project devDependency", () => {
    const devDependencies = buildGeneratedProjectDevDependencies();

    expect(devDependencies).toEqual({
      swallowkit: expect.stringMatching(/.+/),
    });
  });

  it("builds a project-scoped MCP config that resolves the configured swallowkit-mcp version", () => {
    const source = buildSwallowKitMcpProjectConfigSource();
    const parsed = JSON.parse(source) as {
      mcpServers: {
        swallowkit: {
          command: string;
          args: string[];
          cwd?: string;
          env?: Record<string, string>;
        };
      };
    };

    expect(parsed.mcpServers.swallowkit.command).toBe("pnpm");
    expect(parsed.mcpServers.swallowkit.args).toEqual([
      "dlx",
      "--package",
      "swallowkit@${SWALLOWKIT_MCP_VERSION}",
      "swallowkit-mcp",
    ]);
    expect(parsed.mcpServers.swallowkit.cwd).toBe(".");
    expect(parsed.mcpServers.swallowkit.env).toEqual({ SWALLOWKIT_MCP_VERSION: "latest" });
  });

  it("builds an npm-based MCP config when pnpm is unavailable", () => {
    const source = buildSwallowKitMcpProjectConfigSource("npm");
    const parsed = JSON.parse(source);

    expect(parsed.mcpServers.swallowkit.command).toBe("npx");
    expect(parsed.mcpServers.swallowkit.args).toEqual([
      "--yes",
      "--package",
      "swallowkit@${SWALLOWKIT_MCP_VERSION}",
      "swallowkit-mcp",
    ]);
  });

  it("temporarily rewrites workspace protocol dependencies for npm lockfile generation", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-lockfile-"));
    fs.mkdirSync(path.join(projectDir, "shared"));
    fs.mkdirSync(path.join(projectDir, "functions"));
    fs.mkdirSync(path.join(projectDir, "node_modules"));
    fs.mkdirSync(path.join(projectDir, "shared", "node_modules"));
    fs.writeFileSync(path.join(projectDir, "node_modules", ".pnpm-marker"), "root");
    fs.writeFileSync(path.join(projectDir, "shared", "node_modules", ".pnpm-marker"), "shared");

    const rootPackageJson = {
      name: "sample-app",
      dependencies: {
        "@sample-app/shared": "workspace:*",
      },
    };
    const functionsPackageJson = {
      name: "functions",
      dependencies: {
        "@sample-app/shared": "workspace:*",
      },
    };
    const sharedPackageJson = {
      name: "@sample-app/shared",
    };

    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify(rootPackageJson, null, 2));
    fs.writeFileSync(path.join(projectDir, "functions", "package.json"), JSON.stringify(functionsPackageJson, null, 2));
    fs.writeFileSync(path.join(projectDir, "shared", "package.json"), JSON.stringify(sharedPackageJson, null, 2));

    await withNpmLockfileSafeManifests(projectDir, async () => {
      const normalizedRoot = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
      const normalizedFunctions = JSON.parse(fs.readFileSync(path.join(projectDir, "functions", "package.json"), "utf-8"));

      expect(normalizedRoot.dependencies["@sample-app/shared"]).toBe("file:shared");
      expect(normalizedFunctions.dependencies["@sample-app/shared"]).toBe("file:../shared");
      expect(fs.existsSync(path.join(projectDir, "node_modules"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, "shared", "node_modules"))).toBe(false);
    });

    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"))).toEqual(rootPackageJson);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, "functions", "package.json"), "utf-8"))).toEqual(functionsPackageJson);
    expect(fs.readFileSync(path.join(projectDir, "node_modules", ".pnpm-marker"), "utf-8")).toBe("root");
    expect(fs.readFileSync(path.join(projectDir, "shared", "node_modules", ".pnpm-marker"), "utf-8")).toBe("shared");
  });
});

describe("parseIgnoredBuilds", () => {
  it("extracts package names from the pnpm warning line", () => {
    const output = [
      "WARN  Issues with peer dependencies found",
      " ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: sharp@0.34.5, unrs-resolver@1.12.2",
      "run pnpm approve-builds",
    ].join("\n");
    expect(parseIgnoredBuilds(output)).toEqual(["sharp", "unrs-resolver"]);
  });

  it("handles scoped packages and de-duplicates entries", () => {
    const output = "Ignored build scripts: @scope/pkg@1.0.0, sharp@0.34.5, sharp@0.34.5";
    expect(parseIgnoredBuilds(output)).toEqual(["@scope/pkg", "sharp"]);
  });

  it("returns an empty array when no warning is present", () => {
    expect(parseIgnoredBuilds("everything is fine")).toEqual([]);
  });
});

describe("buildCosmosDbFreeTierBicepSource", () => {
  it("keeps database-level shared throughput at 1000 RU/s for Free Tier", () => {
    const source = buildCosmosDbFreeTierBicepSource();

    expect(source).toContain("throughput: 1000");
    expect(source).not.toContain("containers");
  });
});

describe("Static Web Apps plan", () => {
  it("maps init plan values to Azure SKU names", () => {
    expect(getStaticWebAppSku("free")).toBe("Free");
    expect(getStaticWebAppSku("standard")).toBe("Standard");
  });
});

describe("Functions host key infrastructure", () => {
  it("reads the generated default host key without exposing a literal value", () => {
    const expression = buildFunctionsHostKeyBicepExpression();
    expect(expression).toContain("listKeys(");
    expect(expression).toContain("functionKeys.default");
    expect(expression).toContain("${resourceId('Microsoft.Web/sites', functionsAppName)}/host/default");
    expect(expression).not.toContain("Microsoft.Web/sites/host");
    expect(expression).not.toContain("functionsFlex.outputs.id");
  });

  it("resolves the key inside the SWA config module after Functions deployment", () => {
    const source = buildStaticWebAppConfigBicepSource();
    expect(source).toContain("param functionsAppName string");
    expect(source).toContain("BACKEND_FUNCTIONS_KEY: listKeys(");
    expect(source).not.toContain("param functionsHostKey string");
    expect(source).not.toContain("output functionsHostKey");
  });
});

describe("Infrastructure generation", () => {
  it.each([
    ["freetier", "free"],
    ["serverless", "standard"],
  ] as Array<["freetier" | "serverless", "free" | "standard"]>)(
    "emits VNet module definitions with VNet disabled (%s)",
    async (cosmosDbMode, swaPlan) => {
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-infra-no-vnet-"));

      await createInfrastructure(
        projectDir,
        "sample-app",
        { cosmosDbMode, vnetOption: "none", swaPlan },
        "typescript",
      );

      expect(fs.existsSync(path.join(projectDir, "infra", "modules", "vnet.bicep"))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, "infra", "modules", "private-endpoint-cosmos.bicep"))).toBe(true);

      const mainBicep = fs.readFileSync(path.join(projectDir, "infra", "main.bicep"), "utf-8");
      expect(mainBicep).toContain("param enableVNet bool = false");
      expect(mainBicep).toContain("module vnet 'modules/vnet.bicep' = if (enableVNet)");
      expect(mainBicep).toContain("functionsAppName: functionsFlex.outputs.name");
      expect(mainBicep).not.toContain("functionsHostKey:");
    },
  );
});

describe("GitHub Actions workflow generation", () => {
  it("uses npm ci for the SWA workflow when the project was initialized with pnpm", () => {
    const workflow = buildGitHubSwaWorkflow("npm", "pnpm");

    expect(workflow).toContain("Normalize pnpm workspace for npm CI");
    expect(workflow).toContain("root.workspaces = ['shared', 'functions']");
    expect(workflow).toContain("replaceSharedWorkspaceDep(root, 'file:shared')");
    expect(workflow).toContain("root.scripts.build = \"npm run --workspace=shared build");
    expect(workflow).toContain("npm install --package-lock-only --ignore-scripts");
    expect(workflow).toContain("npm ci && npm run build");
    expect(workflow).not.toContain("npm install && npm run build");
    expect(workflow).not.toContain("pnpm/action-setup");
    expect(workflow).not.toContain("pnpm install --frozen-lockfile");
  });

  it("uses npm ci for the Functions workflow when the project was initialized with pnpm", () => {
    const workflow = getGitHubFunctionsWorkflow("npm", "typescript", "pnpm");

    expect(workflow).toContain("Normalize pnpm workspace for npm CI");
    expect(workflow).toContain("replaceSharedWorkspaceDep(functionsPkg, 'file:../shared')");
    expect(workflow).toContain("functionsPkg.scripts.prestart = 'npm run build'");
    expect(workflow).toContain("npm install --package-lock-only --ignore-scripts");
    expect(workflow).toContain("- name: Install dependencies\n        run: |\n          npm ci");
    expect(workflow).toContain("npm run --workspace=shared build");
    expect(workflow).toContain("npm run --workspace=functions build");
    expect(workflow).not.toContain("pnpm/action-setup");
    expect(workflow).not.toContain("pnpm install --frozen-lockfile");
  });

  it("uses npm ci for the SWA pipeline when the project was initialized with pnpm", () => {
    const pipeline = buildAzureSwaPipeline("npm", "pnpm");

    expect(pipeline).toContain("Normalize pnpm workspace for npm CI");
    expect(pipeline).toContain("root.workspaces = ['shared', 'functions']");
    expect(pipeline).toContain("replaceSharedWorkspaceDep(root, 'file:shared')");
    expect(pipeline).toContain("root.scripts.build = \"npm run --workspace=shared build");
    expect(pipeline).toContain("npm install --package-lock-only --ignore-scripts");
    expect(pipeline).toContain("npm ci");
    expect(pipeline).not.toContain("- script: |\n      npm install\n    displayName: 'Install dependencies'");
    expect(pipeline).toContain("npm run build");
    expect(pipeline).not.toContain("corepack enable");
    expect(pipeline).not.toContain("pnpm install --frozen-lockfile");
  });

  it("uses npm ci for the Functions pipeline when the project was initialized with pnpm", () => {
    const pipeline = getAzureFunctionsPipeline("npm", "typescript", "pnpm");

    expect(pipeline).toContain("Normalize pnpm workspace for npm CI");
    expect(pipeline).toContain("replaceSharedWorkspaceDep(functionsPkg, 'file:../shared')");
    expect(pipeline).toContain("functionsPkg.scripts.prestart = 'npm run build'");
    expect(pipeline).toContain("npm install --package-lock-only --ignore-scripts");
    expect(pipeline).toContain("- script: |\n      npm ci\n    displayName: 'Install workspace dependencies'");
    expect(pipeline).toContain("npm run --workspace=shared build");
    expect(pipeline).toContain("npm run --workspace=functions build");
    expect(pipeline).not.toContain("corepack enable");
    expect(pipeline).not.toContain("pnpm install --frozen-lockfile");
  });
});
