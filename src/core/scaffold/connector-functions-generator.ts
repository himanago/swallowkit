/**
 * コネクタ用 Azure Functions CRUD コード生成
 * RDB（MySQL/PostgreSQL/SQL Server）および 外部 REST API コネクタ向けのハンドラーを生成
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";
import {
  ConnectorDefinition,
  RdbConnectorConfig,
  ApiConnectorConfig,
  RdbModelConnectorConfig,
  ApiModelConnectorConfig,
  ConnectorOperation,
} from "../../types";

// ─── TypeScript Generators ────────────────────────────────────────

/**
 * RDB コネクタ用 TypeScript Azure Functions を生成
 */
export function generateRdbConnectorFunctionTS(
  model: ModelInfo,
  sharedPackageName: string,
  connectorDef: RdbConnectorConfig,
  modelConnector: RdbModelConnectorConfig
): string {
  const modelCamel = toCamelCase(model.name);
  const schemaName = model.schemaName;
  const ops = new Set(modelConnector.operations);
  const table = modelConnector.table;
  const idCol = modelConnector.idColumn || "id";
  const envVar = connectorDef.connectionEnvVar;
  const provider = connectorDef.provider;

  const driverImport = provider === "mysql"
    ? `import mysql from 'mysql2/promise';`
    : provider === "postgres"
    ? `import pg from 'pg';`
    : `import sql from 'mssql';`;

  const getConnection = provider === "mysql"
    ? `async function getConnection() {
  return mysql.createConnection(process.env.${envVar}!);
}`
    : provider === "postgres"
    ? `async function getConnection() {
  const client = new pg.Client(process.env.${envVar}!);
  await client.connect();
  return client;
}`
    : `async function getConnection() {
  return sql.connect(process.env.${envVar}!);
}`;

  const queryAll = provider === "mysql"
    ? `const conn = await getConnection();
      try {
        const [rows] = await conn.query('SELECT * FROM ${table}');
        const validated = z.array(${schemaName}).parse(rows);
        return { status: 200, jsonBody: validated };
      } finally {
        await conn.end();
      }`
    : provider === "postgres"
    ? `const client = await getConnection();
      try {
        const result = await client.query('SELECT * FROM ${table}');
        const validated = z.array(${schemaName}).parse(result.rows);
        return { status: 200, jsonBody: validated };
      } finally {
        await client.end();
      }`
    : `const pool = await getConnection();
      try {
        const result = await pool.request().query('SELECT * FROM ${table}');
        const validated = z.array(${schemaName}).parse(result.recordset);
        return { status: 200, jsonBody: validated };
      } finally {
        await pool.close();
      }`;

  const queryById = provider === "mysql"
    ? `const conn = await getConnection();
      try {
        const [rows] = await conn.query('SELECT * FROM ${table} WHERE ${idCol} = ?', [id]);
        const items = rows as any[];
        if (items.length === 0) {
          return { status: 404, jsonBody: { error: 'Item not found' } };
        }
        const validated = ${schemaName}.parse(items[0]);
        return { status: 200, jsonBody: validated };
      } finally {
        await conn.end();
      }`
    : provider === "postgres"
    ? `const client = await getConnection();
      try {
        const result = await client.query('SELECT * FROM ${table} WHERE ${idCol} = $1', [id]);
        if (result.rows.length === 0) {
          return { status: 404, jsonBody: { error: 'Item not found' } };
        }
        const validated = ${schemaName}.parse(result.rows[0]);
        return { status: 200, jsonBody: validated };
      } finally {
        await client.end();
      }`
    : `const pool = await getConnection();
      try {
        const result = await pool.request()
          .input('id', id)
          .query('SELECT * FROM ${table} WHERE ${idCol} = @id');
        if (result.recordset.length === 0) {
          return { status: 404, jsonBody: { error: 'Item not found' } };
        }
        const validated = ${schemaName}.parse(result.recordset[0]);
        return { status: 200, jsonBody: validated };
      } finally {
        await pool.close();
      }`;

  let code = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod/v4';
import { ${schemaName} } from '${sharedPackageName}';
${driverImport}

${getConnection}
`;

  if (ops.has("getAll")) {
    code += `
// GET /api/${modelCamel} - 全件取得
app.http('${modelCamel}-get-all', {
  methods: ['GET'],
  route: '${modelCamel}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      ${queryAll}
    } catch (error) {
      context.error(\`Error fetching from ${table}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch items' } };
    }
  },
});
`;
  }

  if (ops.has("getById")) {
    code += `
// GET /api/${modelCamel}/{id} - ID指定取得
app.http('${modelCamel}-get-by-id', {
  methods: ['GET'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }
      ${queryById}
    } catch (error) {
      context.error(\`Error fetching item from ${table}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch item' } };
    }
  },
});
`;
  }

  return code;
}

/**
 * API コネクタ用 TypeScript Azure Functions を生成
 */
export function generateApiConnectorFunctionTS(
  model: ModelInfo,
  sharedPackageName: string,
  connectorDef: ApiConnectorConfig,
  modelConnector: ApiModelConnectorConfig
): string {
  const modelCamel = toCamelCase(model.name);
  const schemaName = model.schemaName;
  const ops = new Set(modelConnector.operations);
  const baseUrlEnv = connectorDef.baseUrlEnvVar;
  const endpoints = modelConnector.endpoints || {};

  const authSetup = generateTSAuthSetup(connectorDef);

  let code = `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod/v4';
import { ${schemaName} } from '${sharedPackageName}';

function getBaseUrl(): string {
  return process.env.${baseUrlEnv} || '';
}

${authSetup.helperCode}
`;

  if (ops.has("getAll")) {
    const endpoint = endpoints.getAll || `GET /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    code += `
// GET /api/${modelCamel} - 全件取得
app.http('${modelCamel}-get-all', {
  methods: ['GET'],
  route: '${modelCamel}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = getBaseUrl() + '${epPath}';
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...getAuthHeaders() },
      });

      if (!response.ok) {
        context.error(\`External API error: \${response.status}\`);
        return { status: response.status, jsonBody: { error: 'External API request failed' } };
      }

      const data = await response.json();
      const validated = z.array(${schemaName}).parse(data);
      return { status: 200, jsonBody: validated };
    } catch (error) {
      context.error(\`Error fetching from external API:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch items' } };
    }
  },
});
`;
  }

  if (ops.has("getById")) {
    const endpoint = endpoints.getById || `GET /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    code += `
// GET /api/${modelCamel}/{id} - ID指定取得
app.http('${modelCamel}-get-by-id', {
  methods: ['GET'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }
      const url = getBaseUrl() + '${epPath}'.replace('{id}', id);
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...getAuthHeaders() },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { status: 404, jsonBody: { error: 'Item not found' } };
        }
        return { status: response.status, jsonBody: { error: 'External API request failed' } };
      }

      const data = await response.json();
      const validated = ${schemaName}.parse(data);
      return { status: 200, jsonBody: validated };
    } catch (error) {
      context.error(\`Error fetching item from external API:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to fetch item' } };
    }
  },
});
`;
  }

  if (ops.has("create")) {
    const endpoint = endpoints.create || `POST /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    code += `
// POST /api/${modelCamel} - 新規作成
app.http('${modelCamel}-create', {
  methods: ['POST'],
  route: '${modelCamel}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json();
      const url = getBaseUrl() + '${epPath}';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        context.error(\`External API error: \${response.status} \${errorText}\`);
        return { status: response.status, jsonBody: { error: 'External API request failed' } };
      }

      const data = await response.json();
      return { status: 201, jsonBody: data };
    } catch (error) {
      context.error(\`Error creating item via external API:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to create item' } };
    }
  },
});
`;
  }

  if (ops.has("update")) {
    const endpoint = endpoints.update || `PUT /${modelCamel}/{id}`;
    const parts = endpoint.split(" ");
    const method = parts[0];
    const epPath = parts[1];
    code += `
// PUT /api/${modelCamel}/{id} - 更新
app.http('${modelCamel}-update', {
  methods: ['PUT'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }
      const body = await request.json();
      const url = getBaseUrl() + '${epPath}'.replace('{id}', id);
      const response = await fetch(url, {
        method: '${method}',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        context.error(\`External API error: \${response.status} \${errorText}\`);
        return { status: response.status, jsonBody: { error: 'External API request failed' } };
      }

      const data = await response.json();
      return { status: 200, jsonBody: data };
    } catch (error) {
      context.error(\`Error updating item via external API:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to update item' } };
    }
  },
});
`;
  }

  if (ops.has("delete")) {
    const endpoint = endpoints.delete || `DELETE /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    code += `
// DELETE /api/${modelCamel}/{id} - 削除
app.http('${modelCamel}-delete', {
  methods: ['DELETE'],
  route: '${modelCamel}/{id}',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }
      const url = getBaseUrl() + '${epPath}'.replace('{id}', id);
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() },
      });

      if (!response.ok && response.status !== 404) {
        return { status: response.status, jsonBody: { error: 'External API request failed' } };
      }

      return { status: 204 };
    } catch (error) {
      context.error(\`Error deleting item via external API:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to delete item' } };
    }
  },
});
`;
  }

  return code;
}

function generateTSAuthSetup(connectorDef: ApiConnectorConfig): { helperCode: string } {
  if (!connectorDef.auth) {
    return {
      helperCode: `function getAuthHeaders(): Record<string, string> {
  return {};
}`,
    };
  }

  const { type, envVar, placement, paramName } = connectorDef.auth;

  if (type === "apiKey" && placement === "query") {
    return {
      helperCode: `function getAuthHeaders(): Record<string, string> {
  return {};
}

function appendAuthQuery(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + '${paramName || "apiKey"}=' + encodeURIComponent(process.env.${envVar} || '');
}`,
    };
  }

  if (type === "apiKey" && placement !== "query") {
    return {
      helperCode: `function getAuthHeaders(): Record<string, string> {
  return { '${paramName || "X-Api-Key"}': process.env.${envVar} || '' };
}`,
    };
  }

  // bearer
  return {
    helperCode: `function getAuthHeaders(): Record<string, string> {
  return { 'Authorization': 'Bearer ' + (process.env.${envVar} || '') };
}`,
  };
}

// ─── C# Generators ────────────────────────────────────────────────

/**
 * RDB コネクタ用 C# Azure Functions を生成
 */
export function generateRdbConnectorFunctionCSharp(
  model: ModelInfo,
  connectorDef: RdbConnectorConfig,
  modelConnector: RdbModelConnectorConfig
): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const className = `${modelName}ConnectorFunctions`;
  const ops = new Set(modelConnector.operations);
  const table = modelConnector.table;
  const idCol = modelConnector.idColumn || "id";
  const envVar = connectorDef.connectionEnvVar;
  const provider = connectorDef.provider;

  const usingStatements = provider === "mysql"
    ? `using MySqlConnector;`
    : provider === "postgres"
    ? `using Npgsql;`
    : `using Microsoft.Data.SqlClient;`;

  const connType = provider === "mysql"
    ? "MySqlConnection"
    : provider === "postgres"
    ? "NpgsqlConnection"
    : "SqlConnection";

  const cmdType = provider === "mysql"
    ? "MySqlCommand"
    : provider === "postgres"
    ? "NpgsqlCommand"
    : "SqlCommand";

  const paramPrefix = provider === "mysql" ? "@" : provider === "postgres" ? "@" : "@";

  let methods = "";

  if (ops.has("getAll")) {
    methods += `
    [Function("${modelCamel}GetAll")]
    public async Task<HttpResponseData> GetAll(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}")] HttpRequestData request)
    {
        try
        {
            using var connection = new ${connType}(Environment.GetEnvironmentVariable("${envVar}"));
            await connection.OpenAsync();

            using var command = new ${cmdType}("SELECT * FROM ${table}", connection);
            using var reader = await command.ExecuteReaderAsync();
            var items = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync())
            {
                var item = new Dictionary<string, object?>();
                for (int i = 0; i < reader.FieldCount; i++)
                {
                    item[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
                }
                items.Add(item);
            }

            return await WriteJsonAsync(request, HttpStatusCode.OK, items);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch items from ${table}.");
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch items" });
        }
    }
`;
  }

  if (ops.has("getById")) {
    methods += `
    [Function("${modelCamel}GetById")]
    public async Task<HttpResponseData> GetById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {
            using var connection = new ${connType}(Environment.GetEnvironmentVariable("${envVar}"));
            await connection.OpenAsync();

            using var command = new ${cmdType}("SELECT * FROM ${table} WHERE ${idCol} = ${paramPrefix}id", connection);
            command.Parameters.AddWithValue("${paramPrefix}id", id);
            using var reader = await command.ExecuteReaderAsync();

            if (!await reader.ReadAsync())
            {
                return await WriteJsonAsync(request, HttpStatusCode.NotFound, new { error = "${modelName} not found", id });
            }

            var item = new Dictionary<string, object?>();
            for (int i = 0; i < reader.FieldCount; i++)
            {
                item[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            return await WriteJsonAsync(request, HttpStatusCode.OK, item);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ${modelName} item {Id} from ${table}.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch item", id });
        }
    }
`;
  }

  return `using System.Net;
using System.Text.Json;
${usingStatements}
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace SwallowKit.Functions;

public sealed class ${className}
{
    private readonly ILogger<${className}> _logger;

    public ${className}(ILogger<${className}> logger)
    {
        _logger = logger;
    }

    private static async Task<HttpResponseData> WriteJsonAsync(HttpRequestData request, HttpStatusCode status, object payload)
    {
        var response = request.CreateResponse(status);
        await response.WriteAsJsonAsync(payload);
        return response;
    }
${methods}}
`;
}

/**
 * API コネクタ用 C# Azure Functions を生成
 */
export function generateApiConnectorFunctionCSharp(
  model: ModelInfo,
  connectorDef: ApiConnectorConfig,
  modelConnector: ApiModelConnectorConfig
): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const className = `${modelName}ConnectorFunctions`;
  const ops = new Set(modelConnector.operations);
  const baseUrlEnv = connectorDef.baseUrlEnvVar;
  const endpoints = modelConnector.endpoints || {};

  const authSetup = generateCSharpAuthSetup(connectorDef);

  let methods = "";

  if (ops.has("getAll")) {
    const endpoint = endpoints.getAll || `GET /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    methods += `
    [Function("${modelCamel}GetAll")]
    public async Task<HttpResponseData> GetAll(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}")] HttpRequestData request)
    {
        try
        {
            var url = BaseUrl + "${epPath}";
            using var httpRequest = new HttpRequestMessage(HttpMethod.Get, url);
            ${authSetup.applyAuth}
            var response = await _httpClient.SendAsync(httpRequest);

            if (!response.IsSuccessStatusCode)
            {
                return await WriteJsonAsync(request, (HttpStatusCode)response.StatusCode, new { error = "External API request failed" });
            }

            var content = await response.Content.ReadAsStringAsync();
            var data = JsonSerializer.Deserialize<JsonElement>(content);
            return await WriteJsonAsync(request, HttpStatusCode.OK, data);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ${modelName} items from external API.");
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch items" });
        }
    }
`;
  }

  if (ops.has("getById")) {
    const endpoint = endpoints.getById || `GET /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    methods += `
    [Function("${modelCamel}GetById")]
    public async Task<HttpResponseData> GetById(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {
            var url = BaseUrl + "${epPath}".Replace("{id}", id);
            using var httpRequest = new HttpRequestMessage(HttpMethod.Get, url);
            ${authSetup.applyAuth}
            var response = await _httpClient.SendAsync(httpRequest);

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return await WriteJsonAsync(request, HttpStatusCode.NotFound, new { error = "${modelName} not found", id });
            }
            if (!response.IsSuccessStatusCode)
            {
                return await WriteJsonAsync(request, (HttpStatusCode)response.StatusCode, new { error = "External API request failed" });
            }

            var content = await response.Content.ReadAsStringAsync();
            var data = JsonSerializer.Deserialize<JsonElement>(content);
            return await WriteJsonAsync(request, HttpStatusCode.OK, data);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch ${modelName} item {Id} from external API.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to fetch item", id });
        }
    }
`;
  }

  if (ops.has("create")) {
    const endpoint = endpoints.create || `POST /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    methods += `
    [Function("${modelCamel}Create")]
    public async Task<HttpResponseData> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "${modelCamel}")] HttpRequestData request)
    {
        try
        {
            using var reader = new StreamReader(request.Body);
            var body = await reader.ReadToEndAsync();
            var url = BaseUrl + "${epPath}";
            using var httpRequest = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")
            };
            ${authSetup.applyAuth}
            var response = await _httpClient.SendAsync(httpRequest);

            var content = await response.Content.ReadAsStringAsync();
            var data = JsonSerializer.Deserialize<JsonElement>(content);
            var status = response.IsSuccessStatusCode ? HttpStatusCode.Created : (HttpStatusCode)response.StatusCode;
            return await WriteJsonAsync(request, status, data);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create ${modelName} item via external API.");
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to create item" });
        }
    }
`;
  }

  if (ops.has("update")) {
    const endpoint = endpoints.update || `PUT /${modelCamel}/{id}`;
    const parts = endpoint.split(" ");
    const httpMethod = parts[0] === "PATCH" ? "Patch" : "Put";
    const epPath = parts[1];
    methods += `
    [Function("${modelCamel}Update")]
    public async Task<HttpResponseData> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {
            using var reader = new StreamReader(request.Body);
            var body = await reader.ReadToEndAsync();
            var url = BaseUrl + "${epPath}".Replace("{id}", id);
            using var httpRequest = new HttpRequestMessage(HttpMethod.${httpMethod}, url)
            {
                Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")
            };
            ${authSetup.applyAuth}
            var response = await _httpClient.SendAsync(httpRequest);

            var content = await response.Content.ReadAsStringAsync();
            var data = JsonSerializer.Deserialize<JsonElement>(content);
            return await WriteJsonAsync(request, response.IsSuccessStatusCode ? HttpStatusCode.OK : (HttpStatusCode)response.StatusCode, data);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update ${modelName} item {Id} via external API.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to update item", id });
        }
    }
