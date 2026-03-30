/**
 * コネクタ関連のモデルパーサーおよびBFFジェネレーターのテスト
 */

import { parseConnectorConfig } from "../core/scaffold/model-parser";
import { generateConnectorBFFRoutes } from "../core/scaffold/nextjs-generator";
import {
  createRdbConnectorModelInfo,
  createApiConnectorModelInfo,
} from "./fixtures";

// ─── parseConnectorConfig ───────────────────────────────────

describe("parseConnectorConfig", () => {
  it("parses RDB connector config from model content", () => {
    const content = `
import { z } from 'zod/v4';
export const User = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof User>;
export const displayName = 'User';

export const connectorConfig = {
  connector: 'mysql',
  operations: ['getAll', 'getById'] as const,
  table: 'users',
  idColumn: 'id',
};
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeDefined();
    expect(result!.connector).toBe("mysql");
    expect(result!.operations).toEqual(["getAll", "getById"]);
    expect((result as any).table).toBe("users");
    expect((result as any).idColumn).toBe("id");
  });

  it("parses API connector config from model content", () => {
    const content = `
export const connectorConfig = {
  connector: 'backlog',
  operations: ['getAll', 'getById', 'create', 'update'] as const,
  endpoints: {
    getAll: 'GET /issues',
    getById: 'GET /issues/{id}',
    create: 'POST /issues',
    update: 'PATCH /issues/{id}',
  },
};
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeDefined();
    expect(result!.connector).toBe("backlog");
    expect(result!.operations).toEqual(["getAll", "getById", "create", "update"]);
    expect((result as any).endpoints).toEqual({
      getAll: "GET /issues",
      getById: "GET /issues/{id}",
      create: "POST /issues",
      update: "PATCH /issues/{id}",
    });
  });

  it("returns undefined when no connectorConfig export exists", () => {
    const content = `
export const Todo = z.object({ id: z.string() });
export type Todo = z.infer<typeof Todo>;
export const displayName = 'Todo';
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeUndefined();
  });

  it("returns undefined when connector name is missing", () => {
    const content = `
export const connectorConfig = {
  operations: ['getAll'],
};
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeUndefined();
  });

  it("handles single quotes and double quotes", () => {
    const content = `
export const connectorConfig = {
  connector: "postgres",
  operations: ["getAll", "getById"] as const,
  table: "items",
};
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeDefined();
    expect(result!.connector).toBe("postgres");
    expect((result as any).table).toBe("items");
  });

  it("handles API connector without endpoints", () => {
    const content = `
export const connectorConfig = {
  connector: 'external-api',
  operations: ['getAll'] as const,
};
`;
    const result = parseConnectorConfig(content);
    expect(result).toBeDefined();
    expect(result!.connector).toBe("external-api");
    expect(result!.operations).toEqual(["getAll"]);
    expect((result as any).table).toBeUndefined();
    expect((result as any).endpoints).toBeUndefined();
  });
});

// ─── generateConnectorBFFRoutes ─────────────────────────────

describe("generateConnectorBFFRoutes", () => {
  it("generates read-only BFF routes for RDB connector", () => {
    const model = createRdbConnectorModelInfo();
    const routes = generateConnectorBFFRoutes(model, "@myapp/shared", ["getAll", "getById"]);

    expect(routes.listRoute).toContain("export async function GET");
    expect(routes.listRoute).toContain("/api/user");
    expect(routes.listRoute).not.toContain("export async function POST");

    expect(routes.detailRoute).toContain("export async function GET");
    expect(routes.detailRoute).not.toContain("export async function PUT");
    expect(routes.detailRoute).not.toContain("export async function DELETE");
  });

  it("generates read-write BFF routes for API connector", () => {
    const model = createApiConnectorModelInfo();
    const routes = generateConnectorBFFRoutes(model, "@myapp/shared", ["getAll", "getById", "create", "update"]);

    expect(routes.listRoute).toContain("export async function GET");
    expect(routes.listRoute).toContain("export async function POST");

    expect(routes.detailRoute).toContain("export async function GET");
    expect(routes.detailRoute).toContain("export async function PUT");
  });

  it("does not generate DELETE route when delete is not in operations", () => {
    const model = createApiConnectorModelInfo();
    const routes = generateConnectorBFFRoutes(model, "@myapp/shared", ["getAll", "getById", "create", "update"]);

    expect(routes.detailRoute).not.toContain("export async function DELETE");
  });

  it("uses correct route paths based on model name", () => {
    const model = createApiConnectorModelInfo();
    const routes = generateConnectorBFFRoutes(model, "@myapp/shared", ["getAll", "getById"]);

    // BacklogIssue → backlogIssue route
    expect(routes.listRoute).toContain("backlogIssue");
    expect(routes.detailRoute).toContain("backlogIssue");
  });

  it("imports from shared package", () => {
    const model = createRdbConnectorModelInfo();
    const routes = generateConnectorBFFRoutes(model, "@myapp/shared", ["getAll", "getById"]);

    expect(routes.listRoute).toContain("@myapp/shared");
    expect(routes.detailRoute).toContain("@myapp/shared");
  });
});
