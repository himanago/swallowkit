# Connector Guide

## Overview

SwallowKit's **Connector** feature extends your project beyond Cosmos DB by integrating with external data sources — relational databases (MySQL, PostgreSQL, SQL Server) and SaaS REST APIs. Connectors let you treat external data the same way you treat Cosmos DB models: define a Zod schema, scaffold, and get full-stack CRUD with type-safe UI, BFF routes, and Azure Functions — all generated automatically.

💡 **Key concept**: A connector model is a standard Zod model with an additional `connectorConfig` export that tells SwallowKit how to reach the external data source.

## Architecture

Connector models plug into the same architecture as standard Cosmos DB models. The frontend and BFF layer are completely unaware of the underlying data source — the difference is only in the Functions layer.

### Standard Model (Cosmos DB)

```
Frontend → BFF (Next.js API Routes) → Azure Functions → Cosmos DB
```

### Connector Model

```
Frontend → BFF (Next.js API Routes) → Azure Functions → External Source (RDB / API)
```

The BFF routes generated for connector models are **identical** to standard models. This means:

- The frontend consumes all models through the same interface
- You can migrate a model from Cosmos DB to an external source (or vice versa) without changing the frontend
- UI components are generated the same way regardless of the data source

### Local Development with Mock Connectors

```
Frontend → BFF → Mock Proxy (:7072) ──┬─ Connector routes → In-memory CRUD (Zod-generated data)
                                      └─ Other routes → Azure Functions (:7071)
```

The mock proxy intercepts requests to connector models and serves realistic fake data, while proxying standard Cosmos DB model requests to the real Azure Functions runtime.

## Getting Started

### 1. Add a Connector to Config

Use the `add-connector` command to register a new external data source:

```bash
# Add an RDB connector (MySQL)
npx swallowkit add-connector mysql --type rdb --provider mysql

# Add an API connector (Backlog)
npx swallowkit add-connector backlog --type api
```

