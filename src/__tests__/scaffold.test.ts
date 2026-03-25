import * as path from "path";
import { getCSharpSchemaArtifactPruneTargets, getOpenApiGeneratorArgs } from "../cli/commands/scaffold";

describe("getOpenApiGeneratorArgs", () => {
  it("omits supportingFiles for C# model generation to avoid Polly version conflicts", () => {
    const args = getOpenApiGeneratorArgs("spec.json", "out", "csharp");
    const globalPropertyIndex = args.indexOf("--global-property");

    expect(globalPropertyIndex).toBeGreaterThanOrEqual(0);
    expect(args[globalPropertyIndex + 1]).toBe("models,apis=false,modelDocs=false,modelTests=false");
  });

  it("continues omitting supporting files for Python model generation", () => {
    const args = getOpenApiGeneratorArgs("spec.json", "out", "python");
    const globalPropertyIndex = args.indexOf("--global-property");

    expect(globalPropertyIndex).toBeGreaterThanOrEqual(0);
    expect(args[globalPropertyIndex + 1]).toBe(
      "models,apis=false,supportingFiles=false,modelDocs=false,modelTests=false"
    );
  });

  it("prunes extra C# artifacts that pull in unused dependencies", () => {
    const targets = getCSharpSchemaArtifactPruneTargets("C:\\temp\\generated\\csharp-models");

    expect(targets).toEqual([
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels.Test"),
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Api"),
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Extensions"),
    ]);
  });

  it("keeps only Option.cs from generated C# client helpers", () => {
    const args = getOpenApiGeneratorArgs("spec.json", "out", "csharp");

    expect(args).toContain("csharp");
    expect(getCSharpSchemaArtifactPruneTargets("C:\\temp\\generated\\csharp-models")).toHaveLength(3);
  });
});
