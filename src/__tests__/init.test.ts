import {
  buildGeneratedProjectDependencies,
  buildGeneratedProjectDevDependencies,
  buildSharedTsConfig,
  buildSwallowKitMcpProjectConfigSource,
  buildCSharpFunctionsProgramSource,
  buildCSharpFunctionsProjectSource,
  buildSwallowKitConfigSource,
  injectSwallowKitNextConfig,
  parseIgnoredBuilds,
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