`;
  }

  if (ops.has("delete")) {
    const endpoint = endpoints.delete || `DELETE /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    methods += `
    [Function("${modelCamel}Delete")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "${modelCamel}/{id}")] HttpRequestData request,
        string id)
    {
        try
        {
            var url = BaseUrl + "${epPath}".Replace("{id}", id);
            using var httpRequest = new HttpRequestMessage(HttpMethod.Delete, url);
            ${authSetup.applyAuth}
            var response = await _httpClient.SendAsync(httpRequest);

            if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
            {
                return await WriteJsonAsync(request, (HttpStatusCode)response.StatusCode, new { error = "External API request failed" });
            }

            return request.CreateResponse(HttpStatusCode.NoContent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete ${modelName} item {Id} via external API.", id);
            return await WriteJsonAsync(request, HttpStatusCode.InternalServerError, new { error = "Failed to delete item", id });
        }
    }
`;
  }

  return `using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace SwallowKit.Functions;

public sealed class ${className}
{
    private readonly ILogger<${className}> _logger;
    private readonly HttpClient _httpClient;
    private static string BaseUrl => Environment.GetEnvironmentVariable("${baseUrlEnv}") ?? "";
    ${authSetup.fieldDecl}

    public ${className}(ILogger<${className}> logger, HttpClient httpClient)
    {
        _logger = logger;
        _httpClient = httpClient;
    }

    private static async Task<HttpResponseData> WriteJsonAsync(HttpRequestData request, HttpStatusCode status, object payload)
    {
        var response = request.CreateResponse(status);
        await response.WriteAsJsonAsync(payload);
        return response;
    }
${methods}}
`;
}

