import {
  generateAuthModels,
  generateAuthFunctionsTS,
  generateJwtHelperTS,
  generateAuthFunctionsCSharp,
  generateJwtHelperCSharp,
  generateAuthFunctionsPython,
  generateJwtHelperPython,
  generateBFFAuthLoginRoute,
  generateBFFAuthLogoutRoute,
  generateBFFAuthMeRoute,
  generateMiddleware,
  generateLoginPage,
  generateAuthContext,
  generateBFFCallFunctionWithAuth,
  generateAuthImportTS,
  generateAuthGuardTS,
  generateAuthGuardCSharp,
  generateAuthGuardPython,
} from "../core/scaffold/auth-generator";
import { generateCompactAzureFunctionsCRUD } from "../core/scaffold/functions-generator";
import { parseAuthPolicy } from "../core/scaffold/model-parser";
import { createBasicModelInfo } from "./fixtures";
import { ModelAuthPolicy, CustomJwtConfig } from "../types";

const defaultJwtConfig: CustomJwtConfig = {
  userConnector: "mysql",
  userTable: "users",
  loginIdColumn: "login_id",
  passwordHashColumn: "password_hash",
  rolesColumn: "roles",
  jwtSecretEnv: "JWT_SECRET",
  tokenExpiry: "24h",
};

const sharedPkg = "@myapp/shared";

// ============================================================
// auth-generator: Shared models
// ============================================================
describe("generateAuthModels", () => {
  it("generates LoginRequest, AuthUser, LoginResponse Zod schemas", () => {
    const code = generateAuthModels();
    expect(code).toContain("LoginRequest");
    expect(code).toContain("AuthUser");
    expect(code).toContain("LoginResponse");
    expect(code).toContain("z.object");
    expect(code).toContain("loginId");
    expect(code).toContain("password");
    expect(code).toContain("roles");
  });

  it("exports type aliases for each schema", () => {
    const code = generateAuthModels();
    expect(code).toContain("export type LoginRequest");
    expect(code).toContain("export type AuthUser");
    expect(code).toContain("export type LoginResponse");
  });

  it("does NOT contain passwordHash or backlogApiKey", () => {
    const code = generateAuthModels();
    expect(code).not.toContain("passwordHash");
    expect(code).not.toContain("backlogApiKey");
  });
});

// ============================================================
// auth-generator: TypeScript Functions
// ============================================================
describe("generateAuthFunctionsTS", () => {
  it("generates login, me, logout endpoints", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "mysql");
    expect(code).toContain("auth-login");
    expect(code).toContain("auth-me");
    expect(code).toContain("auth-logout");
  });

  it("uses bcrypt for password verification", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "mysql");
    expect(code).toContain("bcrypt");
    expect(code).toContain("compare");
  });

  it("uses JWT for token generation", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "mysql");
    expect(code).toContain("generateToken");
  });

  it("queries MySQL for user authentication", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "mysql");
    expect(code).toContain("mysql2");
  });
});

describe("generateJwtHelperTS", () => {
  it("exports requireAuth, requireRoles, generateToken, handleAuthError", () => {
    const code = generateJwtHelperTS();
    expect(code).toContain("export function requireAuth");
    expect(code).toContain("export function requireRoles");
    expect(code).toContain("export function generateToken");
    expect(code).toContain("export function handleAuthError");
  });

  it("exports AuthError class", () => {
    const code = generateJwtHelperTS();
    expect(code).toContain("export class AuthError");
  });

  it("exports JwtPayload interface", () => {
    const code = generateJwtHelperTS();
    expect(code).toContain("interface JwtPayload");
  });

  it("validates Authorization Bearer header", () => {
    const code = generateJwtHelperTS();
    expect(code).toContain("Bearer");
    expect(code).toContain("authorization");
  });

  it("uses JWT_SECRET from environment", () => {
    const code = generateJwtHelperTS();
    expect(code).toContain("JWT_SECRET");
  });
});

// ============================================================
// auth-generator: C# Functions
// ============================================================
describe("generateAuthFunctionsCSharp", () => {
  it("generates login, me, logout endpoints", () => {
    const code = generateAuthFunctionsCSharp(defaultJwtConfig, "mysql");
    expect(code).toContain("auth-login");
    expect(code).toContain("auth-me");
    expect(code).toContain("auth-logout");
  });

  it("uses BCrypt for password verification", () => {
    const code = generateAuthFunctionsCSharp(defaultJwtConfig, "mysql");
    expect(code).toContain("BCrypt");
    expect(code).toContain("Verify");
  });
});

