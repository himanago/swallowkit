/**
 * Generated project matrix.
 *
 * Builds realistic consumer skeletons (the same builders as `init`), applies authentication,
 * plans/applies scaffold through the machine interface, and then *compiles* the result:
 * - TypeScript: standalone Functions, BFF, and UI are type-checked with the project's tsconfig.
 *   Only npm packages that are not installed in this repository are replaced by `any` stubs
 *   generated from the actual imports; project modules and the shared package are real.
 * - Python: every backend file is parsed, and project-local imports must resolve to real names.
 * - C#: `dotnet build` of the standalone Functions project (when the .NET SDK is available).
 *
 * Each combination of frontend × backend × authentication × model authPolicy must either
 * be rejected before any file is written, or produce code that compiles.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as childProcess from "child_process";
import { builtinModules } from "module";
import { EventEmitter } from "events";
import * as ts from "typescript";
import { runMachineCli } from "../machine";
import { addAuthCommand } from "../cli/commands/add-auth";
import { buildGeneratedProjectDependencies, buildGeneratedProjectDevDependencies, buildSwallowKitConfigSource, createAzureFunctionsProject, createSharedPackage } from "../cli/commands/init";
import { createReactBffProject, createReactProject } from "../core/project/react-project";
import { BackendLanguage, FrontendFramework } from "../types";

jest.mock("child_process", () => {
  const actual = jest.requireActual<typeof import("child_process")>("child_process");
  return { ...actual, execFile: jest.fn(), spawn: jest.fn(), spawnSync: jest.fn() };
});

/**
 * Jest caches file contents per test file, so a swallowkit.config.js rewritten by add-auth (or by
 * this test) would be re-required with stale content. The CLI runs each command in a fresh process;
 * mirror that by always evaluating the config file from disk.
 */
jest.mock("module", () => {
  const actual = jest.requireActual<typeof import("module")>("module");
  const nodeFs = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    createRequire(filename: string) {
      const base = actual.createRequire(filename);
      const fresh = ((id: string) => {
        if (!/[\\/]swallowkit\.config\.js$/.test(id)) return base(id);
        const module = { exports: {} as unknown };
        new Function("module", "exports", "require", nodeFs.readFileSync(id, "utf-8"))(module, module.exports, base);
        return module.exports;
      }) as NodeJS.Require;
      return Object.assign(fresh, { cache: {}, resolve: base.resolve });
    },
  };
});

const real = jest.requireActual<typeof import("child_process")>("child_process");
const repoRoot = process.cwd();
const PROJECT = "matrix-app";
const SHARED = `@${PROJECT}/shared`;

type Provider = "swa" | "external-token" | "custom-jwt";
interface AuthSetup {
  id: string;
  kind: "none" | "legacy" | "named";
  providers: Array<{ provider: Provider; scheme?: string }>;
  defaultPolicy?: string;
}
type PolicyId = "none" | "roles" | "rw-roles" | "named" | "rw-named";

const AUTH_SETUPS: AuthSetup[] = [
  { id: "no-auth", kind: "none", providers: [] },
  { id: "legacy-swa", kind: "legacy", providers: [{ provider: "swa" }] },
  { id: "legacy-external-token", kind: "legacy", providers: [{ provider: "external-token" }] },
  { id: "legacy-custom-jwt", kind: "legacy", providers: [{ provider: "custom-jwt" }] },
  { id: "legacy-swa-named-default-policy", kind: "legacy", providers: [{ provider: "swa" }], defaultPolicy: "readers" },
  { id: "named-swa", kind: "named", providers: [{ provider: "swa", scheme: "admin" }] },
  { id: "named-external-token", kind: "named", providers: [{ provider: "external-token", scheme: "partner" }] },
  { id: "named-custom-jwt", kind: "named", providers: [{ provider: "custom-jwt", scheme: "staff" }] },
  {
    id: "named-swa+external-default-policy",
    kind: "named",
    providers: [{ provider: "swa", scheme: "admin" }, { provider: "external-token", scheme: "partner" }],
    defaultPolicy: "readers",
  },
];