function generateCSharpAuthSetup(connectorDef: ApiConnectorConfig): { fieldDecl: string; applyAuth: string } {
  if (!connectorDef.auth) {
    return { fieldDecl: "", applyAuth: "" };
  }

  const { type, envVar, placement, paramName } = connectorDef.auth;

  if (type === "apiKey" && placement === "query") {
    return {
      fieldDecl: "",
      applyAuth: `// API key is appended as query parameter
            var uriBuilder = new UriBuilder(httpRequest.RequestUri!);
            var query = System.Web.HttpUtility.ParseQueryString(uriBuilder.Query);
            query["${paramName || "apiKey"}"] = Environment.GetEnvironmentVariable("${envVar}");
            uriBuilder.Query = query.ToString();
            httpRequest.RequestUri = uriBuilder.Uri;`,
    };
  }

  if (type === "apiKey") {
    return {
      fieldDecl: "",
      applyAuth: `httpRequest.Headers.Add("${paramName || "X-Api-Key"}", Environment.GetEnvironmentVariable("${envVar}"));`,
    };
  }

  // bearer
  return {
    fieldDecl: "",
    applyAuth: `httpRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Environment.GetEnvironmentVariable("${envVar}"));`,
  };
}

// ─── Python Generators ────────────────────────────────────────────

