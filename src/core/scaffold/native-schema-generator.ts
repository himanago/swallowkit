import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";
import { BackendLanguage } from "../../types";
import { FileOperationSession } from "../operations/file-session";
import { ModelInfo, toKebabCase } from "./model-parser";
import { expandInlineObjectModels, generateOpenApiDocument } from "./openapi-generator";
import {
  buildProjectLocalUvInstallerEnv,
  buildUvPipInstallArgs,
  buildPythonCodegenInstallEnv,
  ensureUvVirtualEnvironment,
  getProjectLocalUvInstallerCommand,
  getProjectLocalUvPaths,
  getPythonProjectRoot,
} from "../../utils/python-uv";

export const NSWAG_CONSOLECORE_VERSION = "14.7.1";
export const PYTHON_SCHEMA_CODEGEN_REQUIREMENT = "datamodel-code-generator>=0.44.0,<1.0.0";
const PYTHON_OUTPUT_MODEL_TYPE = "pydantic_v2.BaseModel";
// Preserve model syntax compatibility with existing deployments, not the tool's interpreter.
const PYTHON_MODEL_SYNTAX_VERSION = "3.11";

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

interface CSharpEnumMember {
  value: string;
  name: string;
}

const CSHARP_RESERVED_IDENTIFIERS = new Set([
  "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
  "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else",
  "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for", "foreach",
  "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock", "long",
  "namespace", "new", "null", "object", "operator", "out", "override", "params", "private",
  "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short", "sizeof",
  "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true", "try",
  "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "virtual", "void",
  "volatile", "while",
]);

function toCSharpEnumMemberBase(value: string): string {
  const encoded = Array.from(value)
    .map((character) => {
      if (/^[A-Za-z0-9_-]$/.test(character)) return character;
      if (/^\s$/.test(character)) return "-";
      return `-U${character.codePointAt(0)!.toString(16).toUpperCase()}-`;
    })
    .join("");
  let identifier = toPascalIdentifier(encoded).replace(/[^A-Za-z0-9_]/g, "");
  if (!identifier) identifier = "Value";
  if (/^[0-9]/.test(identifier)) identifier = `Value${identifier}`;
  if (CSHARP_RESERVED_IDENTIFIERS.has(identifier)) identifier = `Value${identifier}`;
  return identifier;
}

function buildCSharpEnumMemberMap(values: string[], enumType: string): CSharpEnumMember[] {
  const uniqueValues = [...new Set(values)];
  const bases = uniqueValues.map((value) => ({ value, base: toCSharpEnumMemberBase(value) }));
  const baseCounts = new Map<string, number>();
  for (const entry of bases) baseCounts.set(entry.base, (baseCounts.get(entry.base) ?? 0) + 1);

  return bases.map(({ value, base }) => {
    let name = base;
    if ((baseCounts.get(base) ?? 0) > 1 || name === enumType) {
      name = `${base}_${Buffer.from(value, "utf-8").toString("hex").toUpperCase() || "Empty"}`;
    }
    return { value, name };
  });
}

function csharpStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/** Date/time types are used only when the Zod schema declares them (z.iso.datetime(), z.iso.date(), z.date()). */
function getCSharpScalarType(field: ModelInfo["fields"][number]): string {
  switch (field.type) {
    case "string":
      return field.format === "date-time" ? "DateTime" : field.format === "date" ? "DateOnly" : "string";
    case "number":
      return field.isInteger ? "long" : "double";
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
    PYTHON_MODEL_SYNTAX_VERSION,
    "--disable-timestamp",
    "--use-union-operator",
    "--collapse-root-models",
  ];
}

function getCSharpFieldBaseType(field: ModelInfo["fields"][number]): string {
  // Arrays first: arrays of nested models or enums are lists of the element type.
  if (field.isArray) {
    return `List<${getCSharpArrayElementType(field)}>`;
  }

  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  if (field.enumValues?.length) {
    return `${toPascalIdentifier(field.name)}Enum`;
  }

  return getCSharpScalarType(field);
}