const POLICIES: Record<PolicyId, string | null> = {
  none: null,
  roles: "{ roles: ['admin'] }",
  "rw-roles": "{ read: ['reader'], write: ['admin'] }",
  named: "{ policy: 'adminOnly' }",
  "rw-named": "{ read: 'readers', write: 'adminOnly' }",
};

interface MatrixCase {
  name: string;
  frontend: FrontendFramework;
  backend: BackendLanguage;
  auth: AuthSetup;
  policy: PolicyId;
  /** init writes swallowkit.config.js; swallowkit.config.json is also supported and takes precedence. */
  configFormat?: "js" | "json";
}

/** The contract: either a precise prerequisite error, or a project that compiles. */
function expectedBlock(auth: AuthSetup, policy: PolicyId): string | null {
  const namedPolicy = policy === "named" || policy === "rw-named" || (policy === "none" && Boolean(auth.defaultPolicy));
  if (auth.kind === "none") return policy === "none" ? null : "auth-policy-without-auth";
  if (auth.kind === "named" && (policy === "roles" || policy === "rw-roles")) return "auth-policy-requires-named-policy";
  // Named policies are routed by the multi-scheme router, which only exists for named auth.schemes.
  if (auth.kind === "legacy" && namedPolicy) return "auth-named-policy-requires-named-scheme";
  return null;
}

// Frontend-specific code (UI, BFF) is independent of the backend language and vice versa,
// so the full auth × policy grid runs for TypeScript on both frontends and for C#/Python on React,
// plus a Next.js smoke case per native backend.
const CASES: MatrixCase[] = [];
for (const auth of AUTH_SETUPS) {
  for (const policy of Object.keys(POLICIES) as PolicyId[]) {
    const combos: Array<[FrontendFramework, BackendLanguage]> = [
      ["nextjs", "typescript"], ["react", "typescript"], ["react", "csharp"], ["react", "python"],
    ];
    for (const [frontend, backend] of combos) {
      CASES.push({ name: `${frontend}/${backend}/${auth.id}/${policy}`, frontend, backend, auth, policy });
    }
  }
}
const setup = (id: string) => AUTH_SETUPS.find((candidate) => candidate.id === id)!;
for (const backend of ["csharp", "python"] as const) {
  for (const auth of [setup("no-auth"), setup("legacy-swa"), setup("named-swa")]) {
    const policy: PolicyId = auth.kind === "named" ? "named" : auth.kind === "legacy" ? "roles" : "none";
    CASES.push({ name: `nextjs/${backend}/${auth.id}/${policy}`, frontend: "nextjs", backend, auth, policy });
  }
}
for (const backend of ["typescript", "csharp", "python"] as const) {
  for (const auth of [setup("legacy-swa"), setup("legacy-custom-jwt"), setup("named-swa"), setup("named-custom-jwt")]) {
    const policy: PolicyId = auth.kind === "named" ? "rw-named" : "rw-roles";
    CASES.push({ name: `react/${backend}/${auth.id}/${policy}/json-config`, frontend: "react", backend, auth, policy, configFormat: "json" });
  }
}

const MODEL_SOURCE = `import { z } from 'zod/v4';
export const ProbeItem = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1),
  tags: z.array(z.string()),
  score: z.number().min(0).max(1),
  kind: z.enum(['a', 'b']),
  nested: z.object({ x: z.string() }).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type ProbeItem = z.infer<typeof ProbeItem>;
export const partitionKey = '/userId';
export const displayName = 'Probe';
`;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

