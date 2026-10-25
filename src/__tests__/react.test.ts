import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import ts from "typescript";
import type { Mock } from "jest-mock";
import { z } from "zod/v4";
import {
  getFrontendFramework,
  loadConfig,
  validateConfig,
} from "../core/config";
import {
  createReactProject,
  createReactBffProject,
  buildReactSwaConfig,
} from "../core/project/react-project";
import { buildHomePage } from "../core/project/home-page";
import {
  generateManagedFunctionConfig,
  generateReactBffHelper,
  generateReactBffRoute,
  generateReactAuthBff,
} from "../core/scaffold/react-bff-generator";
import { createBasicModelInfo, createRdbConnectorModelInfo } from "./fixtures";
import { planScaffoldOperation } from "../core/operations/scaffold-plan";
import { applyScaffoldOperation } from "../core/operations/scaffold-apply";
import { buildProjectManifest } from "../core/project/manifest";
import { validateProject } from "../core/project/validation";
import {
  buildAgentsMd,
  buildPathSpecificInstructions,
} from "../core/project/agent-instructions";
import {
  buildGitHubSwaWorkflow,
  buildAzureSwaPipeline,
  buildSwallowKitConfigSource,
} from "../cli/commands/init";
import { getBuildScript } from "../utils/package-manager";
import {
  assertDevPortAvailable,
  buildReactDevArgs,
  buildSwaStartArgs,
} from "../cli/commands/dev";
import { addAuthCommand } from "../cli/commands/add-auth";
import { captureConsoleMessages } from "../core/operations/runtime";

interface TestRequest {
  method: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}
interface TestResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
interface Helper {
  callFunction(config: {
    request: TestRequest;
    method: string;
    path: string;
    body?: unknown;
    inputSchema?: z.ZodType;
    responseSchema?: z.ZodType;
  }): Promise<TestResponse>;
}
type Handler = (
  _context: object,
  request: TestRequest
) => Promise<TestResponse>;

function evaluate<T>(source: string, modules: Record<string, unknown> = {}): T {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  expect(diagnostics).toEqual([]);
  const output = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      if (name === "zod/v4") return { z };
      if (name in modules) return modules[name];
      throw new Error(`Unexpected generated runtime import: ${name}`);
    },
    output,
    output.exports
  );
  return output.exports as T;
}

function request(overrides: Partial<TestRequest> = {}): TestRequest {
  return { method: "GET", headers: {}, params: {}, ...overrides };
}

