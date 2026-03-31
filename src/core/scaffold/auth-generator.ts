/**
 * SwallowKit 認証・認可コード生成
 * add-auth コマンドおよび scaffold ロールガード挿入で使用するテンプレート群
 */

import { CustomJwtConfig, ModelAuthPolicy, AuthConfig, RdbConnectorConfig } from "../../types";

type RdbProvider = RdbConnectorConfig["provider"]; // "mysql" | "postgres" | "sqlserver"

// ============================================================
// 1. shared/models/auth.ts（Zod スキーマ）
// ============================================================

export function generateAuthModels(): string {
  return `import { z } from 'zod/v4';

// ログインリクエスト
export const LoginRequest = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// 認証済みユーザー情報（JWT claims 相当、機密情報なし）
export const AuthUser = z.object({
  id: z.string(),
  loginId: z.string(),
  name: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
});
export type AuthUser = z.infer<typeof AuthUser>;

// ログインレスポンス
export const LoginResponse = z.object({
  user: AuthUser,
  token: z.string(),
  expiresAt: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const displayName = 'Auth';
`;
}

// ============================================================
// 2. TypeScript Functions テンプレート
// ============================================================

export function generateAuthFunctionsTS(
  sharedPackageName: string,
  config: CustomJwtConfig,
  provider: RdbProvider,
): string {
  const envVar = `${config.userConnector.toUpperCase()}_CONNECTION_STRING`;

  const driverImport = provider === "mysql"
    ? `import mysql from 'mysql2/promise';`
    : provider === "postgres"
    ? `import pg from 'pg';`
    : `import sql from 'mssql';`;

  const getConnection = provider === "mysql"
    ? `function getConnection() {
  return mysql.createConnection(process.env.${envVar} || '');
}`
    : provider === "postgres"
    ? `async function getConnection() {
  const client = new pg.Client(process.env.${envVar} || '');
  await client.connect();
  return client;
}`
    : `async function getConnection() {
  return sql.connect(process.env.${envVar} || '');
}`;

  const connVar = provider === "mysql" ? "conn" : provider === "postgres" ? "client" : "pool";

  const queryExec = provider === "mysql"
    ? `const [rows] = await ${connVar}.query(
          'SELECT * FROM ${config.userTable} WHERE ${config.loginIdColumn} = ?',
          [body.loginId]
        );
        const users = rows as any[];`
    : provider === "postgres"
    ? `const result = await ${connVar}.query(
          'SELECT * FROM ${config.userTable} WHERE ${config.loginIdColumn} = $1',
          [body.loginId]
        );
        const users = result.rows;`
    : `const result = await ${connVar}.request()
          .input('loginId', body.loginId)
          .query('SELECT * FROM ${config.userTable} WHERE ${config.loginIdColumn} = @loginId');
        const users = result.recordset;`;

  const cleanup = provider === "mysql"
    ? `await ${connVar}.end();`
    : provider === "postgres"
    ? `await ${connVar}.end();`
    : `await ${connVar}.close();`;

  return `import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { LoginRequest, LoginResponse, AuthUser } from '${sharedPackageName}';
import { requireAuth, generateToken, handleAuthError } from './auth/jwt-helper';
import bcrypt from 'bcryptjs';
${driverImport}

${getConnection}

// POST /api/auth/login - ログイン
app.http('auth-login', {
  methods: ['POST'],
  route: 'auth/login',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = LoginRequest.parse(await request.json());

      const ${connVar} = await getConnection();
      try {
        ${queryExec}

        if (users.length === 0) {
          return { status: 401, jsonBody: { error: 'Invalid credentials' } };
        }

        const user = users[0];
        const valid = await bcrypt.compare(body.password, user.${config.passwordHashColumn});
        if (!valid) {
          return { status: 401, jsonBody: { error: 'Invalid credentials' } };
        }

        // ロール取得（JSON配列 or カンマ区切り）
        let roles: string[] = [];
        if (typeof user.${config.rolesColumn} === 'string') {
          try {
            roles = JSON.parse(user.${config.rolesColumn});
          } catch {
            roles = user.${config.rolesColumn}.split(',').map((r: string) => r.trim());
          }
        } else if (Array.isArray(user.${config.rolesColumn})) {
          roles = user.${config.rolesColumn};
        }

        const authUser: AuthUser = {
          id: String(user.id),
          loginId: user.${config.loginIdColumn},
          name: user.name || user.${config.loginIdColumn},
          email: user.email || '',
          roles,
        };

        const token = generateToken(authUser);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const response: LoginResponse = { user: authUser, token, expiresAt };
        return { status: 200, jsonBody: response };
      } finally {
        ${cleanup}
      }
    } catch (error: any) {
      context.error('Login error:', error);
      return { status: 500, jsonBody: { error: 'Login failed' } };
    }
  },
});

// GET /api/auth/me - 現在のユーザー情報取得
app.http('auth-me', {
  methods: ['GET'],
  route: 'auth/me',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const user = requireAuth(request);
      return { status: 200, jsonBody: user };
    } catch (error) {
      const authErr = handleAuthError(error);
      if (authErr) return authErr;
      context.error('Auth/me error:', error);
      return { status: 500, jsonBody: { error: 'Internal server error' } };
    }
  },
});

// POST /api/auth/logout - ログアウト（ステートレスJWTのためサーバー側処理なし）
app.http('auth-logout', {
  methods: ['POST'],
  route: 'auth/logout',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    return { status: 200, jsonBody: { message: 'Logged out' } };
  },
});
`;
}