async function createSkeleton(root: string, frontend: FrontendFramework, backend: BackendLanguage, configFormat: "js" | "json"): Promise<void> {
  fs.mkdirSync(root, { recursive: true });
  if (frontend === "react") {
    createReactProject(root, PROJECT, "pnpm");
  } else {
    // create-next-app's manifest (SwallowKit init adds its own dependencies below).
    write(path.join(root, "package.json"), JSON.stringify({
      name: PROJECT, private: true,
      dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0" },
      devDependencies: { typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19", tailwindcss: "^4", "@tailwindcss/postcss": "^4" },
    }, null, 2));
    // Mirrors create-next-app plus the exclusions SwallowKit init adds.
    write(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true,
        noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true,
        isolatedModules: true, jsx: "react-jsx", incremental: false, paths: { "@/*": ["./*"] },
      },
      include: ["**/*.ts", "**/*.tsx"],
      exclude: ["node_modules", "functions", "shared"],
    }, null, 2));
    write(path.join(root, "app", "layout.tsx"), `import type { ReactNode } from 'react';
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`);
    write(path.join(root, "lib", "scaffold-config.ts"), `export interface ScaffoldModel { name: string; path: string; label: string; }
export const scaffoldConfig = {
  models: [] as ScaffoldModel[]
};
`);
  }
  if (configFormat === "json") {
    write(path.join(root, "swallowkit.config.json"), JSON.stringify({ frontend: { framework: frontend }, backend: { language: backend } }, null, 2));
  } else {
    write(path.join(root, "swallowkit.config.js"), buildSwallowKitConfigSource(backend, frontend));
  }
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.dependencies = { ...manifest.dependencies, ...buildGeneratedProjectDependencies(PROJECT, "pnpm", frontend) };
  manifest.devDependencies = { ...manifest.devDependencies, ...buildGeneratedProjectDevDependencies(frontend) };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  await createSharedPackage(root, PROJECT);
  await createAzureFunctionsProject(root, "pnpm", backend);
  if (frontend === "react") createReactBffProject(root, PROJECT, "pnpm");
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "junction");
}

async function applyAuth(root: string, auth: AuthSetup): Promise<void> {
  for (const { provider, scheme } of auth.providers) {
    await addAuthCommand({ provider, scheme, allowedProviders: provider === "swa" ? ["github"] : undefined });
  }
  if (auth.kind === "none") return;
  const schemes = auth.kind === "legacy" ? ["default"] : auth.providers.map((entry) => entry.scheme!);
  const policies = {
    adminOnly: { schemes: schemes.slice(0, 1), roles: ["admin"] },
    readers: { schemes, roles: ["reader"] },
  };
  const jsonPath = path.join(root, "swallowkit.config.json");
  if (fs.existsSync(jsonPath)) {
    const config = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (!config.auth) throw new Error("add-auth did not record auth in swallowkit.config.json");
    config.auth.authorization = {
      ...config.auth.authorization,
      ...(auth.defaultPolicy ? { defaultPolicy: auth.defaultPolicy } : {}),
      policies: { ...config.auth.authorization?.policies, ...policies },
    };
    fs.writeFileSync(jsonPath, JSON.stringify(config, null, 2));
    return;
  }
  // Named policies are hand-edited after apply auth; append the equivalent edit to the JS config.
  fs.appendFileSync(path.join(root, "swallowkit.config.js"), `
module.exports.auth.authorization = {
  ...module.exports.auth.authorization,
  ${auth.defaultPolicy ? `defaultPolicy: ${JSON.stringify(auth.defaultPolicy)},` : ""}
  policies: { ...(module.exports.auth.authorization || {}).policies, ...${JSON.stringify(policies)} },
};
`);
}

function mockNativeToolchainValidation(): void {
  // Only toolchain *validation* shells out; generation is in-process and stays real.
  (childProcess.spawnSync as unknown as ReturnType<typeof jest.fn>).mockReturnValue({ status: 0, stdout: "", stderr: "" });
  (childProcess.spawn as unknown as ReturnType<typeof jest.fn>).mockImplementation(() => {
    const child = new EventEmitter() as childProcess.ChildProcess;
    process.nextTick(() => child.emit("close", 0));
    return child;
  });
  (childProcess.execFile as unknown as ReturnType<typeof jest.fn>).mockImplementation(
    (_c: string, _a: string[], _o: object, callback: (e: Error | null, out: string, err: string) => void) =>
      process.nextTick(() => callback(null, "", ""))
  );
}

