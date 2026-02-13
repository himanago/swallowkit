/**
 * Next.js BFF API Routes コード生成
 * Azure Functions を呼び出す BFF パターンの API routes を生成
 * callFunction ヘルパー方式
 */

import { ModelInfo, toCamelCase, toKebabCase } from "./model-parser";

/**
 * BFF callFunction ヘルパー (lib/api/call-function.ts) のコードを生成
 */
export function generateBFFCallFunction(): string {
  return `import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';

/**
 * SwallowKit BFF Call Function Helper
 * Azure Functions を呼び出す汎用ヘルパー
 *
 * @example
 * // シンプルな GET
 * return callFunction({ method: 'GET', path: '/api/todo', responseSchema: z.array(TodoSchema) });
 *
 * // バリデーション付き POST
 * return callFunction({ method: 'POST', path: '/api/todo', body, inputSchema: InputSchema, responseSchema: TodoSchema, successStatus: 201 });
 *
 * // カスタムビジネスロジック関数の呼び出し
 * return callFunction({ method: 'POST', path: '/api/todo/archive', body: { ids } });
 */

function getFunctionsBaseUrl(): string {
  return process.env.BACKEND_FUNCTIONS_BASE_URL || 'http://localhost:7071';
}

interface CallFunctionConfig<TInput = any, TOutput = any> {
  /** HTTP メソッド */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Azure Functions のパス (例: '/api/todo', '/api/todo/123') */
  path: string;
  /** リクエストボディ (POST/PUT 用) */
  body?: any;
  /** 入力バリデーション用 Zod スキーマ (省略時はバリデーションなし) */
  inputSchema?: z.ZodSchema<TInput>;
  /** 出力バリデーション用 Zod スキーマ (省略時はそのまま返す) */
  responseSchema?: z.ZodSchema<TOutput>;
  /** 成功時の HTTP ステータスコード (デフォルト: 200) */
  successStatus?: number;
}

export async function callFunction<TInput = any, TOutput = any>(
  config: CallFunctionConfig<TInput, TOutput>
): Promise<NextResponse> {
  const { method, path, body, inputSchema, responseSchema, successStatus = 200 } = config;

  try {
    // 入力バリデーション
    let validatedBody = body;
    if (inputSchema && body !== undefined) {
      const result = inputSchema.safeParse(body);
      if (!result.success) {
        console.error('[BFF] Validation failed:', result.error.issues);
        return NextResponse.json(
          { error: 'Validation failed', details: result.error.issues },
          { status: 400 }
        );
      }
      validatedBody = result.data;
    }

    // Azure Functions を呼び出し
    const functionsBaseUrl = getFunctionsBaseUrl();
    const url = functionsBaseUrl + path;
    console.log(\`[BFF] \${method} \${url}\`);

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: validatedBody !== undefined ? JSON.stringify(validatedBody) : undefined,
    });

    console.log('[BFF] Functions response status:', response.status);

    // エラーレスポンスの転送
    if (!response.ok) {
      const text = await response.text();
      console.error('[BFF] Functions error:', { status: response.status, body: text });

      let errorMessage = 'Request failed';
      try {
        const error = JSON.parse(text);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = text || errorMessage;
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    // DELETE 204 の場合はボディなし
    if (response.status === 204 || method === 'DELETE') {
      return new NextResponse(null, { status: 204 });
    }

    // レスポンスの取得と出力バリデーション
    const data = await response.json();

    if (responseSchema) {
      const validated = responseSchema.parse(data);
      return NextResponse.json(validated, { status: successStatus });
    }

    return NextResponse.json(data, { status: successStatus });
  } catch (error: any) {
    console.error(\`[BFF] Error:\`, error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
`;
}

/**
 * 明示的ハンドラー方式の BFF ルートファイルを生成
 */
export function generateCompactBFFRoutes(model: ModelInfo, sharedPackageName: string): {
  listRoute: string;
  detailRoute: string;
} {
  const modelName = model.name;
  const modelCamel = toCamelCase(modelName);
  const modelKebab = toKebabCase(modelName);
  const schemaName = model.schemaName;

  const listRoute = `import { NextRequest } from 'next/server';
import { callFunction } from '@/lib/api/call-function';
import { ${schemaName} } from '${sharedPackageName}';
import { z } from 'zod/v4';

const InputSchema = ${schemaName}.omit({ id: true, createdAt: true, updatedAt: true });

// GET /api/${modelCamel} - 一覧取得
export async function GET() {
  return callFunction({
    method: 'GET',
    path: '/api/${modelCamel}',
    responseSchema: z.array(${schemaName}),
  });
}

// POST /api/${modelCamel} - 新規作成
export async function POST(request: NextRequest) {
  const body = await request.json();
  return callFunction({
    method: 'POST',
    path: '/api/${modelCamel}',
    body,
    inputSchema: InputSchema,
    responseSchema: ${schemaName},
    successStatus: 201,
  });
}
`;

  const detailRoute = `import { NextRequest } from 'next/server';
import { callFunction } from '@/lib/api/call-function';
import { ${schemaName} } from '${sharedPackageName}';

const InputSchema = ${schemaName}.omit({ id: true, createdAt: true, updatedAt: true });

// GET /api/${modelCamel}/{id} - 詳細取得
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return callFunction({
    method: 'GET',
    path: \`/api/${modelCamel}/\${id}\`,
    responseSchema: ${schemaName},
  });
}

// PUT /api/${modelCamel}/{id} - 更新
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  return callFunction({
    method: 'PUT',
    path: \`/api/${modelCamel}/\${id}\`,
    body,
    inputSchema: InputSchema,
    responseSchema: ${schemaName},
  });
}

// DELETE /api/${modelCamel}/{id} - 削除
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return callFunction({
    method: 'DELETE',
    path: \`/api/${modelCamel}/\${id}\`,
  });
}
`;

  return {
    listRoute,
    detailRoute,
  };
}
