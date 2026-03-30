/**
 * コネクタ Functions ジェネレーターのテスト
 */

import {
  generateRdbConnectorFunctionTS,
  generateApiConnectorFunctionTS,
  generateRdbConnectorFunctionCSharp,
  generateApiConnectorFunctionCSharp,
  generateRdbConnectorFunctionPython,
  generateApiConnectorFunctionPython,
  isReadOnlyConnector,
} from "../core/scaffold/connector-functions-generator";
import {
  createRdbConnectorModelInfo,
  createApiConnectorModelInfo,
} from "./fixtures";
import {
  RdbConnectorConfig,
  ApiConnectorConfig,
  RdbModelConnectorConfig,
  ApiModelConnectorConfig,
} from "../types";

// ─── Shared Test Data ────────────────────────────────────────

const mysqlConnector: RdbConnectorConfig = {
  type: "rdb",
  provider: "mysql",
  connectionEnvVar: "MYSQL_CONNECTION_STRING",
};

const postgresConnector: RdbConnectorConfig = {
  type: "rdb",
  provider: "postgres",
  connectionEnvVar: "PG_CONNECTION_STRING",
};

const sqlserverConnector: RdbConnectorConfig = {
  type: "rdb",
  provider: "sqlserver",
  connectionEnvVar: "MSSQL_CONNECTION_STRING",
};

const backlogConnector: ApiConnectorConfig = {
  type: "api",
  baseUrlEnvVar: "BACKLOG_API_BASE_URL",
  auth: {
    type: "apiKey",
    envVar: "BACKLOG_API_KEY",
    placement: "query",
    paramName: "apiKey",
  },
};

const bearerConnector: ApiConnectorConfig = {
  type: "api",
  baseUrlEnvVar: "EXT_API_BASE_URL",
  auth: {
    type: "bearer",
    envVar: "EXT_API_TOKEN",
  },
};

// ─── isReadOnlyConnector ────────────────────────────────────

describe("isReadOnlyConnector", () => {
  it("returns true when only read operations are present", () => {
    expect(isReadOnlyConnector(["getAll", "getById"])).toBe(true);
    expect(isReadOnlyConnector(["getAll"])).toBe(true);
    expect(isReadOnlyConnector(["getById"])).toBe(true);
  });

  it("returns false when write operations are present", () => {
    expect(isReadOnlyConnector(["getAll", "getById", "create"])).toBe(false);
    expect(isReadOnlyConnector(["getAll", "update"])).toBe(false);
    expect(isReadOnlyConnector(["getAll", "delete"])).toBe(false);
  });
});

// ─── TypeScript RDB Connector ───────────────────────────────

describe("generateRdbConnectorFunctionTS", () => {
  const model = createRdbConnectorModelInfo();
  const modelConnector = model.connectorConfig as RdbModelConnectorConfig;

  it("generates MySQL read-only functions", () => {
    const code = generateRdbConnectorFunctionTS(model, "@myapp/shared", mysqlConnector, modelConnector);
    expect(code).toContain("import mysql from 'mysql2/promise'");
    expect(code).toContain("MYSQL_CONNECTION_STRING");
    expect(code).toContain("SELECT * FROM users");
    expect(code).toContain("user-get-all");
    expect(code).toContain("user-get-by-id");
    // Should NOT contain write operations
    expect(code).not.toContain("user-create");
    expect(code).not.toContain("user-update");
    expect(code).not.toContain("user-delete");
  });

  it("generates PostgreSQL functions", () => {
    const code = generateRdbConnectorFunctionTS(model, "@myapp/shared", postgresConnector, modelConnector);
    expect(code).toContain("import pg from 'pg'");
    expect(code).toContain("PG_CONNECTION_STRING");
  });

  it("generates SQL Server functions", () => {
    const code = generateRdbConnectorFunctionTS(model, "@myapp/shared", sqlserverConnector, modelConnector);
    expect(code).toContain("import sql from 'mssql'");
    expect(code).toContain("MSSQL_CONNECTION_STRING");
  });

  it("uses correct table and id column", () => {
    const code = generateRdbConnectorFunctionTS(model, "@myapp/shared", mysqlConnector, modelConnector);
    expect(code).toContain("FROM users");
    expect(code).toContain("WHERE id = ");
  });

  it("imports schema from shared package", () => {
    const code = generateRdbConnectorFunctionTS(model, "@myapp/shared", mysqlConnector, modelConnector);
    expect(code).toContain("from '@myapp/shared'");
  });
});

