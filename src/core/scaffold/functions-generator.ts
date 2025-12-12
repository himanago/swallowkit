/**
 * Azure Functions CRUD コード生成
 * Cosmos DB 入出力バインディングを使用した Azure Functions のベストプラクティスに従う
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";

/**
 * Azure Functions の CRUD 操作（Create, Read, Update, Delete, List）を生成
 */
export function generateAzureFunctionsCRUD(model: ModelInfo): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  const schemaName = model.schemaName;
  
  return `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';

// Import the shared Zod schema (auto-generated copy)
import { ${schemaName}, ${modelName} } from './models/${modelKebab}';

/**
 * Get all ${modelName} items
 * GET /api/${modelCamel}
 */
export async function get${modelName}s(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    // Cosmos DB input binding will inject documents here
    const documents = context.extraInputs.get('${modelCamel}Documents');
    
    if (!documents || !Array.isArray(documents)) {
      return {
        status: 200,
        jsonBody: [],
      };
    }
    
    // Validate with Zod schema
    const validated = z.array(${schemaName}).parse(documents);
    
    return {
      status: 200,
      jsonBody: validated,
    };
  } catch (error) {
    context.error('Error fetching ${modelCamel}s:', error);
    return {
      status: 500,
      jsonBody: { error: 'Failed to fetch ${modelCamel}s' },
    };
  }
}

app.http('get${modelName}s', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '${modelCamel}',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: '${modelCamel}Documents',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName: '${modelName}s',
      connection: 'CosmosDBConnection',
      sqlQuery: 'SELECT * FROM c',
    },
  ],
  handler: get${modelName}s,
});

/**
 * Get a single ${modelName} by ID
 * GET /api/${modelCamel}/{id}
 */
export async function get${modelName}ById(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const id = request.params.id;
    
    if (!id) {
      return {
        status: 400,
        jsonBody: { error: 'ID is required' },
      };
    }
    
    // Cosmos DB input binding will inject the document here
    const document = context.extraInputs.get('${modelCamel}Document');
    
    if (!document) {
      return {
        status: 404,
        jsonBody: { error: '${modelName} not found' },
      };
    }
    
    // Validate with Zod schema
    const validated = ${schemaName}.parse(document);
    
    return {
      status: 200,
      jsonBody: validated,
    };
  } catch (error) {
    context.error('Error fetching ${modelCamel}:', error);
    return {
      status: 500,
      jsonBody: { error: 'Failed to fetch ${modelCamel}' },
    };
  }
}

app.http('get${modelName}ById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '${modelCamel}/{id}',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: '${modelCamel}Document',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName: '${modelName}s',
      connection: 'CosmosDBConnection',
      id: '{id}',
      partitionKey: '{id}',
    },
  ],
  handler: get${modelName}ById,
});

/**
 * Create a new ${modelName}
 * POST /api/${modelCamel}
 */
export async function create${modelName}(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = await request.json() as any;
    
    // Ignore any timestamp fields sent from client (SwallowKit manages these)
    const { id, createdAt, updatedAt, ...userData } = body;
    
    // Auto-generate SwallowKit-managed fields
    const now = new Date().toISOString();
    const dataWithManagedFields = {
      ...userData,
      id: id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    
    // Validate with Zod schema (including auto-generated fields)
    const validationResult = ${schemaName}.safeParse(dataWithManagedFields);
    
    if (!validationResult.success) {
      return {
        status: 400,
        jsonBody: {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
      };
    }
    
    const ${modelCamel} = validationResult.data;
    
    // Cosmos DB output binding will save the document
    context.extraOutputs.set('${modelCamel}Output', ${modelCamel});
    
    return {
      status: 201,
      jsonBody: ${modelCamel},
    };
  } catch (error) {
    context.error('Error creating ${modelCamel}:', error);
    return {
      status: 500,
      jsonBody: { error: 'Failed to create ${modelCamel}' },
    };
  }
}

app.http('create${modelName}', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: '${modelCamel}',
  extraOutputs: [
    {
      type: 'cosmosDB',
      name: '${modelCamel}Output',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName: '${modelName}s',
      connection: 'CosmosDBConnection',
      createIfNotExists: true,
    },
  ],
  handler: create${modelName},
});

/**
 * Update an existing ${modelName}
 * PUT /api/${modelCamel}/{id}
 */
export async function update${modelName}(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const id = request.params.id;
    
    if (!id) {
      return {
        status: 400,
        jsonBody: { error: 'ID is required' },
      };
    }
    
    // Get existing document to preserve createdAt
    const existingDocument = context.extraInputs.get('${modelCamel}Document') as any;
    
    if (!existingDocument) {
      return {
        status: 404,
        jsonBody: { error: '${modelName} not found' },
      };
    }
    
    const body = await request.json() as any;
    
    // Ignore any timestamp fields sent from client (SwallowKit manages these)
    const { createdAt, updatedAt, ...userData } = body;
    
    // Preserve existing createdAt, update updatedAt
    const dataWithManagedFields = {
      ...userData,
      id,
      createdAt: existingDocument.createdAt, // preserve existing
      updatedAt: new Date().toISOString(),
    };
    
    // Validate with Zod schema (including managed fields)
    const validationResult = ${schemaName}.safeParse(dataWithManagedFields);
    
    if (!validationResult.success) {
      return {
        status: 400,
        jsonBody: {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
      };
    }
    
    const ${modelCamel} = validationResult.data;
    
    // Cosmos DB output binding will save the updated document
    context.extraOutputs.set('${modelCamel}Output', ${modelCamel});
    
    return {
      status: 200,
      jsonBody: ${modelCamel},
    };
  } catch (error) {
    context.error('Error updating ${modelCamel}:', error);
    return {
      status: 500,
      jsonBody: { error: 'Failed to update ${modelCamel}' },
    };
  }
}

app.http('update${modelName}', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: '${modelCamel}/{id}',
  extraInputs: [
    {
      type: 'cosmosDB',
      name: '${modelCamel}Document',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName: '${modelName}s',
      connection: 'CosmosDBConnection',
      id: '{id}',
      partitionKey: '{id}',
    },
  ],
  extraOutputs: [
    {
      type: 'cosmosDB',
      name: '${modelCamel}Output',
      databaseName: process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase',
      containerName: '${modelName}s',
      connection: 'CosmosDBConnection',
    },
  ],
  handler: update${modelName},
});

/**
 * Delete a ${modelName}
 * DELETE /api/${modelCamel}/{id}
 * 
 * Note: Cosmos DB output binding doesn't support direct deletion.
 * This function uses the Cosmos DB client directly for deletion.
 */
export async function delete${modelName}(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const id = request.params.id;
    
    if (!id) {
      return {
        status: 400,
        jsonBody: { error: 'ID is required' },
      };
    }
    
    // For deletion, we need to use the Cosmos DB client directly
    // since output bindings don't support deletion
    const { CosmosClient } = await import('@azure/cosmos');
    
    const connectionString = process.env.CosmosDBConnection;
    if (!connectionString) {
      throw new Error('CosmosDBConnection environment variable is not set');
    }
    
    const client = new CosmosClient(connectionString);
    const database = client.database(process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase');
    const container = database.container('${modelName}s');
    
    await container.item(id, id).delete();
    
    return {
      status: 204,
    };
  } catch (error: any) {
    if (error.code === 404) {
      return {
        status: 404,
        jsonBody: { error: '${modelName} not found' },
      };
    }
    
    context.error('Error deleting ${modelCamel}:', error);
    return {
      status: 500,
      jsonBody: { error: 'Failed to delete ${modelCamel}' },
    };
  }
}

app.http('delete${modelName}', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: '${modelCamel}/{id}',
  handler: delete${modelName},
});
`;
}
