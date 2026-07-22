import ts from "typescript";
import {
  generateBFFCallFunctionWithMultipleAuth,
  generateBFFCallFunctionWithSwaAuth,
} from "../core/scaffold/auth-generator";

type GeneratedModule = {
  callFunction(config: { method: "GET"; path: string }): Promise<unknown>;
};

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

const originalFetch = global.fetch;
const originalBaseUrl = process.env.BACKEND_FUNCTIONS_BASE_URL;
const originalFunctionsKey = process.env.BACKEND_FUNCTIONS_KEY;

function encodePrincipal(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeForwardedPrincipal(call: FetchCall): Record<string, unknown> | undefined {
  const value = (call.init?.headers as Record<string, string>)["x-ms-client-principal"];
  return value
    ? JSON.parse(Buffer.from(value, "base64").toString("utf8"))
    : undefined;
}

function loadGeneratedModule(
  code: string,
  requestHeaders: Record<string, string>,
): GeneratedModule {
  const output = ts.transpileModule(code, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  expect(output.diagnostics).toEqual([]);

  class MockNextResponse {
    static json(body: unknown, init?: { status?: number }) {
      return { body, status: init?.status ?? 200 };
    }

    constructor(
      public body: unknown,
      public init?: { status?: number },
    ) {}
  }

  const generatedModule = { exports: {} as GeneratedModule };
  const mockRequire = (id: string): unknown => {
    if (id === "next/server") return { NextResponse: MockNextResponse };
    if (id === "next/headers") {
      return { headers: async () => new Headers(requestHeaders) };
    }
    if (id === "zod/v4") return require("zod/v4");
    throw new Error(`Unexpected generated import: ${id}`);
  };

  new Function("require", "module", "exports", output.outputText)(
    mockRequire,
    generatedModule,
    generatedModule.exports,
  );
  return generatedModule.exports;
}

async function runGeneratedCall(options: {
  code: string;
  requestHeaders: Record<string, string>;
  mePrincipal?: unknown;
  functionsBaseUrl?: string;
}): Promise<FetchCall[]> {
  process.env.BACKEND_FUNCTIONS_BASE_URL =
    options.functionsBaseUrl ?? "https://functions.example.test";
  process.env.BACKEND_FUNCTIONS_KEY = "functions-key-secret";

  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, init });
    if (url.endsWith("/.auth/me")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ clientPrincipal: options.mePrincipal }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "",
    } as Response;
  }) as typeof fetch;

  const generated = loadGeneratedModule(options.code, options.requestHeaders);
  await generated.callFunction({ method: "GET", path: "/api/resource" });
  return calls;
}

function functionsCall(calls: FetchCall[]): FetchCall {
  const call = calls.find(({ url }) => url.endsWith("/api/resource"));
  expect(call).toBeDefined();
  return call!;
}

afterEach(() => {
  global.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.BACKEND_FUNCTIONS_BASE_URL;
  else process.env.BACKEND_FUNCTIONS_BASE_URL = originalBaseUrl;
  if (originalFunctionsKey === undefined) delete process.env.BACKEND_FUNCTIONS_KEY;
  else process.env.BACKEND_FUNCTIONS_KEY = originalFunctionsKey;
  jest.restoreAllMocks();
});