function getCSharpArrayElementType(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  if (field.enumValues?.length) {
    return `${toPascalIdentifier(field.name)}Enum`;
  }

  return getCSharpScalarType(field);
}

function getCSharpPropertyType(field: ModelInfo["fields"][number]): string {
  const baseType = getCSharpFieldBaseType(field);
  return field.isOptional || field.isNullable ? `${baseType}?` : baseType;
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

function buildCSharpEnumMembers(members: CSharpEnumMember[]): string {
  return members
    .map((member, index) => `            ${member.name} = ${index + 1}`)
    .join(",\n\n");
}

function buildCSharpEnumFromStringCases(
  field: ModelInfo["fields"][number],
  members: CSharpEnumMember[],
  nullable: boolean
): string {
  const enumType = `${toPascalIdentifier(field.name)}Enum`;
  return members
    .map((member) => `            if (value.Equals(${csharpStringLiteral(member.value)}, StringComparison.Ordinal))\n                return ${enumType}.${member.name};`)
    .join("\n\n") + (nullable ? `\n\n            return null;` : `\n\n            throw new NotImplementedException($"Could not convert value to type ${enumType}: '{value}'");`);
}

function buildCSharpEnumToJsonCases(field: ModelInfo["fields"][number], members: CSharpEnumMember[]): string {
  const enumType = `${toPascalIdentifier(field.name)}Enum`;
  return members
    .map((member) => `            if (value == ${enumType}.${member.name})\n                return ${csharpStringLiteral(member.value)};`)
    .join("\n\n");
}

function csharpNumberLiteral(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value}d`;
}

function csharpRegexOptions(flags: string | undefined): string {
  const options = [
    flags?.includes("i") ? "RegexOptions.IgnoreCase" : null,
    flags?.includes("m") ? "RegexOptions.Multiline" : null,
    flags?.includes("s") ? "RegexOptions.Singleline" : null,
  ].filter(Boolean);
  return options.length > 0 ? options.join(" | ") : "RegexOptions.None";
}

function isCSharpReferenceType(field: ModelInfo["fields"][number]): boolean {
  if (field.isArray || field.isNestedSchema || field.type === "object") return true;
  if (field.enumValues?.length) return false;
  return field.type === "string" && field.format !== "date-time" && field.format !== "date";
}

/**
 * Translate Zod constraints into IValidatableObject checks. Regexes use search semantics like
 * Zod's RegExp.test. String formats (email/uuid/url) and value-type presence stay with Zod.
 */
function buildCSharpValueChecks(
  field: ModelInfo["fields"][number],
  accessor: string,
  member: string,
  optionalValue: boolean
): string[] {
  const constraints = field.constraints ?? {};
  const checks: string[] = [];
  const add = (condition: string, message: string) =>
    checks.push(`if (${condition})\n                yield return new ValidationResult(${csharpStringLiteral(message)}, new[] { ${member} });`);

  if (field.isNestedSchema && field.nestedModelName) {
    // Pattern variables in an if condition stay in scope for the enclosing block, so keep names unique.
    const variable = `validated${toPascalIdentifier(field.name)}${accessor === "item" ? "Item" : ""}`;
    checks.push(`if (${accessor} is IValidatableObject ${variable})\n                foreach (var ${variable}Result in ${variable}.Validate(new ValidationContext(${accessor})))\n                    yield return new ValidationResult(${variable}Result.ErrorMessage, ${variable}Result.MemberNames.Select(name => ${member} + "." + name).ToArray());`);
    return checks;
  }
  if (field.enumValues?.length) return checks;

  if (field.type === "string" && field.format !== "date-time" && field.format !== "date") {
    if (constraints.minLength !== undefined) add(`${accessor} != null && ${accessor}.Length < ${constraints.minLength}`, `${field.name} must contain at least ${constraints.minLength} character(s).`);
    if (constraints.maxLength !== undefined) add(`${accessor} != null && ${accessor}.Length > ${constraints.maxLength}`, `${field.name} must contain at most ${constraints.maxLength} character(s).`);
    if (constraints.pattern !== undefined) {
      add(
        `${accessor} != null && !Regex.IsMatch(${accessor}, ${csharpStringLiteral(constraints.pattern)}, ${csharpRegexOptions(constraints.patternFlags)})`,
        `${field.name} must match /${constraints.pattern}/${constraints.patternFlags ?? ""}.`
      );
    }
  }

  if (field.type === "number") {
    const value = optionalValue ? `${accessor}.Value` : accessor;
    const guard = optionalValue ? `${accessor}.HasValue && ` : "";
    if (constraints.minimum !== undefined) {
      add(`${guard}${value} ${constraints.exclusiveMinimum ? "<=" : "<"} ${csharpNumberLiteral(constraints.minimum)}`,
        `${field.name} must be ${constraints.exclusiveMinimum ? "greater than" : "greater than or equal to"} ${constraints.minimum}.`);
    }
    if (constraints.maximum !== undefined) {
      add(`${guard}${value} ${constraints.exclusiveMaximum ? ">=" : ">"} ${csharpNumberLiteral(constraints.maximum)}`,
        `${field.name} must be ${constraints.exclusiveMaximum ? "less than" : "less than or equal to"} ${constraints.maximum}.`);
    }
  }
  return checks;
}

function buildCSharpValidationBody(model: ModelInfo): string {
  const blocks: string[] = [];
  for (const field of model.fields) {
    const propertyName = toPascalIdentifier(field.name);
    const member = csharpStringLiteral(field.name);
    const constraints = field.constraints ?? {};

    // .nullable() fields accept null in Zod, so only non-nullable required references are rejected.
    if (!field.isOptional && !field.isNullable && isCSharpReferenceType(field)) {
      blocks.push(`if (${propertyName} is null)\n                yield return new ValidationResult(${csharpStringLiteral(`${field.name} is required.`)}, new[] { ${member} });`);
    }

    if (field.isArray) {
      if (constraints.minItems !== undefined) {
        blocks.push(`if (${propertyName} != null && ${propertyName}.Count < ${constraints.minItems})\n                yield return new ValidationResult(${csharpStringLiteral(`${field.name} must contain at least ${constraints.minItems} item(s).`)}, new[] { ${member} });`);
      }
      if (constraints.maxItems !== undefined) {
        blocks.push(`if (${propertyName} != null && ${propertyName}.Count > ${constraints.maxItems})\n                yield return new ValidationResult(${csharpStringLiteral(`${field.name} must contain at most ${constraints.maxItems} item(s).`)}, new[] { ${member} });`);
      }
      const itemChecks = buildCSharpValueChecks(
        { ...field, isArray: false },
        "item",
        `${member} + "[" + index + "]"`,
        false
      );
      if (itemChecks.length > 0) {
        blocks.push(`if (${propertyName} != null)\n            {\n                for (var index = 0; index < ${propertyName}.Count; index++)\n                {\n                    var item = ${propertyName}[index];\n${itemChecks.map((check) => `                    ${check.replace(/\n {16}/g, "\n                        ").replace(/\n {20}/g, "\n                            ")}`).join("\n")}\n                }\n            }`);
      }
      continue;
    }

    const optionalValue = (field.isOptional || field.isNullable === true) && !isCSharpReferenceType(field);
    blocks.push(...buildCSharpValueChecks(field, propertyName, member, optionalValue));
  }

  return blocks.length > 0
    ? blocks.map((block) => `            ${block}`).join("\n\n")
    : "            yield break;";
}

function generateLegacyCompatibleCSharpModelSource(model: ModelInfo): string {
  const requiredFields = model.fields.filter((field) => !field.isOptional);
  const optionalFields = model.fields.filter((field) => field.isOptional);

  const constructorParams = [
    ...requiredFields.map((field) => `${getCSharpPropertyType(field)} ${field.name}`),
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
      const enumMembers = buildCSharpEnumMemberMap(field.enumValues!, enumType);
      return `        /// <summary>
        /// Defines ${toPascalIdentifier(field.name)}
        /// </summary>
        [JsonConverter(typeof(${enumType}JsonConverter))]
        public enum ${enumType}
        {
${buildCSharpEnumMembers(enumMembers)}
        }

        public static ${enumType} ${enumType}FromString(string value)
        {
${buildCSharpEnumFromStringCases(field, enumMembers, false)}
        }

        public static ${enumType}? ${enumType}FromStringOrDefault(string value)
        {
${buildCSharpEnumFromStringCases(field, enumMembers, true)}
        }

        public static string ${enumType}ToJsonValue(${enumType}? value)
        {
${buildCSharpEnumToJsonCases(field, enumMembers)}

            throw new NotImplementedException($"Value could not be handled: '{value}'");
        }

        /// <summary>
        /// Reads and writes ${enumType} with the exact Zod enum values.
        /// </summary>
        public sealed class ${enumType}JsonConverter : JsonConverter<${enumType}>
        {
            public override ${enumType} Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            {
                var value = reader.GetString();
                var parsed = value == null ? null : ${enumType}FromStringOrDefault(value);
                return parsed ?? throw new JsonException($"Unsupported ${enumType} value: '{value}'");
            }

            public override void Write(Utf8JsonWriter writer, ${enumType} value, JsonSerializerOptions options)
                => writer.WriteStringValue(${enumType}ToJsonValue(value));
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
        [JsonPropertyName("${field.name}")]${field.isNullable ? "" : `
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`}
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
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SwallowKitBackendModels.Client;

namespace SwallowKitBackendModels.Model
{
    /// <summary>
    /// ${model.name}
    /// </summary>
    public partial class ${model.name} : IValidatableObject
    {
        /// <summary>
        /// Used by System.Text.Json. Optional values are marked as set only when present in the JSON.
        /// </summary>
#pragma warning disable CS8618
        [JsonConstructor]
        public ${model.name}()
        {
            OnCreated();
        }
#pragma warning restore CS8618
${constructorParams ? `
        public ${model.name}(${constructorParams})
        {
${constructorAssignments}
        }
` : ""}
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
${buildCSharpValidationBody(model)}
        }
    }
}
`;
}

function getPythonScalarType(field: ModelInfo["fields"][number]): string {
  switch (field.type) {
    case "string":
      return field.format === "date-time" ? "datetime" : field.format === "date" ? "date" : "StrictStr";
    case "number":
      return field.isInteger ? "StrictInt" : "Union[StrictFloat, StrictInt]";
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

/** pydantic Field bounds for a scalar value (string length or numeric range). */
function getPythonValueConstraintArgs(field: ModelInfo["fields"][number]): string[] {
  const constraints = field.constraints ?? {};
  if (field.enumValues?.length || field.isNestedSchema) return [];
  const args: string[] = [];
  if (field.type === "string" && field.format !== "date-time" && field.format !== "date") {
    if (constraints.minLength !== undefined) args.push(`min_length=${constraints.minLength}`);
    if (constraints.maxLength !== undefined) args.push(`max_length=${constraints.maxLength}`);
  }
  if (field.type === "number") {
    if (constraints.minimum !== undefined) args.push(`${constraints.exclusiveMinimum ? "gt" : "ge"}=${constraints.minimum}`);
    if (constraints.maximum !== undefined) args.push(`${constraints.exclusiveMaximum ? "lt" : "le"}=${constraints.maximum}`);
  }
  return args;
}

function getPythonArrayElementType(field: ModelInfo["fields"][number]): string {
  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  const elementType = getPythonScalarType(field);
  const elementArgs = getPythonValueConstraintArgs(field);
  return elementArgs.length > 0 ? `Annotated[${elementType}, Field(${elementArgs.join(", ")})]` : elementType;
}

function getPythonTypeName(field: ModelInfo["fields"][number]): string {
  if (field.isArray) {
    return `List[${getPythonArrayElementType(field)}]`;
  }

  if (field.isNestedSchema && field.nestedModelName) {
    return field.nestedModelName;
  }

  return getPythonScalarType(field);
}

function buildPythonFieldDeclaration(field: ModelInfo["fields"][number]): string {
  const pythonName = toSnakeCase(field.name);
  const typeName = field.isOptional ? `Optional[${getPythonTypeName(field)}]` : getPythonTypeName(field);
  const fieldArgs = [
    ...(field.isOptional ? ["default=None"] : []),
    ...(pythonName !== field.name ? [`alias="${field.name}"`] : []),
    ...(field.isArray
      ? [
          ...(field.constraints?.minItems !== undefined ? [`min_length=${field.constraints.minItems}`] : []),
          ...(field.constraints?.maxItems !== undefined ? [`max_length=${field.constraints.maxItems}`] : []),
        ]
      : getPythonValueConstraintArgs(field)),
  ];

  return fieldArgs.length > 0
    ? `${pythonName}: ${typeName} = Field(${fieldArgs.join(", ")})`
    : `${pythonName}: ${typeName}`;
}

function buildPythonRegexFlags(flags: string | undefined): string {
  const values = [
    flags?.includes("i") ? "re.IGNORECASE" : null,
    flags?.includes("m") ? "re.MULTILINE" : null,
    flags?.includes("s") ? "re.DOTALL" : null,
  ].filter(Boolean);
  return values.length > 0 ? values.join(" | ") : "0";
}

export type PythonRegexTranslation = { pattern: string } | { unsupported: string };

/**
 * Translates a JavaScript regex (as used by Zod) to Python `re` syntax. Constructs Python cannot
 * express identically are reported as unsupported so the validator is skipped instead of breaking imports.
 */
export function toPythonRegex(pattern: string, flags = ""): PythonRegexTranslation {
  const unsupportedFlags = [...flags].filter((flag) => !"imsgu".includes(flag));
  if (unsupportedFlags.length > 0) return { unsupported: `flag(s) ${unsupportedFlags.join("")} have no Python equivalent` };
  const checks: Array<[RegExp, string]> = [
    [/\\[pP]\{/, "Unicode property escapes (\\p{...})"],
    [/\\u\{/, "code point escapes (\\u{...})"],
    [/\\c[A-Za-z]/, "control escapes (\\cX)"],
    [/\(\?<[=!]/, "lookbehind (JavaScript allows variable width; Python does not)"],
    [/\[\^?\]/, "empty character classes ([] / [^])"],
  ];
  for (const [construct, label] of checks) {
    if (construct.test(pattern)) return { unsupported: label };
  }
  return {
    pattern: pattern
      .replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?P<$1>")
      .replace(/\\k<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?P=$1)"),
  };
}

function pythonRegexFields(model: ModelInfo): Array<{ field: ModelInfo["fields"][number]; translation: PythonRegexTranslation }> {
  return model.fields
    .filter((field) => field.type === "string" && !field.enumValues?.length && field.constraints?.pattern !== undefined)
    .map((field) => ({ field, translation: toPythonRegex(field.constraints!.pattern!, field.constraints!.patternFlags) }));
}

export function getPythonRegexWarnings(model: ModelInfo): string[] {
  return pythonRegexFields(model)
    .filter((entry): entry is { field: ModelInfo["fields"][number]; translation: { unsupported: string } } => "unsupported" in entry.translation)
    .map(({ field, translation }) =>
      `python-regex-not-enforced: ${model.name}.${field.name} uses ${translation.unsupported}; the Python model does not enforce /${field.constraints!.pattern}/. The BFF Zod schema still validates it.`);
}

/**
 * Zod regex checks use RegExp.test (search), so validators use re.search instead of pydantic's anchored pattern.
 * They run before type conversion so date/time strings are checked as the JSON text Zod sees; non-string
 * values are left to the field's own type validation.
 */
function buildPythonPatternValidators(model: ModelInfo): string {
  return pythonRegexFields(model)
    .filter((entry): entry is { field: ModelInfo["fields"][number]; translation: { pattern: string } } => "pattern" in entry.translation)
    .map(({ field, translation }) => {
      const pythonName = toSnakeCase(field.name);
      const pattern = JSON.stringify(translation.pattern);
      const flags = buildPythonRegexFlags(field.constraints!.patternFlags);
      const message = JSON.stringify(`${field.name} must match /${field.constraints!.pattern}/${field.constraints!.patternFlags ?? ""}`);
      return `    @field_validator('${pythonName}', mode='before')
    def ${pythonName}_validate_pattern(cls, value):
        """Validates the Zod regex constraint"""
        if value is None:
            return value

        for item in (value if isinstance(value, list) else [value]):
            if isinstance(item, str) and not re.search(${pattern}, item, ${flags}):
                raise ValueError(${message})
        return value`;
    })
    .join("\n\n");
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
  const validators = [buildPythonEnumValidators(model), buildPythonPatternValidators(model)].filter(Boolean).join("\n\n");
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

from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr, field_validator
from typing import Annotated, Any, ClassVar, Dict, List, Optional, Set, Union
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
        return self.model_dump_json(by_alias=True, exclude_none=True)

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

/** Generated backend_models import pydantic v2 at runtime, so the deployed Functions app must install it. */
export const PYTHON_SCHEMA_RUNTIME_REQUIREMENT = "pydantic>=2.6,<3";

function ensurePythonRuntimeRequirement(functionsRoot: string, session: FileOperationSession): void {
  const requirementsPath = path.join(functionsRoot, "requirements.txt");
  const current = session.fileExists(requirementsPath) ? session.readFile(requirementsPath) : "";
  const declared = current.split(/\r?\n/).some((line) => line.trim().split(/[<>=!~;[ ]/)[0].toLowerCase() === "pydantic");
  if (declared) return;
  const prefix = current && !current.endsWith("\n") ? `${current}\n` : current;
  session.writeFile(requirementsPath, `${prefix}${PYTHON_SCHEMA_RUNTIME_REQUIREMENT}\n`, {
    ownership: "extension-point",
    generator: "native-schema",
  });
}

async function ensureProjectLocalUvCommand(projectRoot: string): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  const uvEnv = { ...process.env };
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
  const venvPython = await ensureUvVirtualEnvironment(uvCommand, venvDir, functionsRoot, uvEnv);

  if (!canRun(venvPython, ["-c", "import datamodel_code_generator"], functionsRoot, uvEnv)) {
    await runCommand(
      uvCommand,
      buildUvPipInstallArgs(venvPython, requirementsPath),
      functionsRoot,
      "Failed to install Python schema generation dependencies.",
      buildPythonCodegenInstallEnv(uvEnv)
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
  ensurePythonRuntimeRequirement(functionsRoot, session);

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
    for (const warning of getPythonRegexWarnings(model)) {
      session.addWarning(warning);
      console.warn(`⚠️  ${warning}`);
    }
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

  // Inline z.object fields become named classes (e.g. ProbeItemNested) so their shape is preserved.
  const nativeModels = expandInlineObjectModels(models);
  if (backendLanguage === "csharp") {
    await generateCSharpSchemaArtifacts(nativeModels, outputDir, functionsRoot, session, rootModel.name);
  } else {
    await generatePythonSchemaArtifacts(nativeModels, outputDir, functionsRoot, session, rootModel.name);
  }

  console.log(
    planning
      ? `\ud83d\udccb Will generate ${backendLanguage} schema assets: ${outputDir}`
      : `\u2705 Generated ${backendLanguage} schema assets: ${outputDir}`
  );
}
