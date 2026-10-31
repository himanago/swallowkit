import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as z from "zod/v4";
import { FileOperationSession } from "../core/operations/file-session";
import { parseModelFile } from "../core/scaffold/model-parser";
import { generateLanguageSchemaArtifacts } from "../core/scaffold/native-schema-generator";
import { generateOpenApiDocument } from "../core/scaffold/openapi-generator";

const MODEL_SOURCE = `import { z } from 'zod/v4';
export const ProbeItem = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1).max(40),
  code: z.string().regex(/^[a-z]+-\\d+$/i).optional(),
  tags: z.array(z.string().min(2)).max(3),
  score: z.number().min(0).max(1),
  count: z.number().int().nonnegative(),
  kind: z.enum(['a', 'b']),
  nested: z.object({ x: z.string(), depth: z.object({ level: z.number().int() }).optional() }).optional(),
  publishedAt: z.iso.datetime().optional(),
  note: z.string().nullable(),
  rating: z.number().gt(0).min(0).lt(5).max(5).nullable(),
  items: z.array(z.object({ x: z.string().min(1) })).optional(),
  kinds: z.array(z.enum(['a', 'b'])).optional(),
  metadata: z.object({}).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ProbeItem = z.infer<typeof ProbeItem>;
export const partitionKey = '/userId';
export const displayName = 'Probe';
`;

// Same schema as MODEL_SOURCE; used to validate C# output exactly as the BFF responseSchema would.
const ProbeItem = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1).max(40),
  code: z.string().regex(/^[a-z]+-\d+$/i).optional(),
  tags: z.array(z.string().min(2)).max(3),
  score: z.number().min(0).max(1),
  count: z.number().int().nonnegative(),
  kind: z.enum(["a", "b"]),
  nested: z.object({ x: z.string(), depth: z.object({ level: z.number().int() }).optional() }).optional(),
  publishedAt: z.iso.datetime().optional(),
  note: z.string().nullable(),
  rating: z.number().gt(0).min(0).lt(5).max(5).nullable(),
  items: z.array(z.object({ x: z.string().min(1) })).optional(),
  kinds: z.array(z.enum(["a", "b"])).optional(),
  metadata: z.object({}).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const VALID_INPUTS = [
  {
    id: "1",
    userId: "user-1",
    title: "Probe",
    code: "ABC-12",
    tags: ["aa", "bb"],
    score: 0.25,
    count: 3,
    kind: "b",
    nested: { x: "value", depth: { level: 2 } },
    publishedAt: "2024-05-06T07:08:09.123Z",
    note: "note",
    rating: 2.5,
    items: [{ x: "a" }, { x: "b" }],
    kinds: ["a", "b"],
    metadata: {},
    createdAt: "2024-05-06T07:08:09.123456+09:00",
    updatedAt: "not a timestamp but still a string",
  },
  { id: "2", userId: "user-2", title: "Minimal", tags: [], score: 1, count: 0, kind: "a", note: null, rating: null },
];

const INVALID_INPUTS: Array<{ input: Record<string, unknown>; members: string[] }> = [
  { input: { ...VALID_INPUTS[1], title: "" }, members: ["title"] },
  { input: { ...VALID_INPUTS[1], title: "x".repeat(41) }, members: ["title"] },
  { input: { ...VALID_INPUTS[1], code: "no-digits" }, members: ["code"] },
  { input: { ...VALID_INPUTS[1], tags: ["a"] }, members: ["tags[0]"] },
  { input: { ...VALID_INPUTS[1], tags: ["aa", "bb", "cc", "dd"] }, members: ["tags"] },
  { input: { ...VALID_INPUTS[1], score: 1.5 }, members: ["score"] },
  { input: { ...VALID_INPUTS[1], count: -1 }, members: ["count"] },
  { input: { ...VALID_INPUTS[1], nested: { depth: { level: 1 } } }, members: ["nested.x"] },
  { input: { ...VALID_INPUTS[1], rating: 0 }, members: ["rating"] },
  { input: { ...VALID_INPUTS[1], rating: 5 }, members: ["rating"] },
  { input: { ...VALID_INPUTS[1], items: [{ x: "ok" }, { x: "" }] }, members: ["items[1].x"] },
];

