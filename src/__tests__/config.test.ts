import { validateConfig, loadConfigFromEnv } from "../core/config";
import { SwallowKitConfig } from "../types";

describe("validateConfig", () => {
  it("returns valid for a complete config", () => {
    const config: SwallowKitConfig = {
      database: { connectionString: "AccountEndpoint=https://..." },
      backend: { language: "typescript" },
      api: { endpoint: "/api/_swallowkit" },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error when connectionString is missing", () => {
    const config: SwallowKitConfig = {
      database: {},
      backend: { language: "typescript" },
      api: { endpoint: "/api/_swallowkit" },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Cosmos DB connection string is required");
  });

  it("returns error when endpoint does not start with /", () => {
    const config: SwallowKitConfig = {
      database: { connectionString: "AccountEndpoint=https://..." },
      backend: { language: "typescript" },
      api: { endpoint: "api/_swallowkit" },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("API endpoint must start with '/'");
  });

  it("returns multiple errors for multiple issues", () => {
    const config: SwallowKitConfig = {
      database: {},
      backend: { language: "typescript" },
      api: { endpoint: "bad-endpoint" },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("returns error when backend language is invalid", () => {
    const config: SwallowKitConfig = {
      backend: { language: "ruby" as never },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Backend language must be one of: typescript, csharp, python");
  });

  it("accepts config without database or api (no validation errors for absent sections)", () => {
    const config: SwallowKitConfig = {};
    const result = validateConfig(config);
    // database is undefined → no connectionString check triggered
    expect(result.errors.filter((e) => e.includes("endpoint"))).toHaveLength(0);
  });

  // ─── Connector Validation ───────────────────────────────────

  it("validates valid RDB connector config", () => {
    const config: SwallowKitConfig = {
      connectors: {
        mysql: {
          type: "rdb",
          provider: "mysql",
          connectionEnvVar: "MYSQL_CONNECTION_STRING",
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates valid API connector config", () => {
    const config: SwallowKitConfig = {
      connectors: {
        backlog: {
          type: "api",
          baseUrlEnvVar: "BACKLOG_API_BASE_URL",
          auth: {
            type: "apiKey",
            envVar: "BACKLOG_API_KEY",
            placement: "query",
            paramName: "apiKey",
          },
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error for invalid connector type", () => {
    const config = {
      connectors: {
        bad: {
          type: "graphql",
          baseUrlEnvVar: "GRAPHQL_URL",
        },
      },
    } as unknown as SwallowKitConfig;
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Connector 'bad'");
    expect(result.errors[0]).toContain("type must be one of");
  });

  it("returns error for RDB connector without provider", () => {
    const config: SwallowKitConfig = {
      connectors: {
        mydb: {
          type: "rdb",
          provider: "" as any,
          connectionEnvVar: "CONN",
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("provider must be one of")])
    );
  });

  it("returns error for RDB connector without connectionEnvVar", () => {
    const config: SwallowKitConfig = {
      connectors: {
        mydb: {
          type: "rdb",
          provider: "mysql",
          connectionEnvVar: "",
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("connectionEnvVar is required")])
    );
  });

  it("returns error for API connector without baseUrlEnvVar", () => {
    const config: SwallowKitConfig = {
      connectors: {
        ext: {
          type: "api",
          baseUrlEnvVar: "",
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("baseUrlEnvVar is required")])
    );
  });

  it("returns error for API connector with invalid auth type", () => {
    const config: SwallowKitConfig = {
      connectors: {
        ext: {
          type: "api",
          baseUrlEnvVar: "EXT_URL",
          auth: {
            type: "saml" as any,
            envVar: "KEY",
          },
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("auth.type must be one of")])
    );
  });

  it("validates multiple connectors at once", () => {
    const config: SwallowKitConfig = {
      connectors: {
        mysql: {
          type: "rdb",
          provider: "mysql",
          connectionEnvVar: "MYSQL_CONN",
        },
        backlog: {
          type: "api",
          baseUrlEnvVar: "BACKLOG_URL",
        },
      },
    };
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("loadConfigFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns empty config when no env vars set", () => {
    delete process.env.SWALLOWKIT_DB_CONNECTION_STRING;
    delete process.env.SWALLOWKIT_DB_NAME;
    delete process.env.SWALLOWKIT_API_ENDPOINT;

    const config = loadConfigFromEnv();
    expect(config.database).toBeUndefined();
    expect(config.api).toBeUndefined();
  });

  it("reads database connection string from env", () => {
    process.env.SWALLOWKIT_DB_CONNECTION_STRING = "AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=xxx;";
    const config = loadConfigFromEnv();
    expect(config.database?.connectionString).toBe(
      "AccountEndpoint=https://test.documents.azure.com:443/;AccountKey=xxx;"
    );
  });

  it("reads database name from env", () => {
    process.env.SWALLOWKIT_DB_NAME = "MyTestDB";
    const config = loadConfigFromEnv();
    expect(config.database?.databaseName).toBe("MyTestDB");
  });

  it("reads API endpoint from env", () => {
    process.env.SWALLOWKIT_API_ENDPOINT = "/api/custom";
    const config = loadConfigFromEnv();
    expect(config.api?.endpoint).toBe("/api/custom");
  });

  it("reads backend language from env", () => {
    process.env.SWALLOWKIT_BACKEND_LANGUAGE = "python";
    const config = loadConfigFromEnv();
    expect(config.backend?.language).toBe("python");
  });

  it("reads all env vars together", () => {
    process.env.SWALLOWKIT_DB_CONNECTION_STRING = "conn";
    process.env.SWALLOWKIT_DB_NAME = "db";
    process.env.SWALLOWKIT_API_ENDPOINT = "/api/v2";
    const config = loadConfigFromEnv();
    expect(config.database?.connectionString).toBe("conn");
    expect(config.database?.databaseName).toBe("db");
    expect(config.api?.endpoint).toBe("/api/v2");
  });
});
