/**
 * SwallowKit Add-Auth コマンド
 * 認証認可基盤ファイルを生成する
 */

import * as fs from "fs";
import * as path from "path";
import { ensureSwallowKitProject, getBackendLanguage, getConnectorDefinition, getValidatedFullConfig } from "../../core/config";
import { AuthProvider, BackendLanguage, CustomJwtConfig, RdbConnectorConfig } from "../../types";
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
  generateProxy,
  generateLoginPage,
  generateAuthContext,
  generateBFFCallFunctionWithAuth,
  generateBFFCallFunctionWithSwaAuth,
  generateBFFCallFunctionWithMultipleAuth,
  generateSwaAuthHelperTS,
  generateSwaAuthHelperCSharp,
  generateSwaAuthHelperPython,
  generateExternalTokenAdapter,
  generateAuthenticatedFetch,
  generateExternalTokenBFFMeRoute,
  generateExternalTokenAuthContext,
  generateExternalTokenVerifierTS,
  generateExternalTokenHelperTS,
  generateExternalAuthMeTS,
  generateExternalTokenVerifierCSharp,
  generateExternalTokenHelperCSharp,
  generateExternalAuthMeCSharp,
  generateExternalTokenVerifierPython,
  generateExternalTokenHelperPython,
  generateExternalAuthMePython,
  generateNamedExternalTokenVerifierCSharp,
  generateNamedExternalTokenVerifierPython,
} from "../../core/scaffold/auth-generator";
import { syncProjectManifest } from "../../core/project/manifest";
import { buildSharedTsConfig } from "./init";

interface AddAuthOptions {
  provider?: string;
  scheme?: string;
}

function writeIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function defaultCustomJwtConfig(): CustomJwtConfig {
  return {
    userConnector: "mysql",
    userTable: "users",
    loginIdColumn: "login_id",
    passwordHashColumn: "password_hash",
    rolesColumn: "roles",
    jwtSecretEnv: "JWT_SECRET",
    tokenExpiry: "24h",
  };
}

function setupSwaAuth(cwd: string, backendLanguage: BackendLanguage): void {
  const helperPath = backendLanguage === "typescript"
    ? path.join(cwd, "functions", "src", "auth", "jwt-helper.ts")
    : backendLanguage === "csharp"
      ? path.join(cwd, "functions", "Auth", "JwtHelper.cs")
      : path.join(cwd, "functions", "auth", "jwt_helper.py");
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  const helper = backendLanguage === "typescript"
    ? generateSwaAuthHelperTS()
    : backendLanguage === "csharp"
      ? generateSwaAuthHelperCSharp()
      : generateSwaAuthHelperPython();
  fs.writeFileSync(helperPath, helper, "utf-8");

  const callFnPath = path.join(cwd, "lib", "api", "call-function.ts");
  fs.mkdirSync(path.dirname(callFnPath), { recursive: true });
  fs.writeFileSync(callFnPath, generateBFFCallFunctionWithSwaAuth(), "utf-8");

  const authDir = path.join(cwd, "lib", "auth");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, "auth-context.tsx"), generateSwaAuthContext(), "utf-8");
  updateRootLayoutWithAuthProvider(cwd);
  const loginDir = path.join(cwd, "app", "login");
  fs.mkdirSync(loginDir, { recursive: true });
  fs.writeFileSync(path.join(loginDir, "page.tsx"), generateSwaLoginPage(), "utf-8");
  updateSwaRouteConfig(cwd);
}

