/**
 * SwallowKit Add-Auth コマンド
 * 認証認可基盤ファイルを生成する
 */

import * as fs from "fs";
import * as path from "path";
import { ensureSwallowKitProject, getBackendLanguage, getConnectorDefinition, getFullConfig } from "../../core/config";
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
} from "../../core/scaffold/auth-generator";
import { detectFromProject, getCommands } from "../../utils/package-manager";

interface AddAuthOptions {
  provider?: string;
}

export async function addAuthCommand(options: AddAuthOptions) {
  ensureSwallowKitProject("add-auth");

  console.log(" SwallowKit Add-Auth: Setting up authentication...\n");

  const provider = (options.provider || "custom-jwt") as AuthProvider;
  if (!["custom-jwt", "swa", "swa-custom", "none"].includes(provider)) {
    console.error(` Unknown provider: ${provider}. Use: custom-jwt | swa | swa-custom | none`);
    process.exit(1);
  }

  const backendLanguage = getBackendLanguage();
  const config = getFullConfig();
  const cwd = process.cwd();

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
  const customJwtConfig: CustomJwtConfig = config.auth?.customJwt || {
    userConnector: "mysql",
    userTable: "users",
    loginIdColumn: "login_id",
    passwordHashColumn: "password_hash",
    rolesColumn: "roles",
    jwtSecretEnv: "JWT_SECRET",
    tokenExpiry: "24h",
  };

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
    const tsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        moduleResolution: "node",
        lib: ["ES2020"],
        outDir: "dist",
        rootDir: ".",
        declaration: true,
        declarationMap: true,
        sourceMap: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ["index.ts", "models/**/*"],
      exclude: ["node_modules", "dist"],
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");
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
    generateBFFAuthMeRoute(sharedPackageName),
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

  const authBlock = `${needsComma ? "," : ""}
  // 認証認可設定
  auth: {
    provider: '${provider}',
    customJwt: {
      userConnector: '${config.userConnector}',
      userTable: '${config.userTable}',
      loginIdColumn: '${config.loginIdColumn}',
      passwordHashColumn: '${config.passwordHashColumn}',
      rolesColumn: '${config.rolesColumn}',
      jwtSecretEnv: '${config.jwtSecretEnv || "JWT_SECRET"}',
      tokenExpiry: '${config.tokenExpiry || "24h"}',
    },
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
  const pm = detectFromProject();
  const cmds = getCommands(pm);

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