async function runMachine(argv: string[]): Promise<any> {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExitCode = process.exitCode;
  (process.stdout.write as unknown) = (chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  };
  try {
    await runMachineCli(["node", "swallowkit", "machine", ...argv]);
    return JSON.parse(writes.join(""));
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

function snapshotTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".swallowkit") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(root, full), fs.readFileSync(full, "utf-8"));
    }
  };
  walk(root);
  return files;
}

// ---------------------------------------------------------------------------------------------
// Toolchains: CI sets SWALLOWKIT_REQUIRE_TOOLCHAINS=1 so a missing Python/.NET fails instead of skipping.
// Locally, SWALLOWKIT_TEST_SKIP_DOTNET=1 skips the slower dotnet builds.
// ---------------------------------------------------------------------------------------------

const REQUIRE_TOOLCHAINS = process.env.SWALLOWKIT_REQUIRE_TOOLCHAINS === "1";

type TestFn = (title: string, fn: () => void | Promise<void>) => void;

function toolchainGate(available: boolean, name: string, optOut = false): TestFn {
  if (available && !optOut) return (title, fn) => it(title, fn);
  if (REQUIRE_TOOLCHAINS && !optOut) {
    return (title) => it(title, () => { throw new Error(`${name} is required (SWALLOWKIT_REQUIRE_TOOLCHAINS=1) but was not found`); });
  }
  return (title, fn) => it.skip(title, fn);
}

// ---------------------------------------------------------------------------------------------
// TypeScript checking
// ---------------------------------------------------------------------------------------------

const sourceFileCache = new Map<string, ts.SourceFile | undefined>();
let previousProgram: ts.Program | undefined;

function createCachingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
    const shareable = fileName.includes(`${path.sep}node_modules${path.sep}`) || fileName.includes("/node_modules/") ||
      path.dirname(fileName) === path.dirname(ts.getDefaultLibFilePath(options));
    if (!shareable) return getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate);
    const version = typeof languageVersionOrOptions === "object"
      ? `${languageVersionOrOptions.languageVersion}:${languageVersionOrOptions.impliedNodeFormat}`
      : String(languageVersionOrOptions);
    // Resolve through the symlink so every case shares the same cached declaration files.
    const key = `${fs.existsSync(fileName) ? fs.realpathSync(fileName) : fileName}|${version}`;
    if (!sourceFileCache.has(key)) sourceFileCache.set(key, getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate));
    return sourceFileCache.get(key);
  };
  return host;
}

