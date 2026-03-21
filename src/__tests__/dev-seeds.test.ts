import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBasicModelInfo } from "./fixtures";
import {
  buildSeedTemplateDocument,
  getContainerNameForModel,
  loadDevSeedFiles,
  normalizeSeedIdentifier,
  parseSeedDocuments,
} from "../cli/commands/dev-seeds";

describe("dev seed helpers", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-dev-seeds-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds Cosmos container names from model names", () => {
    expect(getContainerNameForModel(createBasicModelInfo())).toBe("Todos");
  });

  it("normalizes seed identifiers across common naming styles", () => {
    expect(normalizeSeedIdentifier("todo-items")).toBe("todoitems");
    expect(normalizeSeedIdentifier("Todo_Items")).toBe("todoitems");
    expect(normalizeSeedIdentifier("todoSchema")).toBe("todoschema");
  });

  it("wraps a single JSON object into a document array", () => {
    expect(parseSeedDocuments('{"id":"todo-001","title":"Hello"}', "todo.json")).toEqual([
      { id: "todo-001", title: "Hello" },
    ]);
  });

  it("loads matching seed files for an environment", async () => {
    const seedsDir = path.join(tempDir, "dev-seeds", "local");
    fs.mkdirSync(seedsDir, { recursive: true });
    fs.writeFileSync(
      path.join(seedsDir, "todo.json"),
      JSON.stringify([{ id: "todo-001", title: "First task" }], null, 2),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(seedsDir, "ignored.json"),
      JSON.stringify([{ id: "ignored-001" }], null, 2),
      "utf-8"
    );

    const loaded = await loadDevSeedFiles("local", [createBasicModelInfo()]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      containerName: "Todos",
      documents: [{ id: "todo-001", title: "First task" }],
    });
  });

  it("rejects seed documents without ids", async () => {
    const seedsDir = path.join(tempDir, "dev-seeds", "local");
    fs.mkdirSync(seedsDir, { recursive: true });
    fs.writeFileSync(path.join(seedsDir, "todo.json"), JSON.stringify([{ title: "Missing id" }], null, 2), "utf-8");

    await expect(loadDevSeedFiles("local", [createBasicModelInfo()])).rejects.toThrow(/non-empty string id/);
  });

  it("builds nested template documents from related schemas", () => {
    const category = createBasicModelInfo({
      name: "Category",
      displayName: "Category",
      schemaName: "categorySchema",
      filePath: "/models/category.ts",
      fields: [
        { name: "id", type: "string", isOptional: false, isArray: false },
        { name: "name", type: "string", isOptional: false, isArray: false },
      ],
      hasCreatedAt: false,
      hasUpdatedAt: false,
    });
    const todo = createBasicModelInfo({
      fields: [
        { name: "id", type: "string", isOptional: false, isArray: false },
        { name: "title", type: "string", isOptional: false, isArray: false },
        {
          name: "category",
          type: "object",
          isOptional: true,
          isArray: false,
          isNestedSchema: true,
          nestedModelName: "Category",
          nestedSchemaName: "categorySchema",
        },
      ],
    });

    expect(buildSeedTemplateDocument(todo, [todo, category])).toEqual({
      id: "todo-001",
      title: "todo-title-sample",
      category: {
        id: "category-001",
        name: "category-name-sample",
      },
    });
  });
});
