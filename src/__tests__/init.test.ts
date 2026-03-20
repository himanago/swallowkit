import {
  buildCSharpFunctionsProgramSource,
  buildCSharpFunctionsProjectSource,
  injectSwallowKitNextConfig,
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
    expect(source).not.toContain("Microsoft.Azure.Functions.Worker.Builder");
    expect(source).not.toContain("FunctionsApplication.CreateBuilder");
    expect(source).not.toContain("ConfigureFunctionsApplicationInsights");
  });

  it("excludes nested generated bin and obj files from the C# Functions project", () => {
    const source = buildCSharpFunctionsProjectSource();

    expect(source).toContain('<Compile Remove="generated\\**\\bin\\**\\*.cs;generated\\**\\obj\\**\\*.cs" />');
    expect(source).toContain('<EmbeddedResource Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />');
    expect(source).toContain('<None Remove="generated\\**\\bin\\**;generated\\**\\obj\\**" />');
  });
});