/**
 * RDB コネクタ用 Python Azure Functions を生成
 */
export function generateRdbConnectorFunctionPython(
  model: ModelInfo,
  connectorDef: RdbConnectorConfig,
  modelConnector: RdbModelConnectorConfig
): { blueprint: string; registration: string } {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelSnake = toKebabCase(modelName).replace(/-/g, "_");
  const ops = new Set(modelConnector.operations);
  const table = modelConnector.table;
  const idCol = modelConnector.idColumn || "id";
  const envVar = connectorDef.connectionEnvVar;

  let handlers = "";

  if (ops.has("getAll")) {
    handlers += `
@bp.route(route="${modelCamel}", methods=["GET"])
def ${modelSnake}_get_all(req: func.HttpRequest) -> func.HttpResponse:
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM ${table}")
        items = cursor.fetchall()
        cursor.close()
        conn.close()
        return _json_response(items, 200)
    except Exception as e:
        logging.error(f"Error fetching from ${table}: {e}")
        return _json_response({"error": "Failed to fetch items"}, 500)
`;
  }

  if (ops.has("getById")) {
    handlers += `
@bp.route(route="${modelCamel}/{id}", methods=["GET"])
def ${modelSnake}_get_by_id(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    if not item_id:
        return _json_response({"error": "ID is required"}, 400)
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM ${table} WHERE ${idCol} = %s", (item_id,))
        item = cursor.fetchone()
        cursor.close()
        conn.close()
        if item is None:
            return _json_response({"error": "Item not found"}, 404)
        return _json_response(item, 200)
    except Exception as e:
        logging.error(f"Error fetching item from ${table}: {e}")
        return _json_response({"error": "Failed to fetch item"}, 500)
`;
  }

  const blueprint = `import json
import logging
import os

import azure.functions as func
import mysql.connector

bp = func.Blueprint()


def _json_response(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False, default=str),
        status_code=status_code,
        mimetype="application/json",
    )


def get_connection():
    return mysql.connector.connect(
        host=os.environ.get("${envVar}_HOST", "localhost"),
        user=os.environ.get("${envVar}_USER", ""),
        password=os.environ.get("${envVar}_PASSWORD", ""),
        database=os.environ.get("${envVar}_DATABASE", ""),
    )

${handlers}`;

  return {
    blueprint,
    registration: `from blueprints.${modelSnake} import bp as ${modelSnake}_bp\napp.register_blueprint(${modelSnake}_bp)`,
  };
}

