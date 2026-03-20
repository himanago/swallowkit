import {
  generateBFFCallFunction,
  generateCompactBFFRoutes,
} from "../core/scaffold/nextjs-generator";
import { createBasicModelInfo } from "./fixtures";

describe("generateBFFCallFunction", () => {
  it("generates call function helper code", () => {
    const code = generateBFFCallFunction();
    expect(code).toMatchSnapshot();
  });

  it("includes getFunctionsBaseUrl helper", () => {
    const code = generateBFFCallFunction();
    expect(code).toContain("getFunctionsBaseUrl");
    expect(code).toContain("BACKEND_FUNCTIONS_BASE_URL");
  });

  it("includes callFunction export", () => {
    const code = generateBFFCallFunction();
    expect(code).toContain("export async function callFunction");
  });

  it("includes z.ZodSchema typings", () => {
    const code = generateBFFCallFunction();
    expect(code).toContain("z.ZodSchema");
  });
});

describe("generateCompactBFFRoutes", () => {
  it("generates list and detail routes", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toMatchSnapshot();
    expect(routes.detailRoute).toMatchSnapshot();
  });

  it("imports the correct schema", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toContain(
      "import { todoSchema } from '@myapp/shared'"
    );
    expect(routes.detailRoute).toContain(
      "import { todoSchema } from '@myapp/shared'"
    );
  });

  it("uses correct API paths (camelCase)", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toContain("path: '/api/todo'");
    expect(routes.detailRoute).toContain("/api/todo/");
  });

  it("list route has GET and POST handlers", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toContain("export async function GET()");
    expect(routes.listRoute).toContain("export async function POST(");
  });

  it("detail route has GET, PUT, and DELETE handlers", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.detailRoute).toContain("export async function GET(");
    expect(routes.detailRoute).toContain("export async function PUT(");
    expect(routes.detailRoute).toContain("export async function DELETE(");
  });

  it("creates InputSchema that omits managed fields", () => {
    const model = createBasicModelInfo();
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toContain(
      "todoSchema.omit({ id: true, createdAt: true, updatedAt: true })"
    );
  });

  it("handles multi-word model names", () => {
    const model = createBasicModelInfo({
      name: "BlogPost",
      schemaName: "blogPostSchema",
    });
    const routes = generateCompactBFFRoutes(model, "@myapp/shared");

    expect(routes.listRoute).toContain("path: '/api/blogPost'");
    expect(routes.listRoute).toContain(
      "import { blogPostSchema } from '@myapp/shared'"
    );
  });
});
