/**
 * Azure Functions CRUD コード生成
 * Cosmos DB 入出力バインディングを使用した Azure Functions のベストプラクティスに従う
 * インラインハンドラー方式（ファクトリー不使用）
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";
import { ModelAuthPolicy } from "../../types";
import { generateAuthImportTS, generateAuthGuardTS, generateAuthGuardCSharp, generateAuthGuardPython } from "./auth-generator";

/**
 * Azure Functions エンティティファイルを生成（インラインハンドラー方式）
 * 各ハンドラーがベタ書きされており、ビジネスロジックの追加・変更が容易
 */
export function generateCompactAzureFunctionsCRUD(model: ModelInfo, sharedPackageName: string, authPolicy?: ModelAuthPolicy): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  const schemaName = model.schemaName;

  const hasAuth = !!authPolicy;
  const authImport = hasAuth ? `\n${generateAuthImportTS()}\n` : '';
  const readGuard = hasAuth ? `\n${generateAuthGuardTS(authPolicy!, 'read')}\n` : '';
  const writeGuard = hasAuth ? `\n${generateAuthGuardTS(authPolicy!, 'write')}\n` : '';
  const authCatchBlock = hasAuth
    ? `      const authErr = handleAuthError(error);
      if (authErr) return authErr;\n`
    : '';

  return `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod/v4';
import crypto from 'crypto';
import { ${schemaName} } from '${sharedPackageName}';${authImport}

const containerName = '${modelName.endsWith('s') ? modelName : modelName + 's'}';

// GET /api/${modelCamel} - 全件取得
app.http('${modelCamel}-get-all', {
  methods: ['GET'],
  route: '${modelCamel}',
  authLevel: 'anonymous',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: 'cosmosInput',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName,
      connection: 'CosmosDBConnection',
      sqlQuery: 'SELECT * FROM c',
    },
  ],
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {${readGuard}
      const documents = context.extraInputs.get('cosmosInput') as any[];

      if (!documents || !Array.isArray(documents)) {
        return { status: 200, jsonBody: [] };
      }

      const validated = z.array(${schemaName}).parse(documents);
      context.log(\`Fetched \${validated.length} items from \${containerName}\`);

      return { status: 200, jsonBody: validated };
    } catch (error) {
${authCatchBlock}      context.error(\`Error fetching from \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch items' } };
    }
  },
});

// GET /api/${modelCamel}/{id} - ID指定取得
app.http('${modelCamel}-get-by-id', {
  methods: ['GET'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: 'cosmosInput',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName,
      connection: 'CosmosDBConnection',
      id: '{id}',
      partitionKey: '{id}',
    },
  ],
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {${readGuard}
      const document = context.extraInputs.get('cosmosInput');

      if (!document) {
        return { status: 404, jsonBody: { error: 'Item not found' } };
      }

      const validated = ${schemaName}.parse(document);
      return { status: 200, jsonBody: validated };
    } catch (error) {
${authCatchBlock}      context.error(\`Error fetching item from \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch item' } };
    }
  },
});

// POST /api/${modelCamel} - 新規作成
app.http('${modelCamel}-create', {
  methods: ['POST'],
  route: '${modelCamel}',
  authLevel: 'anonymous',
  extraOutputs: [
    {
      type: 'cosmosDB',
      name: 'cosmosOutput',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName,
      connection: 'CosmosDBConnection',
      createIfNotExists: true,
    },
  ],
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {${writeGuard}
      const body = await request.json() as any;

      const { id, createdAt, updatedAt, ...userData } = body;
      const now = new Date().toISOString();
      const dataWithManagedFields = {
        ...userData,
        id: id || crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      const result = ${schemaName}.safeParse(dataWithManagedFields);

      if (!result.success) {
        context.error('Validation failed:', result.error.issues);
        return { status: 400, jsonBody: { error: 'Validation failed', details: result.error.issues } };
      }

      context.extraOutputs.set('cosmosOutput', result.data);
      return { status: 201, jsonBody: result.data };
    } catch (error) {
${authCatchBlock}      context.error(\`Error creating item in \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to create item' } };
    }
  },
});

// PUT /api/${modelCamel}/{id} - 更新
app.http('${modelCamel}-update', {
  methods: ['PUT'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: 'cosmosInput',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName,
      connection: 'CosmosDBConnection',
      id: '{id}',
      partitionKey: '{id}',
    },
  ],
  extraOutputs: [
    {
      type: 'cosmosDB',
      name: 'cosmosOutput',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName,
      connection: 'CosmosDBConnection',
    },
  ],
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {${writeGuard}
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }

      const existingDocument = context.extraInputs.get('cosmosInput') as any;
      if (!existingDocument) {
        return { status: 404, jsonBody: { error: 'Item not found' } };
      }

      const body = await request.json() as any;
      const { createdAt, updatedAt, ...userData } = body;

      const dataWithManagedFields = {
        ...userData,
        id,
        createdAt: existingDocument.createdAt,
        updatedAt: new Date().toISOString(),
      };

      const result = ${schemaName}.safeParse(dataWithManagedFields);

      if (!result.success) {
        context.error('Validation failed:', result.error.issues);
        return { status: 400, jsonBody: { error: 'Validation failed', details: result.error.issues } };
      }

      context.extraOutputs.set('cosmosOutput', result.data);
      return { status: 200, jsonBody: result.data };
    } catch (error) {
${authCatchBlock}      context.error(\`Error updating item in \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to update item' } };
    }
  },
});

// DELETE /api/${modelCamel}/{id} - 削除
app.http('${modelCamel}-delete', {
  methods: ['DELETE'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {${writeGuard}
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }

      const { CosmosClient } = await import('@azure/cosmos');
      const endpoint = process.env.CosmosDBConnection__accountEndpoint;
      let client: InstanceType<typeof CosmosClient>;
      if (endpoint) {
        const { DefaultAzureCredential } = await import('@azure/identity');
        client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
      } else {
        client = new CosmosClient(process.env.CosmosDBConnection!);
      }
      const database = client.database(process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase');
      const container = database.container(containerName);

      await container.item(id, id).delete();
      context.log(\`Deleted item \${id} from \${containerName}\`);

      return { status: 204 };
    } catch (error: any) {
      if (error.code === 404) {
        return { status: 404, jsonBody: { error: 'Item not found' } };
      }
${authCatchBlock}      context.error(\`Error deleting item from \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to delete item' } };
    }
  },
});
`;
}