// ============================================================
// 3. TypeScript JWT Helper
// ============================================================

export function generateJwtHelperTS(): string {
  return `import jwt from 'jsonwebtoken';
import { HttpRequest, HttpResponseInit } from '@azure/functions';

export interface JwtPayload {
  sub: string;
  loginId: string;
  name: string;
  email: string;
  roles: string[];
}

const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * JWT 検証。無効な場合は AuthError をスロー。
 */
export function requireAuth(request: HttpRequest): JwtPayload {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return payload;
  } catch {
    throw new AuthError(401, 'Invalid or expired token');
  }
}

/**
 * ロール確認。必要なロールを持たない場合は AuthError をスロー。
 */
export function requireRoles(user: JwtPayload, requiredRoles: string[]): void {
  const hasRole = requiredRoles.some(role => user.roles.includes(role));
  if (!hasRole) {
    throw new AuthError(403, \`Requires one of roles: \${requiredRoles.join(', ')}\`);
  }
}

/**
 * JWT 生成
 */
export function generateToken(payload: { id: string; loginId: string; name: string; email: string; roles: string[] }): string {
  return jwt.sign(
    { sub: payload.id, loginId: payload.loginId, name: payload.name, email: payload.email, roles: payload.roles },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '24h' } as jwt.SignOptions
  );
}

/**
 * 認証エラー
 */
export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * AuthError を HTTP レスポンスに変換
 */
export function handleAuthError(error: unknown): HttpResponseInit | null {
  if (error instanceof AuthError) {
    return { status: error.statusCode, jsonBody: { error: error.message } };
  }
  return null;
}
`;
}

// ============================================================
// 4. C# Auth Functions テンプレート
// ============================================================