This adds entries to the `connectors` section of your `swallowkit.config.js`. You can also edit the config file manually — see the [Configuration Reference](#configuration-reference) below.

### 2. Create a Connector Model

Use `create-model` with the `--connector` flag to generate a model template that includes `connectorConfig`:

```bash
# Create a model bound to the mysql connector
npx swallowkit create-model user --connector mysql

# Create a model bound to the backlog connector
npx swallowkit create-model backlog-issue --connector backlog
```

This generates `shared/models/user.ts` (or `backlog-issue.ts`) with a Zod schema and a `connectorConfig` export pre-filled for the specified connector.

### 3. Edit the Model

Customize the generated Zod schema and `connectorConfig` to match your actual data source:

**RDB example** (`shared/models/user.ts`):

```typescript
import { z } from 'zod/v4';

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  department: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type User = z.infer<typeof User>;
export const displayName = 'User';

export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById'] as const,
  table: 'users',
  idColumn: 'id',
};
```

**API example** (`shared/models/backlog-issue.ts`):

```typescript
import { z } from 'zod/v4';

export const BacklogIssue = z.object({
  id: z.string(),
  projectId: z.string(),
  issueKey: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  status: z.object({ id: z.number(), name: z.string() }),
  assignee: z.object({ id: z.number(), name: z.string() }).optional(),
  priority: z.object({ id: z.number(), name: z.string() }).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BacklogIssue = z.infer<typeof BacklogIssue>;
export const displayName = 'BacklogIssue';

export const connectorConfig = {
  connector: 'backlog',
  operations: ['getAll', 'getById', 'create', 'update'] as const,
  endpoints: {
    getAll: 'GET /issues',
    getById: 'GET /issues/{id}',
    create: 'POST /issues',
    update: 'PATCH /issues/{id}',
  },
};
```

### 4. Scaffold

Run `scaffold` as usual — SwallowKit detects the `connectorConfig` export and generates connector-specific Functions code instead of Cosmos DB code:

```bash
npx swallowkit scaffold shared/models/user.ts
npx swallowkit scaffold shared/models/backlog-issue.ts
```

Generated files depend on the backend language:

| Component | Standard Model | Connector Model |
|-----------|---------------|-----------------|
| **Functions (C#)** | `functions/` | `functions/Connectors/` |
| **Functions (TypeScript)** | `functions/src/functions/` | `functions/src/functions/` |
| **Functions (Python)** | `functions/` | `functions/` |
| **BFF routes** | Same | Same (transparent to frontend) |
| **UI components** | Same | Same |
| **Cosmos DB Bicep** | Generated | **Skipped** |

⚠️ **Read-only models**: If `operations` only includes `getAll` and/or `getById`, scaffold will **not** generate POST, PUT, or DELETE handlers. The model is treated as read-only.

### 5. Local Development

Start the dev server with the `--mock-connectors` flag to work without real external connections:

```bash
npx swallowkit dev --mock-connectors
```

This starts the mock proxy server on port 7072 alongside the normal dev environment (Cosmos Emulator + Azure Functions on 7071 + Next.js). See [Mock Server](#mock-server) for details.

## Configuration Reference

External data sources are defined in the `connectors` section of `swallowkit.config.js`. Each key is a unique connector name used in model `connectorConfig`.

### Full Config Example

```javascript
// swallowkit.config.js
module.exports = {
  backend: { language: 'csharp' },
  functions: {
    baseUrl: process.env.BACKEND_FUNCTIONS_BASE_URL || 'http://localhost:7071',
  },
  connectors: {
    mysql: {
      type: 'rdb',
      provider: 'mysql',
      connectionEnvVar: 'MYSQL_CONNECTION_STRING',
    },
    postgres: {
      type: 'rdb',
      provider: 'postgres',
      connectionEnvVar: 'POSTGRES_CONNECTION_STRING',
    },
    backlog: {
      type: 'api',
      baseUrlEnvVar: 'BACKLOG_API_BASE_URL',
      auth: {
        type: 'apiKey',
        envVar: 'BACKLOG_API_KEY',
        placement: 'query',
        paramName: 'apiKey',
      },
    },
    internal: {
      type: 'api',
      baseUrlEnvVar: 'INTERNAL_API_BASE_URL',
      auth: {
        type: 'bearer',
        envVar: 'INTERNAL_API_TOKEN',
      },
    },
  },
};
```

### RDB Connector Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `'rdb'` | ✅ | Connector type |
| `provider` | `'mysql'` \| `'postgres'` \| `'sqlserver'` | ✅ | Database provider |
| `connectionEnvVar` | `string` | ✅ | Environment variable name holding the connection string |

### API Connector Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `'api'` | ✅ | Connector type |
| `baseUrlEnvVar` | `string` | ✅ | Environment variable name holding the API base URL |
| `auth` | `object` | ✅ | Authentication configuration (see below) |

### API Auth Types

**API Key** (`type: 'apiKey'`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `'apiKey'` | ✅ | Auth type |
| `envVar` | `string` | ✅ | Environment variable holding the API key |
| `placement` | `'query'` \| `'header'` | ✅ | Where to send the API key |
| `paramName` | `string` | ✅ | Query parameter or header name |

**Bearer Token** (`type: 'bearer'`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `'bearer'` | ✅ | Auth type |
| `envVar` | `string` | ✅ | Environment variable holding the bearer token |

**OAuth 2.0** (`type: 'oauth2'`):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `'oauth2'` | ✅ | Auth type |
| `tokenUrlEnvVar` | `string` | ✅ | Environment variable holding the token endpoint URL |
| `clientIdEnvVar` | `string` | ✅ | Environment variable holding the client ID |
| `clientSecretEnvVar` | `string` | ✅ | Environment variable holding the client secret |

## Model Metadata Reference

The `connectorConfig` export in a model file tells SwallowKit which connector to use and how to interact with the external data source.

### Common Fields

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `connector` | `string` | ✅ | Name of the connector (must match a key in `connectors` config) |
| `operations` | `readonly string[]` | ✅ | Array of enabled operations |

### RDB-Specific Fields

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `table` | `string` | ✅ | Database table name |
| `idColumn` | `string` | ✅ | Primary key column name |

```typescript
export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById', 'create', 'update', 'delete'] as const,
  table: 'products',
  idColumn: 'id',
};
```

### API-Specific Fields

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `endpoints` | `object` | ✅ | Mapping of operation names to HTTP method + path |

```typescript
export const connectorConfig = {
  connector: 'backlog',
  operations: ['getAll', 'getById', 'create'] as const,
  endpoints: {
    getAll: 'GET /issues',
    getById: 'GET /issues/{id}',
    create: 'POST /issues',
  },
};
```

Endpoint paths use `{id}` as a placeholder for the resource identifier.

## Supported Operations

| Operation | HTTP Method | RDB (Generated SQL) | API (Generated HTTP) | Description |
|-----------|-------------|---------------------|---------------------|-------------|
| `getAll` | GET | `SELECT * FROM {table}` | `GET {endpoint}` | Retrieve all records |
| `getById` | GET | `SELECT * FROM {table} WHERE {idColumn} = ?` | `GET {endpoint}/{id}` | Retrieve a single record |
| `create` | POST | `INSERT INTO {table} ...` | `POST {endpoint}` | Create a new record |
| `update` | PUT | `UPDATE {table} SET ... WHERE {idColumn} = ?` | `PATCH {endpoint}/{id}` | Update an existing record |
| `delete` | DELETE | `DELETE FROM {table} WHERE {idColumn} = ?` | `DELETE {endpoint}/{id}` | Delete a record |

💡 **Read-only pattern**: To create a read-only integration, only include `getAll` and/or `getById` in the `operations` array. Scaffold will skip write handlers, and the mock server will return 405 for write requests.

## Mock Server

The `--mock-connectors` flag on the `dev` command starts a mock proxy server that eliminates the need for real external connections during development.

### How It Works

1. **Startup**: The mock proxy starts on port 7072 and the BFF is configured to route through it
2. **Routing**: Requests for connector models are intercepted and handled in-memory; all other requests are proxied to Azure Functions on port 7071
3. **Data generation**: On startup, the mock server reads each connector model's Zod schema and generates realistic fake data using field-name heuristics (e.g., `email` fields get email-like values, `name` fields get name-like values)
4. **In-memory CRUD**: Generated data is stored in memory and supports full CRUD operations matching each model's `operations` array

### Mock Data Generation

The mock server auto-generates realistic data based on Zod schema field names and types:

| Field Pattern | Generated Value |
|--------------|-----------------|
| `email` | Email address (e.g., `user@example.com`) |
| `name` | Person or entity name |
| `url`, `website` | URL string |
| `phone` | Phone number |
| `id` | UUID string |
| `createdAt`, `updatedAt` | ISO 8601 timestamp |
| `z.number()` | Random number within constraints |
| `z.boolean()` | Random boolean |
| `z.enum([...])` | Random value from the enum |

### Dev Seeds Integration

You can provide initial data for connector models using dev-seeds JSON files:

```bash
npx swallowkit create-dev-seeds shared/models/user.ts
```

This creates a JSON seed file that the mock server loads as initial data instead of auto-generated data. The seed file format is the same as for standard Cosmos DB models.

### Unsupported Operations

If a request targets an operation not listed in the model's `operations` array, the mock server returns **405 Method Not Allowed**.

```
# If user model only has ['getAll', 'getById']:
POST /api/users → 405 Method Not Allowed
DELETE /api/users/123 → 405 Method Not Allowed
```

## Best Practices

### When to Use Connectors

- ✅ Your project needs data from an existing relational database
- ✅ You want to integrate a third-party SaaS API into your SwallowKit app
- ✅ You need a read-only view of external data alongside Cosmos DB data
- ✅ You want consistent type-safe UI and BFF layer across all data sources

### Read-Only Pattern

For external data sources you should not modify (e.g., a shared corporate database), use a read-only connector:

```typescript
export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById'] as const,
  table: 'employees',
  idColumn: 'employee_id',
};
```

This ensures:
- Only GET endpoints are generated
- No write-related UI components (create/edit forms) are generated
- The mock server rejects write attempts with 405

### Naming Conventions

- **Connector names** in config: Use lowercase, descriptive names (e.g., `mysql`, `backlog`, `salesforce`)
- **Model files**: Use kebab-case matching the model name (e.g., `backlog-issue.ts`)
- **Environment variables**: Use UPPER_SNAKE_CASE with a clear prefix (e.g., `BACKLOG_API_BASE_URL`, `MYSQL_CONNECTION_STRING`)

### Environment Variable Management

Store all connector credentials in environment variables — never hardcode connection strings or API keys:

```bash
# .env.local (for local development)
MYSQL_CONNECTION_STRING=mysql://user:pass@localhost:3306/mydb
BACKLOG_API_BASE_URL=https://your-space.backlog.com/api/v2
BACKLOG_API_KEY=your-api-key-here
```

### Mixing Cosmos DB and Connector Models

You can freely mix standard Cosmos DB models and connector models in the same project. The frontend and BFF layer treat them identically — only the Functions layer differs.

## Limitations

The following are current limitations of the connector feature:

- **No caching layer**: Connector-generated Functions do not include caching. Add caching manually if needed for high-traffic external API calls
- **No custom auth flows**: OAuth 2.0 supports only the client credentials flow. Interactive/authorization code flows are not supported
- **No pagination pass-through**: The `getAll` operation does not pass pagination parameters to the external source. Implement pagination manually for large datasets
- **No JOIN / relations**: RDB connectors operate on a single table per model. Cross-table queries require custom implementation
- **No schema migration**: SwallowKit does not create or migrate database tables for RDB connectors — tables must already exist
- **No webhook / event support**: Connectors are request-response only; push-based integrations are not supported
- **No connection pooling config**: RDB connection pooling relies on the driver defaults; advanced pool configuration is not exposed

💡 **Reference**: For CLI command details, see the **[CLI Reference](./cli-reference.md)**. For standard Cosmos DB model scaffolding, see the **[Scaffold Guide](./scaffold-guide.md)**.