export function generateCSharpAzureFunctionsCRUD(model: ModelInfo, authPolicy?: ModelAuthPolicy): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const className = `${modelName}Functions`;
  const containerName = modelName.endsWith('s') ? modelName : `${modelName}s`;

  const hasAuth = !!authPolicy;
  const authUsing = hasAuth ? 'using Functions.Auth;\n' : '';
  const readGuard = hasAuth ? `\n${generateAuthGuardCSharp(authPolicy!, 'read')}\n` : '';
  const writeGuard = hasAuth ? `\n${generateAuthGuardCSharp(authPolicy!, 'write')}\n` : '';

  return `using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Azure.Identity;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
${authUsing}
namespace SwallowKit.Functions;

public sealed class ${className}
{
    private readonly ILogger<${className}> _logger;
    private static readonly string ContainerName = "${containerName}";

    public ${className}(ILogger<${className}> logger)
    {
        _logger = logger;
    }

    private static string DatabaseName => Environment.GetEnvironmentVariable("COSMOS_DB_DATABASE_NAME") ?? "AppDatabase";

    private static bool IsLocalCosmosEndpoint(string endpoint) =>
        endpoint.Contains("localhost:8081", StringComparison.OrdinalIgnoreCase) ||
        endpoint.Contains("127.0.0.1:8081", StringComparison.OrdinalIgnoreCase);

    private static CosmosClient CreateCosmosClient()
    {
        var endpoint = Environment.GetEnvironmentVariable("CosmosDBConnection__accountEndpoint");
        if (!string.IsNullOrWhiteSpace(endpoint))
        {
            var options = IsLocalCosmosEndpoint(endpoint)
                ? new CosmosClientOptions { ConnectionMode = ConnectionMode.Gateway }
                : new CosmosClientOptions();
            return new CosmosClient(endpoint, new DefaultAzureCredential(), options);
        }

        var connectionString = Environment.GetEnvironmentVariable("CosmosDBConnection");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Cosmos DB connection is not configured.");
        }

        var connectionOptions = IsLocalCosmosEndpoint(connectionString)
            ? new CosmosClientOptions { ConnectionMode = ConnectionMode.Gateway }
            : new CosmosClientOptions();

        return new CosmosClient(connectionString, connectionOptions);
    }

    private static Container GetContainer(CosmosClient client) => client.GetContainer(DatabaseName, ContainerName);

    private static async Task<JsonObject> ReadRequestBodyAsync(HttpRequestData request)
    {
        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var raw = await reader.ReadToEndAsync();
        var node = JsonNode.Parse(raw) as JsonObject;

        if (node is null)
        {
            throw new JsonException("Request body must be a JSON object.");
        }

        return node;
    }

    private static JsonObject BuildManagedDocument(JsonObject source, string id, string createdAt, string updatedAt)
    {
        var payload = new JsonObject();

        foreach (var entry in source)
        {
            if (entry.Key is "id" or "createdAt" or "updatedAt")
            {
                continue;
            }

            payload[entry.Key] = entry.Value?.DeepClone();
        }

        payload["id"] = id;
        payload["createdAt"] = createdAt;
        payload["updatedAt"] = updatedAt;

        return payload;
    }

    private static Stream CreateJsonStream(JsonObject payload) =>
        new MemoryStream(Encoding.UTF8.GetBytes(payload.ToJsonString()));

    private static async Task<JsonObject> ReadCosmosItemAsync(Container container, string id)
    {
        var response = await container.ReadItemStreamAsync(id, new PartitionKey(id));
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            throw new CosmosException("Item not found", HttpStatusCode.NotFound, 0, response.Headers.ActivityId, response.Headers.RequestCharge);
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Cosmos read failed with status {(int)response.StatusCode}.");
        }

        using var document = await JsonDocument.ParseAsync(response.Content);
        return JsonNode.Parse(document.RootElement.GetRawText())?.AsObject()
            ?? throw new JsonException("Cosmos item payload must be a JSON object.");
    }

    private static async Task<HttpResponseData> WriteJsonAsync(HttpRequestData request, HttpStatusCode status, object payload)
    {
        var response = request.CreateResponse(status);
        await response.WriteAsJsonAsync(payload);
        return response;
    }

    [Function("${modelCamel}GetAll")]
    public async Task<HttpResponseData> GetAll(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}")] HttpRequestData request)
    {
        try
        {${readGuard}
            using var client = CreateCosmosClient();
            var container = GetContainer(client);
            using var iterator = container.GetItemQueryStreamIterator("SELECT * FROM c");
            var items = new List<JsonElement>();

            while (iterator.HasMoreResults)
            {
                var page = await iterator.ReadNextAsync();
                if (!page.IsSuccessStatusCode)
                {
                    throw new InvalidOperationException($"Cosmos query failed with status {(int)page.StatusCode}.");
                }

                using var document = await JsonDocument.ParseAsync(page.Content);
                if (!document.RootElement.TryGetProperty("Documents", out var documents))
                {
                    continue;
                }

                foreach (var item in documents.EnumerateArray())
                {
                    items.Add(item.Clone());
                }
            }

            _logger.LogInformation("Fetched {Count} ${modelName} item(s) from {Container}.", items.Count, ContainerName);
            return await WriteJsonAsync(request, HttpStatusCode.OK, items);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ${modelName} items from Cosmos DB.");
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch items" });
        }
    }

    [Function("${modelCamel}GetById")]
    public async Task<HttpResponseData> GetById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {${readGuard}
            using var client = CreateCosmosClient();
            var container = GetContainer(client);
            var item = await ReadCosmosItemAsync(container, id);
            return await WriteJsonAsync(request, HttpStatusCode.OK, item);
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return await WriteJsonAsync(request, HttpStatusCode.NotFound, new { error = "${modelName} not found", id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ${modelName} item {Id} from Cosmos DB.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch item", id });
        }
    }

    [Function("${modelCamel}Create")]
    public async Task<HttpResponseData> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "${modelCamel}")] HttpRequestData request)
    {
        try
        {${writeGuard}
            var body = await ReadRequestBodyAsync(request);
            var now = DateTimeOffset.UtcNow.ToString("O");
            var id = body["id"]?.GetValue<string>() ?? Guid.NewGuid().ToString();
            var payload = BuildManagedDocument(body, id, now, now);

            using var client = CreateCosmosClient();
            var container = GetContainer(client);
            using var stream = CreateJsonStream(payload);
            var response = await container.CreateItemStreamAsync(stream, new PartitionKey(id));
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Cosmos create failed with status {(int)response.StatusCode}.");
            }

            return await WriteJsonAsync(request, HttpStatusCode.Created, payload);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Invalid ${modelName} create payload.");
            return await WriteJsonAsync(request, HttpStatusCode.BadRequest, new { error = "Request body must be a JSON object." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create ${modelName} item in Cosmos DB.");
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to create item" });
        }
    }

    [Function("${modelCamel}Update")]
    public async Task<HttpResponseData> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {${writeGuard}
            using var client = CreateCosmosClient();
            var container = GetContainer(client);

            JsonObject existing;
            try
            {
                existing = await ReadCosmosItemAsync(container, id);
            }
            catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
            {
                return await WriteJsonAsync(request, HttpStatusCode.NotFound, new { error = "${modelName} not found", id });
            }

            var body = await ReadRequestBodyAsync(request);
            var createdAt = existing["createdAt"]?.GetValue<string>() ?? DateTimeOffset.UtcNow.ToString("O");
            var payload = BuildManagedDocument(body, id, createdAt, DateTimeOffset.UtcNow.ToString("O"));

            using var stream = CreateJsonStream(payload);
            var response = await container.ReplaceItemStreamAsync(stream, id, new PartitionKey(id));
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Cosmos replace failed with status {(int)response.StatusCode}.");
            }

            return await WriteJsonAsync(request, HttpStatusCode.OK, payload);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Invalid ${modelName} update payload for {Id}.", id);
            return await WriteJsonAsync(request, HttpStatusCode.BadRequest, new { error = "Request body must be a JSON object.", id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update ${modelName} item {Id} in Cosmos DB.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to update item", id });
        }
    }

    [Function("${modelCamel}Delete")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {${writeGuard}
            using var client = CreateCosmosClient();
            var container = GetContainer(client);
            await container.DeleteItemAsync<JsonObject>(id, new PartitionKey(id));

            return request.CreateResponse(HttpStatusCode.NoContent);
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return await WriteJsonAsync(request, HttpStatusCode.NotFound, new { error = "${modelName} not found", id });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete ${modelName} item {Id} from Cosmos DB.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to delete item", id });
        }
    }
}
`;
}

