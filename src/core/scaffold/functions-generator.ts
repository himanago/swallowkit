/**
 * Azure Functions CRUD コード生成
 * Cosmos DB 入出力バインディングを使用した Azure Functions のベストプラクティスに従う
 * インラインハンドラー方式（ファクトリー不使用）
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";

/**
 * Azure Functions エンティティファイルを生成（インラインハンドラー方式）
 * 各ハンドラーがベタ書きされており、ビジネスロジックの追加・変更が容易
 */
export function generateCompactAzureFunctionsCRUD(model: ModelInfo, sharedPackageName: string): string {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  const schemaName = model.schemaName;

  return `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod/v4';
import crypto from 'crypto';
import { ${schemaName} } from '${sharedPackageName}';

const containerName = '${modelName}s';

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
    try {
      const documents = context.extraInputs.get('cosmosInput') as any[];

      if (!documents || !Array.isArray(documents)) {
        return { status: 200, jsonBody: [] };
      }

      const validated = z.array(${schemaName}).parse(documents);
      context.log(\`Fetched \${validated.length} items from \${containerName}\`);

      return { status: 200, jsonBody: validated };
    } catch (error) {
      context.error(\`Error fetching from \${containerName}:\`, error);
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
    try {
      const document = context.extraInputs.get('cosmosInput');

      if (!document) {
        return { status: 404, jsonBody: { error: 'Item not found' } };
      }

      const validated = ${schemaName}.parse(document);
      return { status: 200, jsonBody: validated };
    } catch (error) {
      context.error(\`Error fetching item from \${containerName}:\`, error);
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
    try {
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
      context.error(\`Error creating item in \${containerName}:\`, error);
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
    try {
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
      context.error(\`Error updating item in \${containerName}:\`, error);
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
    try {
      const id = request.params.id;
      if (!id) {
        return { status: 400, jsonBody: { error: 'ID is required' } };
      }

      const { CosmosClient } = await import('@azure/cosmos');
      const client = new CosmosClient(process.env.CosmosDBConnection!);
      const database = client.database(process.env.COSMOS_DB_DATABASE_NAME || 'AppDatabase');
      const container = database.container(containerName);

      await container.item(id, id).delete();
      context.log(\`Deleted item \${id} from \${containerName}\`);

      return { status: 204 };
    } catch (error: any) {
      if (error.code === 404) {
        return { status: 404, jsonBody: { error: 'Item not found' } };
      }
      context.error(\`Error deleting item from \${containerName}:\`, error);
      return { status: 500, jsonBody: { error: 'Failed to delete item' } };
    }
  },
});
`;
}