/** Declare `any`-typed stubs for exactly the bindings imported from packages that are not installed here. */
function buildMissingPackageStubs(files: string[], options: ts.CompilerOptions): string {
  const modules = new Map<string, { names: Set<string>; hasDefault: boolean }>();
  const needsStub = (specifier: string, file: string) => {
    const local = specifier.startsWith(".") || specifier.startsWith("@/") || specifier === SHARED || specifier.startsWith(`${SHARED}/`);
    if (local) return false;
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    // Untyped JavaScript packages (TS7016) are stubbed like missing ones.
    return !resolved || ![".ts", ".tsx", ".d.ts", ".mts", ".cts", ".d.mts", ".d.cts"].includes(resolved.extension);
  };
  const entryFor = (specifier: string) => {
    const entry = modules.get(specifier) ?? { names: new Set<string>(), hasDefault: false };
    modules.set(specifier, entry);
    return entry;
  };
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (needsStub(specifier, file)) {
          const entry = entryFor(specifier);
          if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            if (clause?.name) entry.hasDefault = true;
            if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
              for (const element of clause.namedBindings.elements) entry.names.add((element.propertyName ?? element.name).text);
            }
          } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            for (const element of node.exportClause.elements) entry.names.add((element.propertyName ?? element.name).text);
          }
        }
      } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        // `const { A } = await import('pkg')` / `require('pkg')`
        const specifier = node.arguments[0].text;
        if (needsStub(specifier, file)) {
          const entry = entryFor(specifier);
          entry.hasDefault = true;
          let parent: ts.Node = node.parent;
          while (parent && (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent;
          if (parent && ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
            for (const element of parent.name.elements) {
              const name = element.propertyName ?? element.name;
              if (ts.isIdentifier(name)) entry.names.add(name.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...modules].map(([name, { names, hasDefault }]) => [
    `declare module ${JSON.stringify(name)} {`,
    ...[...names].filter((n) => n !== "default").map((n) => `  export const ${n}: any;\n  export type ${n}<A = any, B = any, C = any> = any;`),
    hasDefault || names.has("default") ? "  const value: any;\n  export default value;" : "",
    "}",
  ].join("\n")).join("\n");
}

function listSources(dir: string, pattern = /\.(ts|tsx)$/): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return pattern.test(dir) ? [dir] : [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name) && !/[\\/](node_modules|dist)([\\/]|$)/.test(entry.parentPath))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const NODE_BUILTINS = new Set(builtinModules);

/** npm packages imported by generated code that the generated project does not declare (would fail after a clean install). */
function undeclaredPackages(sourceRoots: string[], packageJsons: string[], extraAllowed: string[] = []): string[] {
  const declared = new Set(extraAllowed);
  for (const file of packageJsons) {
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) Object.keys(pkg[field] ?? {}).forEach((name) => declared.add(name));
  }
  const missing = new Set<string>();
  for (const file of sourceRoots.flatMap((root) => listSources(root))) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true);
    const check = (specifier: string) => {
      if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("node:") || NODE_BUILTINS.has(specifier.split("/")[0])) return;
      const parts = specifier.split("/");
      const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!declared.has(name)) missing.add(`${path.basename(file)} imports '${name}'`);
    };
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
          !(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)) check(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        check(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...missing].sort();
}

function typecheck(tsconfigPath: string, sharedIndex: string, packageOverrides: Record<string, string> = {}): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, { noEmit: true }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); },
  })!;
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    incremental: false,
    // Workspace installs link the shared package to its built dist/ (outside rootDir); type-check its source instead.
    rootDir: undefined,
    paths: {
      ...parsed.options.paths,
      [SHARED]: [sharedIndex],
      [`${SHARED}/*`]: [path.join(path.dirname(sharedIndex), "*")],
      ...Object.fromEntries(Object.entries(packageOverrides).map(([name, target]) => [name, [target]])),
    },
    pathsBasePath: path.dirname(tsconfigPath),
  };
  const rootNames = parsed.fileNames.filter((file) => !/[\\/](node_modules|dist)[\\/]/.test(file));
  const stubFile = path.join(path.dirname(tsconfigPath), "__matrix_missing_packages__.d.ts");
  fs.writeFileSync(stubFile, buildMissingPackageStubs(rootNames, options));
  const program = ts.createProgram({ rootNames: [...rootNames, stubFile], options, host: createCachingHost(options), oldProgram: previousProgram });
  previousProgram = program;
  const diagnostics = ts.getPreEmitDiagnostics(program);
  fs.rmSync(stubFile);
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file) return `TS${diagnostic.code}: ${message}`;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${path.relative(path.dirname(tsconfigPath), diagnostic.file.fileName)}(${line + 1},${character + 1}): TS${diagnostic.code}: ${message}`;
  });
}

// ---------------------------------------------------------------------------------------------
// Python checking
// ---------------------------------------------------------------------------------------------

const PYTHON = ["python3", "python"].find((command) => {
  const probe = real.spawnSync(command, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"], { encoding: "utf-8" });
  return probe.status === 0;
});

const PYTHON_CHECKER = String.raw`
import ast, json, os, sys
root = sys.argv[1]
errors = []
modules = {}
for base, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in (".venv", ".codegen-venv", "__pycache__", "node_modules")]
    for name in files:
        if name.endswith(".py"):
            full = os.path.join(base, name)
            rel = os.path.relpath(full, root)
            parts = rel[:-3].split(os.sep)
            if parts[-1] == "__init__":
                parts = parts[:-1]
            try:
                with open(full, encoding="utf-8") as handle:
                    modules[".".join(parts)] = (rel, ast.parse(handle.read(), rel))
            except SyntaxError as exc:
                errors.append(f"{rel}:{exc.lineno}: {exc.__class__.__name__}: {exc.msg}")

