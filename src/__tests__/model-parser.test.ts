import * as fs from "fs";
import * as path from "path";
import { parseModelFile } from "../core/scaffold/model-parser";

describe("parseModelFile", () => {
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
