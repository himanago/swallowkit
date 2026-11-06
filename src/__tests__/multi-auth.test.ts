import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { addAuthCommand } from "../cli/commands/add-auth";
import { createUIAuthOptions } from "../cli/commands/scaffold";
import {
  generateBFFCallFunctionWithMultipleAuth,
  generateNamedAuthRouterCSharp,
  generateNamedExternalTokenVerifierCSharp,
  generateNamedAuthRouterPython,
  generateNamedAuthRouterTS,
} from "../core/scaffold/auth-generator";
import { normalizeAuthConfig, validateConfig } from "../core/config";
import { parseAuthPolicy } from "../core/scaffold/model-parser";
import { createBasicModelInfo } from "./fixtures";
import { generateCSharpAzureFunctionsCRUD, generateCompactAzureFunctionsCRUD, generatePythonAzureFunctionsCRUD } from "../core/scaffold/functions-generator";
import { generateAuthLayout, generateNewPage } from "../core/scaffold/ui-generator";
import { AuthConfig, SwallowKitConfig } from "../types";

const dotnetVersion = spawnSync("dotnet", ["--version"], { encoding: "utf8" });
const canRunDotnet = dotnetVersion.status === 0 && parseInt(dotnetVersion.stdout, 10) >= 10;

(canRunDotnet ? it : it.skip)("runs generated C# guards with scoped HTTP verification and cancellation", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-csharp-auth-"));
  try {
    const config = normalizeAuthConfig({
      schemes: { partner: { provider: "external-token" }, second: { provider: "external-token" } },
      authorization: { defaultPolicy: "anonymous", policies: {
        first: { schemes: ["partner"] }, second: { schemes: ["second"] },
      } },
    })!;
    const write = (file: string, contents: string) => fs.writeFileSync(path.join(root, file), contents);
    write("Probe.csproj", '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup></Project>');
    write("AuthRouter.cs", generateNamedAuthRouterCSharp(config));
    write("Partner.cs", generateNamedExternalTokenVerifierCSharp("partner"));
    write("Second.cs", generateNamedExternalTokenVerifierCSharp("second"));
    write("Worker.cs", `
using System.Net;
using System.Net.Http.Headers;
namespace Microsoft.Azure.Functions.Worker.Http;
public record Invocation(IServiceProvider InstanceServices, CancellationToken CancellationToken);
public class HttpRequestData(Invocation context)
{
    public Invocation FunctionContext => context;
    public HttpRequestHeaders Headers { get; } = new HttpRequestMessage().Headers;
    public HttpResponseData CreateResponse(HttpStatusCode status) => new(status);
}
public class HttpResponseData(HttpStatusCode status)
{
    public HttpStatusCode Status { get; } = status;
    public string Body { get; private set; } = "";
    public Task WriteAsJsonAsync<T>(T value)
    {
        Body = System.Text.Json.JsonSerializer.Serialize(value);
        return Task.CompletedTask;
    }
}
`);
    write("Program.cs", `
using System.Net;
using System.Net.Http.Headers;
using Functions.Auth;
using Functions.Auth.Schemes;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;

using var cancelled = new CancellationTokenSource();
using var services = new ServiceCollection()
    .AddSingleton(new HttpClient(new Handler()))
    .AddScoped<Func<string, CancellationToken, Task<ExternalPrincipal_partner>>>(sp => async (token, ct) =>
    {
        if (ct != cancelled.Token) throw new Exception("Invocation token was lost");
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://idp.example.test/verify");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var result = await sp.GetRequiredService<HttpClient>().SendAsync(request, ct);
        if (result.StatusCode == HttpStatusCode.Unauthorized) throw new ExternalTokenVerificationException_partner("private");
        if (result.StatusCode == HttpStatusCode.Gone) throw new ExternalTokenExpiredException();
        result.EnsureSuccessStatusCode();
        return new("subject", "issuer", [], new Dictionary<string, object?>());
    })
    .BuildServiceProvider();
using var scope = services.CreateScope();
HttpRequestData Request(string? token)
{
    var request = new HttpRequestData(new(scope.ServiceProvider, cancelled.Token));
    if (token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    return request;
}
var (principal, error) = await AuthRouter.Authorize(Request("valid"), "first");
if (principal?.IdentityKey != "partner:subject" || error != null) throw new Exception("DI verifier was not called");
foreach (var (token, policy, status, code) in new (string?, string, int, string)[] {
    (null, "first", 401, "unauthenticated"), ("invalid", "first", 401, "invalid_token"),
    ("expired", "first", 401, "expired_token"), ("outage", "first", 503, "identity_provider_unavailable"),
    ("valid", "second", 500, "verifier_not_configured"),
})
{
    var (denied, failure) = await AuthRouter.Authorize(Request(token), policy);
    if (denied != null || failure == null || (int)failure.Status != status || !failure.Body.Contains(code) ||
        failure.Body.Contains("private")) throw new Exception("Unexpected verification result for " + code);
}
cancelled.Cancel();
try
{
    await AuthRouter.Authorize(Request("valid"), "first");
    throw new Exception("Invocation cancellation was swallowed");
}
catch (OperationCanceledException) { }

sealed class Handler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (!ct.CanBeCanceled) throw new Exception("HTTP cancellation was lost");
        return Task.FromResult(new HttpResponseMessage(request.Headers.Authorization?.Parameter switch {
            "valid" => HttpStatusCode.OK,
            "expired" => HttpStatusCode.Gone,
            "invalid" => HttpStatusCode.Unauthorized,
            _ => HttpStatusCode.ServiceUnavailable,
        }));
    }
}
`);
    const result = spawnSync("dotnet", ["run", "--project", path.join(root, "Probe.csproj")], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", MSBUILDDISABLENODEREUSE: "1" },
    });
    expect({ status: result.status, error: result.status === 0 ? "" : result.stdout + result.stderr })
      .toEqual({ status: 0, error: "" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 35_000);

const namedAuthConfig: AuthConfig = {
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
};
const auth = normalizeAuthConfig(namedAuthConfig)!;

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
    expect(python).toContain('\n    if PROVIDERS[scheme] == "swa":');
    expect(python).not.toContain('\n    elif PROVIDERS[scheme] == "swa":');
    expect(python).toContain("ALLOWED_PROVIDERS");
    expect(generateNamedAuthRouterCSharp(swaOnly)).toContain("AllowedProviders[scheme]");
    expect(generateNamedAuthRouterCSharp(swaOnly)).not.toContain("using Functions.Auth.Schemes;");
  });

  const pythonCommand = ["python3", "python"].find(command => spawnSync(command, ["--version"], { encoding: "utf-8" }).status === 0);
  (pythonCommand ? it : it.skip).each([false, true])("compiles named Python auth router syntax (external schemes: %s)", (external) => {
    const config = external ? auth : normalizeAuthConfig({
      schemes: { admin: { provider: "swa" } },
      authorization: { defaultPolicy: "anonymous", policies: { adminOnly: { schemes: ["admin"] } } },
    })!;
    const result = spawnSync(pythonCommand!, ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      encoding: "utf-8", input: generateNamedAuthRouterPython(config),
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("emits Array.Empty<string>() instead of untyped new[] { } for empty C# arrays (CS0826)", () => {
    const emptyLists = normalizeAuthConfig({
      schemes: { api: { provider: "external-token" } },
      authorization: { defaultPolicy: "anonymous", policies: { apiOnly: { schemes: ["api"] } } },
    })!;
    const csharp = generateNamedAuthRouterCSharp(emptyLists);
    expect(csharp).not.toMatch(/new\[\]\s*\{\s*\}/);
    expect(csharp).toContain("Array.Empty<string>()");
    // 非空のリストは従来通り new[] リテラル
    expect(csharp).toContain('new[] { "api" }');
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
    expect(code).toContain("fetchHeaders.Authorization");
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

  it("resolves the same named auth context for the model layout and CRUD pages", () => {
    const model = createBasicModelInfo({ name: "Product", authPolicy: { policy: "adminOnly" } });
    const options = createUIAuthOptions(model.authPolicy!, namedAuthConfig);
    const layout = generateAuthLayout(model, options);
    const page = generateNewPage(model, options);

    expect(options.authContextImport).toBe("@/lib/auth/schemes/admin/auth-context");
    expect(layout).toContain("AuthProvider } from '@/lib/auth/schemes/admin/auth-context'");
    expect(page).toContain("useAuth } from '@/lib/auth/schemes/admin/auth-context'");
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

  it("writes named schemes to swallowkit.config.json when both config files exist (loadConfig precedence)", async () => {
    const js = "module.exports = { backend: { language: 'typescript' } };\n";
    fs.writeFileSync(path.join(root, "swallowkit.config.js"), js);
    await addAuthCommand({ scheme: "admin", provider: "swa" });
    expect(JSON.parse(fs.readFileSync(path.join(root, "swallowkit.config.json"), "utf-8")).auth.schemes.admin.provider).toBe("swa");
    expect(fs.readFileSync(path.join(root, "swallowkit.config.js"), "utf-8")).toBe(js);
  });

  it.each(["json", "js"] as const)("disables auth in a %s config with an anonymous default that passes validation", async (format) => {
    fs.rmSync(path.join(root, "swallowkit.config.json"));
    if (format === "json") fs.writeFileSync(path.join(root, "swallowkit.config.json"), JSON.stringify({ backend: { language: "typescript" } }));
    else fs.writeFileSync(path.join(root, "swallowkit.config.js"), "module.exports = {\n  backend: { language: 'typescript' },\n}\n");
    await addAuthCommand({ provider: "none" });
    let config: SwallowKitConfig;
    if (format === "json") {
      config = JSON.parse(fs.readFileSync(path.join(root, "swallowkit.config.json"), "utf-8"));
    } else {
      const configModule = { exports: {} as SwallowKitConfig };
      new Function("module", fs.readFileSync(path.join(root, "swallowkit.config.js"), "utf-8"))(configModule);
      config = configModule.exports;
    }
    expect(config.auth).toMatchObject({ provider: "none", authorization: { defaultPolicy: "anonymous" } });
    expect(validateConfig(config)).toEqual({ valid: true, errors: [] });
  });

  it("records single-provider auth in swallowkit.config.json instead of silently skipping it", async () => {
    fs.writeFileSync(path.join(root, "swallowkit.config.json"), JSON.stringify({ backend: { language: "typescript" } }));
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.writeFileSync(path.join(root, "app", "layout.tsx"), "export default function L({ children }: any) { return <html><body>{children}</body></html>; }\n");
    await addAuthCommand({ provider: "swa", allowedProviders: ["github"] });
    expect(JSON.parse(fs.readFileSync(path.join(root, "swallowkit.config.json"), "utf-8")).auth).toEqual({
      provider: "swa",
      swa: { allowedProviders: ["github"], roleSource: "swa-roles" },
      authorization: { defaultPolicy: "authenticated" },
    });
  });

  it.each(["typescript", "csharp", "python"] as const)("declares %s backend dependencies for a named custom-jwt scheme", async (language) => {
    fs.writeFileSync(path.join(root, "swallowkit.config.json"), JSON.stringify({ backend: { language } }));
    fs.mkdirSync(path.join(root, "functions"), { recursive: true });
    if (language === "typescript") fs.writeFileSync(path.join(root, "functions", "package.json"), JSON.stringify({ name: "functions", dependencies: {} }));
    if (language === "csharp") fs.writeFileSync(path.join(root, "functions", "App.Functions.csproj"), "<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n");
    if (language === "python") fs.writeFileSync(path.join(root, "functions", "requirements.txt"), "azure-functions\n");
    await addAuthCommand({ scheme: "staff", provider: "custom-jwt" });
    if (language === "typescript") {
      expect(JSON.parse(fs.readFileSync(path.join(root, "functions", "package.json"), "utf-8")).dependencies).toEqual(expect.objectContaining({ jsonwebtoken: expect.any(String), bcryptjs: expect.any(String) }));
    } else if (language === "csharp") {
      const csproj = fs.readFileSync(path.join(root, "functions", "App.Functions.csproj"), "utf-8");
      expect(csproj).toContain('Include="System.IdentityModel.Tokens.Jwt"');
      expect(csproj).toContain('Include="BCrypt.Net-Next"');
    } else {
      expect(fs.readFileSync(path.join(root, "functions", "requirements.txt"), "utf-8")).toMatch(/PyJWT[\s\S]*bcrypt/);
    }
  });
});

describe("Python custom-jwt blueprint registration", () => {
  const originalCwd = process.cwd();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-py-auth-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    fs.writeFileSync(path.join(root, "swallowkit.config.json"), JSON.stringify({ backend: { language: "python" } }));
    fs.mkdirSync(path.join(root, "shared"), { recursive: true });
    fs.writeFileSync(path.join(root, "shared", "package.json"), JSON.stringify({ name: "@fixture/shared" }));
    fs.mkdirSync(path.join(root, "functions"), { recursive: true });
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.writeFileSync(path.join(root, "app", "layout.tsx"), "export default function L({ children }: any) { return <html><body>{children}</body></html>; }\n");
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const register = (body: string) => fs.writeFileSync(path.join(root, "functions", "function_app.py"), body);

  it("imports the blueprint object the generated module actually defines", async () => {
    register("import azure.functions as func\napp = func.FunctionApp()\n# SwallowKit scaffold registrations\n");
    await addAuthCommand({ provider: "custom-jwt" });
    const blueprint = fs.readFileSync(path.join(root, "functions", "blueprints", "auth.py"), "utf-8");
    const app = fs.readFileSync(path.join(root, "functions", "function_app.py"), "utf-8");
    expect(blueprint).toMatch(/^auth_bp = func\.Blueprint\(\)$/m);
    expect(app).toContain("from blueprints.auth import auth_bp\napp.register_blueprint(auth_bp)");
  });

  it("repairs the broken import written by earlier releases without duplicating the registration", async () => {
    register("import azure.functions as func\napp = func.FunctionApp()\nfrom blueprints.auth import bp as auth_bp\napp.register_blueprint(auth_bp)\n# SwallowKit scaffold registrations\n");
    await addAuthCommand({ provider: "custom-jwt" });
    const app = fs.readFileSync(path.join(root, "functions", "function_app.py"), "utf-8");
    expect(app).not.toContain("import bp as auth_bp");
    expect(app.match(/app\.register_blueprint\(auth_bp\)/g)).toHaveLength(1);
  });
});