def defined(tree):
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in (node.targets if isinstance(node, ast.Assign) else [node.target]):
                for sub in ast.walk(target):
                    if isinstance(sub, ast.Name):
                        names.add(sub.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
    return names

local_roots = {name.split(".")[0] for name in modules}
external = set()
for module, (rel, tree) in modules.items():
    for node in ast.walk(tree):
        names = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and not node.level and node.module:
            names = [node.module]
        for name in names:
            top = name.split(".")[0]
            if top not in local_roots and top not in sys.stdlib_module_names and top != "__future__":
                external.add(".".join(name.split(".")[:2]) if top == "azure" else top)
    package = module.split(".") if rel.endswith("__init__.py") else module.split(".")[:-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                target = ".".join(package[: len(package) - node.level + 1] + ([node.module] if node.module else []))
            else:
                target = node.module or ""
            if target.split(".")[0] not in local_roots:
                continue
            if target not in modules:
                errors.append(f"{rel}:{node.lineno}: missing module '{target}'")
                continue
            names = defined(modules[target][1])
            for alias in node.names:
                if alias.name != "*" and alias.name not in names and f"{target}.{alias.name}" not in modules:
                    errors.append(f"{rel}:{node.lineno}: '{target}' has no name '{alias.name}'")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in local_roots and alias.name not in modules:
                    errors.append(f"{rel}:{node.lineno}: missing module '{alias.name}'")
print(json.dumps({"errors": errors, "external": sorted(external)}))
`;

/** Import name -> distribution that provides it (only names generated code uses). */
const PYTHON_DISTRIBUTIONS: Record<string, string> = {
  "azure.functions": "azure-functions",
  "azure.cosmos": "azure-cosmos",
  "azure.identity": "azure-identity",
  jwt: "PyJWT",
  bcrypt: "bcrypt",
  mysql: "mysql-connector-python",
  psycopg2: "psycopg2-binary",
  pymssql: "pymssql",
  pydantic: "pydantic",
  // A required dependency of pydantic v2, so declaring pydantic installs it.
  typing_extensions: "pydantic",
  requests: "requests",
  httpx: "httpx",
  yaml: "PyYAML",
};

function checkPython(functionsRoot: string): string[] {
  const result = real.spawnSync(PYTHON!, ["-c", PYTHON_CHECKER, functionsRoot], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`Python checker failed: ${result.stderr}`);
  const { errors, external } = JSON.parse(result.stdout) as { errors: string[]; external: string[] };
  const requirementsPath = path.join(functionsRoot, "requirements.txt");
  const requirements = new Set((fs.existsSync(requirementsPath) ? fs.readFileSync(requirementsPath, "utf-8") : "")
    .split(/\r?\n/).map((line) => line.trim().split(/[<>=!~;[ ]/)[0].toLowerCase()).filter(Boolean));
  for (const name of external) {
    const distribution = PYTHON_DISTRIBUTIONS[name];
    if (!distribution) errors.push(`imports '${name}', which has no known distribution mapping (add it to PYTHON_DISTRIBUTIONS)`);
    else if (!requirements.has(distribution.toLowerCase())) errors.push(`imports '${name}' but requirements.txt does not declare ${distribution}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// C# checking
// ---------------------------------------------------------------------------------------------

const DOTNET = real.spawnSync("dotnet", ["--version"], { encoding: "utf-8" }).status === 0;

function dotnetBuild(functionsRoot: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = real.spawn("dotnet", ["build", "--nologo", "-v", "q", "-clp:NoSummary", "-p:TreatWarningsAsErrors=false"], {
      cwd: functionsRoot,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", MSBUILDDISABLENODEREUSE: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => {
      const errors = [...new Set(output.split(/\r?\n/).filter((line) => /error [A-Z]+\d+/.test(line))
        .map((line) => line.replace(functionsRoot + path.sep, "").replace(/\s*\[[^\]]+\.csproj\]\s*$/, "").trim()))];
      resolve(code === 0 ? [] : errors.length > 0 ? errors : [output.slice(-4000)]);
    });
  });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------------------------