export function generateAuthFunctionsCSharp(
  config: CustomJwtConfig,
  provider: RdbProvider,
): string {
  const usingStatement = provider === "mysql"
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

  return `using System;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
${usingStatement}
using BCrypt.Net;

namespace Functions.Auth
{
    public class AuthFunctions
    {
        [Function("auth-login")]
        public async Task<HttpResponseData> Login(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/login")] HttpRequestData request)
        {
            var body = await JsonSerializer.DeserializeAsync<LoginRequest>(request.Body);
            if (body == null || string.IsNullOrEmpty(body.LoginId) || string.IsNullOrEmpty(body.Password))
            {
                var badReq = request.CreateResponse(System.Net.HttpStatusCode.BadRequest);
                await badReq.WriteAsJsonAsync(new { error = "loginId and password are required" });
                return badReq;
            }

            await using var conn = new ${connType}(
                Environment.GetEnvironmentVariable("${config.userConnector.toUpperCase()}_CONNECTION_STRING"));
            await conn.OpenAsync();

            await using var cmd = new ${cmdType}(
                "SELECT * FROM ${config.userTable} WHERE ${config.loginIdColumn} = @loginId", conn);
            cmd.Parameters.AddWithValue("@loginId", body.LoginId);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                var unauthorized = request.CreateResponse(System.Net.HttpStatusCode.Unauthorized);
                await unauthorized.WriteAsJsonAsync(new { error = "Invalid credentials" });
                return unauthorized;
            }

            var passwordHash = reader["${config.passwordHashColumn}"].ToString()!;
            if (!BCrypt.Net.BCrypt.Verify(body.Password, passwordHash))
            {
                var unauthorized = request.CreateResponse(System.Net.HttpStatusCode.Unauthorized);
                await unauthorized.WriteAsJsonAsync(new { error = "Invalid credentials" });
                return unauthorized;
            }

            var rolesStr = reader["${config.rolesColumn}"].ToString() ?? "[]";
            string[] roles;
            try { roles = JsonSerializer.Deserialize<string[]>(rolesStr) ?? Array.Empty<string>(); }
            catch { roles = rolesStr.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries); }

            var userId = reader["id"].ToString()!;
            var loginId = reader["${config.loginIdColumn}"].ToString()!;
            var name = reader["name"]?.ToString() ?? loginId;
            var email = reader["email"]?.ToString() ?? "";

            var token = JwtHelper.GenerateToken(userId, loginId, name, email, roles);
            var expiresAt = DateTime.UtcNow.AddHours(24).ToString("o");

            var response = request.CreateResponse(System.Net.HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                user = new { id = userId, loginId, name, email, roles },
                token,
                expiresAt
            });
            return response;
        }

        [Function("auth-me")]
        public async Task<HttpResponseData> Me(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "auth/me")] HttpRequestData request)
        {
            var (principal, errorResponse) = await JwtHelper.Authorize(request);
            if (errorResponse != null) return errorResponse;

            var response = request.CreateResponse(System.Net.HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                sub = principal!.Sub,
                loginId = principal.LoginId,
                name = principal.Name,
                email = principal.Email,
                roles = principal.Roles
            });
            return response;
        }

        [Function("auth-logout")]
        public async Task<HttpResponseData> Logout(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/logout")] HttpRequestData request)
        {
            var response = request.CreateResponse(System.Net.HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { message = "Logged out" });
            return response;
        }
    }

    public class LoginRequest
    {
        [System.Text.Json.Serialization.JsonPropertyName("loginId")]
        public string LoginId { get; set; } = "";
        [System.Text.Json.Serialization.JsonPropertyName("password")]
        public string Password { get; set; } = "";
    }
}
`;
}

// ============================================================
// 5. C# JWT Helper
// ============================================================

export function generateJwtHelperCSharp(): string {
  return `using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.IdentityModel.Tokens;

namespace Functions.Auth
{
    public class JwtPayload
    {
        public string Sub { get; set; } = "";
        public string LoginId { get; set; } = "";
        public string Name { get; set; } = "";
        public string Email { get; set; } = "";
        public string[] Roles { get; set; } = Array.Empty<string>();
    }

    public static class JwtHelper
    {
        private static string JwtSecret => Environment.GetEnvironmentVariable("JWT_SECRET") ?? "";

        public static string GenerateToken(string userId, string loginId, string name, string email, string[] roles)
        {
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, userId),
                new("loginId", loginId),
                new("name", name),
                new("email", email),
            };
            foreach (var role in roles)
            {
                claims.Add(new Claim("roles", role));
            }

            var token = new JwtSecurityToken(
                expires: DateTime.UtcNow.AddHours(24),
                claims: claims,
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public static JwtPayload? ValidateToken(HttpRequestData request)
        {
            var authHeader = request.Headers.TryGetValues("Authorization", out var values)
                ? values.FirstOrDefault() : null;

            if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
                return null;

            var token = authHeader["Bearer ".Length..];
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));

            try
            {
                var handler = new JwtSecurityTokenHandler();
                var principal = handler.ValidateToken(token, new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    IssuerSigningKey = key,
                }, out _);

                return new JwtPayload
                {
                    Sub = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? "",
                    LoginId = principal.FindFirst("loginId")?.Value ?? "",
                    Name = principal.FindFirst("name")?.Value ?? "",
                    Email = principal.FindFirst("email")?.Value ?? "",
                    Roles = principal.FindAll("roles").Select(c => c.Value).ToArray(),
                };
            }
            catch
            {
                return null;
            }
        }

        public static async Task<(JwtPayload?, HttpResponseData?)> Authorize(
            HttpRequestData request, params string[] requiredRoles)
        {
            var payload = ValidateToken(request);
            if (payload == null)
            {
                var unauthorized = request.CreateResponse(System.Net.HttpStatusCode.Unauthorized);
                await unauthorized.WriteAsJsonAsync(new { error = "Unauthorized" });
                return (null, unauthorized);
            }

            if (requiredRoles.Length > 0 && !requiredRoles.Any(r => payload.Roles.Contains(r)))
            {
                var forbidden = request.CreateResponse(System.Net.HttpStatusCode.Forbidden);
                await forbidden.WriteAsJsonAsync(new { error = "Forbidden" });
                return (null, forbidden);
            }

            return (payload, null);
        }
    }
}
`;
}