/**
 * API コネクタ用 Python Azure Functions を生成
 */
export function generateApiConnectorFunctionPython(
  model: ModelInfo,
  connectorDef: ApiConnectorConfig,
  modelConnector: ApiModelConnectorConfig
): { blueprint: string; registration: string } {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelSnake = toKebabCase(modelName).replace(/-/g, "_");
  const ops = new Set(modelConnector.operations);
  const baseUrlEnv = connectorDef.baseUrlEnvVar;
  const endpoints = modelConnector.endpoints || {};

  const authSetup = generatePythonAuthSetup(connectorDef);

  let handlers = "";

  if (ops.has("getAll")) {
    const endpoint = endpoints.getAll || `GET /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    handlers += `
@bp.route(route="${modelCamel}", methods=["GET"])
def ${modelSnake}_get_all(req: func.HttpRequest) -> func.HttpResponse:
    try:
        url = BASE_URL + "${epPath}"
        response = requests.get(url, ${authSetup.requestKwargs})
        response.raise_for_status()
        return _json_response(response.json(), 200)
    except Exception as e:
        logging.error(f"Error fetching from external API: {e}")
        return _json_response({"error": "Failed to fetch items"}, 500)
`;
  }

  if (ops.has("getById")) {
    const endpoint = endpoints.getById || `GET /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    handlers += `
@bp.route(route="${modelCamel}/{id}", methods=["GET"])
def ${modelSnake}_get_by_id(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    if not item_id:
        return _json_response({"error": "ID is required"}, 400)
    try:
        url = BASE_URL + "${epPath}".replace("{id}", item_id)
        response = requests.get(url, ${authSetup.requestKwargs})
        if response.status_code == 404:
            return _json_response({"error": "Item not found"}, 404)
        response.raise_for_status()
        return _json_response(response.json(), 200)
    except Exception as e:
        logging.error(f"Error fetching item from external API: {e}")
        return _json_response({"error": "Failed to fetch item"}, 500)
`;
  }

  if (ops.has("create")) {
    const endpoint = endpoints.create || `POST /${modelCamel}`;
    const [, epPath] = endpoint.split(" ");
    handlers += `
@bp.route(route="${modelCamel}", methods=["POST"])
def ${modelSnake}_create(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
        url = BASE_URL + "${epPath}"
        response = requests.post(url, json=body, ${authSetup.requestKwargs})
        response.raise_for_status()
        return _json_response(response.json(), 201)
    except Exception as e:
        logging.error(f"Error creating item via external API: {e}")
        return _json_response({"error": "Failed to create item"}, 500)
`;
  }

  if (ops.has("update")) {
    const endpoint = endpoints.update || `PUT /${modelCamel}/{id}`;
    const parts = endpoint.split(" ");
    const method = parts[0].toLowerCase();
    const epPath = parts[1];
    handlers += `
@bp.route(route="${modelCamel}/{id}", methods=["PUT"])
def ${modelSnake}_update(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    if not item_id:
        return _json_response({"error": "ID is required"}, 400)
    try:
        body = req.get_json()
        url = BASE_URL + "${epPath}".replace("{id}", item_id)
        response = requests.${method}(url, json=body, ${authSetup.requestKwargs})
        response.raise_for_status()
        return _json_response(response.json(), 200)
    except Exception as e:
        logging.error(f"Error updating item via external API: {e}")
        return _json_response({"error": "Failed to update item"}, 500)
`;
  }

  if (ops.has("delete")) {
    const endpoint = endpoints.delete || `DELETE /${modelCamel}/{id}`;
    const [, epPath] = endpoint.split(" ");
    handlers += `
@bp.route(route="${modelCamel}/{id}", methods=["DELETE"])
def ${modelSnake}_delete(req: func.HttpRequest) -> func.HttpResponse:
    item_id = req.route_params.get("id")
    if not item_id:
        return _json_response({"error": "ID is required"}, 400)
    try:
        url = BASE_URL + "${epPath}".replace("{id}", item_id)
        response = requests.delete(url, ${authSetup.requestKwargs})
        return func.HttpResponse(status_code=204)
    except Exception as e:
        logging.error(f"Error deleting item via external API: {e}")
        return _json_response({"error": "Failed to delete item"}, 500)
`;
  }

  const blueprint = `import json
import logging
import os

import azure.functions as func
import requests

bp = func.Blueprint()
BASE_URL = os.environ.get("${baseUrlEnv}", "")
${authSetup.setup}


def _json_response(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False, default=str),
        status_code=status_code,
        mimetype="application/json",
    )

${handlers}`;

  return {
    blueprint,
    registration: `from blueprints.${modelSnake} import bp as ${modelSnake}_bp\napp.register_blueprint(${modelSnake}_bp)`,
  };
}