// ─── TypeScript API Connector ───────────────────────────────

describe("generateApiConnectorFunctionTS", () => {
  const model = createApiConnectorModelInfo();
  const modelConnector = model.connectorConfig as ApiModelConnectorConfig;

  it("generates read-write functions with apiKey auth", () => {
    const code = generateApiConnectorFunctionTS(model, "@myapp/shared", backlogConnector, modelConnector);
    expect(code).toContain("BACKLOG_API_BASE_URL");
    expect(code).toContain("backlogIssue-get-all");
    expect(code).toContain("backlogIssue-get-by-id");
    expect(code).toContain("backlogIssue-create");
    expect(code).toContain("backlogIssue-update");
  });

  it("generates bearer auth helper", () => {
    const code = generateApiConnectorFunctionTS(model, "@myapp/shared", bearerConnector, modelConnector);
    expect(code).toContain("Authorization");
    expect(code).toContain("Bearer");
    expect(code).toContain("EXT_API_TOKEN");
  });

  it("does not generate delete when not in operations", () => {
    const code = generateApiConnectorFunctionTS(model, "@myapp/shared", backlogConnector, modelConnector);
    expect(code).not.toContain("backlogIssue-delete");
  });

  it("generates read-only API connector when operations are limited", () => {
    const readOnlyModel = createApiConnectorModelInfo({
      connectorConfig: {
        connector: "backlog",
        operations: ["getAll", "getById"],
        endpoints: {
          getAll: "GET /issues",
          getById: "GET /issues/{id}",
        },
      },
    });
    const readOnlyConnector = readOnlyModel.connectorConfig as ApiModelConnectorConfig;
    const code = generateApiConnectorFunctionTS(readOnlyModel, "@myapp/shared", backlogConnector, readOnlyConnector);
    expect(code).toContain("backlogIssue-get-all");
    expect(code).not.toContain("backlogIssue-create");
    expect(code).not.toContain("backlogIssue-update");
  });
});

// ─── C# RDB Connector ──────────────────────────────────────

describe("generateRdbConnectorFunctionCSharp", () => {
  const model = createRdbConnectorModelInfo();
  const modelConnector = model.connectorConfig as RdbModelConnectorConfig;

  it("generates MySQL C# connector functions", () => {
    const code = generateRdbConnectorFunctionCSharp(model, mysqlConnector, modelConnector);
    expect(code).toContain("MySqlConnection");
    expect(code).toContain("MYSQL_CONNECTION_STRING");
    expect(code).toContain("UserConnectorFunctions");
    expect(code).toContain('[Function("userGetAll")]');
    expect(code).toContain('[Function("userGetById")]');
    // Should NOT contain write operations
    expect(code).not.toContain('[Function("userCreate")]');
    expect(code).not.toContain('[Function("userUpdate")]');
  });

  it("generates PostgreSQL C# connector", () => {
    const code = generateRdbConnectorFunctionCSharp(model, postgresConnector, modelConnector);
    expect(code).toContain("NpgsqlConnection");
    expect(code).toContain("PG_CONNECTION_STRING");
  });

  it("generates SQL Server C# connector", () => {
    const code = generateRdbConnectorFunctionCSharp(model, sqlserverConnector, modelConnector);
    expect(code).toContain("SqlConnection");
    expect(code).toContain("MSSQL_CONNECTION_STRING");
  });

  it("uses Route attribute with correct paths", () => {
    const code = generateRdbConnectorFunctionCSharp(model, mysqlConnector, modelConnector);
    expect(code).toContain('Route = "user"');
    expect(code).toContain('Route = "user/{id}"');
  });
});