// ============================================================
// 6. Python Auth Functions テンプレート
// ============================================================

export function generateAuthFunctionsPython(
  config: CustomJwtConfig,
  provider: RdbProvider,
): string {
  const envPrefix = config.userConnector.toUpperCase();

  const driverImport = provider === "mysql"
    ? `import mysql.connector`
    : provider === "postgres"
    ? `import psycopg2\nimport psycopg2.extras`
    : `import pymssql`;

  const getConnection = provider === "mysql"
    ? `def get_connection():
    return mysql.connector.connect(
        host=os.environ.get("${envPrefix}_HOST", "localhost"),
        user=os.environ.get("${envPrefix}_USER", "root"),
        password=os.environ.get("${envPrefix}_PASSWORD", ""),
        database=os.environ.get("${envPrefix}_DATABASE", ""),
    )`
    : provider === "postgres"
    ? `def get_connection():
    return psycopg2.connect(os.environ.get("${envPrefix}_CONNECTION_STRING", ""))`
    : `def get_connection():
    return pymssql.connect(
        server=os.environ.get("${envPrefix}_SERVER", "localhost"),
        user=os.environ.get("${envPrefix}_USER", ""),
        password=os.environ.get("${envPrefix}_PASSWORD", ""),
        database=os.environ.get("${envPrefix}_DATABASE", ""),
    )`;

  const cursorCreate = provider === "mysql"
    ? `cursor = conn.cursor(dictionary=True)`
    : provider === "postgres"
    ? `cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)`
    : `cursor = conn.cursor(as_dict=True)`;

  return `import json
import os
import logging
import azure.functions as func
import jwt
import bcrypt
${driverImport}

auth_bp = func.Blueprint()

${getConnection}


@auth_bp.route(route="auth/login", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
        login_id = body.get("loginId", "")
        password = body.get("password", "")

        if not login_id or not password:
            return func.HttpResponse(
                json.dumps({"error": "loginId and password are required"}),
                status_code=400, mimetype="application/json"
            )

        conn = get_connection()
        ${cursorCreate}
        cursor.execute(
            "SELECT * FROM ${config.userTable} WHERE ${config.loginIdColumn} = %s",
            (login_id,)
        )
        user = cursor.fetchone()
        cursor.close()
        conn.close()

        if not user:
            return func.HttpResponse(
                json.dumps({"error": "Invalid credentials"}),
                status_code=401, mimetype="application/json"
            )

        if not bcrypt.checkpw(
            password.encode("utf-8"),
            user["${config.passwordHashColumn}"].encode("utf-8")
        ):
            return func.HttpResponse(
                json.dumps({"error": "Invalid credentials"}),
                status_code=401, mimetype="application/json"
            )

        roles_raw = user.get("${config.rolesColumn}", "[]")
        try:
            roles = json.loads(roles_raw) if isinstance(roles_raw, str) else list(roles_raw)
        except (json.JSONDecodeError, TypeError):
            roles = [r.strip() for r in str(roles_raw).split(",")]

        from auth.jwt_helper import generate_token
        import datetime

        auth_user = {
            "id": str(user["id"]),
            "loginId": user["${config.loginIdColumn}"],
            "name": user.get("name", user["${config.loginIdColumn}"]),
            "email": user.get("email", ""),
            "roles": roles,
        }

        token = generate_token(auth_user)
        expires_at = (
            datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        ).isoformat() + "Z"

        return func.HttpResponse(
            json.dumps({"user": auth_user, "token": token, "expiresAt": expires_at}),
            status_code=200, mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Login error: {e}")
        return func.HttpResponse(
            json.dumps({"error": "Login failed"}),
            status_code=500, mimetype="application/json"
        )


@auth_bp.route(route="auth/me", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_me(req: func.HttpRequest) -> func.HttpResponse:
    from auth.jwt_helper import require_auth, handle_auth_error

    try:
        user = require_auth(req)
        return func.HttpResponse(
            json.dumps(user), status_code=200, mimetype="application/json"
        )
    except Exception as e:
        err = handle_auth_error(e)
        if err:
            return err
        return func.HttpResponse(
            json.dumps({"error": "Internal server error"}),
            status_code=500, mimetype="application/json"
        )


@auth_bp.route(route="auth/logout", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_logout(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"message": "Logged out"}),
        status_code=200, mimetype="application/json"
    )
`;
}

