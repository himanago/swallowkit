import { AuthConfig } from "../../types";
import { normalizeAuthConfig } from "../config";
import { ModelInfo, toCamelCase } from "./model-parser";

export function generateManagedFunctionConfig(
  route: string,
  methods: readonly string[],
  entry: string
): string {
  return (
    JSON.stringify(
      {
        scriptFile: `../dist/${entry}/index.js`,
        bindings: [
          {
            authLevel: "anonymous",
            type: "httpTrigger",
            direction: "in",
            name: "req",
            methods: methods.map((method) => method.toLowerCase()),
            route,
          },
          { type: "http", direction: "out", name: "$return" },
        ],
      },
      null,
      2
    ) + "\n"
  );
}

export function getAuthCookieName(projectName: string): string {
  return (
    projectName.replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/g, "-") +
    "-auth-token"
  );
}

/** Request-local credentials: never share authentication state between invocations. */
export function generateReactBffHelper(
  projectName: string,
  auth?: AuthConfig
): string {
  const providers = new Set(
    Object.values(normalizeAuthConfig(auth)?.schemes ?? {}).map(
      (scheme) => scheme.provider
    )
  );
  return `import type { HttpRequest, HttpResponse } from '@azure/functions';
import { z } from 'zod/v4';

// SwallowKit BFF Call Function Helper (SWA managed Functions)
const forwardSwa = ${providers.has("swa")};
const forwardBearer = ${providers.has("custom-jwt") || providers.has("external-token")};
const authCookieName = '${getAuthCookieName(projectName)}';

export class BffError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(body: unknown, status = 200): HttpResponse {
  return { status, body, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } };
}

export function parseBody(request: HttpRequest): unknown {
  if (request.body === undefined || request.body === '') throw new BffError(400, 'Request body is required');
  if (typeof request.body !== 'string') return request.body;
  try { return JSON.parse(request.body); }
  catch { throw new BffError(400, 'Invalid JSON body'); }
}

function credentialHeaders(request: HttpRequest): Record<string, string> {
  const result: Record<string, string> = {};
  if (forwardBearer) {
    const authorization = request.headers.authorization;
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(authCookieName + '='));
    if (authorization?.startsWith('Bearer ')) result.Authorization = authorization;
    else if (cookie) {
      try { result.Authorization = 'Bearer ' + decodeURIComponent(cookie.slice(authCookieName.length + 1)); }
      catch { throw new BffError(401, 'Invalid authentication cookie'); }
    }
  }
  // SWA injects this header at the trusted managed API boundary. Never expose the backend key to clients.
  if (forwardSwa && request.headers['x-ms-client-principal']) {
    const encoded = request.headers['x-ms-client-principal'];
    try {
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.toString('base64') !== encoded) throw new Error('Invalid encoding');
      const value = JSON.parse(decoded.toString('utf8'));
      if (typeof value.identityProvider !== 'string' || !value.identityProvider ||
          typeof value.userId !== 'string' || !value.userId ||
          !Array.isArray(value.userRoles) || !value.userRoles.includes('authenticated')) {
        throw new Error('Invalid principal');
      }
      result['x-ms-client-principal'] = Buffer.from(JSON.stringify({
        identityProvider: value.identityProvider, userId: value.userId,
        userDetails: typeof value.userDetails === 'string' ? value.userDetails : '',
        userRoles: value.userRoles.filter((role: unknown) => typeof role === 'string'),
      })).toString('base64');
    } catch {
      throw new BffError(401, 'Invalid SWA client principal');
    }
  }
  return result;
}

export async function backendRequest(request: HttpRequest, method: string, path: string, body?: unknown): Promise<Response> {
  const baseUrl = process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';
  const parsedUrl = new URL(baseUrl);
  const local = parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
  const key = process.env.BACKEND_FUNCTIONS_KEY;
  if (!key && !local) throw new Error('BACKEND_FUNCTIONS_KEY is required for non-local Functions calls');
  if (!local && parsedUrl.protocol !== 'https:') throw new Error('Remote Functions calls require HTTPS');
  return fetch(baseUrl.replace(/\\/$/, '') + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...credentialHeaders(request), ...(key ? { 'x-functions-key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
  });
}

interface CallFunctionConfig {
  request: HttpRequest;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  inputSchema?: z.ZodType;
  responseSchema?: z.ZodType;
  successStatus?: number;
}

export async function callFunction(config: CallFunctionConfig): Promise<HttpResponse> {
  try {
    let body = config.body;
    if (config.inputSchema) {
      const result = config.inputSchema.safeParse(body);
      if (!result.success) return json({ error: 'Validation failed', details: result.error.issues }, 400);
      body = result.data;
    }
    const response = await backendRequest(config.request, config.method, config.path, body);
    if (response.status === 204) return { status: 204 };
    if (!response.ok) {
      console.error('[BFF] Backend request failed:', response.status);
      return json({ error: 'Backend request failed' }, response.status);
    }
    const data: unknown = await response.json();
    if (config.responseSchema) {
      const result = config.responseSchema.safeParse(data);
      if (!result.success) {
        console.error('[BFF] Backend response validation failed');
        return json({ error: 'Invalid backend response' }, 502);
      }
      return json(result.data, config.successStatus ?? 200);
    }
    return json(data, config.successStatus ?? 200);
  } catch (error) {
    return handleError(error);
  }
}

export function handleError(error: unknown): HttpResponse {
  if (error instanceof BffError) return json({ error: error.message }, error.status);
  console.error('[BFF] Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return json({ error: 'Backend request failed' }, 502);
}
`;
}

