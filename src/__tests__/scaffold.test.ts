import * as path from "path";
import {
  NSWAG_CONSOLECORE_VERSION,
  buildCSharpCodegenToolManifestSource,
  buildPythonCodegenRequirementsSource,
  getCSharpNativeGeneratorArgs,
  getCSharpSchemaModelPath,
  getCSharpSchemaOptionPath,
  getPythonNativeGeneratorArgs,
  getPythonSchemaModelPath,
} from "../core/scaffold/native-schema-generator";

describe("native schema generators", () => {
  it("writes a dotnet tool manifest for NSwag", () => {
    const manifest = JSON.parse(buildCSharpCodegenToolManifestSource());

    expect(manifest.version).toBe(1);
    expect(manifest.tools["nswag.consolecore"].version).toBe(NSWAG_CONSOLECORE_VERSION);
    expect(manifest.tools["nswag.consolecore"].commands).toEqual(["nswag"]);
  });

  it("pins python schema generation requirements without Java", () => {
    expect(buildPythonCodegenRequirementsSource()).toContain("datamodel-code-generator");
    expect(buildPythonCodegenRequirementsSource()).not.toContain("openapi-generator");
  });

  it("builds NSwag arguments for model-only C# generation", () => {
    const outputPath = path.join("C:\\temp\\generated\\csharp-models", ".native-temp", "Contracts.cs");
    const args = getCSharpNativeGeneratorArgs("C:\\temp\\todo.openapi.json", outputPath);

    expect(args.slice(0, 4)).toEqual(["tool", "run", "nswag", "openapi2csclient"]);
    expect(args).toContain("/GenerateClientClasses:false");
    expect(args).toContain("/GenerateDtoTypes:true");
    expect(args).toContain("/GenerateNullableReferenceTypes:true");
    expect(args).toContain(`/output:${outputPath}`);
  });

  it("builds datamodel-code-generator arguments for python assets", () => {
    const outputPath = path.join("C:\\temp\\generated\\python-models", ".native-temp", "models.py");
    const args = getPythonNativeGeneratorArgs("C:\\temp\\todo.openapi.json", outputPath);

    expect(args).toEqual(
      expect.arrayContaining([
        "-m",
        "datamodel_code_generator",
        "--input-file-type",
        "openapi",
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--disable-timestamp",
        outputPath,
      ])
    );
  });

  it("keeps generated asset paths under functions/generated", () => {
    expect(getCSharpSchemaModelPath("C:\\temp\\generated\\csharp-models", "Product")).toBe(
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Model", "Product.cs")
    );
    expect(getCSharpSchemaOptionPath("C:\\temp\\generated\\csharp-models")).toBe(
      path.join("C:\\temp\\generated\\csharp-models", "src", "SwallowKitBackendModels", "Client", "Option.cs")
    );
    expect(getPythonSchemaModelPath("C:\\temp\\generated\\python-models", "Product")).toBe(
      path.join("C:\\temp\\generated\\python-models", "backend_models", "models", "product.py")
    );
  });
});
