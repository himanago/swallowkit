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

const FUNCTIONS_BASE_URL = process.env.BACKEND_FUNCTIONS_BASE_URL || 'http://localhost:7071';

// Input schema: SwallowKit-managed fields (id, createdAt, updatedAt) are optional
// These fields are ignored by the backend and auto-managed
const ${modelName}InputSchema = ${schemaName}.partial({ id: true, createdAt: true, updatedAt: true });

/**
 * GET /api/${modelCamel}
 * Fetch all ${modelName} items from Azure Functions
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[BFF] Fetching ${modelCamel}s from Functions:', \`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`);
    
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[BFF] Functions response status:', response.status);
    
    if (!response.ok) {
      // Read response body once
      const text = await response.text();
      console.error('[BFF] Functions error response:', {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
      
      let errorMessage = 'Failed to fetch ${modelCamel}s';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        // Response body is not JSON, use text as-is
        errorMessage = text || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('[BFF] Received ${modelCamel}s count:', Array.isArray(data) ? data.length : 'not an array');
    
    // Validate response with Zod schema
    const validated = z.array(${schemaName}).parse(data);
    
    return NextResponse.json(validated);
  } catch (error: any) {
    console.error('[BFF] Error fetching ${modelCamel}s:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
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
    console.log('[BFF] Creating ${modelCamel} with data:', body);
    
    // Validate input (excluding SwallowKit-managed fields)
    const validationResult = ${modelName}InputSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error('[BFF] Validation failed:', validationResult.error.errors);
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }
    
    console.log('[BFF] Sending to Functions:', \`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`);
    
    // Pass validated data to Azure Functions
    // SwallowKit auto-manages id, createdAt, updatedAt fields
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validationResult.data),
    });
    
    console.log('[BFF] Functions response status:', response.status);
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[BFF] Functions error response:', {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
      
      let errorMessage = 'Failed to create ${modelCamel}';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = text || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('[BFF] Created ${modelCamel}:', data.id);
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated, { status: 201 });
  } catch (error: any) {
    console.error('[BFF] Error creating ${modelCamel}:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    return NextResponse.json(
      { error: error.message || 'Failed to create ${modelCamel}' },
      { status: 500 }
    );
  }
}
`;

  // Detail route (GET /api/[model]/[id], PUT /api/[model]/[id], DELETE /api/[model]/[id])
  const detailRoute = `import { NextRequest, NextResponse } from 'next/server';
import { ${schemaName} } from '@/lib/models/${modelKebab}';

const FUNCTIONS_BASE_URL = process.env.BACKEND_FUNCTIONS_BASE_URL || 'http://localhost:7071';

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
    console.log('[BFF] Fetching ${modelCamel} by ID:', id);
    
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[BFF] Functions response status:', response.status);
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[BFF] Functions error response:', {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
      
      let errorMessage = '${modelName} not found';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = text || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('[BFF] Fetched ${modelCamel}:', data.id);
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated);
  } catch (error: any) {
    console.error('[BFF] Error fetching ${modelCamel}:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ${modelCamel}' },
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
    console.log('[BFF] Updating ${modelCamel}:', id, 'with data:', body);
    
    // Validate input (excluding SwallowKit-managed fields)
    const validationResult = ${modelName}InputSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error('[BFF] Validation failed:', validationResult.error.errors);
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }
    
    console.log('[BFF] Sending to Functions:', \`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`);
    
    // Pass validated data to Azure Functions
    // SwallowKit auto-manages updatedAt field
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validationResult.data),
    });
    
    console.log('[BFF] Functions response status:', response.status);
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[BFF] Functions error response:', {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
      
      let errorMessage = 'Failed to update ${modelCamel}';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = text || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('[BFF] Updated ${modelCamel}:', data.id);
    
    // Validate response with Zod schema
    const validated = ${schemaName}.parse(data);
    
    return NextResponse.json(validated);
  } catch (error: any) {
    console.error('[BFF] Error updating ${modelCamel}:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    return NextResponse.json(
      { error: error.message || 'Failed to update ${modelCamel}' },
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
    console.log('[BFF] Deleting ${modelCamel}:', id);
    
    const response = await fetch(\`\${FUNCTIONS_BASE_URL}/api/${modelCamel}/\${id}\`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    console.log('[BFF] Functions response status:', response.status);
    
    if (!response.ok) {
      const text = await response.text();
      console.error('[BFF] Functions error response:', {
        status: response.status,
        statusText: response.statusText,
        body: text
      });
      
      let errorMessage = 'Failed to delete ${modelCamel}';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = text || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }
    
    console.log('[BFF] Deleted ${modelCamel}:', id);
    
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('[BFF] Error deleting ${modelCamel}:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    return NextResponse.json(
      { error: error.message || 'Failed to delete ${modelCamel}' },
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