function setupExternalTokenAuth(cwd: string, backendLanguage: BackendLanguage): void {
  const authDir = path.join(cwd, "lib", "auth");
  fs.mkdirSync(authDir, { recursive: true });
  writeIfMissing(path.join(authDir, "external-token-adapter.ts"), generateExternalTokenAdapter());
  fs.writeFileSync(path.join(authDir, "authenticated-fetch.ts"), generateAuthenticatedFetch(), "utf-8");
  fs.writeFileSync(path.join(authDir, "auth-context.tsx"), generateExternalTokenAuthContext(), "utf-8");
  fs.writeFileSync(path.join(cwd, "lib", "api", "call-function.ts"), generateBFFCallFunctionWithAuth(), "utf-8");
  const meDir = path.join(cwd, "app", "api", "auth", "me");
  fs.mkdirSync(meDir, { recursive: true });
  fs.writeFileSync(path.join(meDir, "route.ts"), generateExternalTokenBFFMeRoute(), "utf-8");
  updateRootLayoutWithAuthProvider(cwd);

  if (backendLanguage === "typescript") {
    const verifier = path.join(cwd, "functions", "src", "auth", "external-token-verifier.ts");
    writeIfMissing(verifier, generateExternalTokenVerifierTS());
    fs.writeFileSync(path.join(cwd, "functions", "src", "auth", "jwt-helper.ts"), generateExternalTokenHelperTS(), "utf-8");
    fs.writeFileSync(path.join(cwd, "functions", "src", "auth-me.ts"), generateExternalAuthMeTS(), "utf-8");
  } else if (backendLanguage === "csharp") {
    const verifier = path.join(cwd, "functions", "Auth", "ExternalTokenVerifier.cs");
    writeIfMissing(verifier, generateExternalTokenVerifierCSharp());
    fs.writeFileSync(path.join(cwd, "functions", "Auth", "JwtHelper.cs"), generateExternalTokenHelperCSharp(), "utf-8");
    fs.writeFileSync(path.join(cwd, "functions", "Auth", "ExternalAuthMe.cs"), generateExternalAuthMeCSharp(), "utf-8");
  } else {
    const verifier = path.join(cwd, "functions", "auth", "external_token_verifier.py");
    writeIfMissing(verifier, generateExternalTokenVerifierPython());
    fs.writeFileSync(path.join(cwd, "functions", "auth", "jwt_helper.py"), generateExternalTokenHelperPython(), "utf-8");
    const authMePath = path.join(cwd, "functions", "blueprints", "auth_me.py");
    fs.mkdirSync(path.dirname(authMePath), { recursive: true });
    fs.writeFileSync(authMePath, generateExternalAuthMePython(), "utf-8");
    updatePythonAuthMeRegistration(cwd);
  }
}

function updatePythonAuthMeRegistration(cwd: string): void {
  const appPath = path.join(cwd, "functions", "function_app.py");
  if (!fs.existsSync(appPath)) return;
  const importLine = "from blueprints.auth_me import bp as external_auth_me_bp";
  const registerLine = "app.register_blueprint(external_auth_me_bp)";
  let content = fs.readFileSync(appPath, "utf-8");
  if (content.includes(importLine)) return;
  const marker = "# SwallowKit scaffold registrations";
  content = content.includes(marker)
    ? content.replace(marker, `${importLine}\n${registerLine}\n${marker}`)
    : `${content.trimEnd()}\n${importLine}\n${registerLine}\n`;
  fs.writeFileSync(appPath, content, "utf-8");
}

function generateSwaLoginPage(): string {
  return `'use client';
export default function LoginPage() {
  return <main><h1>Sign in</h1><a href="/.auth/login/aad?post_login_redirect_uri=/">Sign in with Microsoft</a></main>;
}
`;
}

export function generateSwaAuthContext(): string {
  return `'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface AuthUser { id: string; loginId: string; name: string; email: string; roles: string[]; }
interface AuthContextValue { user: AuthUser | null; loading: boolean; login: () => void; logout: () => void; hasRole: (role: string) => boolean; hasAnyRole: (roles: string[]) => boolean; }
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/.auth/me')
      .then(async response => {
        if (!response.ok) throw new Error('SWA authentication is unavailable');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('clientPrincipal' in body)) return null;
        const principal = body.clientPrincipal;
        if (!principal || typeof principal !== 'object') return null;
        const value = principal as Record<string, unknown>;
        if (typeof value.userId !== 'string') return null;
        return {
          id: value.userId,
          loginId: typeof value.userDetails === 'string' ? value.userDetails : '',
          name: typeof value.userDetails === 'string' ? value.userDetails : '',
          email: typeof value.userDetails === 'string' ? value.userDetails : '',
          roles: Array.isArray(value.userRoles) ? value.userRoles.filter((role): role is string => typeof role === 'string') : [],
        } satisfies AuthUser;
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  const login = () => { window.location.href = '/.auth/login/aad?post_login_redirect_uri=/'; };
  const logout = () => { window.location.href = '/.auth/logout?post_logout_redirect_uri=/'; };
  const hasRole = (role: string) => user?.roles.includes(role) ?? false;
  return <AuthContext.Provider value={{ user, loading, login, logout, hasRole, hasAnyRole: roles => roles.some(hasRole) }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used within an AuthProvider'); return value; }
`;
}

