/**
 * コネクタモックサーバーのテスト
 */

import * as http from "http";
import { ConnectorMockServer } from "../core/mock/connector-mock-server";
import {
  createRdbConnectorModelInfo,
  createApiConnectorModelInfo,
} from "./fixtures";

// ─── Helpers ────────────────────────────────────────────────

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: "localhost",
      port,
      path,
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };

    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode || 0,
            body: data ? JSON.parse(data) : null,
          });
        } catch {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ─── Tests ──────────────────────────────────────────────────

describe("ConnectorMockServer", () => {
  let server: ConnectorMockServer;
  const TEST_PORT = 19876; // Unlikely to conflict

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("starts and stops without errors", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();
    await server.stop();
  });

  it("serves GET /api/<model> with mock data", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 3,
    });

    await server.start();

    const { status, body } = await httpRequest(TEST_PORT, "GET", "/api/user");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as any[]).length).toBe(3);
    expect((body as any[])[0]).toHaveProperty("id");
    expect((body as any[])[0]).toHaveProperty("email");
  });

  it("serves GET /api/<model>/<id> for single item", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 3,
    });

    await server.start();

    const { status, body } = await httpRequest(TEST_PORT, "GET", "/api/user/user-001");
    expect(status).toBe(200);
    expect((body as any).id).toBe("user-001");
  });

  it("returns 404 for non-existent item", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();

    const { status } = await httpRequest(TEST_PORT, "GET", "/api/user/nonexistent");
    expect(status).toBe(404);
  });

  it("returns 405 for write operations on read-only connector", async () => {
    // RDB connector model has operations: ["getAll", "getById"] (read-only)
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();

    const { status } = await httpRequest(TEST_PORT, "POST", "/api/user", { name: "New" });
    expect(status).toBe(405);
  });

  it("supports POST for read-write connector models", async () => {
    // API connector model has operations: ["getAll", "getById", "create", "update"]
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createApiConnectorModelInfo()],
      mockCount: 0,
    });

    await server.start();

    const { status, body } = await httpRequest(TEST_PORT, "POST", "/api/backlogIssue", {
      summary: "Test issue",
      projectId: "proj-1",
      issueKey: "TEST-001",
    });
    expect(status).toBe(201);
    expect((body as any).summary).toBe("Test issue");
    expect((body as any).id).toBeDefined();

    // Verify it was stored
    const { body: allBody } = await httpRequest(TEST_PORT, "GET", "/api/backlogIssue");
    expect((allBody as any[]).length).toBe(1);
  });

  it("supports PUT for update operations", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createApiConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();

    const store = server.getStore("BacklogIssue");
    const firstId = store[0].id as string;

    const { status, body } = await httpRequest(TEST_PORT, "PUT", `/api/backlogIssue/${firstId}`, {
      summary: "Updated summary",
    });
    expect(status).toBe(200);
    expect((body as any).summary).toBe("Updated summary");
    expect((body as any).id).toBe(firstId);
  });

  it("returns 405 for DELETE when not in operations", async () => {
    // API connector model doesn't include "delete" in operations
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createApiConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();

    const store = server.getStore("BacklogIssue");
    const firstId = store[0].id as string;

    const { status } = await httpRequest(TEST_PORT, "DELETE", `/api/backlogIssue/${firstId}`);
    expect(status).toBe(405);
  });

  it("proxies non-connector routes to Functions target (returns 502 when Functions not running)", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:19877", // No server on this port
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 1,
    });

    await server.start();

    // /api/todo is NOT a connector model route, so it should be proxied
    const { status, body } = await httpRequest(TEST_PORT, "GET", "/api/todo");
    expect(status).toBe(502);
    expect((body as any).error).toContain("not available");
  });

  it("handles multiple connector models simultaneously", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo(), createApiConnectorModelInfo()],
      mockCount: 2,
    });

    await server.start();

    const usersRes = await httpRequest(TEST_PORT, "GET", "/api/user");
    expect(usersRes.status).toBe(200);
    expect((usersRes.body as any[]).length).toBe(2);

    const issuesRes = await httpRequest(TEST_PORT, "GET", "/api/backlogIssue");
    expect(issuesRes.status).toBe(200);
    expect((issuesRes.body as any[]).length).toBe(2);
  });

  it("getStore returns current data for a model", async () => {
    server = new ConnectorMockServer({
      port: TEST_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [createRdbConnectorModelInfo()],
      mockCount: 3,
    });

    await server.start();

    const store = server.getStore("User");
    expect(store.length).toBe(3);
    expect(store[0].id).toBe("user-001");
  });
});