// ============================================================
// 7. Python JWT Helper
// ============================================================

export function generateJwtHelperPython(): string {
  return `import os
import json
import jwt
import azure.functions as func


JWT_SECRET = os.environ.get("JWT_SECRET", "")


def require_auth(req: func.HttpRequest) -> dict:
    """JWT 検証。無効な場合は AuthError を raise。"""
    auth_header = req.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise AuthError(401, "Missing or invalid Authorization header")

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return {
            "sub": payload.get("sub", ""),
            "loginId": payload.get("loginId", ""),
            "name": payload.get("name", ""),
            "email": payload.get("email", ""),
            "roles": payload.get("roles", []),
        }
    except jwt.ExpiredSignatureError:
        raise AuthError(401, "Token expired")
    except jwt.InvalidTokenError:
        raise AuthError(401, "Invalid token")


def require_roles(user: dict, required_roles: list[str]) -> None:
    """ロール確認。必要なロールを持たない場合は AuthError を raise。"""
    user_roles = user.get("roles", [])
    if not any(role in user_roles for role in required_roles):
        raise AuthError(403, f"Requires one of roles: {', '.join(required_roles)}")


def generate_token(payload: dict) -> str:
    """JWT 生成"""
    import datetime

    return jwt.encode(
        {
            "sub": payload["id"],
            "loginId": payload["loginId"],
            "name": payload["name"],
            "email": payload["email"],
            "roles": payload["roles"],
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=24),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


class AuthError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def handle_auth_error(error: Exception) -> func.HttpResponse | None:
    """AuthError を HTTP レスポンスに変換"""
    if isinstance(error, AuthError):
        return func.HttpResponse(
            json.dumps({"error": str(error)}),
            status_code=error.status_code,
            mimetype="application/json",
        )
    return None
`;
}

// ============================================================
// 8. BFF Auth Routes（Next.js API Routes）
// ============================================================

export function generateBFFAuthLoginRoute(projectName: string, sharedPackageName: string): string {
  const cookieName = projectName.replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]/g, '-') + '-auth-token';
  return `import { NextRequest, NextResponse } from 'next/server';
import { LoginRequest, LoginResponse } from '${sharedPackageName}';

export async function POST(request: NextRequest) {
  const FUNCTIONS_BASE_URL = process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';
  try {
    const body = await request.json();
    const validated = LoginRequest.parse(body);

    const result = await fetch(\`\${FUNCTIONS_BASE_URL}/api/auth/login\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validated),
    });

    if (!result.ok) {
      const error = await result.json().catch(() => ({ error: 'Authentication failed' }));
      return NextResponse.json(error, { status: result.status });
    }

    const data = LoginResponse.parse(await result.json());

    const response = NextResponse.json({ user: data.user });
    response.cookies.set('${cookieName}', data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400,
    });
    return response;
  } catch (error: any) {
    console.error('[BFF] Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
`;
}

export function generateBFFAuthLogoutRoute(projectName: string): string {
  const cookieName = projectName.replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]/g, '-') + '-auth-token';
  return `import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ message: 'Logged out' });
  response.cookies.delete('${cookieName}');
  return response;
}
`;
}

export function generateBFFAuthMeRoute(sharedPackageName: string): string {
  return `import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function GET() {
  const FUNCTIONS_BASE_URL = process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';
  try {
    const reqHeaders = await headers();
    const authorization = reqHeaders.get('authorization');

    if (!authorization) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await fetch(\`\${FUNCTIONS_BASE_URL}/api/auth/me\`, {
      headers: { Authorization: authorization },
    });

    if (!result.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: result.status });
    }

    const data = await result.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[BFF] Auth/me error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
`;
}

// ============================================================
// 9. Next.js Proxy (formerly Middleware)
// ============================================================

