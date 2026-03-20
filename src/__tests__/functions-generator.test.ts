import {
  generateCSharpAzureFunctionsCRUD,
  generateCompactAzureFunctionsCRUD,
  generatePythonAzureFunctionsCRUD,
} from "../core/scaffold/functions-generator";
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

  it("generates C# Cosmos-backed CRUD handlers", () => {
    const model = createBasicModelInfo();
    const code = generateCSharpAzureFunctionsCRUD(model);
    expect(code).toContain("public sealed class TodoFunctions");
    expect(code).toContain('[Function("todoGetAll")]');
    expect(code).toContain('Route = "todo/{id}"');
    expect(code).toContain("CreateCosmosClient()");
    expect(code).toContain('new CosmosClientOptions { ConnectionMode = ConnectionMode.Gateway }');
    expect(code).toContain('endpoint.Contains("localhost:8081", StringComparison.OrdinalIgnoreCase)');
    expect(code).toContain("container.ReadItemStreamAsync");
    expect(code).toContain("JsonNode.Parse(document.RootElement.GetRawText())?.AsObject()");
    expect(code).toContain("container.CreateItemStreamAsync");
    expect(code).toContain("container.ReplaceItemStreamAsync");
    expect(code).toContain("payload.ToJsonString()");
    expect(code).toContain("container.DeleteItemAsync<JsonObject>");
  });

  it("generates Python Cosmos-backed CRUD handlers", () => {
    const model = createBasicModelInfo();
    const generated = generatePythonAzureFunctionsCRUD(model);
    expect(generated.registration).toContain("from blueprints.todo import bp as todo_bp");
    expect(generated.registration).toContain("app.register_blueprint(todo_bp)");
    expect(generated.blueprint).toContain('@bp.route(route="todo", methods=["GET"])');
    expect(generated.blueprint).toContain("def todo_create");
    expect(generated.blueprint).toContain("from azure.cosmos import CosmosClient, exceptions");
    expect(generated.blueprint).toContain("container.query_items");
    expect(generated.blueprint).toContain("container.read_item");
    expect(generated.blueprint).toContain("container.create_item");
    expect(generated.blueprint).toContain("container.replace_item");
    expect(generated.blueprint).toContain("container.delete_item");
  });
});
