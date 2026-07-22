import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  generateListPage,
  generateDetailPage,
  generateFormComponent,
  generateNewPage,
  generateEditPage,
} from "../core/scaffold/ui-generator";
import {
  createBasicModelInfo,
  createModelInfoWithForeignKey,
  createModelInfoWithNullableForeignKeys,
  createModelInfoWithEnum,
} from "./fixtures";

describe("generateListPage", () => {
  it("generates list page for basic model (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("contains 'use client' directive", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("'use client'");
  });

  it("imports schema from shared package", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("@myapp/shared");
  });

  it("fetches from correct API endpoint", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("/api/todo");
  });

  it("displays up to 3 non-id fields", () => {
    const model = createBasicModelInfo();
    const code = generateListPage(model, "@myapp/shared");
    // title, description, completed — first 3 non-id fields
    expect(code).toContain("title");
  });

  it("handles foreign key fields", () => {
    const model = createModelInfoWithForeignKey();
    const code = generateListPage(model, "@myapp/shared");
    expect(code).toContain("categoryId");
  });

  it("guards optional and nullable foreign key map lookups", () => {
    const code = generateListPage(createModelInfoWithNullableForeignKeys(), "@myapp/shared");

    expect(code).toContain("requiredUserMap[item.requiredUserId] || item.requiredUserId");
    expect(code).toContain("item.optionalUserId ? optionalUserMap[item.optionalUserId] || item.optionalUserId : '-'");
    expect(code).toContain("item.nullableUserId ? nullableUserMap[item.nullableUserId] || item.nullableUserId : '-'");
    expect(code).not.toContain("requiredUserId ?");
  });
});

describe("generateDetailPage", () => {
  it("generates detail page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("contains 'use client' directive", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toContain("'use client'");
  });

  it("includes delete button", () => {
    const model = createBasicModelInfo();
    const code = generateDetailPage(model, "@myapp/shared");
    expect(code).toContain("DELETE");
  });

  it("guards optional and nullable foreign key map lookups", () => {
    const code = generateDetailPage(createModelInfoWithNullableForeignKeys(), "@myapp/shared");

    expect(code).toContain("requiredUserMap[coupon.requiredUserId] || coupon.requiredUserId");
    expect(code).toContain("coupon.optionalUserId ? optionalUserMap[coupon.optionalUserId] || coupon.optionalUserId : '-'");
    expect(code).toContain("coupon.nullableUserId ? nullableUserMap[coupon.nullableUserId] || coupon.nullableUserId : '-'");
    expect(code).not.toContain("requiredUserId ?");
  });

  it("generates list and detail pages that pass strict TypeScript checking", () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-ui-generator-"));
    const model = createModelInfoWithNullableForeignKeys();

    try {
      fs.writeFileSync(path.join(tempDir, "list.tsx"), generateListPage(model, "@myapp/shared"));
      fs.writeFileSync(path.join(tempDir, "detail.tsx"), generateDetailPage(model, "@myapp/shared"));
      fs.writeFileSync(
        path.join(tempDir, "shared.ts"),
        `import { z } from 'zod/v4';
export const couponSchema = z.object({
  id: z.string(),
  requiredUserId: z.string(),
  optionalUserId: z.string().optional(),
  nullableUserId: z.string().nullable(),
});
`
      );
      fs.writeFileSync(
        path.join(tempDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ES2020",
            module: "commonjs",
            moduleResolution: "node",
            jsx: "react-jsx",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            noEmit: true,
            baseUrl: ".",
            paths: { "@myapp/shared": ["./shared.ts"] },
          },
          include: ["*.ts", "*.tsx"],
        })
      );

      expect(() => execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", tempDir], {
        cwd: process.cwd(),
        stdio: "pipe",
      })).not.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("generateFormComponent", () => {
  it("generates form component (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("generates inputs for non-managed fields", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    // title and description should have form inputs
    expect(code).toContain("title");
    expect(code).toContain("description");
  });

  it("generates enum select for enum fields", () => {
    const model = createModelInfoWithEnum();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toContain("select");
    expect(code).toContain("open");
    expect(code).toContain("in_progress");
    expect(code).toContain("closed");
  });

  it("generates checkbox for boolean fields", () => {
    const model = createBasicModelInfo();
    const code = generateFormComponent(model, "@myapp/shared");
    expect(code).toContain("checkbox");
  });
});

describe("generateNewPage", () => {
  it("generates new page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toMatchSnapshot();
  });

  it("contains form component reference", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toContain("Form");
  });

  it("references the form component", () => {
    const model = createBasicModelInfo();
    const code = generateNewPage(model);
    expect(code).toContain("TodoForm");
    expect(code).toContain("Create New Todo");
  });
});

describe("generateEditPage", () => {
  it("generates edit page (snapshot)", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("loads existing data and passes to form", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toContain("initialData");
    expect(code).toContain("isEdit={true}");
  });

  it("fetches existing data for editing", () => {
    const model = createBasicModelInfo();
    const code = generateEditPage(model, "@myapp/shared");
    expect(code).toContain("/api/todo/");
  });
});
