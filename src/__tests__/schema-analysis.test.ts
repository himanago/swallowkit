import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseModelFile } from "../core/scaffold/model-parser";
import { generateOpenApiDocument } from "../core/scaffold/openapi-generator";
import { generateListPage, generateFormComponent } from "../core/scaffold/ui-generator";
import { generateLanguageSchemaArtifacts } from "../core/scaffold/native-schema-generator";
import { FileOperationSession } from "../core/operations/file-session";
import { buildUserScopedDataWarning } from "../cli/commands/scaffold";
import { inspectCapabilities } from "../core/project/capabilities";

const repoRoot = path.resolve(__dirname, "..", "..");

function model(name: string, fields: string, extra = ""): string {
  const pascal = name.replace(/(^|-)([a-z])/g, (_, __, char: string) => char.toUpperCase());
  return `import { z } from 'zod/v4';
export const ${pascal} = z.object({
  id: z.string(),
${fields}
});
export type ${pascal} = z.infer<typeof ${pascal}>;
${extra}`;
}

describe("foreign-key inference", () => {
  let root: string;
  const write = (name: string, source: string) => {
    const file = path.join(root, "shared", "models", `${name}.ts`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return file;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-fk-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("does not treat userId as a foreign key when no User model exists", async () => {
    const info = await parseModelFile(write("probe-item", model("probe-item", "  userId: z.string(),\n  title: z.string(),", "export const partitionKey = '/userId';\n")));
    const userId = info.fields.find((field) => field.name === "userId")!;
    expect(userId.isForeignKey).toBeUndefined();
    expect(userId.referencedModel).toBeUndefined();
    expect(info.parserWarnings).toEqual([]);

    const list = generateListPage(info, "@sample/shared");
    const form = generateFormComponent(info, "@sample/shared");
    expect(list).not.toMatch(/api\/user|userMap/);
    expect(form).not.toMatch(/api\/user|userOptions/);
    const schema = JSON.parse(generateOpenApiDocument([info], info)).components.schemas;
    expect(schema.ProbeItem.properties.userId).toEqual({ type: "string" });
    expect(Object.keys(schema)).toEqual(["ProbeItem"]);
  });

  it("infers a foreign key when the referenced model exists", async () => {
    write("category", model("category", "  name: z.string(),"));
    const info = await parseModelFile(write("todo", model("todo", "  categoryId: z.string(),")));
    expect(info.fields.find((field) => field.name === "categoryId")).toMatchObject({ isForeignKey: true, referencedModel: "Category" });
    expect(generateListPage(info, "@sample/shared")).toContain("/api/category");
  });

  it("supports explicit references, opt-out, and warns about missing targets", async () => {
    write("user", model("user", "  name: z.string(),"));
    const info = await parseModelFile(write("post", model(
      "post",
      "  authorId: z.string(),\n  userId: z.string(),\n  reviewerId: z.string(),\n  tagIds: z.array(z.string()),",
      "export const references = { authorId: 'User', userId: false, reviewerId: 'Reviewer', tagIds: 'Tag', missingId: 'User' };\n"
    )));
    const field = (name: string) => info.fields.find((candidate) => candidate.name === name)!;
    expect(field("authorId")).toMatchObject({ isForeignKey: true, referencedModel: "User" });
    expect(field("userId").isForeignKey).toBeUndefined();
    expect(field("reviewerId").isForeignKey).toBeUndefined();
    expect(field("tagIds").isForeignKey).toBeUndefined();
    expect(info.parserWarnings).toEqual([
      "reference-model-not-found: Post.reviewerId references Reviewer, but shared/models has no Reviewer model; it is treated as a plain field.",
      "reference-field-unsupported: Post.tagIds must be a single string id to reference Tag.",
      "reference-field-not-found: Post.references declares missingId, but the schema has no such field.",
    ]);
  });

  it("documents the references declaration in capabilities", () => {
    expect(inspectCapabilities().modelDeclarations.map((declaration) => declaration.name)).toContain("references");
  });
});

describe("dynamic schema evaluation metadata", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-dynamic-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "sample", type: "module" }));
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.symlinkSync(path.join(repoRoot, "node_modules", "zod"), path.join(root, "node_modules", "zod"), "junction");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("extracts formats, integers, constraints, and inline objects from Zod v4 at runtime", async () => {
    const file = path.join(root, "shared", "models", "probe-item.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // startsWith() is outside the static subset, which forces runtime evaluation.
    fs.writeFileSync(file, model("probe-item", [
      "  userId: z.string().startsWith('u'),",
      "  title: z.string().min(1).max(5),",
      "  code: z.string().regex(/^a\\d$/i),",
      "  tags: z.array(z.string().min(2)).min(1),",
      "  score: z.number().gt(0).lte(1),",
      "  count: z.int(),",
      "  publishedAt: z.iso.datetime().optional(),",
      "  createdAt: z.string().optional(),",
      "  nested: z.object({ x: z.string() }).optional(),",
    ].join("\n")));

    const info = await parseModelFile(file);
    const field = (name: string) => info.fields.find((candidate) => candidate.name === name)!;
    expect(info.parserMode).toBe("dynamic");
    expect(field("userId").isForeignKey).toBeUndefined();
    expect(field("title").constraints).toEqual({ minLength: 1, maxLength: 5 });
    expect(field("code").constraints).toEqual({ pattern: "^a\\d$", patternFlags: "i" });
    expect(field("tags")).toMatchObject({ isArray: true, constraints: { minLength: 2, minItems: 1 } });
    expect(field("score").constraints).toEqual({ minimum: 0, exclusiveMinimum: true, maximum: 1 });
    expect(field("count").isInteger).toBe(true);
    expect(field("publishedAt")).toMatchObject({ format: "date-time", isOptional: true });
    expect(field("createdAt").format).toBeUndefined();
    expect(field("nested")).toMatchObject({ type: "object", isOptional: true, objectFields: [expect.objectContaining({ name: "x", type: "string" })] });
  });

  it("extracts the same metadata from Zod v3 schemas", async () => {
    const file = path.join(root, "shared", "models", "legacy-item.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, model("legacy-item", [
      "  title: z.string().startsWith('t').min(2),",
      "  score: z.number().int().positive(),",
      "  publishedAt: z.string().datetime().optional(),",
      "  kind: z.enum(['a', 'b']),",
      "  nested: z.object({ x: z.string().max(3) }),",
    ].join("\n")).replace("from 'zod/v4'", "from 'zod'"));

    const info = await parseModelFile(file);
    const field = (name: string) => info.fields.find((candidate) => candidate.name === name)!;
    expect(info.parserMode).toBe("dynamic");
    expect(field("title").constraints).toEqual({ minLength: 2 });
    expect(field("score")).toMatchObject({ isInteger: true, constraints: { minimum: 0, exclusiveMinimum: true } });
    expect(field("publishedAt").format).toBe("date-time");
    expect(field("kind").enumValues).toEqual(["a", "b"]);
    expect(field("nested").objectFields).toEqual([expect.objectContaining({ name: "x", constraints: { maxLength: 3 } })]);
  });
});

