import { generateCompactAzureFunctionsCRUD } from "../core/scaffold/functions-generator";
import { createBasicModelInfo, createModelInfoWithEnum } from "./fixtures";

describe("generateCompactAzureFunctionsCRUD", () => {
  it("generates correct CRUD code for a basic model", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("generates correct CRUD code for a model with enum fields", () => {
    const model = createModelInfoWithEnum();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toMatchSnapshot();
  });

  it("imports the correct schema from shared package", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("import { todoSchema } from '@myapp/shared'");
  });

  it("uses correct container name (PascalCase + s)", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("const containerName = 'Todos'");
  });

  it("registers correct route names (camelCase)", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("'todo-get-all'");
    expect(code).toContain("'todo-get-by-id'");
    expect(code).toContain("'todo-create'");
    expect(code).toContain("'todo-update'");
    expect(code).toContain("'todo-delete'");
  });

  it("generates all CRUD HTTP methods", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("methods: ['GET']");
    expect(code).toContain("methods: ['POST']");
    expect(code).toContain("methods: ['PUT']");
    expect(code).toContain("methods: ['DELETE']");
  });

  it("uses correct route patterns", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("route: 'todo'");
    expect(code).toContain("route: 'todo/{id}'");
  });

  it("handles multi-word model names correctly", () => {
    const model = createBasicModelInfo({
      name: "TodoItem",
      schemaName: "todoItemSchema",
    });
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).toContain("const containerName = 'TodoItems'");
    expect(code).toContain("route: 'todoItem'");
    expect(code).toContain("'todoItem-get-all'");
  });
});