export function generateReactBffRoute(
  model: ModelInfo,
  sharedPackageName: string
): string {
  const modelCamel = toCamelCase(model.name);
  const operations = new Set(
    model.connectorConfig?.operations ?? [
      "getAll",
      "getById",
      "create",
      "update",
      "delete",
    ]
  );
  const managedFields = model.fields
    .filter((field) => ["id", "createdAt", "updatedAt"].includes(field.name))
    .map((field) => `${field.name}: true`)
    .join(", ");
  const clauses: string[] = [];
  if (operations.has("getAll"))
    clauses.push(
      `    if (request.method === 'GET' && !id) return callFunction({ request, method: 'GET', path, responseSchema: z.array(${model.schemaName}) });`
    );
  if (operations.has("getById"))
    clauses.push(
      `    if (request.method === 'GET' && id) return callFunction({ request, method: 'GET', path, responseSchema: ${model.schemaName} });`
    );
  if (operations.has("create"))
    clauses.push(
      `    if (request.method === 'POST' && !id) return callFunction({ request, method: 'POST', path, body: parseBody(request), inputSchema: InputSchema, responseSchema: ${model.schemaName}, successStatus: 201 });`
    );
  if (operations.has("update"))
    clauses.push(
      `    if (request.method === 'PUT' && id) return callFunction({ request, method: 'PUT', path, body: parseBody(request), inputSchema: InputSchema, responseSchema: ${model.schemaName} });`
    );
  if (operations.has("delete"))
    clauses.push(
      `    if (request.method === 'DELETE' && id) return callFunction({ request, method: 'DELETE', path });`
    );
  return `import type { AzureFunction, Context, HttpRequest } from '@azure/functions';
import { z } from 'zod/v4';
import { ${model.schemaName} } from '${sharedPackageName}';
import { callFunction, parseBody, json, handleError } from '../lib/call-function';

const InputSchema = ${model.schemaName}.omit({ ${managedFields} });

const handler: AzureFunction = async (_context: Context, request: HttpRequest) => {
  try {
    const id = request.params.id;
    const path = '/api/${modelCamel}' + (id ? '/' + encodeURIComponent(id) : '');
${clauses.join("\n")}
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) { return handleError(error); }
};
export default handler;
`;
}

export function generateReactGreetBff(): string {
  return `import type { AzureFunction, Context, HttpRequest } from '@azure/functions';
import { callFunction, parseBody, handleError } from '../lib/call-function';

const handler: AzureFunction = async (_context: Context, request: HttpRequest) => {
  try {
    const body = request.method === 'POST' ? parseBody(request) : undefined;
    return callFunction({
      request, method: request.method === 'POST' ? 'POST' : 'GET',
      path: '/api/greet?name=' + encodeURIComponent(request.query.name || 'World'), body,
    });
  } catch (error) { return handleError(error); }
};
export default handler;
`;
}

export function generateReactAuthBff(
  projectName: string,
  sharedPackageName: string,
  customJwt: boolean
): string {
  return `import type { AzureFunction, Context, HttpRequest } from '@azure/functions';
${customJwt ? `import { z } from 'zod/v4';\nimport { AuthUser, LoginRequest, LoginResponse } from '${sharedPackageName}';` : ""}
import { backendRequest, callFunction, parseBody, json, handleError } from '../lib/call-function';

const cookieName = '${getAuthCookieName(projectName)}';
${
  customJwt
    ? `const CurrentUser = z.preprocess(value => {
  if (!value || typeof value !== 'object') return value;
  return { ...value, id: 'id' in value ? value.id : 'sub' in value ? value.sub : undefined };
}, AuthUser);
`
    : ""
}
const handler: AzureFunction = async (_context: Context, request: HttpRequest) => {
  try {
    const action = request.params.action;
    if (action === 'me' && request.method === 'GET') return callFunction({ request, method: 'GET', path: '/api/auth/me'${customJwt ? ", responseSchema: CurrentUser" : ""} });
${
  customJwt
    ? `    if (action === 'logout' && request.method === 'POST') {
      const response = json({ message: 'Logged out' });
      response.headers = { ...response.headers, 'Set-Cookie': cookieName + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' };
      return response;
    }
    if (action === 'login' && request.method === 'POST') {
      const input = LoginRequest.safeParse(parseBody(request));
      if (!input.success) return json({ error: 'Validation failed', details: input.error.issues }, 400);
      const result = await backendRequest(request, 'POST', '/api/auth/login', input.data);
      if (!result.ok) return json({ error: 'Authentication failed' }, result.status);
      const data = LoginResponse.parse(await result.json());
      const response = json({ user: data.user });
      const secure = process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === 'production';
      response.headers = { ...response.headers, 'Set-Cookie': cookieName + '=' + encodeURIComponent(data.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400' + (secure ? '; Secure' : '') };
      return response;
    }`
    : ""
}
    return json({ error: 'Not found' }, 404);
  } catch (error) { return handleError(error); }
};
export default handler;
`;
}