describe("generateJwtHelperCSharp", () => {
  it("exports Authorize method", () => {
    const code = generateJwtHelperCSharp();
    expect(code).toContain("Authorize");
  });

  it("uses System.IdentityModel.Tokens.Jwt", () => {
    const code = generateJwtHelperCSharp();
    expect(code).toContain("System.IdentityModel.Tokens.Jwt");
  });
});

// ============================================================
// auth-generator: Python Functions
// ============================================================
describe("generateAuthFunctionsPython", () => {
  it("generates login, me, logout endpoints", () => {
    const code = generateAuthFunctionsPython(defaultJwtConfig, "mysql");
    expect(code).toContain("auth/login");
    expect(code).toContain("auth/me");
    expect(code).toContain("auth/logout");
  });

  it("uses bcrypt for password verification", () => {
    const code = generateAuthFunctionsPython(defaultJwtConfig, "mysql");
    expect(code).toContain("bcrypt");
  });
});

describe("generateJwtHelperPython", () => {
  it("exports require_auth, require_roles, generate_token", () => {
    const code = generateJwtHelperPython();
    expect(code).toContain("def require_auth");
    expect(code).toContain("def require_roles");
    expect(code).toContain("def generate_token");
  });

  it("uses PyJWT library", () => {
    const code = generateJwtHelperPython();
    expect(code).toContain("import jwt");
  });
});

// ============================================================
// auth-generator: BFF routes
// ============================================================
describe("generateBFFAuthLoginRoute", () => {
  it("generates POST handler for login", () => {
    const code = generateBFFAuthLoginRoute("test-project", sharedPkg);
    expect(code).toContain("POST");
    expect(code).toContain("FUNCTIONS_BASE_URL");
  });

  it("sets httpOnly cookie with project-derived name", () => {
    const code = generateBFFAuthLoginRoute("test-project", sharedPkg);
    expect(code).toContain("test-project-auth-token");
    expect(code).toContain("httpOnly: true");
    expect(code).toContain("sameSite: 'lax'");
  });

  it("sanitizes scoped package names for cookie", () => {
    const code = generateBFFAuthLoginRoute("@scope/my-app", sharedPkg);
    expect(code).toContain("my-app-auth-token");
    expect(code).not.toContain("@scope");
  });
});

describe("generateBFFAuthLogoutRoute", () => {
  it("generates POST handler for logout", () => {
    const code = generateBFFAuthLogoutRoute("test-project");
    expect(code).toContain("POST");
  });

  it("deletes auth cookie", () => {
    const code = generateBFFAuthLogoutRoute("test-project");
    expect(code).toContain("delete");
    expect(code).toContain("test-project-auth-token");
  });
});

describe("generateBFFAuthMeRoute", () => {
  it("generates GET handler for current user", () => {
    const code = generateBFFAuthMeRoute(sharedPkg);
    expect(code).toContain("GET");
    expect(code).toContain("FUNCTIONS_BASE_URL");
  });
});

// ============================================================
// auth-generator: Middleware
// ============================================================
describe("generateMiddleware", () => {
  it("checks for auth cookie", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("test-project-auth-token");
    expect(code).toContain("cookies.get");
  });

  it("redirects to /login for unauthenticated page requests", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("/login");
    expect(code).toContain("redirect");
  });

  it("returns 401 for unauthenticated API requests", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("401");
    expect(code).toContain("Unauthorized");
  });

  it("injects Authorization header from cookie", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("Authorization");
    expect(code).toContain("Bearer");
  });

  it("skips public paths", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("/login");
    expect(code).toContain("/api/auth/login");
  });

  it("checks JWT expiry (base64 decode, no signature verification)", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("atob");
    expect(code).toContain("exp");
  });

  it("exports matcher config", () => {
    const code = generateMiddleware("test-project");
    expect(code).toContain("export const config");
    expect(code).toContain("matcher");
  });
});