describe("React managed BFF runtime", () => {
  const originalEnv = { ...process.env };
  let fetchMock: Mock<typeof fetch>;
  function fetchInit(index = 0) {
    const init = fetchMock.mock.calls[index][1];
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    return { ...init, headers };
  }
  beforeEach(() => {
    process.env.BACKEND_FUNCTIONS_BASE_URL = "https://backend.example.test";
    process.env.BACKEND_FUNCTIONS_KEY = "server-only-key";
    fetchMock = jest.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ id: "one", title: "Hello" }), {
          status: 200,
        })
    );
    jest.spyOn(global, "fetch").mockImplementation(fetchMock);
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("uses the server key and ignores client-supplied keys/credentials when auth is disabled", async () => {
    const helper = evaluate<Helper>(generateReactBffHelper("sample"));
    const response = await helper.callFunction({
      request: request({
        headers: {
          "x-functions-key": "attacker-key",
          authorization: "Bearer attacker",
        },
      }),
      method: "GET",
      path: "/api/todo",
    });
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://backend.example.test/api/todo"
    );
    expect(fetchInit().headers).toEqual({
      "content-type": "application/json",
      "x-functions-key": "server-only-key",
    });
    expect(fetchInit().redirect).toBe("error");
  });

  it("fails closed for remote backends without a key, including localhost-lookalike hosts", async () => {
    delete process.env.BACKEND_FUNCTIONS_KEY;
    const helper = evaluate<Helper>(generateReactBffHelper("sample"));
    for (const base of [
      "https://backend.example.test",
      "http://localhost:1234@evil.example.test",
      "http://localhost.example.test:7071",
    ]) {
      process.env.BACKEND_FUNCTIONS_BASE_URL = base;
      expect(
        (
          await helper.callFunction({
            request: request(),
            method: "GET",
            path: "/api/todo",
          })
        ).status
      ).toBe(502);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.BACKEND_FUNCTIONS_BASE_URL = "http://localhost:7071";
    expect(
      (
        await helper.callFunction({
          request: request(),
          method: "GET",
          path: "/api/todo",
        })
      ).status
    ).toBe(200);
  });

  it("validates input before forwarding and rejects invalid backend output", async () => {
    const helper = evaluate<Helper>(generateReactBffHelper("sample"));
    const config = {
      request: request(),
      method: "POST",
      path: "/api/todo",
      inputSchema: z.object({ title: z.string().min(1) }),
    };
    expect(
      (await helper.callFunction({ ...config, body: { title: "" } })).status
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (
        await helper.callFunction({
          ...config,
          body: { title: "valid" },
          responseSchema: z.object({ count: z.number() }),
        })
      ).status
    ).toBe(502);
  });

  it("preserves backend errors and bodyless DELETE responses", async () => {
    const helper = evaluate<Helper>(generateReactBffHelper("sample"));
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    expect(
      (
        await helper.callFunction({
          request: request(),
          method: "GET",
          path: "/api/todo",
        })
      ).status
    ).toBe(403);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(
      await helper.callFunction({
        request: request(),
        method: "DELETE",
        path: "/api/todo/one",
      })
    ).toEqual({ status: 204 });
  });

  it("forwards normalized SWA/bearer credentials only from the current request", async () => {
    const helper = evaluate<Helper>(
      generateReactBffHelper("sample", {
        schemes: {
          staff: { provider: "swa" },
          external: { provider: "external-token" },
        },
      })
    );
    const principal = {
      identityProvider: "aad",
      userId: "user",
      userRoles: ["authenticated", 42],
      extra: "not-forwarded",
    };
    await helper.callFunction({
      request: request({
        headers: {
          authorization: "Bearer token",
          "x-ms-client-principal": Buffer.from(
            JSON.stringify(principal)
          ).toString("base64"),
        },
      }),
      method: "GET",
      path: "/api/todo",
    });
    const headers = fetchInit().headers;
    expect(headers.authorization).toBe("Bearer token");
    expect(
      JSON.parse(
        Buffer.from(headers["x-ms-client-principal"], "base64").toString()
      )
    ).toEqual({
      identityProvider: "aad",
      userId: "user",
      userDetails: "",
      userRoles: ["authenticated"],
    });
    await helper.callFunction({
      request: request(),
      method: "GET",
      path: "/api/todo",
    });
    expect(fetchInit(1).headers.authorization).toBeUndefined();
    expect(fetchInit(1).headers["x-ms-client-principal"]).toBeUndefined();
    expect(
      (
        await helper.callFunction({
          request: request({ headers: { "x-ms-client-principal": "invalid" } }),
          method: "GET",
          path: "/api/todo",
        })
      ).status
    ).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("converts the HttpOnly JWT cookie to a backend bearer token, without forwarding cookies", async () => {
    const helper = evaluate<Helper>(
      generateReactBffHelper("sample", { provider: "custom-jwt" })
    );
    await helper.callFunction({
      request: request({
        headers: { cookie: "other=ignored; sample-auth-token=jwt-token" },
      }),
      method: "GET",
      path: "/api/todo",
    });
    expect(fetchInit().headers.authorization).toBe("Bearer jwt-token");
    expect(fetchInit().headers.cookie).toBeUndefined();
  });

  function crud(model = createBasicModelInfo()): Handler {
    const helper = evaluate<Helper>(generateReactBffHelper("sample"));
    return evaluate<{ default: Handler }>(
      generateReactBffRoute(model, "@sample/shared"),
      {
        "../lib/call-function": helper,
        "@sample/shared": {
          todoSchema: z.object({
            id: z.string(),
            title: z.string().min(1),
            createdAt: z.string().optional(),
            updatedAt: z.string().optional(),
          }),
          userSchema: z.object({
            id: z.string(),
            title: z.string(),
            createdAt: z.string().optional(),
            updatedAt: z.string().optional(),
          }),
        },
      }
    ).default;
  }

  it("handles CRUD, encoded IDs, schema-owned fields and malformed JSON", async () => {
    const handler = crud();
    expect(
      (
        await handler(
          {},
          request({
            method: "POST",
            body: { id: "client-id", title: "Hello", createdAt: "client-time" },
          })
        )
      ).status
    ).toBe(201);
    expect(fetchInit().body).toBe(JSON.stringify({ title: "Hello" }));
    expect(
      (await handler({}, request({ params: { id: "a/b?#" } }))).status
    ).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://backend.example.test/api/todo/a%2Fb%3F%23"
    );
    expect(
      (await handler({}, request({ method: "POST", body: "{broken" }))).status
    ).toBe(400);
    expect(
      (
        await handler(
          {},
          request({ method: "POST", params: { id: "one" }, body: {} })
        )
      ).status
    ).toBe(405);
  });

  it("does not generate writable connector operations for read-only models", async () => {
    const handler = crud(createRdbConnectorModelInfo());
    expect(
      (await handler({}, request({ method: "POST", body: { title: "Hello" } })))
        .status
    ).toBe(405);
    expect(
      (await handler({}, request({ method: "DELETE", params: { id: "one" } })))
        .status
    ).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps login tokens in an HttpOnly cookie and includes the backend key", async () => {
    process.env.NODE_ENV = "production";
    const helper = evaluate<Helper>(
      generateReactBffHelper("sample", { provider: "custom-jwt" })
    );
    const user = {
      id: "one",
      loginId: "test",
      name: "Test",
      email: "",
      roles: [],
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "private-token", user }))
    );
    const handler = evaluate<{ default: Handler }>(
      generateReactAuthBff("sample", "@sample/shared", true),
      {
        "../lib/call-function": helper,
        "@sample/shared": {
          AuthUser: z.object({ id: z.string() }),
          LoginRequest: z.object({ loginId: z.string(), password: z.string() }),
          LoginResponse: z.object({ token: z.string(), user: z.unknown() }),
        },
      }
    ).default;
    const result = await handler(
      {},
      request({
        method: "POST",
        params: { action: "login" },
        body: { loginId: "test", password: "password" },
      })
    );
    expect(result.body).toEqual({ user });
    expect(result.headers?.["Set-Cookie"]).toContain("HttpOnly; SameSite=Lax");
    expect(result.headers?.["Set-Cookie"]).toContain("; Secure");
    expect(fetchInit().headers["x-functions-key"]).toBe("server-only-key");
    expect(
      (
        await handler(
          {},
          request({ method: "POST", params: { action: "logout" } })
        )
      ).headers?.["Set-Cookie"]
    ).toContain("Max-Age=0");
  });

  it("normalizes verified JWT subjects to the frontend user contract without exposing claims", async () => {
    const helper = evaluate<Helper>(
      generateReactBffHelper("sample", { provider: "custom-jwt" })
    );
    const handler = evaluate<{ default: Handler }>(
      generateReactAuthBff("sample", "@sample/shared", true),
      {
        "../lib/call-function": helper,
        "@sample/shared": {
          AuthUser: z.object({ id: z.string(), roles: z.array(z.string()) }),
          LoginRequest: z.object({ loginId: z.string(), password: z.string() }),
          LoginResponse: z.object({ token: z.string(), user: z.unknown() }),
        },
      }
    ).default;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ sub: "one", roles: ["admin"], exp: 123 }))
    );
    const result = await handler(
      {},
      request({
        params: { action: "me" },
        headers: { cookie: "sample-auth-token=private-token" },
      })
    );
    expect(result).toMatchObject({
      status: 200,
      body: { id: "one", roles: ["admin"] },
    });
    expect(fetchInit().headers.authorization).toBe("Bearer private-token");
    expect(result.body).not.toHaveProperty("sub");
    expect(result.body).not.toHaveProperty("exp");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ roles: ["admin"] }))
    );
    expect(
      (await handler({}, request({ params: { action: "me" } }))).status
    ).toBe(502);
  });
});

