import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { addAuthCommand } from "../cli/commands/add-auth";
import {
  generateBFFCallFunctionWithMultipleAuth,
  generateNamedAuthRouterCSharp,
  generateNamedAuthRouterPython,
  generateNamedAuthRouterTS,
} from "../core/scaffold/auth-generator";
import { normalizeAuthConfig } from "../core/config";
import { parseAuthPolicy } from "../core/scaffold/model-parser";
import { createBasicModelInfo } from "./fixtures";
import { generateCSharpAzureFunctionsCRUD, generateCompactAzureFunctionsCRUD, generatePythonAzureFunctionsCRUD } from "../core/scaffold/functions-generator";

const auth = normalizeAuthConfig({
  schemes: {
    admin: { provider: "swa" },
    lineUser: { provider: "external-token" },
  },
  authorization: {
    defaultPolicy: "anonymous",
    policies: {
      adminOnly: { schemes: ["admin"], roles: ["authenticated"] },
      lineUserOnly: { schemes: ["lineUser"], roles: ["authenticated"] },
    },
  },
})!;

describe("named authentication routers", () => {
  it("generates deterministic TypeScript policy routing and normalized principals", () => {
    const code = generateNamedAuthRouterTS(auth);
    expect(code).toContain("policy.schemes.filter");
    expect(code).toContain("candidates.length !== 1");
    expect(code).toContain("subject: value.userId");
    expect(code).toContain("scheme + ':' + principal.subject");
    expect(code).toContain("new AuthError(403");
    expect(code).toContain("new AuthError(503");
    expect(code).not.toContain("JWT_SECRET");
  });

  it("generates equivalent C# and Python named guards", () => {
    const csharp = generateNamedAuthRouterCSharp(auth);
    const python = generateNamedAuthRouterPython(auth);
    expect(csharp).toContain("record AuthPrincipal(string Subject, string Scheme, string Issuer");
    expect(csharp).toContain("candidates.Length != 1");
    expect(csharp).toContain("HttpStatusCode.Forbidden");
    expect(python).toContain('principal["scheme"] + ":" + principal["subject"]');
    expect(python).toContain("len(candidates) != 1");
    expect(python).toContain("AuthError(503");
  });

  it("generates valid branch structure for an SWA-only Python router", () => {
    const swaOnly = normalizeAuthConfig({ schemes: { admin: { provider: "swa", swa: { allowedProviders: ["github"] } } }, authorization: { defaultPolicy: "anonymous", policies: { adminOnly: { schemes: ["admin"] } } } })!;
    const python = generateNamedAuthRouterPython(swaOnly);
    expect(python).toContain('        if PROVIDERS[scheme] == "swa":');
    expect(python).not.toContain('        elif PROVIDERS[scheme] == "swa":');
    expect(python).toContain("ALLOWED_PROVIDERS");
    expect(generateNamedAuthRouterCSharp(swaOnly)).toContain("AllowedProviders[scheme]");
  });

  it("scaffolds named read/write guards for all Functions languages", () => {
    const policy = { read: "adminOnly", write: "lineUserOnly" };
    const model = createBasicModelInfo();
    const ts = generateCompactAzureFunctionsCRUD(model, "@fixture/shared", policy);
    const cs = generateCSharpAzureFunctionsCRUD(model, policy);
    const py = generatePythonAzureFunctionsCRUD(model, policy).blueprint;
    expect(ts).toContain("./auth/auth-router");
    expect(ts).toContain('requireAuth(request, "adminOnly")');
    expect(ts).toContain('requireAuth(request, "lineUserOnly")');
    expect(cs).toContain('AuthRouter.Authorize(request, "adminOnly")');
    expect(cs).toContain('AuthRouter.Authorize(request, "lineUserOnly")');
    expect(py).toContain("from auth.auth_router import");
    expect(py).toContain('require_auth(req, "adminOnly")');
    expect(py).toContain('require_auth(req, "lineUserOnly")');
  });

  it("forwards both credential sources and the Functions host key", () => {
    const code = generateBFFCallFunctionWithMultipleAuth();
    expect(code).toContain("fetchHeaders['Authorization']");
    expect(code).toContain("fetchHeaders['x-ms-client-principal']");
    expect(code).toContain("'x-functions-key'");
    expect(code).not.toMatch(/console\.log\([^\n]*(authorization|principal|cookie)/i);
  });

  it("parses model-wide and operation-specific named policies", () => {
    expect(parseAuthPolicy("export const authPolicy = { policy: 'adminOnly' };"))
      .toEqual({ policy: "adminOnly" });
    expect(parseAuthPolicy("export const authPolicy = { read: 'adminOnly', write: 'lineUserOnly' };"))
      .toEqual({ read: "adminOnly", write: "lineUserOnly" });
  });
});

describe("add-auth named scheme CLI", () => {
  const originalCwd = process.cwd();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-multi-auth-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    fs.writeFileSync(path.join(root, "swallowkit.config.json"), JSON.stringify({ backend: { language: "typescript" }, auth: { schemes: {}, authorization: { defaultPolicy: "anonymous", policies: {} } } }, null, 2));
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("adds two schemes without overwriting the first verifier", async () => {
    await addAuthCommand({ scheme: "admin", provider: "swa" });
    await addAuthCommand({ scheme: "lineUser", provider: "external-token" });
    const verifier = path.join(root, "functions", "src", "auth", "schemes", "line-user", "verifier.ts");
    fs.writeFileSync(verifier, "// user verifier\n", "utf-8");
    const config = JSON.parse(fs.readFileSync(path.join(root, "swallowkit.config.json"), "utf-8"));
    expect(config.auth.schemes.admin.provider).toBe("swa");
    expect(config.auth.schemes.lineUser.provider).toBe("external-token");
    await expect(addAuthCommand({ scheme: "lineUser", provider: "external-token" })).rejects.toThrow("already exists");
    expect(fs.readFileSync(verifier, "utf-8")).toBe("// user verifier\n");
    expect(fs.readFileSync(path.join(root, "lib", "api", "call-function.ts"), "utf-8")).toContain("x-functions-key");
  });

  it("updates a JavaScript config that already has a trailing comma", async () => {
    fs.rmSync(path.join(root, "swallowkit.config.json"));
    fs.writeFileSync(path.join(root, "swallowkit.config.js"), "module.exports = {\n  backend: { language: 'typescript' },\n  api: { endpoint: '/api/test' },\n};\n");
    await addAuthCommand({ scheme: "admin", provider: "swa" });
    const content = fs.readFileSync(path.join(root, "swallowkit.config.js"), "utf-8");
    expect(content).not.toContain(",,");
    const configModule = { exports: {} as Record<string, unknown> };
    new Function("module", content)(configModule);
    expect((configModule.exports as { auth: { schemes: { admin: { provider: string } } } }).auth.schemes.admin.provider).toBe("swa");
  });
});