// ============================================================
// auth-generator: Frontend
// ============================================================
describe("generateLoginPage", () => {
  it("generates a React login form component", () => {
    const code = generateLoginPage();
    expect(code).toContain("use client");
    expect(code).toContain("loginId");
    expect(code).toContain("password");
    expect(code).toContain("handleSubmit");
    expect(code).toContain("/api/auth/login");
  });
});

describe("generateAuthContext", () => {
  it("generates React context with useAuth hook", () => {
    const code = generateAuthContext();
    expect(code).toContain("useAuth");
    expect(code).toContain("AuthProvider");
    expect(code).toContain("createContext");
  });

  it("provides login, logout, user state", () => {
    const code = generateAuthContext();
    expect(code).toContain("login");
    expect(code).toContain("logout");
    expect(code).toContain("user");
  });
});

// ============================================================
// auth-generator: callFunction with auth
// ============================================================
describe("generateBFFCallFunctionWithAuth", () => {
  it("imports headers from next/headers", () => {
    const code = generateBFFCallFunctionWithAuth();
    expect(code).toContain("import { headers } from 'next/headers'");
  });

  it("forwards Authorization header", () => {
    const code = generateBFFCallFunctionWithAuth();
    expect(code).toContain("Authorization");
    expect(code).toContain("authorization");
  });

  it("handles headers() unavailable gracefully", () => {
    const code = generateBFFCallFunctionWithAuth();
    expect(code).toContain("catch");
  });
});

// ============================================================
// auth-generator: Scaffold helpers
// ============================================================
describe("generateAuthImportTS", () => {
  it("generates import from ./auth/jwt-helper", () => {
    const code = generateAuthImportTS();
    expect(code).toContain("requireAuth");
    expect(code).toContain("handleAuthError");
    expect(code).toContain("./auth/jwt-helper");
  });
});

describe("generateAuthGuardTS", () => {
  it("generates authentication-only guard for empty policy", () => {
    const policy: ModelAuthPolicy = {};
    const readGuard = generateAuthGuardTS(policy, "read");
    expect(readGuard).toContain("requireAuth");
    expect(readGuard).not.toContain("requireRoles");
  });

  it("generates role guard for policy with roles", () => {
    const policy: ModelAuthPolicy = { roles: ["admin", "editor"] };
    const guard = generateAuthGuardTS(policy, "read");
    expect(guard).toContain("requireAuth");
    expect(guard).toContain("requireRoles");
    expect(guard).toContain("admin");
    expect(guard).toContain("editor");
  });

  it("uses read roles for read operations", () => {
    const policy: ModelAuthPolicy = {
      read: ["viewer", "admin"],
      write: ["admin"],
    };
    const guard = generateAuthGuardTS(policy, "read");
    expect(guard).toContain("viewer");
    expect(guard).toContain("admin");
    expect(guard).not.toContain("'admin'"); // It should have admin as part of roles array
  });

  it("uses write roles for write operations", () => {
    const policy: ModelAuthPolicy = {
      read: ["viewer", "admin"],
      write: ["admin"],
    };
    const guard = generateAuthGuardTS(policy, "write");
    expect(guard).toContain("admin");
    expect(guard).not.toContain("viewer");
  });

  it("falls back to roles when read/write not specified", () => {
    const policy: ModelAuthPolicy = { roles: ["admin"] };
    const readGuard = generateAuthGuardTS(policy, "read");
    const writeGuard = generateAuthGuardTS(policy, "write");
    expect(readGuard).toContain("admin");
    expect(writeGuard).toContain("admin");
  });
});

describe("generateAuthGuardCSharp", () => {
  it("generates JwtHelper.Authorize call for C# with roles", () => {
    const policy: ModelAuthPolicy = { roles: ["admin"] };
    const guard = generateAuthGuardCSharp(policy, "read");
    expect(guard).toContain("Authorize");
    expect(guard).toContain("admin");
  });

  it("generates authentication-only guard for empty policy", () => {
    const policy: ModelAuthPolicy = {};
    const guard = generateAuthGuardCSharp(policy, "read");
    expect(guard).toContain("Authorize");
  });
});

describe("generateAuthGuardPython", () => {
  it("generates require_auth call for Python with roles", () => {
    const policy: ModelAuthPolicy = { roles: ["admin"] };
    const guard = generateAuthGuardPython(policy, "read");
    expect(guard).toContain("require_auth");
  });

  it("generates authentication-only guard for empty policy", () => {
    const policy: ModelAuthPolicy = {};
    const guard = generateAuthGuardPython(policy, "read");
    expect(guard).toContain("require_auth");
  });
});