describe("React project integration", () => {
  const originalCwd = process.cwd();
  let project: string;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(originalCwd, ".tmp-react-test-"));
    createReactProject(project, "sample");
    createReactBffProject(project, "sample", "npm");
    fs.mkdirSync(path.join(project, "functions", "src"), { recursive: true });
    fs.mkdirSync(path.join(project, "shared", "models"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "swallowkit.config.js"),
      buildSwallowKitConfigSource("typescript", "react")
    );
    fs.writeFileSync(
      path.join(project, "staticwebapp.config.json"),
      JSON.stringify(buildReactSwaConfig())
    );
    fs.writeFileSync(
      path.join(project, "shared", "package.json"),
      JSON.stringify({ name: "@sample/shared" })
    );
    fs.writeFileSync(
      path.join(project, "shared", "index.ts"),
      "export { Todo } from './models/todo';\n"
    );
    fs.writeFileSync(
      path.join(project, "shared", "models", "todo.ts"),
      `import { z } from 'zod/v4';\nexport const Todo = z.object({ id: z.string(), title: z.string().min(1), createdAt: z.string().optional(), updatedAt: z.string().optional() });\n`
    );
    process.chdir(project);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("persists the frontend choice and preserves Next.js for existing projects", () => {
    expect(getFrontendFramework()).toBe("react");
    expect(loadConfig(undefined, true, true).frontend?.framework).toBe("react");
    fs.rmSync(path.join(project, "swallowkit.config.js"));
    fs.writeFileSync(path.join(project, "swallowkit.config.json"), "{}");
    expect(getFrontendFramework()).toBe("nextjs");
    expect(
      validateConfig({ frontend: { framework: "invalid" as never } }).valid
    ).toBe(false);
  });

  it("generates the shared home page with the selected package manager and Tailwind defaults", () => {
    createReactProject(project, "sample", "npm");
    expect(fs.readFileSync(path.join(project, "src", "Home.tsx"), "utf8"))
      .toBe(buildHomePage("react", "npm"));

    const css = fs.readFileSync(path.join(project, "src", "style.css"), "utf8");
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--background: #ffffff");
    expect(css).toContain("--background: #0a0a0a");
    expect(css).toContain("--color-background: var(--background)");
    expect(css).toContain("font-family: Arial, Helvetica, sans-serif");
    expect(fs.readFileSync(path.join(project, "index.html"), "utf8"))
      .toContain('class="h-full antialiased"');
    expect(fs.readFileSync(path.join(project, "vite.config.mts"), "utf8"))
      .toContain("plugins: [react(), tailwindcss()]");
  });

  it("plans and applies BFF bindings, React pages and metadata through the common path", async () => {
    const plan = await planScaffoldOperation({ model: "todo" });
    expect(plan.requiresApproval).toBe(false);
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "bff/src/todo/index.ts",
          ownership: "managed",
        }),
        expect.objectContaining({
          path: "bff/todo/function.json",
          ownership: "managed",
        }),
        expect.objectContaining({ path: "src/pages/todo/routes.tsx" }),
        expect.objectContaining({ path: "functions/src/todo.ts" }),
      ])
    );
    expect(
      plan.operations.some((operation) => operation.path.startsWith("app/"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(project, "bff", "src", "todo", "index.ts"))
    ).toBe(false);
    await applyScaffoldOperation({ planId: plan.planId });
    const { manifest } = await buildProjectManifest(project);
    expect(manifest.frontendFramework).toBe("react");
    expect(
      manifest.routes.find((route) => route.name === "Todo-bff-detail")
    ).toMatchObject({ filePath: "bff/src/todo/index.ts", exists: true });
    expect(
      (await validateProject(project)).violations.filter(
        (violation) => violation.severity === "error"
      )
    ).toEqual([]);
    const page = fs.readFileSync(
      path.join(project, "src", "pages", "todo", "[id]", "page.tsx"),
      "utf8"
    );
    expect(page).toContain("react-router-dom");
    expect(page).not.toContain("next/");
    const secondPlan = await planScaffoldOperation({ model: "todo" });
    expect(secondPlan.requiresApproval).toBe(false);
  });

  it("generates only server artifacts with api-only", async () => {
    const plan = await planScaffoldOperation({ model: "todo", apiOnly: true });
    expect(
      plan.operations.some((operation) => operation.path.startsWith("bff/"))
    ).toBe(true);
    expect(
      plan.operations.some((operation) =>
        operation.path.startsWith("src/pages/")
      )
    ).toBe(false);
  });

  it.each<["csharp" | "python", string]>([
    ["csharp", "functions/Crud/TodoCrudFunctions.cs"],
    ["python", "functions/blueprints/todo.py"],
  ])(
    "plans the same managed BFF and React UI with a %s standalone backend",
    async (language, backendPath) => {
      const source = buildSwallowKitConfigSource(language, "react");
      const config = new Function(
        source.replace("module.exports =", "return")
      )();
      fs.rmSync(path.join(project, "swallowkit.config.js"));
      fs.writeFileSync(
        path.join(project, "swallowkit.config.json"),
        JSON.stringify(config)
      );
      if (language === "python") {
        fs.writeFileSync(
          path.join(project, "functions", "function_app.py"),
          "import azure.functions as func\napp = func.FunctionApp()\n# SwallowKit scaffold registrations\n"
        );
      }
      const plan = await planScaffoldOperation({ model: "todo" });
      expect(plan.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: backendPath }),
          expect.objectContaining({ path: "bff/src/todo/index.ts" }),
          expect.objectContaining({ path: "bff/todo/function.json" }),
          expect.objectContaining({ path: "src/pages/todo/routes.tsx" }),
        ])
      );
      expect(
        plan.operations.some((operation) => operation.path.startsWith("app/"))
      ).toBe(false);
      expect(fs.existsSync(path.join(project, backendPath))).toBe(false);
      expect(getFrontendFramework()).toBe("react");
    }
  );

  it("reports server dependencies and settings in browser code", async () => {
    fs.writeFileSync(
      path.join(project, "src", "unsafe.ts"),
      "import { callFunction } from '../bff/src/lib/call-function';\nconst key = import.meta.env.VITE_BACKEND_FUNCTIONS_KEY;\n"
    );
    const result = await validateProject(project);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "forbidden-client-backend-dependency",
          severity: "error",
          location: { path: "src/unsafe.ts" },
        }),
      ])
    );
  });

  it("detects manifest drift when the frontend changes without migrating routes", async () => {
    const plan = await planScaffoldOperation({ model: "todo" });
    await applyScaffoldOperation({ planId: plan.planId });
    fs.rmSync(path.join(project, "swallowkit.config.js"));
    fs.writeFileSync(
      path.join(project, "swallowkit.config.json"),
      JSON.stringify({ frontend: { framework: "nextjs" } })
    );
    expect((await validateProject(project)).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "manifest-out-of-date" }),
      ])
    );
  });

  it.each(["swa", "external-token", "custom-jwt"])(
    "generates %s auth without Next.js imports",
    async (provider) => {
      await captureConsoleMessages(async () => addAuthCommand({ provider }));
      const helper = fs.readFileSync(
        path.join(project, "bff", "src", "lib", "call-function.ts"),
        "utf8"
      );
      expect(helper).not.toContain("next/");
      expect(helper).toContain(
        provider === "swa"
          ? "const forwardSwa = true"
          : "const forwardBearer = true"
      );
      const context = fs.readFileSync(
        path.join(project, "lib", "auth", "auth-context.tsx"),
        "utf8"
      );
      expect(context).not.toContain("next/");
      expect(fs.existsSync(path.join(project, "proxy.ts"))).toBe(false);
      expect(fs.existsSync(path.join(project, "app"))).toBe(false);
      if (provider !== "external-token")
        expect(
          fs.existsSync(path.join(project, "src", "pages", "login.tsx"))
        ).toBe(true);
      // JSON config avoids Jest's CJS module cache when reading the just-updated config.
      const source = fs.readFileSync(
        path.join(project, "swallowkit.config.js"),
        "utf8"
      );
      const config = new Function(
        source.replace("module.exports =", "return")
      )();
      fs.rmSync(path.join(project, "swallowkit.config.js"));
      fs.writeFileSync(
        path.join(project, "swallowkit.config.json"),
        JSON.stringify(config)
      );
      const { manifest } = await buildProjectManifest(project);
      expect(
        manifest.routes.find((route) => route.name === "auth-login")?.exists
      ).toBe(provider === "custom-jwt");
      expect(
        manifest.routes.find((route) => route.name === "auth-me")?.exists
      ).toBe(provider !== "swa");
    }
  );

  it("adds multiple named credential transports and model-scoped providers", async () => {
    fs.rmSync(path.join(project, "swallowkit.config.js"));
    fs.writeFileSync(
      path.join(project, "swallowkit.config.json"),
      JSON.stringify({
        frontend: { framework: "react" },
        auth: {
          schemes: {},
          authorization: { defaultPolicy: "anonymous", policies: {} },
        },
      })
    );
    await captureConsoleMessages(async () =>
      addAuthCommand({
        provider: "swa",
        scheme: "staff",
        allowedProviders: ["github"],
      })
    );
    await captureConsoleMessages(async () =>
      addAuthCommand({ provider: "external-token", scheme: "customers" })
    );
    const helper = fs.readFileSync(
      path.join(project, "bff", "src", "lib", "call-function.ts"),
      "utf8"
    );
    expect(helper).toContain("const forwardSwa = true");
    expect(helper).toContain("const forwardBearer = true");
    expect(
      fs.existsSync(
        path.join(
          project,
          "lib",
          "auth",
          "schemes",
          "customers",
          "token-adapter.ts"
        )
      )
    ).toBe(true);
  });

  it("describes framework-specific paths, development and deployment to agents", () => {
    const context = {
      projectName: "sample",
      backendLanguage: "typescript" as const,
      packageManager: "npm" as const,
      frontend: "react" as const,
    };
    const agents = buildAgentsMd(context);
    expect(agents).toContain("React + Vite SPA");
    expect(agents).toContain("SWA managed Functions");
    expect(agents).toContain("never directly to standalone Functions");
    expect(agents).toContain("do not start/restart");
    expect(agents).not.toContain("Next.js API");
    expect(
      buildPathSpecificInstructions(context)["bff-routes.instructions.md"]
    ).toContain('applyTo: "bff/**"');
  });
});

