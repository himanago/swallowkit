/**
 * Next.js BFF API Routes コード生成
 * Azure Functions を呼び出す BFF パターンの API routes を生成
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";

/**
 * Next.js BFF API Routes を生成（全 CRUD 操作）
 */
export function generateNextjsBFFRoutes(model: ModelInfo): {
  listRoute: string;
  detailRoute: string;
} {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  const schemaName = model.schemaName;
  
  // List & Create route (GET /api/[model], POST /api/[model])
  const listRoute = `import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ${schemaName} } from '@/lib/models/${modelKebab}';

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

// Input schema: SwallowKit-managed fields (id, createdAt, updatedAt) are optional
// These fields are ignored by the backend and auto-managed
const ${modelName}InputSchema = ${schemaName}.partial({ id: true, createdAt: true, updatedAt: true });

/**
 * GET /api/${modelCamel}
 * Fetch all ${modelName} items from Azure Functions
 */
export async function GET(request: NextRequest) {
  try {
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      let errorMessage = 'Failed to fetch ${modelCamel}s';
      try {
        const error = await response.json();
        errorMessage = error.error || errorMessage;
      } catch {
        // Response body is not JSON
        errorMessage = await response.text() || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Validate response with Zod schema
    const validated = z.array(${schemaName}).parse(data);
    
    return NextResponse.json(validated);
  } catch (error: any) {
    console.error('Error fetching ${modelCamel}s:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ${modelCamel}s' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/${modelCamel}
 * Create a new ${modelName} via Azure Functions
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate input (excluding SwallowKit-managed fields)
    const validationResult = ${modelName}InputSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }
    
    // Pass validated data to Azure Functions
    // SwallowKit auto-manages id, createdAt, updatedAt fields
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validationResult.data),
    });
    
    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.error || 'Failed to create ${modelCamel}' },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated, { status: 201 });
  } catch (error) {
    console.error('Error creating ${modelCamel}:', error);
    return NextResponse.json(
      { error: 'Failed to create ${modelCamel}' },
      { status: 500 }
    );
  }
}
`;

  // Detail route (GET /api/[model]/[id], PUT /api/[model]/[id], DELETE /api/[model]/[id])
  const detailRoute = `import { NextRequest, NextResponse } from 'next/server';
import { ${schemaName} } from '@/lib/models/${modelKebab}';

const FUNCTIONS_BASE_URL = process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';

// Input schema: SwallowKit-managed fields (id, createdAt, updatedAt) are optional
// These fields are ignored by the backend and auto-managed
const ${modelName}InputSchema = ${schemaName}.partial({ id: true, createdAt: true, updatedAt: true });

/**
 * GET /api/${modelCamel}/[id]
 * Fetch a single ${modelName} by ID from Azure Functions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.error || '${modelName} not found' },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated);
  } catch (error) {
    console.error('Error fetching ${modelCamel}:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ${modelCamel}' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/${modelCamel}/[id]
 * Update a ${modelName} via Azure Functions
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Validate input (excluding SwallowKit-managed fields)
    const validationResult = ${modelName}InputSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }
    
    // Pass validated data to Azure Functions
    // SwallowKit auto-manages updatedAt field
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validationResult.data),
    });
    
    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.error || 'Failed to update ${modelCamel}' },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated);
  } catch (error) {
    console.error('Error updating ${modelCamel}:', error);
    return NextResponse.json(
      { error: 'Failed to update ${modelCamel}' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/${modelCamel}/[id]
 * Delete a ${modelName} via Azure Functions
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.error || 'Failed to delete ${modelCamel}' },
        { status: response.status }
      );
    }
    
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting ${modelCamel}:', error);
    return NextResponse.json(
      { error: 'Failed to delete ${modelCamel}' },
      { status: 500 }
    );
  }
}
`;

  return {
    listRoute,
    detailRoute,
  };
}
