import * as fs from "fs";
import * as path from "path";
import { getAllModels, parseModelFile } from "../core/scaffold/model-parser";

describe("parseModelFile", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("does not enumerate model barrels or declaration files as Cosmos entities", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(previousCwd, ".tmp-model-non-entities-"));
    try {
      process.chdir(tempDir);
      const modelsDir = path.join(tempDir, "shared", "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      fs.writeFileSync(path.join(modelsDir, "index.ts"), "export { Task } from './task';\n");
      fs.writeFileSync(path.join(modelsDir, "types.d.ts"), "export interface GeneratedModelTypes { value: string }\n");
      fs.writeFileSync(path.join(modelsDir, "task.ts"), `import { z } from 'zod/v4';
export const Task = z.object({ id: z.string(), title: z.string() });
`);

      const models = await getAllModels();
      expect(models.map((model) => model.name)).toEqual(["Task"]);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps a referenced helper schema nested instead of enumerating it as a Cosmos entity", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(previousCwd, ".tmp-model-helpers-"));
    try {
      process.chdir(tempDir);
      const modelsDir = path.join(tempDir, "shared", "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      fs.writeFileSync(path.join(modelsDir, "topic-mastery.ts"), `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
export type TopicMastery = z.infer<typeof TopicMastery>;
`);
      fs.writeFileSync(path.join(modelsDir, "learning-profile.ts"), `import { z } from 'zod/v4';
import { TopicMastery } from './topic-mastery';
export const LearningProfile = z.object({
  id: z.string(),
  userId: z.string(),
  mastery: z.array(TopicMastery),
});
export type LearningProfile = z.infer<typeof LearningProfile>;
export const partitionKey = '/userId';
`);

      const models = await getAllModels();
      expect(models.map((model) => model.name)).toEqual(["LearningProfile"]);
      expect(models[0].nestedSchemaRefs).toEqual([
        expect.objectContaining({
          schemaName: "TopicMastery",
          modelName: "TopicMastery",
          importPath: "./topic-mastery",
          sourceHash: expect.any(String),
        }),
      ]);
      expect(models[0].fields.find((field) => field.name === "mastery")).toMatchObject({
        type: "object",
        isArray: true,
        isNestedSchema: false,
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not suppress parser errors from a referenced helper schema", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(previousCwd, ".tmp-model-helper-errors-"));
    try {
      process.chdir(tempDir);
      const modelsDir = path.join(tempDir, "shared", "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      fs.writeFileSync(path.join(modelsDir, "topic-mastery.ts"), `import { z } from 'zod/v4';
export const TopicMastery = z.object({ scores: z.record(z.string(), z.number()) });
`);
      fs.writeFileSync(path.join(modelsDir, "learning-profile.ts"), `import { z } from 'zod/v4';
import { TopicMastery } from './topic-mastery';
export const LearningProfile = z.object({ id: z.string(), mastery: TopicMastery });
`);

      await expect(getAllModels()).rejects.toMatchObject({
        code: "schema-field-unsupported",
        details: expect.objectContaining({
          filePath: expect.stringContaining("topic-mastery.ts"),
          schemaName: "TopicMastery",
          field: "scores",
          reason: "ZodRecord",
        }),
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks an unreferenced id-less schema instead of assuming it is a helper", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(previousCwd, ".tmp-model-classification-"));
    try {
      process.chdir(tempDir);
      const modelsDir = path.join(tempDir, "shared", "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      fs.writeFileSync(path.join(modelsDir, "topic-mastery.ts"), `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
`);

      await expect(getAllModels()).rejects.toMatchObject({
        code: "model-classification-ambiguous",
        details: expect.objectContaining({
          filePath: expect.stringContaining("topic-mastery.ts"),
          schemaName: "TopicMastery",
        }),
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks a persistent entity with an optional or non-string id", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(previousCwd, ".tmp-model-invalid-id-"));
    try {
      process.chdir(tempDir);
      const modelsDir = path.join(tempDir, "shared", "models");
      fs.mkdirSync(modelsDir, { recursive: true });
      fs.writeFileSync(path.join(modelsDir, "learning-profile.ts"), `import { z } from 'zod/v4';
export const LearningProfile = z.object({ id: z.number().optional(), userId: z.string() });
`);

      await expect(getAllModels()).rejects.toMatchObject({
        code: "model-entity-id-required",
        details: expect.objectContaining({
          filePath: expect.stringContaining("learning-profile.ts"),
          field: "id",
        }),
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each(["zod", "zod/v4"])("executes TypeScript modules and nested imports with %s without fallback", async (zodImport) => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(tempDir, "leaf.ts"), `
import { z } from '${zodImport}';
export const displayName = 'Leaf';
export const leafSchema = z.object({ name: z.string() });
`);
      fs.writeFileSync(path.join(tempDir, "nested.ts"), `
import { z } from '${zodImport}';
import { leafSchema } from './leaf';
export const displayName = 'Nested';
export const nestedSchema = z.object({ leaf: leafSchema });
`);
      const modelPath = path.join(tempDir, "record.ts");
      fs.writeFileSync(modelPath, `
import { z } from '${zodImport}';
import { nestedSchema } from './nested';
import { leafSchema as otherSchema } from './leaf';
interface Settings { inner: { count: number }; }
type Label = string;
const label: Label = 'https://example.com';
const statuses = ['draft', 'active'] as const;
export const recordSchema = z.object({
  id: z.string(), title: z.string().default(label), count: z.number(), enabled: z.boolean(),
  optional: z.string().optional(), nullable: z.number().nullable(), status: z.enum(statuses),
  numbers: z.array(z.number()), nested: nestedSchema, others: z.array(otherSchema),
  inline: z.object({ name: z.string() }), tenantId: z.string(),
});
export type Record = z.infer<typeof recordSchema>;
export const displayName = 'Record';
export const partitionKey = '/tenantId';
export const connectorConfig = { connector: 'catalog', table: 'records', operations: ['read'] } as const;
export const authPolicy = { read: ['reader'], write: ['editor'] } as const;
`);
      const model = await parseModelFile(modelPath);
      expect(warning).not.toHaveBeenCalled();
      expect(model.fields).toHaveLength(12);
      expect(model.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "count", type: "number" }),
        expect.objectContaining({ name: "enabled", type: "boolean" }),
        expect.objectContaining({ name: "title", isOptional: true }),
        expect.objectContaining({ name: "optional", isOptional: true }),
        expect.objectContaining({ name: "nullable", isNullable: true }),
        expect.objectContaining({ name: "status", enumValues: ["draft", "active"] }),
        expect.objectContaining({ name: "numbers", type: "number", isArray: true }),
        expect.objectContaining({ name: "nested", type: "object" }),
        expect.objectContaining({ name: "others", type: "object", isArray: true }),
      ]));
      expect(model.connectorConfig).toEqual(expect.objectContaining({ connector: "catalog", table: "records", operations: ["read"] }));
      expect(model.partitionKey).toBe("/tenantId");
      expect(model.authPolicy).toEqual({ read: ["reader"], write: ["editor"] });
      expect(fs.readdirSync(tempDir).some(name => name.startsWith(".swallowkit-parser-"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves array and enum metadata for schemas with defaults", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "product.ts");

    try {
      fs.writeFileSync(
        modelPath,
        `import { z } from 'zod/v4';

export const Product = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().min(0),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Product = z.infer<typeof Product>;
`,
        "utf-8"
      );

      const model = await parseModelFile(modelPath);
      expect(model.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "tags",
            type: "string",
            isArray: true,
            isOptional: true,
          }),
          expect.objectContaining({
            name: "status",
            type: "string",
            isArray: false,
            isOptional: true,
            enumValues: ["draft", "active", "archived"],
          }),
        ])
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("distinguishes optional and nullable fields", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "coupon.ts");

    try {
      fs.writeFileSync(
        modelPath,
        `import { z } from 'zod/v4';

export const couponSchema = z.object({
  requiredUserId: z.string(),
  optionalUserId: z.string().optional(),
  nullableUserId: z.string().nullable(),
});
`,
        "utf-8"
      );

      const model = await parseModelFile(modelPath);
      expect(model.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "requiredUserId", isOptional: false, isNullable: false }),
        expect.objectContaining({ name: "optionalUserId", isOptional: true, isNullable: false }),
        expect.objectContaining({ name: "nullableUserId", isOptional: false, isNullable: true }),
      ]));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("statically preserves enum and literal metadata without starting Node", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-question.ts");
    const executeNode = jest.fn(() => { throw new Error("static parser unexpectedly started Node"); });
    try {
      fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
const kinds = ['grammar', 'vocabulary'] as const;
export const LearningQuestion = z.object({
  id: z.string(), kind: z.enum(kinds), level: z.literal('5'),
  score: z.number().int().positive().max(100).optional(),
  tags: z.array(z.string()).default([]), publishedAt: z.date().nullable(),
});
`);

      const model = await parseModelFile(modelPath, { executeNode });

      expect(model.parserMode).toBe("static-ast");
      expect(executeNode).not.toHaveBeenCalled();
      expect(model.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "kind", type: "string", enumValues: ["grammar", "vocabulary"] }),
        expect.objectContaining({ name: "level", type: "string", enumValues: ["5"] }),
        expect.objectContaining({ name: "score", type: "number", isOptional: true }),
        expect.objectContaining({ name: "tags", type: "string", isArray: true, isOptional: true }),
        expect.objectContaining({ name: "publishedAt", type: "date", isNullable: true }),
      ]));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores unrelated exported response schemas in the semantic fingerprint", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-question.ts");
    const modelSource = `import { z } from 'zod/v4';
export const LearningQuestion = z.object({ id: z.string(), kind: z.enum(['grammar', 'vocabulary']) });
`;
    try {
      fs.writeFileSync(modelPath, modelSource);
      const before = await parseModelFile(modelPath);
      fs.writeFileSync(modelPath, `${modelSource}\nexport const LearningQuestionRevealFeedback = z.object({ message: z.string() });\n`);
      const after = await parseModelFile(modelPath);

      expect(after.semanticFingerprint).toBe(before.semanticFingerprint);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks when dynamic schema evaluation cannot start", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "computed.ts");
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "fixture" }));
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
const field = z.string();
export const Computed = z.object({ id: field.transform(value => value) });
`);
    const unavailable = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
    const executeNode = jest.fn(() => { throw unavailable; });

    try {
      await expect(parseModelFile(modelPath, { executeNode })).rejects.toMatchObject({
        code: "schema-evaluation-unavailable",
        status: "blocked",
        details: expect.objectContaining({ command: process.execPath, reason: "EPERM" }),
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks unsupported dynamic fields with structured schema diagnostics", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "lossy.ts");
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "fixture" }));
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
const baseFields = { id: z.string() };
export const Lossy = z.object({ ...baseFields, ambiguous: z.union([z.string(), z.number()]) });
`);

    try {
      await expect(parseModelFile(modelPath)).rejects.toMatchObject({
        code: "schema-field-unsupported",
        status: "blocked",
        details: expect.objectContaining({
          filePath: modelPath,
          schemaName: "Lossy",
          field: "ambiguous",
          reason: "ZodUnion",
          explanation: expect.stringContaining("Zod union"),
        }),
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("selects the filename-matching model schema when helper schemas are exported first", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-profile.ts");
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
export const LearningProfile = z.object({ id: z.string(), userId: z.string(), topic: TopicMastery });
export type LearningProfile = z.infer<typeof LearningProfile>;
export const partitionKey = '/userId';
`);

    try {
      const model = await parseModelFile(modelPath);
      expect(model.name).toBe("LearningProfile");
      expect(model.schemaName).toBe("LearningProfile");
      expect(model.fields.map((field) => field.name)).toEqual(["id", "userId", "topic"]);
      expect(model.partitionKey).toBe("/userId");
      expect(model.hasId).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("supports the legacy filename-matching Schema export with unrelated schemas before it", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-profile.ts");
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
export const TopicSchema = z.object({ topicId: z.string() });
export const learningProfileSchema = z.object({ id: z.string(), userId: z.string() });
`);

    try {
      const model = await parseModelFile(modelPath);
      expect(model.schemaName).toBe("learningProfileSchema");
      expect(model.fields.map((field) => field.name)).toEqual(["id", "userId"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks schema files with multiple non-matching exported object candidates", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-profile.ts");
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
export const TopicSchema = z.object({ topicId: z.string() });
export const SummarySchema = z.object({ total: z.number() });
`);

    try {
      await expect(parseModelFile(modelPath)).rejects.toMatchObject({
        code: "model-schema-ambiguous",
        status: "blocked",
        details: expect.objectContaining({
          filePath: modelPath,
          model: "LearningProfile",
          candidates: ["TopicSchema", "SummarySchema"],
        }),
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports unsupported record fields with schema and field diagnostics", async () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-model-parser-"));
    const modelPath = path.join(tempDir, "learning-profile.ts");
    fs.writeFileSync(modelPath, `import { z } from 'zod/v4';
export const TopicMastery = z.object({ topicId: z.string(), score: z.number() });
export const LearningProfile = z.object({
  id: z.string(),
  userId: z.string(),
  masteryByTopic: z.record(z.string(), TopicMastery),
});
`);

    try {
      await expect(parseModelFile(modelPath)).rejects.toMatchObject({
        code: "schema-field-unsupported",
        status: "blocked",
        details: expect.objectContaining({
          filePath: modelPath,
          schemaName: "LearningProfile",
          field: "masteryByTopic",
          reason: "ZodRecord",
          explanation: expect.stringContaining("Zod record"),
        }),
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
