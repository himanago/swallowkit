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
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: "localhost",
      port,
      path,
      method,
      headers: { "Content-Type": "application/json" },
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