describe("generated BFF SWA credential forwarding", () => {
  const validPrincipal = {
    identityProvider: "github",
    userId: "user-123",
    userDetails: "octocat",
    userRoles: ["anonymous", "authenticated", 123],
    untrustedExtra: "must-not-be-forwarded",
  };

  it("normalizes an incoming principal and does not call /.auth/me", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: {
        cookie: "session=cookie-secret",
        host: "app.example.test",
        "x-ms-client-principal": encodePrincipal(validPrincipal),
      },
    });

    expect(calls.map(({ url }) => url)).not.toContain("https://app.example.test/.auth/me");
    expect(decodeForwardedPrincipal(functionsCall(calls))).toEqual({
      identityProvider: "github",
      userId: "user-123",
      userDetails: "octocat",
      userRoles: ["anonymous", "authenticated"],
    });
    expect(
      (functionsCall(calls).init?.headers as Record<string, string>)[
        "x-functions-key"
      ],
    ).toBe("functions-key-secret");
  });

  it("uses x-forwarded-host for the /.auth/me fallback", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: {
        cookie: "session=valid",
        host: "internal.example.test",
        "x-forwarded-host": "public.example.test",
      },
      mePrincipal: validPrincipal,
    });

    expect(calls[0].url).toBe("https://public.example.test/.auth/me");
    expect(decodeForwardedPrincipal(functionsCall(calls))).toEqual({
      identityProvider: "github",
      userId: "user-123",
      userDetails: "octocat",
      userRoles: ["anonymous", "authenticated"],
    });
  });

  it("falls back to host when x-forwarded-host is absent", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: { cookie: "session=valid", host: "app.example.test" },
      mePrincipal: validPrincipal,
    });

    expect(calls[0].url).toBe("https://app.example.test/.auth/me");
  });

  it("uses the first comma-separated forwarded host and protocol", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: {
        cookie: "session=valid",
        host: "internal.example.test",
        "x-forwarded-host": "public.example.test, proxy.example.test",
        "x-forwarded-proto": "http, https",
      },
      mePrincipal: validPrincipal,
    });

    expect(calls[0].url).toBe("http://public.example.test/.auth/me");
  });

  it.each([
    ["a missing userId", { ...validPrincipal, userId: undefined }],
    ["a missing authenticated role", { ...validPrincipal, userRoles: ["anonymous"] }],
    ["a missing identityProvider", { ...validPrincipal, identityProvider: "" }],
  ])("does not forward a principal with %s", async (_case, principal) => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: { "x-ms-client-principal": encodePrincipal(principal) },
    });

    expect(decodeForwardedPrincipal(functionsCall(calls))).toBeUndefined();
  });

  it.each([
    "not-base64!",
    `${encodePrincipal(validPrincipal)}!`,
    Buffer.from("not-json", "utf8").toString("base64"),
  ])(
    "fails closed without logging credentials for malformed principal %s",
    async (principal) => {
      const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const cookie = "session=highly-sensitive-cookie";
      const calls = await runGeneratedCall({
        code: generateBFFCallFunctionWithSwaAuth(),
        requestHeaders: { cookie, "x-ms-client-principal": principal },
      });

      expect(decodeForwardedPrincipal(functionsCall(calls))).toBeUndefined();
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).not.toContain(cookie);
      expect(logged).not.toContain(principal);
    },
  );

  it("preserves Bearer and applies the same SWA rules for multiple auth", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithMultipleAuth(),
      requestHeaders: {
        authorization: "Bearer line-token-secret",
        "x-ms-client-principal": encodePrincipal(validPrincipal),
      },
    });
    const headers = functionsCall(calls).init?.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer line-token-secret");
    expect(decodeForwardedPrincipal(functionsCall(calls))?.userId).toBe("user-123");
  });

  it("does not add Bearer forwarding to the SWA-only variant", async () => {
    const code = generateBFFCallFunctionWithSwaAuth();
    const calls = await runGeneratedCall({
      code,
      requestHeaders: {
        authorization: "Bearer must-not-be-forwarded",
        "x-ms-client-principal": encodePrincipal(validPrincipal),
      },
    });
    const headers = functionsCall(calls).init?.headers as Record<string, string>;

    expect(headers.Authorization).toBeUndefined();
    expect(code).not.toContain("reqHeaders.get('authorization')");
    expect(decodeForwardedPrincipal(functionsCall(calls))?.userId).toBe("user-123");
  });

  it("defaults /.auth/me to http for local Functions development", async () => {
    const calls = await runGeneratedCall({
      code: generateBFFCallFunctionWithSwaAuth(),
      requestHeaders: { cookie: "session=valid", host: "localhost:3000" },
      mePrincipal: validPrincipal,
      functionsBaseUrl: "http://localhost:7071",
    });

    expect(calls[0].url).toBe("http://localhost:3000/.auth/me");
  });
});