// ============================================================
// Mock Auth Endpoints
// ============================================================
describe("ConnectorMockServer - Auth Endpoints", () => {
  let server: ConnectorMockServer;
  const AUTH_PORT = 19877;
  const JWT_SECRET = "test-jwt-secret-for-mock-auth-tests";

  // Auth-compatible User model (has loginId, password, roles fields)
  const authUserModel = createRdbConnectorModelInfo({
    name: "User",
    displayName: "User",
    schemaName: "userSchema",
    filePath: "/models/user.ts",
    fields: [
      { name: "id", type: "string", isOptional: false, isArray: false },
      { name: "loginId", type: "string", isOptional: false, isArray: false },
      { name: "password", type: "string", isOptional: false, isArray: false },
      { name: "name", type: "string", isOptional: false, isArray: false },
      { name: "email", type: "string", isOptional: false, isArray: false },
      { name: "roles", type: "string", isOptional: false, isArray: true },
    ],
    connectorConfig: {
      connector: "mysql",
      operations: ["getAll", "getById"],
      table: "users",
      idColumn: "id",
    },
  });

  const testUsers = [
    { id: "1", loginId: "admin", password: "password123", name: "Admin User", email: "admin@example.com", roles: ["admin"] },
    { id: "2", loginId: "user", password: "password123", name: "Test User", email: "user@example.com", roles: ["user"] },
  ];

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  /** Start mock server with auth-compatible User model and seed data */
  async function startAuthServer() {
    server = new ConnectorMockServer({
      port: AUTH_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [authUserModel],
      mockCount: 0,
      authConfig: {
        jwtSecret: JWT_SECRET,
        tokenExpiry: "1h",
        customJwt: {
          userTable: "users",
          loginIdColumn: "loginId",
          passwordHashColumn: "password",
          rolesColumn: "roles",
        },
      },
    });
    await server.start();
    // Populate user store with known test data
    const store = server.getStore("User");
    store.push(...testUsers);
  }

  it("handles POST /api/auth/login with users from RDB mock store", async () => {
    await startAuthServer();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "admin",
      password: "password123",
    });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.user).toBeDefined();
    expect(body.user.loginId).toBe("admin");
    expect(body.user.roles).toContain("admin");
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.expiresAt).toBeDefined();
  });

  it("returns 401 for invalid credentials", async () => {
    await startAuthServer();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "admin",
      password: "wrong-password",
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 for non-existent user", async () => {
    await startAuthServer();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "nobody",
      password: "password123",
    });

    expect(res.status).toBe(401);
  });

  it("handles GET /api/auth/me with valid JWT", async () => {
    await startAuthServer();

    // Login first
    const loginRes = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "admin",
      password: "password123",
    });
    const token = (loginRes.body as any).token;

    // Then call /me
    const meRes = await httpRequest(AUTH_PORT, "GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${token}`,
    });

    expect(meRes.status).toBe(200);
    const meBody = meRes.body as any;
    expect(meBody.loginId).toBe("admin");
    expect(meBody.roles).toContain("admin");
  });

  it("returns 401 for /api/auth/me without token", async () => {
    await startAuthServer();

    const res = await httpRequest(AUTH_PORT, "GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("handles POST /api/auth/logout", async () => {
    await startAuthServer();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/logout");
    expect(res.status).toBe(200);
    expect((res.body as any).message).toBe("Logged out");
  });

  it("does not intercept auth routes when authConfig is not set", async () => {
    // Without authConfig, auth routes should be proxied (which will fail since no real Functions)
    server = new ConnectorMockServer({
      port: AUTH_PORT,
      functionsTarget: "localhost:19999", // non-existent to trigger proxy error
      connectorModels: [],
    });
    await server.start();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "admin",
      password: "password123",
    });

    // Should get 502 (proxy error) since auth is not handled by mock
    expect(res.status).toBe(502);
  });

  it("returns 500 when no user model matches the configured userTable", async () => {
    server = new ConnectorMockServer({
      port: AUTH_PORT,
      functionsTarget: "localhost:7071",
      connectorModels: [], // no models at all
      authConfig: {
        jwtSecret: JWT_SECRET,
        customJwt: {
          userTable: "users",
          loginIdColumn: "loginId",
          passwordHashColumn: "password",
          rolesColumn: "roles",
        },
      },
    });
    await server.start();

    const res = await httpRequest(AUTH_PORT, "POST", "/api/auth/login", {
      loginId: "admin",
      password: "password123",
    });

    expect(res.status).toBe(500);
    expect((res.body as any).error).toContain("No user model found");
  });
});