describe("Python schema assets", () => {
  let root: string;
  const originalCwd = process.cwd();
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-python-schema-"));
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps declared types and constraints instead of guessing from names", async () => {
    const file = path.join(root, "shared", "models", "probe-item.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, model("probe-item", [
      "  title: z.string().min(1),",
      "  code: z.string().regex(/^a\\d$/i).optional(),",
      "  tags: z.array(z.string().min(2)).max(3),",
      "  score: z.number().min(0).max(1),",
      "  count: z.number().int(),",
      "  publishedAt: z.iso.datetime().optional(),",
      "  createdAt: z.string().optional(),",
      "  nested: z.object({ x: z.string() }).optional(),",
    ].join("\n")));
    const info = await parseModelFile(file);
    process.chdir(root);
    await generateLanguageSchemaArtifacts([info], info, "functions", "python", new FileOperationSession("commit", root));
    const modelsDir = path.join(root, "functions", "generated", "python-models", "backend_models", "models");
    const source = fs.readFileSync(path.join(modelsDir, "probe_item.py"), "utf8");

    expect(source).toContain("created_at: Optional[StrictStr] = Field(default=None, alias=\"createdAt\")");
    expect(source).toContain("published_at: Optional[datetime] = Field(default=None, alias=\"publishedAt\")");
    expect(source).toContain("title: StrictStr = Field(min_length=1)");
    expect(source).toContain("tags: List[Annotated[StrictStr, Field(min_length=2)]] = Field(max_length=3)");
    expect(source).toContain("score: Union[StrictFloat, StrictInt] = Field(ge=0, le=1)");
    expect(source).toContain("count: StrictInt");
    expect(source).toContain("nested: Optional[ProbeItemNested] = Field(default=None)");
    expect(source).toContain('re.search("^a\\\\d$", item, re.IGNORECASE)');
    expect(source).toContain("return self.model_dump_json(by_alias=True, exclude_none=True)");
    expect(fs.readFileSync(path.join(modelsDir, "probe_item_nested.py"), "utf8")).toContain("class ProbeItemNested(BaseModel):");
  });
});

describe("user-scoped data warning", () => {
  const info = (partitionKey: string, fields: string[]) => ({
    name: "ProbeItem",
    partitionKey,
    fields: fields.map((name) => ({ name, type: "string", isOptional: false, isArray: false })),
  }) as unknown as Parameters<typeof buildUserScopedDataWarning>[0];

  it("warns when the partition key is a per-user id and auth is not configured", () => {
    expect(buildUserScopedDataWarning(info("/userId", ["id", "userId"]), undefined))
      .toMatch(/^user-scoped-data-without-auth: ProbeItem\.userId is the partition key and looks like a per-user owner id/);
    expect(buildUserScopedDataWarning(info("/userId", ["id", "userId"]), { provider: "none" })).toBeDefined();
  });

  it("warns for owner-like fields that are not the partition key", () => {
    expect(buildUserScopedDataWarning(info("/id", ["id", "learnerId"]), undefined))
      .toMatch(/ProbeItem\.learnerId looks like a per-user owner id/);
  });

  it("stays quiet when authentication is configured or nothing looks user-scoped", () => {
    expect(buildUserScopedDataWarning(info("/userId", ["id", "userId"]), { provider: "swa" })).toBeUndefined();
    expect(buildUserScopedDataWarning(info("/userId", ["id", "userId"]), { schemes: { admin: { provider: "swa" } } } as never)).toBeUndefined();
    expect(buildUserScopedDataWarning(info("/tenantId", ["id", "tenantId", "categoryId"]), undefined)).toBeUndefined();
  });
});