interface CaseResult {
  root: string;
  planStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  applyOk?: boolean;
  replanChanges?: string[];
  unchanged?: boolean;
  setupError?: string;
}

describe("generated project matrix", () => {
  const originalCwd = process.cwd();
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swallowkit-matrix-"));
  const results = new Map<string, CaseResult>();

  beforeAll(async () => {
    const quiet = [jest.spyOn(console, "log"), jest.spyOn(console, "warn"), jest.spyOn(console, "info")]
      .map((spy) => spy.mockImplementation(() => undefined));
    try {
      for (const [index, testCase] of CASES.entries()) {
        const root = path.join(workRoot, String(index), PROJECT);
        const result: CaseResult = { root };
        results.set(testCase.name, result);
        try {
          await createSkeleton(root, testCase.frontend, testCase.backend, testCase.configFormat ?? "js");
          process.chdir(root);
          mockNativeToolchainValidation();
          await applyAuth(root, testCase.auth);
          const policy = POLICIES[testCase.policy];
          write(path.join(root, "shared", "models", "probe-item.ts"), `${MODEL_SOURCE}${policy ? `export const authPolicy = ${policy};\n` : ""}`);
          const before = snapshotTree(root);
          const plan = await runMachine(["plan", "scaffold", "probe-item", "--skip-infra"]);
          result.planStatus = plan.status;
          if (!plan.ok) {
            result.errorCode = plan.error.code;
            result.errorMessage = plan.error.message;
            const after = snapshotTree(root);
            result.unchanged = after.size === before.size && [...before].every(([file, content]) => after.get(file) === content);
            continue;
          }
          const apply = await runMachine(["apply", "scaffold", "--plan", plan.data.planId]);
          result.applyOk = apply.ok;
          if (!apply.ok) result.errorMessage = `${apply.error.code}: ${apply.error.message}`;
          else {
            const replan = await runMachine(["plan", "scaffold", "probe-item", "--skip-infra"]);
            result.replanChanges = replan.ok
              ? replan.data.operations.filter((op: { action: string }) => op.action !== "skip").map((op: { path: string; action: string }) => `${op.action} ${op.path}`)
              : [`${replan.error.code}: ${replan.error.message}`];
          }
        } catch (error) {
          result.setupError = error instanceof Error ? error.stack ?? error.message : String(error);
        } finally {
          process.chdir(originalCwd);
        }
      }
    } finally {
      quiet.forEach((spy) => spy.mockRestore());
    }
  }, 10 * 60 * 1000);

  afterAll(() => {
    process.chdir(originalCwd);
    if (!process.env.SWALLOWKIT_KEEP_MATRIX) fs.rmSync(workRoot, { recursive: true, force: true });
  });

  describe.each(CASES)("$name", (testCase) => {
    const blocked = expectedBlock(testCase.auth, testCase.policy);

    if (blocked) {
      it(`is blocked with ${blocked} before writing anything`, () => {
        const result = results.get(testCase.name)!;
        expect(result.setupError).toBeUndefined();
        expect({ status: result.planStatus, code: result.errorCode }).toEqual({ status: "blocked", code: blocked });
        expect(result.unchanged).toBe(true);
      });
      return;
    }

    it("plans and applies scaffold", () => {
      const result = results.get(testCase.name)!;
      expect(result.setupError).toBeUndefined();
      expect({ status: result.planStatus, error: result.errorMessage, applied: result.applyOk })
        .toEqual({ status: "complete", error: undefined, applied: true });
    });

    it("is idempotent: re-planning right after apply changes nothing", () => {
      const result = results.get(testCase.name)!;
      if (!result.applyOk) return;
      expect(result.replanChanges).toEqual([]);
    });

    it("type-checks the UI and BFF", () => {
      const result = results.get(testCase.name)!;
      if (!result.applyOk) return; // reported by the scaffold assertion above
      const sharedIndex = path.join(result.root, "shared", "index.ts");
      const diagnostics = [
        ...typecheck(path.join(result.root, "tsconfig.json"), sharedIndex),
        ...(testCase.frontend === "react"
          // The managed BFF pins @azure/functions v3 (classic function.json model), unlike the v4 standalone backend.
          ? typecheck(path.join(result.root, "bff", "tsconfig.json"), sharedIndex, { "@azure/functions": path.join(repoRoot, "node_modules", "azure-functions-v3") })
          : []),
      ];
      expect(diagnostics).toEqual([]);
    });

    it("declares every npm package that generated UI/BFF code imports", () => {
      const result = results.get(testCase.name)!;
      if (!result.applyOk) return;
      const root = result.root;
      // Next.js bundles the BFF (app/api) with the UI; the React BFF is its own workspace package.
      const frontendRoots = testCase.frontend === "react" ? ["src", "lib"] : ["app", "lib", "proxy.ts"];
      expect(undeclaredPackages(frontendRoots.map((dir) => path.join(root, dir)), [path.join(root, "package.json")], ["vite"])).toEqual([]);
      if (testCase.frontend === "react") {
        expect(undeclaredPackages([path.join(root, "bff", "src")], [path.join(root, "bff", "package.json")])).toEqual([]);
      }
    });

    if (testCase.backend === "typescript") {
      it("declares every npm package that the TypeScript Functions import", () => {
        const result = results.get(testCase.name)!;
        if (!result.applyOk) return;
        expect(undeclaredPackages([path.join(result.root, "functions", "src")], [path.join(result.root, "functions", "package.json")])).toEqual([]);
      });

      it("type-checks the standalone TypeScript Functions", () => {
        const result = results.get(testCase.name)!;
        if (!result.applyOk) return;
        expect(listSources(path.join(result.root, "functions", "src")).length).toBeGreaterThan(0);
        expect(typecheck(path.join(result.root, "functions", "tsconfig.json"), path.join(result.root, "shared", "index.ts"))).toEqual([]);
      });
    }

    if (testCase.backend === "python") {
      toolchainGate(Boolean(PYTHON), "Python >= 3.10")("parses Python Functions and resolves every project-local import and requirement", () => {
        const result = results.get(testCase.name)!;
        if (!result.applyOk) return;
        expect(checkPython(path.join(result.root, "functions"))).toEqual([]);
      });
    }
  });

  describe("C# standalone Functions compile with dotnet build", () => {
    const csharpCases = CASES.filter((testCase) => testCase.backend === "csharp" && !expectedBlock(testCase.auth, testCase.policy));
    const builds = new Map<string, string[]>();
    const skipDotnet = process.env.SWALLOWKIT_TEST_SKIP_DOTNET === "1";
    const itWithDotnet = toolchainGate(DOTNET, ".NET SDK", skipDotnet);

    beforeAll(async () => {
      if (!DOTNET || skipDotnet) return;
      const buildable = csharpCases.filter((testCase) => results.get(testCase.name)?.applyOk);
      const outputs = await mapWithConcurrency(buildable, Math.max(1, Math.min(4, os.cpus().length - 1)),
        (testCase) => dotnetBuild(path.join(results.get(testCase.name)!.root, "functions")));
      buildable.forEach((testCase, index) => builds.set(testCase.name, outputs[index]));
    }, 20 * 60 * 1000);

    for (const { name } of csharpCases) {
      itWithDotnet(name, () => {
        if (!results.get(name)?.applyOk) return; // reported by the scaffold assertion
        expect(builds.get(name)).toEqual([]);
      });
    }
  });
});
