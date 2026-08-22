import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
import { BackendLanguage } from "../../types";
import { FileOperationSession } from "../operations/file-session";
import { ModelInfo, toKebabCase } from "./model-parser";
import { generateOpenApiDocument } from "./openapi-generator";
import {
  buildProjectLocalUvEnv,
  buildProjectLocalUvInstallerEnv,
  buildUvPipInstallArgs,
  buildUvVenvArgs,
  getProjectLocalUvInstallerCommand,
  getProjectLocalUvPaths,
  getPythonProjectRoot,
} from "../../utils/python-uv";

export const NSWAG_CONSOLECORE_VERSION = "14.7.1";
export const PYTHON_SCHEMA_CODEGEN_REQUIREMENT = "datamodel-code-generator>=0.44.0,<1.0.0";
const PYTHON_OUTPUT_MODEL_TYPE = "pydantic_v2.BaseModel";

function getMachineAwareStdio(): "inherit" | "pipe" {
  return process.env.SWALLOWKIT_MACHINE_OUTPUT === "1" ? "pipe" : "inherit";
}

function canRun(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): boolean {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  errorMessage: string,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: getMachineAwareStdio(),
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${errorMessage} (${command} ${args.join(" ")}) exited with code ${code}`));
    });

    child.on("error", (error) => reject(new Error(`${errorMessage}: ${error.message}`)));
  });
}

export function buildCSharpCodegenToolManifestSource(): string {
  return `${JSON.stringify(
    {
      version: 1,
      isRoot: true,
      tools: {
        "nswag.consolecore": {
          version: NSWAG_CONSOLECORE_VERSION,
          commands: ["nswag"],
        },
      },
    },
    null,
    2
  )}\n`;
}

export function buildPythonCodegenRequirementsSource(): string {
  return `${PYTHON_SCHEMA_CODEGEN_REQUIREMENT}\n`;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function toPascalIdentifier(value: string): string {
  if (value.includes("-") || value.includes("_")) {
    return value
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isDateLikeField(field: Pick<ModelInfo["fields"][number], "name" | "type">): boolean {
  return field.type === "date" || (field.type === "string" && field.name.toLowerCase().endsWith("at"));
}

export function getCSharpSchemaModelPath(outputDir: string, modelName: string): string {
  return path.join(outputDir, "src", "SwallowKitBackendModels", "Model", `${modelName}.cs`);
}

export function getCSharpSchemaOptionPath(outputDir: string): string {
  return path.join(outputDir, "src", "SwallowKitBackendModels", "Client", "Option.cs");
}

export function getPythonSchemaModelPath(outputDir: string, modelName: string): string {
  return path.join(outputDir, "backend_models", "models", `${toSnakeCase(modelName)}.py`);
}

export function getCSharpNativeGeneratorArgs(specPath: string, outputPath: string): string[] {
  return [
    "tool",
    "run",
    "nswag",
    "openapi2csclient",
    `/input:${specPath}`,
    `/output:${outputPath}`,
    "/namespace:SwallowKitBackendModels",
    "/GenerateClientClasses:false",
    "/GenerateClientInterfaces:false",
    "/GenerateResponseClasses:false",
    "/GenerateExceptionClasses:false",
    "/GenerateDtoTypes:true",
    "/GenerateNullableReferenceTypes:true",
    "/GenerateOptionalPropertiesAsNullable:true",
    "/JsonLibrary:SystemTextJson",
  ];
}

export function getPythonNativeGeneratorArgs(specPath: string, outputPath: string): string[] {
  return [
    "-m",
    "datamodel_code_generator",
    "--input",
    specPath,
    "--input-file-type",
    "openapi",
    "--output",
    outputPath,
    "--output-model-type",
    PYTHON_OUTPUT_MODEL_TYPE,
    "--target-python-version",
    "3.11",
    "--disable-timestamp",
    "--use-union-operator",
    "--collapse-root-models",
  ];
}

function getCSharpFieldBaseType(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  if (field.enumValues?.length) {
    return `${toPascalIdentifier(field.name)}Enum`;
  }

  if (field.isArray) {
    return `List<${getCSharpArrayElementType(field)}>`;
  }

  switch (field.type) {
    case "string":
      return isDateLikeField(field) ? "DateTime" : "string";
    case "number":
      return "decimal";
    case "boolean":
      return "bool";
    case "date":
      return "DateTime";
    case "object":
      return "Dictionary<string, object>";
    default:
      return "object";
  }
}

function getCSharpArrayElementType(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  if (field.enumValues?.length) {
    return `${toPascalIdentifier(field.name)}Enum`;
  }

  switch (field.type) {
    case "string":
      return isDateLikeField(field) ? "DateTime" : "string";
    case "number":
      return "decimal";
    case "boolean":
      return "bool";
    case "date":
      return "DateTime";
    case "object":
      return "Dictionary<string, object>";
    default:
      return "object";
  }
}

function getCSharpPropertyType(field: ModelInfo["fields"][number]): string {
  const baseType = getCSharpFieldBaseType(field);
  return field.isOptional ? `${baseType}?` : baseType;
}

function getCSharpOptionType(field: ModelInfo["fields"][number]): string {
  return `Option<${getCSharpPropertyType(field)}>`;
}

function generateLegacyCompatibleOptionSource(): string {
  return `// <auto-generated>
// Minimal Option<T> for OpenAPI Generator model compatibility.
// Full client supporting files are excluded to avoid Polly version conflicts.
// </auto-generated>

#nullable enable

namespace SwallowKitBackendModels.Client
{
    /// <summary>
    /// A wrapper for nullable/optional properties generated by OpenAPI Generator.
    /// Tracks whether a value has been explicitly set (distinguishing null from absent).
    /// </summary>
    public readonly struct Option<TValue>
    {
        /// <summary>Whether this option has been explicitly set.</summary>
        public bool IsSet { get; }

        /// <summary>The contained value (may be default if not set).</summary>
        public TValue Value { get; }

        /// <summary>Create an Option with an explicit value.</summary>
        public Option(TValue value)
        {
            IsSet = true;
            Value = value;
        }

        /// <summary>Implicit conversion from Option to its inner value.</summary>
        public static implicit operator TValue(Option<TValue> option) => option.Value;
    }
}
`;
}

function buildCSharpEnumMembers(values: string[]): string {
  return values
    .map((value, index) => `            ${toPascalIdentifier(value)} = ${index + 1}`)
    .join(",\n\n");
}

function buildCSharpEnumFromStringCases(field: ModelInfo["fields"][number], nullable: boolean): string {
  const enumType = `${toPascalIdentifier(field.name)}Enum`;
  return field.enumValues!
    .map((value) => `            if (value.Equals("${value}", StringComparison.Ordinal))\n                return ${enumType}.${toPascalIdentifier(value)};`)
    .join("\n\n") + (nullable ? `\n\n            return null;` : `\n\n            throw new NotImplementedException($"Could not convert value to type ${enumType}: '{value}'");`);
}

function buildCSharpEnumToJsonCases(field: ModelInfo["fields"][number]): string {
  const enumType = `${toPascalIdentifier(field.name)}Enum`;
  return field.enumValues!
    .map((value) => `            if (value == ${enumType}.${toPascalIdentifier(value)})\n                return "${value}";`)
    .join("\n\n");
}

function generateLegacyCompatibleCSharpModelSource(model: ModelInfo): string {
  const requiredFields = model.fields.filter((field) => !field.isOptional);
  const optionalFields = model.fields.filter((field) => field.isOptional);

  const constructorParams = [
    ...requiredFields.map((field) => `${getCSharpFieldBaseType(field)} ${field.name}`),
    ...optionalFields.map((field) => `${getCSharpOptionType(field)} ${field.name} = default`),
  ].join(", ");

  const constructorAssignments = [
    ...requiredFields.map((field) => `            ${toPascalIdentifier(field.name)} = ${field.name};`),
    ...optionalFields.map((field) => `            ${toPascalIdentifier(field.name)}Option = ${field.name};`),
    "            OnCreated();",
  ].join("\n");

  const enumBlocks = model.fields
    .filter((field) => field.enumValues?.length)
    .map((field) => {
      const enumType = `${toPascalIdentifier(field.name)}Enum`;
      return `        /// <summary>
        /// Defines ${toPascalIdentifier(field.name)}
        /// </summary>
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public enum ${enumType}
        {
${buildCSharpEnumMembers(field.enumValues!)}
        }

        public static ${enumType} ${enumType}FromString(string value)
        {
${buildCSharpEnumFromStringCases(field, false)}
        }

        public static ${enumType}? ${enumType}FromStringOrDefault(string value)
        {
${buildCSharpEnumFromStringCases(field, true)}
        }

        public static string ${enumType}ToJsonValue(${enumType}? value)
        {
${buildCSharpEnumToJsonCases(field)}

            throw new NotImplementedException($"Value could not be handled: '{value}'");
        }`;
    })
    .join("\n\n");

  const propertyBlocks = model.fields
    .map((field) => {
      const propertyName = toPascalIdentifier(field.name);
      const propertyType = getCSharpPropertyType(field);

      if (!field.isOptional) {
        return `        /// <summary>
        /// Gets or Sets ${propertyName}
        /// </summary>
        [JsonPropertyName("${field.name}")]
        public ${propertyType} ${propertyName} { get; set; }`;
      }

      return `        /// <summary>
        /// Used to track the state of ${propertyName}
        /// </summary>
        [JsonIgnore]
        [global::System.ComponentModel.EditorBrowsable(global::System.ComponentModel.EditorBrowsableState.Never)]
        public ${getCSharpOptionType(field)} ${propertyName}Option { get; private set; }

        /// <summary>
        /// Gets or Sets ${propertyName}
        /// </summary>
        [JsonPropertyName("${field.name}")]
        public ${propertyType} ${propertyName} { get { return this.${propertyName}Option; } set { this.${propertyName}Option = new(value); } }`;
    })
    .join("\n\n");

  const toStringBody = model.fields
    .map((field) => `            sb.Append("  ${toPascalIdentifier(field.name)}: ").Append(${toPascalIdentifier(field.name)}).Append("\\n");`)
    .join("\n");

  return `// <auto-generated>
/*
 * ${model.name} API
 *
 * Generated from SwallowKit Zod model metadata.
 *
 * The version of the OpenAPI document: 1.0.0
 * Generated by native SwallowKit schema compatibility layer
 */

#nullable enable

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Text;
using System.Text.Json.Serialization;
using SwallowKitBackendModels.Client;

namespace SwallowKitBackendModels.Model
{
    /// <summary>
    /// ${model.name}
    /// </summary>
    public partial class ${model.name} : IValidatableObject
    {
        [JsonConstructor]
        public ${model.name}(${constructorParams})
        {
${constructorAssignments}
        }

        partial void OnCreated();
${enumBlocks ? `\n\n${enumBlocks}` : ""}

${propertyBlocks}

        public override string ToString()
        {
            var sb = new StringBuilder();
            sb.Append("class ${model.name} {\\n");
${toStringBody}
            sb.Append("}\\n");
            return sb.ToString();
        }

        IEnumerable<ValidationResult> IValidatableObject.Validate(ValidationContext validationContext)
        {
            yield break;
        }
    }
}
`;
}

function getPythonTypeName(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  if (field.isArray) {
    return `List[${getPythonArrayElementType(field)}]`;
  }

  switch (field.type) {
    case "string":
      return isDateLikeField(field) ? "datetime" : "StrictStr";
    case "number":
      return "Union[StrictFloat, StrictInt]";
    case "boolean":
      return "StrictBool";
    case "date":
      return "datetime";
    case "object":
      return "Dict[str, Any]";
    default:
      return "Any";
  }
}

function getPythonArrayElementType(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  switch (field.type) {
    case "string":
      return isDateLikeField(field) ? "datetime" : "StrictStr";
    case "number":
      return "Union[StrictFloat, StrictInt]";
    case "boolean":
      return "StrictBool";
    case "date":
      return "datetime";
    case "object":
      return "Dict[str, Any]";
    default:
      return "Any";
  }
}

function buildPythonFieldDeclaration(field: ModelInfo["fields"][number]): string {
  const pythonName = toSnakeCase(field.name);
  const typeName = field.isOptional ? `Optional[${getPythonTypeName(field)}]` : getPythonTypeName(field);
  const aliasSuffix = pythonName !== field.name ? `, alias="${field.name}"` : "";

  if (field.isOptional) {
    return `${pythonName}: ${typeName} = Field(default=None${aliasSuffix})`;
  }

  if (aliasSuffix) {
    return `${pythonName}: ${typeName} = Field(${aliasSuffix.slice(2)})`;
  }

  return `${pythonName}: ${typeName}`;
}

function buildPythonEnumValidators(model: ModelInfo): string {
  return model.fields
    .filter((field) => field.enumValues?.length)
    .map((field) => {
      const pythonName = toSnakeCase(field.name);
      const enumSet = field.enumValues!.map((value) => `'${value}'`).join(", ");
      return `    @field_validator('${pythonName}')
    def ${pythonName}_validate_enum(cls, value):
        """Validates the enum"""
        if value is None:
            return value

        if value not in set([${enumSet}]):
            raise ValueError("must be one of enum values (${field.enumValues!.map((value) => `'${value}'`).join(", ")})")
        return value`;
    })
    .join("\n\n");
}

function buildPythonModelImports(model: ModelInfo): string {
  const nestedImports = Array.from(
    new Set(
      model.fields
        .filter((field) => field.isNestedSchema && field.nestedModelName)
        .map((field) => field.nestedModelName!)
    )
  )
    .map((modelName) => `from .${toSnakeCase(modelName)} import ${modelName}`)
    .join("\n");

  return nestedImports ? `${nestedImports}\n\n` : "";
}

function generateLegacyCompatiblePythonModelSource(model: ModelInfo): string {
  const fieldDeclarations = model.fields.map((field) => `    ${buildPythonFieldDeclaration(field)}`).join("\n");
  const propertyNames = model.fields.map((field) => `"${field.name}"`).join(", ");
  const validators = buildPythonEnumValidators(model);
  const dictAssignments = model.fields
    .map((field) => `            "${field.name}": obj.get("${field.name}")`)
    .join(",\n");

  return `# coding: utf-8

"""
    ${model.name} API

    Generated from SwallowKit Zod model metadata.

    The version of the OpenAPI document: 1.0.0
    Generated by native SwallowKit schema compatibility layer

    Do not edit the class manually.
"""  # noqa: E501


from __future__ import annotations
import pprint
import re  # noqa: F401
import json

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr, field_validator
from typing import Any, ClassVar, Dict, List, Optional, Set, Union
from typing_extensions import Self

${buildPythonModelImports(model)}class ${model.name}(BaseModel):
    """
    ${model.name}
    """ # noqa: E501
${fieldDeclarations}
    __properties: ClassVar[List[str]] = [${propertyNames}]
${validators ? `\n\n${validators}` : ""}

    model_config = ConfigDict(
        populate_by_name=True,
        validate_assignment=True,
        protected_namespaces=(),
    )


    def to_str(self) -> str:
        """Returns the string representation of the model using alias"""
        return pprint.pformat(self.model_dump(by_alias=True))

    def to_json(self) -> str:
        """Returns the JSON representation of the model using alias"""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> Optional[Self]:
        """Create an instance of ${model.name} from a JSON string"""
        return cls.from_dict(json.loads(json_str))

    def to_dict(self) -> Dict[str, Any]:
        """Return the dictionary representation of the model using alias."""
        excluded_fields: Set[str] = set([
        ])

        _dict = self.model_dump(
            by_alias=True,
            exclude=excluded_fields,
            exclude_none=True,
        )
        return _dict

    @classmethod
    def from_dict(cls, obj: Optional[Dict[str, Any]]) -> Optional[Self]:
        """Create an instance of ${model.name} from a dict"""
        if obj is None:
            return None

        if not isinstance(obj, dict):
            return cls.model_validate(obj)

        _obj = cls.model_validate({
${dictAssignments}
        })
        return _obj


`;
}

function buildGeneratedPythonPackageInitSource(models: ModelInfo[]): string {
  return models.map((model) => `from .models.${toSnakeCase(model.name)} import ${model.name}`).join("\n") + "\n";
}

function buildGeneratedPythonModelsInitSource(models: ModelInfo[]): string {
  return models.map((model) => `from .${toSnakeCase(model.name)} import ${model.name}`).join("\n") + "\n";
}

function mergePythonInitSource(existingSource: string | undefined, generatedSource: string): string {
  if (!existingSource) {
    return generatedSource;
  }

  const existingLines = existingSource.split(/\r?\n/);
  const lineSet = new Set(existingLines);
  const missingLines = generatedSource
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !lineSet.has(line));

  if (missingLines.length === 0) {
    return existingSource.endsWith("\n") ? existingSource : `${existingSource}\n`;
  }

  const normalizedExisting = existingSource.endsWith("\n") ? existingSource : `${existingSource}\n`;
  return `${normalizedExisting}${missingLines.join("\n")}\n`;
}

function writeMergedPythonInitFile(
  filePath: string,
  generatedSource: string,
  session: FileOperationSession,
  sourceModel: string
): void {
  const existingSource = session.fileExists(filePath) ? session.readFile(filePath) : undefined;
  session.writeFile(filePath, mergePythonInitSource(existingSource, generatedSource), {
    ownership: "extension-point",
    generator: "native-schema",
    sourceModel,
  });
}

function ensureCSharpCodegenProjectFiles(
  functionsRoot: string,
  session: FileOperationSession,
  sourceModel: string
): void {
  const toolManifestPath = path.join(functionsRoot, ".config", "dotnet-tools.json");
  if (!session.fileExists(toolManifestPath)) {
    session.writeFile(toolManifestPath, buildCSharpCodegenToolManifestSource(), {
      ownership: "generated-once",
      generator: "native-schema",
      sourceModel,
    });
  }
}

function ensurePythonCodegenProjectFiles(
  functionsRoot: string,
  session: FileOperationSession,
  sourceModel: string
): string {
  const requirementsPath = path.join(functionsRoot, "requirements.codegen.txt");
  if (!session.fileExists(requirementsPath)) {
    session.writeFile(requirementsPath, buildPythonCodegenRequirementsSource(), {
      ownership: "generated-once",
      generator: "native-schema",
      sourceModel,
    });
  }
  return requirementsPath;
}

function getVirtualEnvPythonPath(venvDir: string): string {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

async function ensureProjectLocalUvCommand(projectRoot: string): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  const uvEnv = buildProjectLocalUvEnv(process.env, projectRoot);
  const { localUvExecutable } = getProjectLocalUvPaths(projectRoot);

  if (canRun("uv", ["--version"], projectRoot)) {
    return { command: "uv", env: uvEnv };
  }

  if (fs.existsSync(localUvExecutable) && canRun(localUvExecutable, ["--version"], projectRoot)) {
    return { command: localUvExecutable, env: uvEnv };
  }

  const installer = getProjectLocalUvInstallerCommand();
  await runCommand(
    installer.command,
    installer.args,
    projectRoot,
    "Failed to install project-local uv.",
    buildProjectLocalUvInstallerEnv(process.env, projectRoot)
  );

  if (!(fs.existsSync(localUvExecutable) && canRun(localUvExecutable, ["--version"], projectRoot))) {
    throw new Error("Failed to install project-local uv.");
  }

  return { command: localUvExecutable, env: uvEnv };
}

async function ensurePythonCodegenEnvironment(functionsRoot: string, requirementsPath: string): Promise<string> {
  const projectRoot = getPythonProjectRoot(functionsRoot);
  const { command: uvCommand, env: uvEnv } = await ensureProjectLocalUvCommand(projectRoot);
  const venvDir = path.join(functionsRoot, ".codegen-venv");
  const venvPython = getVirtualEnvPythonPath(venvDir);

  if (!canRun(venvPython, ["--version"], functionsRoot, uvEnv)) {
    const venvArgs = buildUvVenvArgs(venvDir);
    if (fs.existsSync(venvDir)) {
      venvArgs.push("--clear");
    }

    await runCommand(
      uvCommand,
      venvArgs,
      functionsRoot,
      "Failed to create the Python schema code generation virtual environment.",
      uvEnv
    );
  }

  if (!canRun(venvPython, ["-c", "import datamodel_code_generator"], functionsRoot, uvEnv)) {
    await runCommand(
      uvCommand,
      buildUvPipInstallArgs(venvPython, requirementsPath),
      functionsRoot,
      "Failed to install Python schema generation dependencies.",
      uvEnv
    );
  }

  return venvPython;
}

/**
 * 外部 codegen toolchain の事前検証。プロジェクトには一切書き込まず、
 * OS 一時ディレクトリ上で NSwag / datamodel-code-generator を実行して失敗を早期検出する。
 */
export async function validateNativeSchemaToolchain(
  models: ModelInfo[],
  rootModel: ModelInfo,
  backendLanguage: Exclude<BackendLanguage, "typescript">,
  functionsRoot: string
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-native-codegen-"));
  try {
    const specPath = path.join(tempDir, `${toKebabCase(rootModel.name)}.openapi.json`);
    fs.writeFileSync(specPath, generateOpenApiDocument(models, rootModel), "utf-8");

    if (backendLanguage === "csharp") {
      if (!canRun("dotnet", ["--version"], tempDir)) {
        throw new Error(
          "The .NET SDK is required to generate C# backend schema assets.\n" +
            "Install the .NET 8 SDK and retry."
        );
      }

      // プロジェクトの tool manifest（バージョン固定）があればそれを尊重し、なければ一時 manifest で検証する
      const projectManifestPath = path.join(functionsRoot, ".config", "dotnet-tools.json");
      let toolCwd = functionsRoot;
      if (!fs.existsSync(projectManifestPath)) {
        fs.mkdirSync(path.join(tempDir, ".config"), { recursive: true });
        fs.writeFileSync(path.join(tempDir, ".config", "dotnet-tools.json"), buildCSharpCodegenToolManifestSource(), "utf-8");
        toolCwd = tempDir;
      }

      await runCommand("dotnet", ["tool", "restore"], toolCwd, "Failed to restore the NSwag dotnet tool.");
      await runCommand(
        "dotnet",
        getCSharpNativeGeneratorArgs(specPath, path.join(tempDir, "Contracts.cs")),
        toolCwd,
        "NSwag failed to generate C# backend schema assets."
      );
    } else {
      const projectRequirementsPath = path.join(functionsRoot, "requirements.codegen.txt");
      let requirementsPath = projectRequirementsPath;
      if (!fs.existsSync(projectRequirementsPath)) {
        requirementsPath = path.join(tempDir, "requirements.codegen.txt");
        fs.writeFileSync(requirementsPath, buildPythonCodegenRequirementsSource(), "utf-8");
      }

      // .codegen-venv は environment cache であり managed artifact ではない(既存挙動どおり functionsRoot 配下)
      fs.mkdirSync(functionsRoot, { recursive: true });
      const pythonExecutable = await ensurePythonCodegenEnvironment(functionsRoot, requirementsPath);
      await runCommand(
        pythonExecutable,
        getPythonNativeGeneratorArgs(specPath, path.join(tempDir, "models.py")),
        functionsRoot,
        "datamodel-code-generator failed to generate Python backend schema assets."
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function generateCSharpSchemaArtifacts(
  models: ModelInfo[],
  outputDir: string,
  functionsRoot: string,
  session: FileOperationSession,
  sourceModel: string
): Promise<void> {
  ensureCSharpCodegenProjectFiles(functionsRoot, session, sourceModel);

  const optionPath = getCSharpSchemaOptionPath(outputDir);
  session.writeFile(optionPath, generateLegacyCompatibleOptionSource(), {
    ownership: "managed",
    generator: "native-schema",
    sourceModel,
  });

  for (const model of models) {
    const modelPath = getCSharpSchemaModelPath(outputDir, model.name);
    session.writeFile(modelPath, generateLegacyCompatibleCSharpModelSource(model), {
      ownership: "managed",
      generator: "native-schema",
      sourceModel,
    });
  }
}

async function generatePythonSchemaArtifacts(
  models: ModelInfo[],
  outputDir: string,
  functionsRoot: string,
  session: FileOperationSession,
  sourceModel: string
): Promise<void> {
  ensurePythonCodegenProjectFiles(functionsRoot, session, sourceModel);

  const packageRoot = path.join(outputDir, "backend_models");
  const modelsRoot = path.join(packageRoot, "models");
  writeMergedPythonInitFile(
    path.join(packageRoot, "__init__.py"),
    buildGeneratedPythonPackageInitSource(models),
    session,
    sourceModel
  );
  writeMergedPythonInitFile(
    path.join(modelsRoot, "__init__.py"),
    buildGeneratedPythonModelsInitSource(models),
    session,
    sourceModel
  );

  for (const model of models) {
    const modelPath = getPythonSchemaModelPath(outputDir, model.name);
    session.writeFile(modelPath, generateLegacyCompatiblePythonModelSource(model), {
      ownership: "managed",
      generator: "native-schema",
      sourceModel,
    });
  }
}

export async function generateLanguageSchemaArtifacts(
  models: ModelInfo[],
  rootModel: ModelInfo,
  functionsDir: string,
  backendLanguage: Exclude<BackendLanguage, "typescript">,
  session: FileOperationSession = new FileOperationSession("commit")
): Promise<void> {
  const planning = session.mode === "collect";
  console.log(
    planning
      ? "\n\ud83e\uddec Planning OpenAPI export and native schema assets..."
      : "\n\ud83e\uddec Generating OpenAPI export and native schema assets..."
  );

  const projectRoot = process.cwd();
  const functionsRoot = path.join(projectRoot, functionsDir);
  const openApiDir = path.join(functionsRoot, "openapi");

  const specPath = path.join(openApiDir, `${toKebabCase(rootModel.name)}.openapi.json`);
  session.writeFile(specPath, generateOpenApiDocument(models, rootModel), {
    ownership: "managed",
    generator: "native-schema",
    sourceModel: rootModel.name,
  });
  console.log(planning ? `\ud83d\udccb Will create: ${specPath}` : `\u2705 Created: ${specPath}`);

  const outputDir = path.join(
    functionsRoot,
    "generated",
    backendLanguage === "csharp" ? "csharp-models" : "python-models"
  );

  if (backendLanguage === "csharp") {
    await generateCSharpSchemaArtifacts(models, outputDir, functionsRoot, session, rootModel.name);
  } else {
    await generatePythonSchemaArtifacts(models, outputDir, functionsRoot, session, rootModel.name);
  }

  console.log(
    planning
      ? `\ud83d\udccb Will generate ${backendLanguage} schema assets: ${outputDir}`
      : `\u2705 Generated ${backendLanguage} schema assets: ${outputDir}`
  );
}
