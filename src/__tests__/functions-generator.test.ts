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

  // --- Custom Partition Key Tests ---

  describe("custom partition key (TS)", () => {
    it("uses input binding when partitionKey is /id (default)", () => {
      const model = createBasicModelInfo({ partitionKey: "/id" });
      const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
      expect(code).toContain("partitionKey: '{id}'");
      expect(code).toContain("container.item(id, id).delete()");
    });

    it("uses SDK direct call when partitionKey is not /id", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");

      // Should NOT have input binding with partitionKey
      expect(code).not.toContain("partitionKey: '{id}'");
      // getById should use SDK query
      expect(code).toContain("custom partition key");
      expect(code).toContain("SELECT * FROM c WHERE c.id = @id");
      // delete should read doc first to get PK value
      expect(code).toContain("resources[0].tenantId");
      expect(code).toContain("container.item(id, pkValue).delete()");
    });

    it("generates snapshot for custom partition key TS", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
      expect(code).toMatchSnapshot();
    });
  });

  describe("custom partition key (C#)", () => {
    it("uses ReadItemStreamAsync when partitionKey is /id", () => {
      const model = createBasicModelInfo({ partitionKey: "/id" });
      const code = generateCSharpAzureFunctionsCRUD(model);
      expect(code).toContain("ReadItemStreamAsync(id, new PartitionKey(id))");
      expect(code).toContain("DeleteItemAsync<JsonObject>(id, new PartitionKey(id))");
    });

    it("uses query when partitionKey is not /id", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const code = generateCSharpAzureFunctionsCRUD(model);
      // ReadCosmosItemAsync should use query instead of point read
      expect(code).toContain("GetItemQueryStreamIterator(query)");
      expect(code).not.toContain("ReadItemStreamAsync(id, new PartitionKey(id))");
      // Delete should read doc first for PK value
      expect(code).toContain('existing["tenantId"]');
    });

    it("generates snapshot for custom partition key C#", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const code = generateCSharpAzureFunctionsCRUD(model);
      expect(code).toMatchSnapshot();
    });
  });

  describe("custom partition key (Python)", () => {
    it("uses read_item with partition_key=item_id when partitionKey is /id", () => {
      const model = createBasicModelInfo({ partitionKey: "/id" });
      const generated = generatePythonAzureFunctionsCRUD(model);
      expect(generated.blueprint).toContain("partition_key=item_id");
    });

    it("uses cross-partition query when partitionKey is not /id", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const generated = generatePythonAzureFunctionsCRUD(model);
      // Should not use direct read_item with partition_key=item_id
      expect(generated.blueprint).not.toContain("partition_key=item_id");
      // Should use cross-partition query
      expect(generated.blueprint).toContain("enable_cross_partition_query=True");
      expect(generated.blueprint).toContain('SELECT * FROM c WHERE c.id = @id');
      // Delete should get PK value from document
      expect(generated.blueprint).toContain('.get("tenantId")');
    });

    it("generates snapshot for custom partition key Python", () => {
      const model = createBasicModelInfo({
        partitionKey: "/tenantId",
        fields: [
          { name: "id", type: "string", isOptional: false, isArray: false },
          { name: "tenantId", type: "string", isOptional: false, isArray: false },
          { name: "title", type: "string", isOptional: false, isArray: false },
          { name: "createdAt", type: "string", isOptional: false, isArray: false },
          { name: "updatedAt", type: "string", isOptional: false, isArray: false },
        ],
      });
      const generated = generatePythonAzureFunctionsCRUD(model);
      expect(generated.blueprint).toMatchSnapshot();
    });
  });
});