// ============================================================
// model-parser: parseAuthPolicy
// ============================================================
describe("parseAuthPolicy", () => {
  it("parses simple roles-based authPolicy", () => {
    const content = `
export const Estimate = z.object({ id: z.string() });
export const displayName = '見積';
export const authPolicy = {
  roles: ['admin', 'estimator'],
};
`;
    const result = parseAuthPolicy(content);
    expect(result).toEqual({ roles: ["admin", "estimator"] });
  });

  it("parses read/write authPolicy", () => {
    const content = `
export const authPolicy = {
  read: ['admin', 'member'],
  write: ['admin'],
};
`;
    const result = parseAuthPolicy(content);
    expect(result).toEqual({
      read: ["admin", "member"],
      write: ["admin"],
    });
  });

  it("parses authPolicy with all three fields", () => {
    const content = `
export const authPolicy = {
  roles: ['admin'],
  read: ['admin', 'viewer'],
  write: ['admin'],
};
`;
    const result = parseAuthPolicy(content);
    expect(result).toEqual({
      roles: ["admin"],
      read: ["admin", "viewer"],
      write: ["admin"],
    });
  });

  it("returns undefined when no authPolicy export exists", () => {
    const content = `
export const Estimate = z.object({ id: z.string() });
export const displayName = '見積';
`;
    const result = parseAuthPolicy(content);
    expect(result).toBeUndefined();
  });

  it("handles double-quoted strings", () => {
    const content = `
export const authPolicy = {
  roles: ["admin", "editor"],
};
`;
    const result = parseAuthPolicy(content);
    expect(result).toEqual({ roles: ["admin", "editor"] });
  });

  it("returns undefined for empty authPolicy object", () => {
    const content = `
export const authPolicy = {};
`;
    const result = parseAuthPolicy(content);
    expect(result).toBeUndefined();
  });
});

// ============================================================
// functions-generator: Auth guard integration in TS CRUD
// ============================================================
describe("generateCompactAzureFunctionsCRUD with auth", () => {
  it("generates auth imports when authPolicy is provided", () => {
    const model = createBasicModelInfo();
    const policy: ModelAuthPolicy = { roles: ["admin"] };
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared", policy);
    expect(code).toContain("requireAuth");
    expect(code).toContain("handleAuthError");
    expect(code).toContain("./auth/jwt-helper");
  });

  it("does NOT generate auth imports when authPolicy is absent", () => {
    const model = createBasicModelInfo();
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared");
    expect(code).not.toContain("requireAuth");
    expect(code).not.toContain("handleAuthError");
    expect(code).not.toContain("./auth/jwt-helper");
  });

  it("injects role guards into all CRUD handlers", () => {
    const model = createBasicModelInfo();
    const policy: ModelAuthPolicy = { roles: ["admin", "editor"] };
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared", policy);
    // requireAuth should appear in every handler (5 handlers)
    const requireAuthCount = (code.match(/requireAuth/g) || []).length;
    // At least import + handlers
    expect(requireAuthCount).toBeGreaterThanOrEqual(5);
  });

  it("uses read roles for GET handlers and write roles for POST/PUT/DELETE", () => {
    const model = createBasicModelInfo();
    const policy: ModelAuthPolicy = {
      read: ["admin", "viewer"],
      write: ["admin"],
    };
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared", policy);
    expect(code).toContain("requireAuth");
    // Should have both viewer (read) and admin (write) roles
    expect(code).toContain("viewer");
    expect(code).toContain("admin");
  });

  it("generates auth error handling in catch blocks", () => {
    const model = createBasicModelInfo();
    const policy: ModelAuthPolicy = { roles: ["admin"] };
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared", policy);
    // handleAuthError should appear in each catch block
    const handleAuthCount = (code.match(/handleAuthError/g) || []).length;
    expect(handleAuthCount).toBeGreaterThanOrEqual(5);
  });

  it("generates authentication-only guard for empty policy (defaultPolicy: authenticated)", () => {
    const model = createBasicModelInfo();
    const policy: ModelAuthPolicy = {}; // empty = auth only, no specific roles
    const code = generateCompactAzureFunctionsCRUD(model, "@myapp/shared", policy);
    expect(code).toContain("requireAuth");
    // requireRoles should not be called (only imported)
    expect(code).not.toContain("requireRoles(");
  });
});