// ─── C# API Connector ──────────────────────────────────────

describe("generateApiConnectorFunctionCSharp", () => {
  const model = createApiConnectorModelInfo();
  const modelConnector = model.connectorConfig as ApiModelConnectorConfig;

  it("generates API connector with CRUD operations", () => {
    const code = generateApiConnectorFunctionCSharp(model, backlogConnector, modelConnector);
    expect(code).toContain("BacklogIssueConnectorFunctions");
    expect(code).toContain("HttpClient");
    expect(code).toContain("BACKLOG_API_BASE_URL");
    expect(code).toContain('[Function("backlogIssueGetAll")]');
    expect(code).toContain('[Function("backlogIssueGetById")]');
    expect(code).toContain('[Function("backlogIssueCreate")]');
    expect(code).toContain('[Function("backlogIssueUpdate")]');
  });

  it("includes auth configuration for apiKey", () => {
    const code = generateApiConnectorFunctionCSharp(model, backlogConnector, modelConnector);
    expect(code).toContain("BACKLOG_API_KEY");
    expect(code).toContain("apiKey");
  });

  it("generates bearer auth for C#", () => {
    const code = generateApiConnectorFunctionCSharp(model, bearerConnector, modelConnector);
    expect(code).toContain("Authorization");
    expect(code).toContain("Bearer");
    expect(code).toContain("EXT_API_TOKEN");
  });
});

// ─── Python RDB Connector ───────────────────────────────────

describe("generateRdbConnectorFunctionPython", () => {
  const model = createRdbConnectorModelInfo();
  const modelConnector = model.connectorConfig as RdbModelConnectorConfig;

  it("generates MySQL Python connector", () => {
    const result = generateRdbConnectorFunctionPython(model, mysqlConnector, modelConnector);
    expect(result.registration).toContain("user");
    expect(result.blueprint).toContain("mysql.connector");
    expect(result.blueprint).toContain("MYSQL_CONNECTION_STRING");
    expect(result.blueprint).toContain("SELECT * FROM users");
    expect(result.blueprint).toContain('route="user"');
    expect(result.blueprint).toContain('methods=["GET"]');
  });

  it("returns registration and blueprint as object", () => {
    const result = generateRdbConnectorFunctionPython(model, mysqlConnector, modelConnector);
    expect(result).toHaveProperty("registration");
    expect(result).toHaveProperty("blueprint");
    expect(typeof result.registration).toBe("string");
    expect(typeof result.blueprint).toBe("string");
  });
});

// ─── Python API Connector ───────────────────────────────────

describe("generateApiConnectorFunctionPython", () => {
  const model = createApiConnectorModelInfo();
  const modelConnector = model.connectorConfig as ApiModelConnectorConfig;

  it("generates API Python connector with CRUD", () => {
    const result = generateApiConnectorFunctionPython(model, backlogConnector, modelConnector);
    expect(result.blueprint).toContain("BACKLOG_API_BASE_URL");
    expect(result.blueprint).toContain("requests");
    expect(result.blueprint).toContain('route="backlogIssue"');
  });

  it("includes apiKey auth in Python", () => {
    const result = generateApiConnectorFunctionPython(model, backlogConnector, modelConnector);
    expect(result.blueprint).toContain("BACKLOG_API_KEY");
    expect(result.blueprint).toContain("apiKey");
  });

  it("generates bearer auth for Python", () => {
    const result = generateApiConnectorFunctionPython(model, bearerConnector, modelConnector);
    expect(result.blueprint).toContain("Authorization");
    expect(result.blueprint).toContain("Bearer");
    expect(result.blueprint).toContain("EXT_API_TOKEN");
  });
});