describe("React deployment and development contracts", () => {
  it("refuses occupied ports without stopping the existing listener", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected TCP address");
      await expect(
        assertDevPortAvailable(address.port, "127.0.0.1")
      ).rejects.toThrow("unavailable");
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it.each(["npm", "pnpm"] as const)(
    "deploys prebuilt SPA and managed BFF using %s, never the standalone backend",
    (pm) => {
      for (const workflow of [
        buildGitHubSwaWorkflow(pm, pm, "react"),
        buildAzureSwaPipeline(pm, pm, "react"),
      ]) {
        expect(workflow).toContain("app_location: dist");
        expect(workflow).toContain("api_location: bff");
        expect(workflow).toContain("skip_app_build: true");
        expect(workflow).toContain("skip_api_build: true");
        expect(workflow).toContain("bff/**");
        expect(workflow).toContain("staticwebapp.config.json");
        expect(workflow).not.toContain("api_location: functions");
        expect(workflow).not.toContain("next build");
      }
      expect(getBuildScript(pm, "react")).toContain("copyFileSync");
      expect(getBuildScript(pm, "react")).not.toContain("next ");
    }
  );

  it("binds managed HTTP functions and excludes APIs from SPA fallback", () => {
    const binding = JSON.parse(
      generateManagedFunctionConfig("todo/{id?}", ["GET"], "todo")
    );
    expect(binding.scriptFile).toBe("../dist/todo/index.js");
    expect(binding.bindings[0]).toMatchObject({
      authLevel: "anonymous",
      route: "todo/{id?}",
      type: "httpTrigger",
      methods: ["get"],
    });
    expect(binding.bindings[1]).toEqual({
      type: "http",
      direction: "out",
      name: "$return",
    });
    expect(buildReactSwaConfig().navigationFallback.exclude).toEqual(
      expect.arrayContaining(["/api/*", "/.auth/*"])
    );
  });

  it("routes SWA only to the managed BFF and starts Vite instead of Next.js", () => {
    expect(buildReactDevArgs("npm", "3100", "127.0.0.1")).toEqual([
      "vite",
      "--port",
      "3100",
      "--host",
      "127.0.0.1",
      "--strictPort",
    ]);
    const args = buildSwaStartArgs(undefined, "3100", "4285", "7079");
    expect(args).toContain("http://localhost:7079");
    expect(args).not.toContain("http://localhost:7071");
  });
});