export function generateProxy(projectName: string): string {
  const cookieName = projectName.replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]/g, '-') + '-auth-token';
  return `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = '${cookieName}';
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公開パス・静的アセットはスキップ
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname.match(/\\.(ico|png|jpg|svg|css|js)$/)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // JWT 有効期限の簡易チェック（署名検証なし）
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      const response = pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Token expired' }, { status: 401 })
        : NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete(AUTH_COOKIE_NAME);
      return response;
    }
  } catch {
    const response = pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Invalid token' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete(AUTH_COOKIE_NAME);
    return response;
  }

  // Authorization ヘッダーを注入（BFF callFunction が自動転送できるように）
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Authorization', \`Bearer \${token}\`);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}
`;
}

// ============================================================
// 10. ログインページ
// ============================================================

export function generateLoginPage(): string {
  return `'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'ログインに失敗しました');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center mb-6">ログイン</h1>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="loginId" className="block text-sm font-medium text-gray-700 mb-1">
              ログインID
            </label>
            <input
              id="loginId"
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
`;
}

// ============================================================
// 11. React Auth Context
// ============================================================

export function generateAuthContext(): string {
  return `'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface AuthUser {
  id: string;
  loginId: string;
  name: string;
  email: string;
  roles: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (loginId: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (loginId: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || 'Login failed' };
      }

      const data = await res.json();
      setUser(data.user);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  };

  const hasRole = (role: string) => user?.roles?.includes(role) ?? false;
  const hasAnyRole = (roles: string[]) => roles.some(r => hasRole(r));

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasRole, hasAnyRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
`;
}

// ============================================================
// 12. callFunction 認証対応版
// ============================================================

export function generateBFFCallFunctionWithAuth(): string {
  return `import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod/v4';

/**
 * SwallowKit BFF Call Function Helper (Auth-enabled)
 * Azure Functions を呼び出す汎用ヘルパー（Authorization ヘッダー自動転送対応）
 */

function getFunctionsBaseUrl(): string {
  return process.env.BACKEND_FUNCTIONS_BASE_URL || process.env.FUNCTIONS_BASE_URL || 'http://localhost:7071';
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

    // Authorization ヘッダーの転送（Proxy が cookie → Authorization に変換済み）
    const fetchHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    try {
      const reqHeaders = await headers();
      const authorization = reqHeaders.get('authorization');
      if (authorization) {
        fetchHeaders['Authorization'] = authorization;
      }
    } catch {
      // headers() が使えないコンテキスト（ISR 等）では無視
    }

    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
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

// ============================================================
// 13. scaffold 用ロールガード挿入ヘルパー
// ============================================================

/**
 * TypeScript Functions のハンドラーにロールガードを挿入するためのインポート文を生成
 */
export function generateAuthImportTS(): string {
  return `import { requireAuth, requireRoles, handleAuthError } from './auth/jwt-helper';`;
}

/**
 * TypeScript Functions のハンドラー先頭に挿入する認証チェックコードを生成
 */
export function generateAuthGuardTS(policy: ModelAuthPolicy, operation: 'read' | 'write'): string {
  const roles = operation === 'read'
    ? (policy.read || policy.roles || [])
    : (policy.write || policy.roles || []);

  if (roles.length > 0) {
    return `      const authUser = requireAuth(request);
      requireRoles(authUser, ${JSON.stringify(roles)});`;
  }
  return `      const authUser = requireAuth(request);`;
}

/**
 * C# Functions のハンドラーに挿入するロールガードコードを生成
 */
export function generateAuthGuardCSharp(policy: ModelAuthPolicy, operation: 'read' | 'write'): string {
  const roles = operation === 'read'
    ? (policy.read || policy.roles || [])
    : (policy.write || policy.roles || []);

  if (roles.length > 0) {
    const rolesStr = roles.map(r => `"${r}"`).join(', ');
    return `            var (principal, errorResponse) = await JwtHelper.Authorize(request, ${rolesStr});
            if (errorResponse != null) return errorResponse;`;
  }
  return `            var (principal, errorResponse) = await JwtHelper.Authorize(request);
            if (errorResponse != null) return errorResponse;`;
}

/**
 * Python Functions のハンドラーに挿入するロールガードコードを生成
 */
export function generateAuthGuardPython(policy: ModelAuthPolicy, operation: 'read' | 'write'): string {
  const roles = operation === 'read'
    ? (policy.read || policy.roles || [])
    : (policy.write || policy.roles || []);

  if (roles.length > 0) {
    const rolesStr = roles.map(r => `"${r}"`).join(', ');
    return `    user = require_auth(req)
    require_roles(user, [${rolesStr}])`;
  }
  return `    user = require_auth(req)`;
}
