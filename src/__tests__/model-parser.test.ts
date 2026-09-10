import * as fs from "fs";
import * as path from "path";
import { parseModelFile } from "../core/scaffold/model-parser";

describe("parseModelFile", () => {
  afterEach(() => { jest.restoreAllMocks(); });

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
});