export function generatePythonAzureFunctionsCRUD(model: ModelInfo, authPolicy?: ModelAuthPolicy): {
  blueprint: string;
  registration: string;
} {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelSnake = toKebabCase(modelName).replace(/-/g, "_");
  const containerName = modelName.endsWith('s') ? modelName : `${modelName}s`;

  const hasAuth = !!authPolicy;
  const authImport = hasAuth ? '\nfrom auth.jwt_helper import require_auth, require_roles, handle_auth_error\n' : '';
  // generateAuthGuardPython outputs at 4-space indent; inside try: we need 8-space
  const readGuardRaw = hasAuth ? generateAuthGuardPython(authPolicy!, 'read') : '';
  const writeGuardRaw = hasAuth ? generateAuthGuardPython(authPolicy!, 'write') : '';
  const readGuard = hasAuth ? '\n' + readGuardRaw.split('\n').map(l => '    ' + l).join('\n') : '';
  const writeGuard = hasAuth ? '\n' + writeGuardRaw.split('\n').map(l => '    ' + l).join('\n') : '';
  const authCatch = hasAuth ? `\n        auth_err = handle_auth_error(exc)\n        if auth_err:\n            return auth_err` : '';

  return {
    registration: `from blueprints.${modelSnake} import bp as ${modelSnake}_bp\napp.register_blueprint(${modelSnake}_bp)`,
    blueprint: `import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
import os

import azure.functions as func
from azure.cosmos import CosmosClient, exceptions
from azure.identity import DefaultAzureCredential
${authImport}
bp = func.Blueprint()
CONTAINER_NAME = "${containerName}"
DATABASE_NAME = os.environ.get("COSMOS_DB_DATABASE_NAME", "AppDatabase")


def _json_response(payload: Any, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False),
        status_code=status_code,
        mimetype="application/json",
    )


def _get_container():
    endpoint = os.environ.get("CosmosDBConnection__accountEndpoint")
    if endpoint:
        client = CosmosClient(endpoint, credential=DefaultAzureCredential())
    else:
        connection_string = os.environ.get("CosmosDBConnection")
        if not connection_string:
            raise RuntimeError("Cosmos DB connection is not configured.")
        client = CosmosClient.from_connection_string(connection_string)

    database = client.get_database_client(DATABASE_NAME)
    return database.get_container_client(CONTAINER_NAME)


def _build_managed_document(source: dict[str, Any], item_id: str, created_at: str, updated_at: str) -> dict[str, Any]:
    payload = {
        key: value
        for key, value in source.items()
        if key not in {"id", "createdAt", "updatedAt"}
    }
    payload["id"] = item_id
    payload["createdAt"] = created_at
    payload["updatedAt"] = updated_at
    return payload


@bp.route(route="${modelCamel}", methods=["GET"])
def ${modelSnake}_get_all(req: func.HttpRequest) -> func.HttpResponse:
    try:${readGuard}
        container = _get_container()
        items = list(
            container.query_items(
                query="SELECT * FROM c",
                enable_cross_partition_query=True,
            )
        )
        return _json_response(items, 200)
    except Exception as exc:${authCatch}
        return _json_response({"error": "Failed to fetch items", "details": str(exc)}, 500)


@bp.route(route="${modelCamel}/{id}", methods=["GET"])
def ${modelSnake}_get_by_id(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    try:${readGuard}
        container = _get_container()
        item = container.read_item(item=item_id, partition_key=item_id)
        return _json_response(item, 200)
    except exceptions.CosmosResourceNotFoundError:
        return _json_response({"error": "${modelName} not found", "id": item_id}, 404)
    except Exception as exc:${authCatch}
        return _json_response({"error": "Failed to fetch item", "id": item_id, "details": str(exc)}, 500)


@bp.route(route="${modelCamel}", methods=["POST"])
def ${modelSnake}_create(req: func.HttpRequest) -> func.HttpResponse:
    try:${writeGuard}
        body = req.get_json()
        now = datetime.now(timezone.utc).isoformat()
        item_id = body.get("id") or str(uuid4())
        payload = _build_managed_document(body, item_id, now, now)

        container = _get_container()
        container.create_item(payload)
        return _json_response(payload, 201)
    except ValueError:
        return _json_response({"error": "Request body must be a JSON object."}, 400)
    except Exception as exc:${authCatch}
        return _json_response({"error": "Failed to create item", "details": str(exc)}, 500)


@bp.route(route="${modelCamel}/{id}", methods=["PUT"])
def ${modelSnake}_update(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    try:${writeGuard}
        container = _get_container()
        existing = container.read_item(item=item_id, partition_key=item_id)
        body = req.get_json()
        payload = _build_managed_document(
            body,
            item_id,
            existing.get("createdAt") or datetime.now(timezone.utc).isoformat(),
            datetime.now(timezone.utc).isoformat(),
        )
        container.replace_item(item=item_id, body=payload)
        return _json_response(payload, 200)
    except exceptions.CosmosResourceNotFoundError:
        return _json_response({"error": "${modelName} not found", "id": item_id}, 404)
    except ValueError:
        return _json_response({"error": "Request body must be a JSON object.", "id": item_id}, 400)
    except Exception as exc:${authCatch}
        return _json_response({"error": "Failed to update item", "id": item_id, "details": str(exc)}, 500)


@bp.route(route="${modelCamel}/{id}", methods=["DELETE"])
def ${modelSnake}_delete(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    try:${writeGuard}
        container = _get_container()
        container.delete_item(item=item_id, partition_key=item_id)
        return func.HttpResponse(status_code=204)
    except exceptions.CosmosResourceNotFoundError:
        return _json_response({"error": "${modelName} not found", "id": item_id}, 404)
    except Exception as exc:${authCatch}
        return _json_response({"error": "Failed to delete item", "id": item_id, "details": str(exc)}, 500)
`,
  };
}