function createModel(): { root: string; modelPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-csharp-schema-"));
  const modelPath = path.join(root, "shared", "models", "probe-item.ts");
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  fs.writeFileSync(modelPath, MODEL_SOURCE);
  return { root, modelPath };
}

describe("Zod -> OpenAPI -> C# conversion", () => {
  let root: string;
  let modelPath: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    ({ root, modelPath } = createModel());
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records formats, integers, constraints, and inline object shapes from Zod", async () => {
    const model = await parseModelFile(modelPath);
    const field = (name: string) => model.fields.find((candidate) => candidate.name === name)!;
    expect(model.parserMode).toBe("static-ast");
    expect(field("createdAt")).toMatchObject({ type: "string", isOptional: true });
    expect(field("createdAt").format).toBeUndefined();
    expect(field("publishedAt").format).toBe("date-time");
    expect(field("title").constraints).toEqual({ minLength: 1, maxLength: 40 });
    expect(field("code").constraints).toEqual({ pattern: "^[a-z]+-\\d+$", patternFlags: "i" });
    expect(field("tags").constraints).toEqual({ minLength: 2, maxItems: 3 });
    expect(field("score")).toMatchObject({ constraints: { minimum: 0, maximum: 1 } });
    expect(field("score").isInteger).toBeUndefined();
    expect(field("count")).toMatchObject({ isInteger: true, constraints: { minimum: 0 } });
    expect(field("nested").objectFields?.map((child) => child.name)).toEqual(["x", "depth"]);
    expect(field("nested").objectFields?.[1].objectFields?.[0]).toMatchObject({ name: "level", isInteger: true });
    expect(field("rating")).toMatchObject({
      isNullable: true,
      constraints: { minimum: 0, exclusiveMinimum: true, maximum: 5, exclusiveMaximum: true },
    });
    expect(field("metadata").objectFields).toEqual([]);
  });

  it("emits typed OpenAPI components without guessing formats from names", async () => {
    const model = await parseModelFile(modelPath);
    const schemas = JSON.parse(generateOpenApiDocument([model], model)).components.schemas;
    const properties = schemas.ProbeItem.properties;
    expect(properties.createdAt).toEqual({ type: "string" });
    expect(properties.publishedAt).toEqual({ type: "string", format: "date-time" });
    expect(properties.score).toEqual({ type: "number", format: "double", minimum: 0, maximum: 1 });
    expect(properties.count).toEqual({ type: "integer", format: "int64", minimum: 0 });
    expect(properties.title).toEqual({ type: "string", minLength: 1, maxLength: 40 });
    expect(properties.code).toEqual({ type: "string", pattern: "^[a-z]+-\\d+$" });
    expect(properties.tags).toEqual({ type: "array", items: { type: "string", minLength: 2 }, maxItems: 3 });
    expect(properties.nested).toEqual({ $ref: "#/components/schemas/ProbeItemNested" });
    expect(schemas.ProbeItemNested).toEqual({
      type: "object",
      properties: { x: { type: "string" }, depth: { $ref: "#/components/schemas/ProbeItemNestedDepth" } },
      required: ["x"],
    });
    expect(schemas.ProbeItemNestedDepth.properties.level).toEqual({ type: "integer", format: "int64" });
  });

  it("generates C# types and validation from the Zod contract", async () => {
    const model = await parseModelFile(modelPath);
    process.chdir(root);
    await generateLanguageSchemaArtifacts([model], model, "functions", "csharp", new FileOperationSession("commit", root));
    const modelDir = path.join(root, "functions", "generated", "csharp-models", "src", "SwallowKitBackendModels", "Model");
    const source = fs.readFileSync(path.join(modelDir, "ProbeItem.cs"), "utf8");

    expect(source).toContain("public string? CreatedAt");
    expect(source).toContain("public DateTime? PublishedAt");
    expect(source).toContain("public double Score");
    expect(source).toContain("public long Count");
    expect(source).toContain("public ProbeItemNested? Nested");
    expect(source).not.toMatch(/Dictionary<string, object>|decimal|DateTime\? CreatedAt/);
    expect(source).not.toContain("yield break;");
    expect(source).toContain('Title.Length < 1');
    expect(source).toContain('Regex.IsMatch(Code, "^[a-z]+-\\\\d+$", RegexOptions.IgnoreCase)');
    expect(source).toContain("Score > 1");
    expect(source).toContain("Count < 0");
    expect(fs.readFileSync(path.join(modelDir, "ProbeItemNested.cs"), "utf8")).toContain("public ProbeItemNestedDepth? Depth");
    expect(fs.readFileSync(path.join(modelDir, "ProbeItemNestedDepth.cs"), "utf8")).toContain("public long Level");
    expect(source).toContain("public string? Note");
    expect(source).not.toContain("if (Note is null)");
    expect(source).toContain("public double? Rating");
    expect(source).toContain("Rating.HasValue && Rating.Value <= 0");
    expect(source).toContain("public List<ProbeItemItems>? Items");
    expect(source).toContain("public List<KindsEnum>? Kinds");
    const metadata = fs.readFileSync(path.join(modelDir, "ProbeItemMetadata.cs"), "utf8");
    expect(metadata.match(/public ProbeItemMetadata\(\)/g)).toHaveLength(1);
  });
});