// ============================================================
// Multi-RDB Provider: TypeScript
// ============================================================
describe("generateAuthFunctionsTS - multi-provider", () => {
  it("generates PostgreSQL driver code when provider is postgres", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "postgres");
    expect(code).toContain("import pg from 'pg'");
    expect(code).toContain("new pg.Client");
    expect(code).toContain("client.connect()");
    expect(code).toContain("$1");
    expect(code).toContain("result.rows");
    expect(code).not.toContain("mysql2");
    expect(code).not.toContain("mssql");
  });

  it("generates SQL Server driver code when provider is sqlserver", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "sqlserver");
    expect(code).toContain("import sql from 'mssql'");
    expect(code).toContain("sql.connect");
    expect(code).toContain(".input(");
    expect(code).toContain("@loginId");
    expect(code).toContain("recordset");
    expect(code).not.toContain("mysql2");
    expect(code).not.toContain("import pg");
  });

  it("generates MySQL driver code when provider is mysql", () => {
    const code = generateAuthFunctionsTS(sharedPkg, defaultJwtConfig, "mysql");
    expect(code).toContain("import mysql from 'mysql2/promise'");
    expect(code).toContain("mysql.createConnection");
    expect(code).toContain("WHERE login_id = ?");
    expect(code).not.toContain("import pg");
    expect(code).not.toContain("import sql from");
  });

  it("uses the connection env var from userConnector config", () => {
    const pgConfig: CustomJwtConfig = { ...defaultJwtConfig, userConnector: "my-pg-db" };
    const code = generateAuthFunctionsTS(sharedPkg, pgConfig, "postgres");
    expect(code).toContain("MY-PG-DB_CONNECTION_STRING");
  });
});

// ============================================================
// Multi-RDB Provider: C#
// ============================================================
describe("generateAuthFunctionsCSharp - multi-provider", () => {
  it("generates Npgsql code when provider is postgres", () => {
    const code = generateAuthFunctionsCSharp(defaultJwtConfig, "postgres");
    expect(code).toContain("using Npgsql");
    expect(code).toContain("NpgsqlConnection");
    expect(code).toContain("NpgsqlCommand");
    expect(code).not.toContain("MySqlConnector");
    expect(code).not.toContain("SqlClient");
  });

  it("generates SqlClient code when provider is sqlserver", () => {
    const code = generateAuthFunctionsCSharp(defaultJwtConfig, "sqlserver");
    expect(code).toContain("Microsoft.Data.SqlClient");
    expect(code).toContain("SqlConnection");
    expect(code).toContain("SqlCommand");
    expect(code).not.toContain("MySqlConnector");
    expect(code).not.toContain("Npgsql");
  });

  it("generates MySqlConnector code when provider is mysql", () => {
    const code = generateAuthFunctionsCSharp(defaultJwtConfig, "mysql");
    expect(code).toContain("MySqlConnector");
    expect(code).toContain("MySqlConnection");
    expect(code).toContain("MySqlCommand");
    expect(code).not.toContain("Npgsql");
    expect(code).not.toContain("SqlClient");
  });
});

// ============================================================
// Multi-RDB Provider: Python
// ============================================================
describe("generateAuthFunctionsPython - multi-provider", () => {
  it("generates psycopg2 code when provider is postgres", () => {
    const code = generateAuthFunctionsPython(defaultJwtConfig, "postgres");
    expect(code).toContain("psycopg2");
    expect(code).toContain("RealDictCursor");
    expect(code).not.toContain("mysql.connector");
    expect(code).not.toContain("pymssql");
  });

  it("generates pymssql code when provider is sqlserver", () => {
    const code = generateAuthFunctionsPython(defaultJwtConfig, "sqlserver");
    expect(code).toContain("pymssql");
    expect(code).not.toContain("mysql.connector");
    expect(code).not.toContain("psycopg2");
  });

  it("generates mysql.connector code when provider is mysql", () => {
    const code = generateAuthFunctionsPython(defaultJwtConfig, "mysql");
    expect(code).toContain("mysql.connector");
    expect(code).not.toContain("psycopg2");
    expect(code).not.toContain("pymssql");
  });
});