export function addAuthProviderToRootLayout(layout: string): string {
  let updated = layout;
  if (!/import\s*\{[^}]*\bAuthProvider\b[^}]*\}\s*from\s*['"]@\/lib\/auth\/auth-context['"]/.test(updated)) {
    const directive = updated.match(/^(?:\s*['"]use (?:client|server)['"];?\s*\r?\n)/)?.[0] ?? "";
    updated = `${directive}import { AuthProvider } from '@/lib/auth/auth-context';\n${updated.slice(directive.length)}`;
  }
  if (!/<AuthProvider(?:\s|>)/.test(updated)) {
    const childrenIndex = updated.lastIndexOf("{children}");
    if (childrenIndex === -1) {
      throw new Error("Could not find {children} in app/layout.tsx");
    }
    updated = `${updated.slice(0, childrenIndex)}<AuthProvider>{children}</AuthProvider>${updated.slice(childrenIndex + "{children}".length)}`;
  }
  return updated;
}

function updateRootLayoutWithAuthProvider(cwd: string): void {
  const layoutPath = path.join(cwd, "app", "layout.tsx");
  if (!fs.existsSync(layoutPath)) {
    throw new Error("app/layout.tsx was not found; cannot install AuthProvider");
  }
  const layout = fs.readFileSync(layoutPath, "utf-8");
  const updated = addAuthProviderToRootLayout(layout);
  if (updated !== layout) fs.writeFileSync(layoutPath, updated, "utf-8");
}

function updateSwaRouteConfig(cwd: string): void {
  const configPath = path.join(cwd, "staticwebapp.config.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  config.routes = Array.isArray(config.routes)
    ? config.routes.filter((route: { route?: string }) => route.route !== "/api/*")
    : [];
  config.routes.unshift({ route: "/api/*", allowedRoles: ["authenticated"] });
  config.responseOverrides = { ...(config.responseOverrides || {}), "401": { statusCode: 302, redirect: "/.auth/login/aad?post_login_redirect_uri=.referrer" } };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export async function addAuthCommand(options: AddAuthOptions) {
  ensureSwallowKitProject("add-auth");

  console.log(" SwallowKit Add-Auth: Setting up authentication...\n");

  const provider = (options.provider || "custom-jwt") as AuthProvider;
  if (!["custom-jwt", "swa", "external-token", "swa-custom", "none"].includes(provider)) {
    console.error(` Unknown provider: ${provider}. Use: custom-jwt | swa | external-token | swa-custom | none`);
    process.exit(1);
  }

  const backendLanguage = getBackendLanguage();
  const config = getValidatedFullConfig();
  const cwd = process.cwd();

  if (options.scheme) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.scheme)) throw new Error("--scheme must start with a letter and contain only letters, digits, '_' or '-'");
    if (provider === "none" || provider === "swa-custom") throw new Error(`Provider '${provider}' cannot be added as a named scheme`);
    addNamedScheme(cwd, options.scheme, provider, backendLanguage);
    await syncProjectManifest();
    console.log(`\n Named authentication scheme '${options.scheme}' added.`);
    return;
  }

  if (provider === "swa-custom") {
    throw new Error("The swa-custom provider is not implemented. Use --provider swa or --provider custom-jwt.");
  }
  if (provider === "none") {
    updateConfigWithAuth(cwd, provider, config.auth?.customJwt || defaultCustomJwtConfig());
    await syncProjectManifest();
    console.log(" Authentication disabled in swallowkit.config.js");
    return;
  }
  if (provider === "swa") {
    setupSwaAuth(cwd, backendLanguage);
    updateConfigWithAuth(cwd, provider, config.auth?.customJwt || defaultCustomJwtConfig());
    await syncProjectManifest();
    console.log("\n SWA built-in authentication setup complete!");
    return;
  }
  if (provider === "external-token") {
    setupExternalTokenAuth(cwd, backendLanguage);
    updateConfigWithAuth(cwd, provider, config.auth?.customJwt || defaultCustomJwtConfig());
    await syncProjectManifest();
    console.log("\n External token authentication setup complete!");
    console.log(" Implement the generated frontend adapter and backend verifier before use.");
    return;
  }

  // Read project name from package.json
  const pkgPath = path.join(cwd, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const projectName = pkg.name || "app";

  // Read shared package name
  const sharedPkgPath = path.join(cwd, "shared", "package.json");
  let sharedPackageName = `@${projectName}/shared`;
  if (fs.existsSync(sharedPkgPath)) {
    const sharedPkg = JSON.parse(fs.readFileSync(sharedPkgPath, "utf-8"));
    sharedPackageName = sharedPkg.name || sharedPackageName;
  }

  // Default custom-jwt config
  const customJwtConfig: CustomJwtConfig = config.auth?.customJwt || defaultCustomJwtConfig();

  // custom-jwt setup continues below.

  // 1. Generate shared/models/auth.ts
  console.log(" Generating auth models...");
  const modelsDir = path.join(cwd, "shared", "models");
  fs.mkdirSync(modelsDir, { recursive: true });
  const authModelPath = path.join(modelsDir, "auth.ts");
  fs.writeFileSync(authModelPath, generateAuthModels(), "utf-8");
  console.log(` Created: shared/models/auth.ts`);

  // Ensure shared package has build infrastructure (tsconfig, build script)
  ensureSharedBuildInfrastructure(cwd);

  // Update shared/index.ts to re-export auth
  updateSharedIndex(cwd);

  // Resolve RDB provider for dependency installation
  const connDef = getConnectorDefinition(customJwtConfig.userConnector);
  const rdbProvider = (connDef as RdbConnectorConfig | undefined)?.provider ?? "mysql";

  // 2. Generate Functions auth code
  console.log("\n Generating auth functions...");
  generateFunctionsAuth(cwd, backendLanguage, sharedPackageName, customJwtConfig);

  // 3. Generate BFF auth routes
  console.log("\n Generating BFF auth routes...");
  generateBFFAuth(cwd, projectName, sharedPackageName);

  // 4. Generate proxy
  console.log("\n  Generating proxy...");
  const proxyPath = path.join(cwd, "proxy.ts");
  fs.writeFileSync(proxyPath, generateProxy(projectName), "utf-8");
  console.log(` Created: proxy.ts`);

  // 5. Generate login page
  console.log("\n Generating login page...");
  const loginDir = path.join(cwd, "app", "login");
  fs.mkdirSync(loginDir, { recursive: true });
  fs.writeFileSync(path.join(loginDir, "page.tsx"), generateLoginPage(), "utf-8");
  console.log(` Created: app/login/page.tsx`);

  // 6. Generate auth context
  console.log("\n Generating auth context...");
  const authLibDir = path.join(cwd, "lib", "auth");
  fs.mkdirSync(authLibDir, { recursive: true });
  fs.writeFileSync(path.join(authLibDir, "auth-context.tsx"), generateAuthContext(), "utf-8");
  console.log(`✅ Created: lib/auth/auth-context.tsx`);

  // 7. Update callFunction with auth support
  console.log("\n Updating callFunction with auth support...");
  const callFnPath = path.join(cwd, "lib", "api", "call-function.ts");
  const callFnDir = path.dirname(callFnPath);
  fs.mkdirSync(callFnDir, { recursive: true });
  fs.writeFileSync(callFnPath, generateBFFCallFunctionWithAuth(), "utf-8");
  console.log(` Updated: lib/api/call-function.ts`);

  // 8. Update swallowkit.config.js
  console.log("\n Updating configuration...");
  updateConfigWithAuth(cwd, provider, customJwtConfig);

  // 9. Update environment files
  console.log("\n Updating environment files...");
  updateEnvironmentFiles(cwd);

  // 10. Install dependencies
  console.log("\n Installing auth dependencies...");
  await installAuthDependencies(cwd, backendLanguage, rdbProvider);
  await syncProjectManifest();

  console.log("\n Authentication setup complete!");
  console.log("\n Next steps:");
  console.log("  1. Review the generated files");
  console.log("  2. Set JWT_SECRET in functions/local.settings.json");
  if (provider === "custom-jwt") {
    console.log("  3. Ensure your user database table matches the config");
    console.log("  4. Add authPolicy to your models for role-based access control:");
    console.log("     export const authPolicy = { roles: ['admin'] };");
  }
  console.log(`  5. Run scaffold to regenerate functions with auth guards`);
}

function findObjectEnd(content: string, open: number): number {
  let depth = 0, quote = "";
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (quote) { if (ch === quote && content[i - 1] !== "\\") quote = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

function updateConfigWithNamedScheme(cwd: string, scheme: string, provider: AuthProvider): void {
  const jsPath = path.join(cwd, "swallowkit.config.js");
  const jsonPath = path.join(cwd, "swallowkit.config.json");
  const configPath = fs.existsSync(jsPath) ? jsPath : jsonPath;
  if (!fs.existsSync(configPath)) throw new Error("swallowkit.config.js or swallowkit.config.json is required");
  if (configPath.endsWith(".json")) {
    const value = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    value.auth ??= {};
    value.auth.schemes ??= {};
    if (value.auth.schemes[scheme]) throw new Error(`auth.schemes.${scheme} already exists; no files were changed`);
    value.auth.schemes[scheme] = provider === "custom-jwt" ? { provider, customJwt: defaultCustomJwtConfig() } : { provider };
    value.auth.authorization ??= { defaultPolicy: "anonymous", policies: {} };
    fs.writeFileSync(configPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
    return;
  }
  let content = fs.readFileSync(configPath, "utf-8");
  const authMatch = /\bauth\s*:\s*\{/.exec(content);
  const customJwt = defaultCustomJwtConfig();
  const entry = provider === "custom-jwt"
    ? `\n      ${scheme}: { provider: 'custom-jwt', customJwt: ${JSON.stringify(customJwt)} },`
    : `\n      ${scheme}: { provider: '${provider}' },`;
  if (!authMatch) {
    const rootEnd = content.lastIndexOf("}");
    const beforeRootEnd = content.slice(0, rootEnd).trimEnd();
    const separator = beforeRootEnd.endsWith(",") || beforeRootEnd.endsWith("{") ? "" : ",";
    content = `${beforeRootEnd}${separator}\n  auth: {\n    schemes: {${entry}\n    },\n    authorization: { defaultPolicy: 'anonymous', policies: {} },\n  },\n${content.slice(rootEnd)}`;
  } else {
    const authOpen = content.indexOf("{", authMatch.index);
    const authEnd = findObjectEnd(content, authOpen);
    const authBody = content.slice(authOpen + 1, authEnd);
    const schemesMatch = /\bschemes\s*:\s*\{/.exec(authBody);
    if (schemesMatch) {
      const schemesOpen = authOpen + 1 + authBody.indexOf("{", schemesMatch.index);
      const schemesEnd = findObjectEnd(content, schemesOpen);
      const existing = content.slice(schemesOpen + 1, schemesEnd);
      if (new RegExp(`(^|[,\\s])${scheme}\\s*:`).test(existing)) throw new Error(`auth.schemes.${scheme} already exists; no files were changed`);
      content = content.slice(0, schemesEnd) + entry + "\n    " + content.slice(schemesEnd);
    } else {
      content = content.slice(0, authOpen + 1) + `\n    schemes: {${entry}\n    },` + content.slice(authOpen + 1);
    }
  }
  fs.writeFileSync(configPath, content, "utf-8");
}

function addNamedScheme(cwd: string, scheme: string, provider: AuthProvider, language: BackendLanguage): void {
  // Validate/update config before creating files, so duplicate names stop safely.
  updateConfigWithNamedScheme(cwd, scheme, provider);
  const slug = scheme.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
  if (language === "typescript") {
    const dir = path.join(cwd, "functions", "src", "auth", "schemes", slug);
    if (provider === "external-token") writeIfMissing(path.join(dir, "verifier.ts"), generateExternalTokenVerifierTS());
    else if (provider === "swa") writeIfMissing(path.join(dir, "adapter.ts"), generateSwaAuthHelperTS());
    else writeIfMissing(path.join(dir, "jwt-helper.ts"), generateJwtHelperTS());
  } else if (language === "csharp") {
    const dir = path.join(cwd, "functions", "Auth", "Schemes", slug);
    if (provider === "external-token") writeIfMissing(path.join(dir, "ExternalTokenVerifier.cs"), generateNamedExternalTokenVerifierCSharp(scheme));
    else if (provider === "swa") writeIfMissing(path.join(dir, "SwaAdapter.cs"), generateSwaAuthHelperCSharp());
    else writeIfMissing(path.join(dir, "JwtHelper.cs"), generateJwtHelperCSharp());
  } else {
    const dir = path.join(cwd, "functions", "auth", "schemes", slug.replace(/-/g, "_"));
    if (provider === "external-token") writeIfMissing(path.join(dir, "verifier.py"), generateNamedExternalTokenVerifierPython(scheme));
    else if (provider === "swa") writeIfMissing(path.join(dir, "adapter.py"), generateSwaAuthHelperPython());
    else writeIfMissing(path.join(dir, "jwt_helper.py"), generateJwtHelperPython());
  }
  const clientDir = path.join(cwd, "lib", "auth", "schemes", slug);
  if (provider === "external-token") {
    writeIfMissing(path.join(clientDir, "token-adapter.ts"), generateExternalTokenAdapter());
    writeIfMissing(path.join(clientDir, "authenticated-fetch.ts"), generateAuthenticatedFetch().replace("'./external-token-adapter'", "'./token-adapter'"));
    writeIfMissing(path.join(clientDir, "auth-context.tsx"), generateExternalTokenAuthContext().replace(/external-token-adapter/g, "token-adapter"));
  } else if (provider === "swa") {
    writeIfMissing(path.join(clientDir, "auth-context.tsx"), generateSwaAuthContext());
  } else if (provider === "custom-jwt") {
    writeIfMissing(path.join(clientDir, "auth-context.tsx"), generateAuthContext());
  }
  const callFunctionPath = path.join(cwd, "lib", "api", "call-function.ts");
  if (!fs.existsSync(callFunctionPath)) writeIfMissing(callFunctionPath, generateBFFCallFunctionWithMultipleAuth());
  else {
    const current = fs.readFileSync(callFunctionPath, "utf-8");
    if (!current.includes("x-ms-client-principal") || !current.includes("fetchHeaders['Authorization']")) {
      if (current.includes("SwallowKit BFF Call Function Helper")) fs.writeFileSync(callFunctionPath, generateBFFCallFunctionWithMultipleAuth(), "utf-8");
      else console.warn(" Existing customized lib/api/call-function.ts was preserved. Ensure it forwards Bearer and SWA credentials without logging them.");
    }
  }
}

/**
 * Ensure the shared package has proper build infrastructure
 * (tsconfig.json, build script, typescript devDependency).
 * Required for `dev` command which runs `npm run --workspace=shared build`.
 */
function ensureSharedBuildInfrastructure(cwd: string): void {
  const sharedDir = path.join(cwd, "shared");
  const pkgPath = path.join(sharedDir, "package.json");
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  let updated = false;

  // Ensure scripts.build exists
  if (!pkg.scripts?.build) {
    if (!pkg.scripts) pkg.scripts = {};
    pkg.scripts.build = "tsc";
    pkg.scripts.watch = "tsc --watch";
    updated = true;
  }

  // Ensure main points to compiled output
  if (!pkg.main || pkg.main === "index.ts") {
    pkg.main = "dist/index.js";
    pkg.types = "dist/index.d.ts";
    updated = true;
  }

  // Ensure typescript devDependency
  if (!pkg.devDependencies?.typescript) {
    if (!pkg.devDependencies) pkg.devDependencies = {};
    pkg.devDependencies.typescript = "^5.0.0";
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
    console.log(` Updated: shared/package.json (added build infrastructure)`);
  }

  // Ensure tsconfig.json exists
  const tsconfigPath = path.join(sharedDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    fs.writeFileSync(tsconfigPath, JSON.stringify(buildSharedTsConfig(), null, 2), "utf-8");
    console.log(` Created: shared/tsconfig.json`);
  }
}

function updateSharedIndex(cwd: string): void {
  const indexPath = path.join(cwd, "shared", "index.ts");
  if (fs.existsSync(indexPath)) {
    let content = fs.readFileSync(indexPath, "utf-8");
    if (!content.includes("./models/auth")) {
      content += `\nexport { LoginRequest, AuthUser, LoginResponse } from './models/auth';\n`;
      fs.writeFileSync(indexPath, content, "utf-8");
      console.log(` Updated: shared/index.ts`);
    }
  } else {
    fs.writeFileSync(indexPath, `export { LoginRequest, AuthUser, LoginResponse } from './models/auth';\n`, "utf-8");
    console.log(` Created: shared/index.ts`);
  }
}

function generateFunctionsAuth(
  cwd: string,
  backendLanguage: BackendLanguage,
  sharedPackageName: string,
  config: CustomJwtConfig,
): void {
  const functionsDir = path.join(cwd, "functions");

  // Resolve the RDB provider from the connector definition
  const connDef = getConnectorDefinition(config.userConnector);
  const provider = (connDef as RdbConnectorConfig | undefined)?.provider ?? "mysql";

  if (backendLanguage === "typescript") {
    // Auth functions
    const srcDir = path.join(functionsDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "auth.ts"),
      generateAuthFunctionsTS(sharedPackageName, config, provider),
      "utf-8"
    );
    console.log(` Created: functions/src/auth.ts`);

    // JWT helper
    const authDir = path.join(srcDir, "auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "jwt-helper.ts"),
      generateJwtHelperTS(),
      "utf-8"
    );
    console.log(` Created: functions/src/auth/jwt-helper.ts`);
  } else if (backendLanguage === "csharp") {
    const authDir = path.join(functionsDir, "Auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "AuthFunctions.cs"),
      generateAuthFunctionsCSharp(config, provider),
      "utf-8"
    );
    console.log(` Created: functions/Auth/AuthFunctions.cs`);
    fs.writeFileSync(
      path.join(authDir, "JwtHelper.cs"),
      generateJwtHelperCSharp(),
      "utf-8"
    );
    console.log(` Created: functions/Auth/JwtHelper.cs`);
  } else if (backendLanguage === "python") {
    const blueprintsDir = path.join(functionsDir, "blueprints");
    fs.mkdirSync(blueprintsDir, { recursive: true });
    fs.writeFileSync(
      path.join(blueprintsDir, "auth.py"),
      generateAuthFunctionsPython(config, provider),
      "utf-8"
    );
    console.log(` Created: functions/blueprints/auth.py`);

    const authDir = path.join(functionsDir, "auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "jwt_helper.py"),
      generateJwtHelperPython(),
      "utf-8"
    );
    console.log(` Created: functions/auth/jwt_helper.py`);

    // __init__.py
    fs.writeFileSync(path.join(authDir, "__init__.py"), "", "utf-8");

    // Register auth blueprint in function_app.py
    const functionAppPath = path.join(functionsDir, "function_app.py");
    if (fs.existsSync(functionAppPath)) {
      const content = fs.readFileSync(functionAppPath, "utf-8");
      const authImport = "from blueprints.auth import bp as auth_bp";
      const authRegister = "app.register_blueprint(auth_bp)";
      if (!content.includes(authImport)) {
        const marker = "# SwallowKit scaffold registrations";
        if (content.includes(marker)) {
          const updated = content.replace(
            marker,
            `${authImport}\n${authRegister}\n${marker}`
          );
          fs.writeFileSync(functionAppPath, updated, "utf-8");
          console.log(` Updated: functions/function_app.py (registered auth blueprint)`);
        }
      }
    }
  }
}

function generateBFFAuth(cwd: string, projectName: string, sharedPackageName: string): void {
  const authApiDir = path.join(cwd, "app", "api", "auth");

  // Login route
  const loginDir = path.join(authApiDir, "login");
  fs.mkdirSync(loginDir, { recursive: true });
  fs.writeFileSync(
    path.join(loginDir, "route.ts"),
    generateBFFAuthLoginRoute(projectName, sharedPackageName),
    "utf-8"
  );
  console.log(` Created: app/api/auth/login/route.ts`);

  // Logout route
  const logoutDir = path.join(authApiDir, "logout");
  fs.mkdirSync(logoutDir, { recursive: true });
  fs.writeFileSync(
    path.join(logoutDir, "route.ts"),
    generateBFFAuthLogoutRoute(projectName),
    "utf-8"
  );
  console.log(` Created: app/api/auth/logout/route.ts`);

  // Me route
  const meDir = path.join(authApiDir, "me");
  fs.mkdirSync(meDir, { recursive: true });
  fs.writeFileSync(
    path.join(meDir, "route.ts"),
    generateBFFAuthMeRoute(),
    "utf-8"
  );
  console.log(` Created: app/api/auth/me/route.ts`);
}

function updateConfigWithAuth(cwd: string, provider: AuthProvider, config: CustomJwtConfig): void {
  const configPath = path.join(cwd, "swallowkit.config.js");
  if (!fs.existsSync(configPath)) {
    console.warn("  swallowkit.config.js not found. Please add auth config manually.");
    return;
  }

  const content = fs.readFileSync(configPath, "utf-8");

  if (content.includes("auth:") || content.includes("auth :")) {
    console.log("  'auth' section already exists in swallowkit.config.js");
    return;
  }

  // Find the last property before the closing of module.exports
  const closingBraceIdx = content.lastIndexOf("}");
  if (closingBraceIdx === -1) {
    console.error(" Could not parse config file structure.");
    return;
  }

  const beforeClosing = content.substring(0, closingBraceIdx).trimEnd();
  const needsComma = !beforeClosing.endsWith(",") && !beforeClosing.endsWith("{");

  const providerSettings = provider === "custom-jwt" ? `
    customJwt: {
      userConnector: '${config.userConnector}',
      userTable: '${config.userTable}',
      loginIdColumn: '${config.loginIdColumn}',
      passwordHashColumn: '${config.passwordHashColumn}',
      rolesColumn: '${config.rolesColumn}',
      jwtSecretEnv: '${config.jwtSecretEnv || "JWT_SECRET"}',
      tokenExpiry: '${config.tokenExpiry || "24h"}',
    },` : provider === "swa" ? `
    swa: {
      allowedProviders: ['aad'],
      roleSource: 'swa-roles',
    },` : "";

  const authBlock = `${needsComma ? "," : ""}
  // 認証認可設定
  auth: {
    provider: '${provider}',
${providerSettings}
    authorization: {
      defaultPolicy: 'authenticated',
    },
  },
`;

  const newContent = content.substring(0, closingBraceIdx) + authBlock + content.substring(closingBraceIdx);
  fs.writeFileSync(configPath, newContent, "utf-8");
  console.log(` Updated: swallowkit.config.js`);
}

function updateEnvironmentFiles(cwd: string): void {
  // Update functions/local.settings.json
  const localSettingsPath = path.join(cwd, "functions", "local.settings.json");
  if (fs.existsSync(localSettingsPath)) {
    const settings = JSON.parse(fs.readFileSync(localSettingsPath, "utf-8"));
    if (!settings.Values) settings.Values = {};
    if (!settings.Values.JWT_SECRET) {
      settings.Values.JWT_SECRET = "dev-jwt-secret-change-in-production-min-32-chars!!";
    }
    fs.writeFileSync(localSettingsPath, JSON.stringify(settings, null, 2), "utf-8");
    console.log(` Updated: functions/local.settings.json`);
  }

  // Update .env.example
  const envExamplePath = path.join(cwd, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    let content = fs.readFileSync(envExamplePath, "utf-8");
    if (!content.includes("JWT_SECRET")) {
      content += "\n# Authentication\nJWT_SECRET=your-jwt-secret-key-at-least-32-chars\n";
      fs.writeFileSync(envExamplePath, content, "utf-8");
      console.log(` Updated: .env.example`);
    }
  }
}

async function installAuthDependencies(cwd: string, backendLanguage: BackendLanguage, provider: "mysql" | "postgres" | "sqlserver" = "mysql"): Promise<void> {
  if (backendLanguage === "typescript") {
    const funcPkgPath = path.join(cwd, "functions", "package.json");
    if (fs.existsSync(funcPkgPath)) {
      const funcPkg = JSON.parse(fs.readFileSync(funcPkgPath, "utf-8"));
      if (!funcPkg.dependencies) funcPkg.dependencies = {};
      funcPkg.dependencies["jsonwebtoken"] = "^9.0.0";
      funcPkg.dependencies["bcryptjs"] = "^2.4.3";
      // RDB driver based on provider
      if (provider === "mysql") funcPkg.dependencies["mysql2"] = "^3.11.0";
      else if (provider === "postgres") funcPkg.dependencies["pg"] = "^8.13.0";
      else funcPkg.dependencies["mssql"] = "^11.0.0";
      if (!funcPkg.devDependencies) funcPkg.devDependencies = {};
      funcPkg.devDependencies["@types/jsonwebtoken"] = "^9.0.0";
      funcPkg.devDependencies["@types/bcryptjs"] = "^2.4.0";
      if (provider === "postgres") funcPkg.devDependencies["@types/pg"] = "^8.11.0";
      fs.writeFileSync(funcPkgPath, JSON.stringify(funcPkg, null, 2), "utf-8");
      console.log(` Updated: functions/package.json with auth dependencies (${provider})`);
    }
  } else if (backendLanguage === "csharp") {
    // Add NuGet package references to .csproj
    const functionsDir = path.join(cwd, "functions");
    const csprojFiles = fs.readdirSync(functionsDir).filter((f: string) => f.endsWith(".csproj"));
    if (csprojFiles.length > 0) {
      const csprojPath = path.join(functionsDir, csprojFiles[0]);
      let csprojContent = fs.readFileSync(csprojPath, "utf-8");
      const nugetPackages: { name: string; version: string }[] = [
        { name: "System.IdentityModel.Tokens.Jwt", version: "7.0.0" },
        { name: "Microsoft.IdentityModel.Tokens", version: "7.0.0" },
        { name: "BCrypt.Net-Next", version: "4.0.3" },
      ];
      // RDB driver based on provider
      if (provider === "mysql") nugetPackages.push({ name: "MySqlConnector", version: "2.3.0" });
      else if (provider === "postgres") nugetPackages.push({ name: "Npgsql", version: "8.0.0" });
      else nugetPackages.push({ name: "Microsoft.Data.SqlClient", version: "5.2.0" });
      for (const pkg of nugetPackages) {
        if (!csprojContent.includes(`"${pkg.name}"`)) {
          const insertPoint = csprojContent.lastIndexOf("</ItemGroup>");
          if (insertPoint >= 0) {
            csprojContent =
              csprojContent.slice(0, insertPoint) +
              `  <PackageReference Include="${pkg.name}" Version="${pkg.version}" />\n  ` +
              csprojContent.slice(insertPoint);
          }
        }
      }
      fs.writeFileSync(csprojPath, csprojContent, "utf-8");
      console.log(` Updated: ${csprojFiles[0]} with auth NuGet packages (${provider})`);
    }
  } else if (backendLanguage === "python") {
    // Add Python dependencies to requirements.txt
    const requirementsPath = path.join(cwd, "functions", "requirements.txt");
    const baseDeps = ["PyJWT>=2.8.0", "bcrypt>=4.1.0"];
    // RDB driver based on provider
    if (provider === "mysql") baseDeps.push("mysql-connector-python>=8.3.0");
    else if (provider === "postgres") baseDeps.push("psycopg2-binary>=2.9.0");
    else baseDeps.push("pymssql>=2.2.0");
    if (fs.existsSync(requirementsPath)) {
      let content = fs.readFileSync(requirementsPath, "utf-8");
      for (const dep of baseDeps) {
        const pkgName = dep.split(">=")[0].split("==")[0];
        if (!content.includes(pkgName)) {
          content += `${dep}\n`;
        }
      }
      fs.writeFileSync(requirementsPath, content, "utf-8");
    } else {
      fs.writeFileSync(requirementsPath, baseDeps.join("\n") + "\n", "utf-8");
    }
    console.log(` Updated: functions/requirements.txt with auth dependencies`);
  }
}
