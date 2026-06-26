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
      "@sample-app/shared": "workspace:*",
    });
    expect(dependencies).not.toHaveProperty("swallowkit");
  });

  it("adds swallowkit as a generated project devDependency", () => {
    const devDependencies = buildGeneratedProjectDevDependencies();

    expect(devDependencies).toEqual({
      swallowkit: expect.stringMatching(/.+/),
    });
  });

  it("builds a project-scoped MCP config that launches the local swallowkit-mcp entrypoint", () => {
    const source = buildSwallowKitMcpProjectConfigSource();
    const parsed = JSON.parse(source) as {
      mcpServers: {
        swallowkit: {
          command: string;
          args: string[];
          cwd?: string;
        };
      };
    };

    expect(parsed.mcpServers.swallowkit.command).toBe("node");
    expect(parsed.mcpServers.swallowkit.args).toEqual([
      expect.stringMatching(/^\.\/node_modules\/swallowkit\/dist\/mcp\/index\.js$/),
    ]);
    expect(parsed.mcpServers.swallowkit.cwd).toBe(".");
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