function generatePythonAuthSetup(connectorDef: ApiConnectorConfig): { setup: string; requestKwargs: string } {
  if (!connectorDef.auth) {
    return { setup: "", requestKwargs: "timeout=30" };
  }

  const { type, envVar, placement, paramName } = connectorDef.auth;

  if (type === "apiKey" && placement === "query") {
    return {
      setup: `API_KEY = os.environ.get("${envVar}", "")`,
      requestKwargs: `params={"${paramName || "apiKey"}": API_KEY}, timeout=30`,
    };
  }

  if (type === "apiKey") {
    return {
      setup: `API_KEY = os.environ.get("${envVar}", "")`,
      requestKwargs: `headers={"${paramName || "X-Api-Key"}": API_KEY}, timeout=30`,
    };
  }

  // bearer
  return {
    setup: `AUTH_TOKEN = os.environ.get("${envVar}", "")`,
    requestKwargs: `headers={"Authorization": f"Bearer {AUTH_TOKEN}"}, timeout=30`,
  };
}

// ─── Helper: check if model has write operations ──────────────────

/**
 * モデルのコネクタ操作が読み取り専用かどうかを判定
 */
export function isReadOnlyConnector(operations: readonly ConnectorOperation[]): boolean {
  const writeOps: ConnectorOperation[] = ["create", "update", "delete"];
  return !operations.some(op => writeOps.includes(op));
}