const dotnetVersion = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
const itWithDotnet = dotnetVersion.status === 0 ? it : it.skip;

describe("generated C# JSON round trip", () => {
  itWithDotnet("serializes back to JSON that passes the same Zod schema, and rejects what Zod rejects", async () => {
    const { root, modelPath } = createModel();
    const originalCwd = process.cwd();
    try {
      const model = await parseModelFile(modelPath);
      process.chdir(root);
      await generateLanguageSchemaArtifacts([model], model, "functions", "csharp", new FileOperationSession("commit", root));
      process.chdir(originalCwd);

      const app = path.join(root, "roundtrip");
      fs.mkdirSync(app);
      const major = String(dotnetVersion.stdout).trim().split(".")[0];
      fs.writeFileSync(path.join(app, "RoundTrip.csproj"), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net${major}.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="../functions/generated/csharp-models/**/*.cs" />
  </ItemGroup>
</Project>
`);
      fs.writeFileSync(path.join(app, "Program.cs"), `using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using SwallowKitBackendModels.Model;

var results = new List<object>();
foreach (var file in args)
{
    var item = JsonSerializer.Deserialize<ProbeItem>(File.ReadAllText(file))!;
    var errors = new List<ValidationResult>();
    Validator.TryValidateObject(item, new ValidationContext(item), errors, true);
    results.Add(new { json = JsonSerializer.Serialize(item), members = errors.SelectMany(error => error.MemberNames).ToArray() });
}
Console.WriteLine(JsonSerializer.Serialize(results));
`);
      const inputs = [...VALID_INPUTS, ...INVALID_INPUTS.map((entry) => entry.input)];
      const files = inputs.map((input, index) => {
        const file = path.join(root, `input-${index}.json`);
        fs.writeFileSync(file, JSON.stringify(input));
        return file;
      });
      const run = spawnSync("dotnet", ["run", "--project", app, "--", ...files], {
        encoding: "utf8",
        timeout: 240000,
        env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
      });
      if (run.status !== 0) throw new Error(`dotnet run failed (${run.status}):\n${run.stdout}\n${run.stderr}`);
      const output = JSON.parse(run.stdout.trim().split(/\r?\n/).pop()!) as Array<{ json: string; members: string[] }>;

      VALID_INPUTS.forEach((input, index) => {
        expect(ProbeItem.safeParse(input).success).toBe(true);
        expect(output[index].members).toEqual([]);
        const roundTripped = JSON.parse(output[index].json);
        expect(ProbeItem.safeParse(roundTripped).success).toBe(true);
        expect(roundTripped).toEqual(input);
      });
      INVALID_INPUTS.forEach(({ input, members }, offset) => {
        expect(ProbeItem.safeParse(input).success).toBe(false);
        expect(output[VALID_INPUTS.length + offset].members).toEqual(members);
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 300000);
});
