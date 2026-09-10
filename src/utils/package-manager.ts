import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { BackendLanguage } from "../types";

/**
 * Supported package managers
 */
export type PackageManager = "npm" | "pnpm";

/**
 * Package manager command mappings
 */
export interface PackageManagerCommands {
  /** The binary name: "npm" or "pnpm" */
  name: PackageManager;
  /** Install all dependencies: "pnpm install" / "npm install" */
  install: string;
  /** Install with lockfile: "pnpm install --frozen-lockfile" / "npm ci" */
  ci: string;
  /** Add a dependency: "pnpm add" / "npm install" */
  add: string;
  /** Add a dev dependency: "pnpm add -D" / "npm install -D" */
  addDev: string;
  /** Add a global dependency: "pnpm add -g" / "npm install -g" */
  addGlobal: string;
  /** Execute a package binary: "pnpm exec" / "npx" */
  exec: string;
  /** Download & execute: "pnpm dlx" / "npx" */
  dlx: string;
  /** Run a script: "pnpm run" / "npm run" */
  run: string;
  /** Run a script with filter: "pnpm --filter <ws> run" / "npm run --workspace=<ws>" */
  runFilter: (workspace: string) => string;
  /** Start script: "pnpm start" / "npm start" */
  start: string;
  /** Install production only (in temp dir for CI): "pnpm install --prod" / "npm install --omit=dev" */
  installProd: string;
  /** create-next-app flag: "--use-pnpm" / "--use-npm" */
  createNextAppFlag: string | null;
}

/**
 * Get the full command mapping for the given package manager
 */
export function getCommands(pm: PackageManager): PackageManagerCommands {
  if (pm === "pnpm") {
    return {
      name: "pnpm",
      install: "pnpm install",
      ci: "pnpm install --frozen-lockfile",
      add: "pnpm add",
      addDev: "pnpm add -D",
      addGlobal: "pnpm add -g",
      exec: "pnpm exec",
      dlx: "pnpm dlx",
      run: "pnpm run",
      runFilter: (ws) => `pnpm --filter ${ws} run`,
      start: "pnpm start",
      installProd: "pnpm install --prod --no-frozen-lockfile",
      createNextAppFlag: "--use-pnpm",
    };
  }

  // npm
  return {
    name: "npm",
    install: "npm install",
    ci: "npm ci",
    add: "npm install",
    addDev: "npm install -D",
    addGlobal: "npm install -g",
    exec: "npx",
    dlx: "npx",
    run: "npm run",
    runFilter: (ws) => `npm run --workspace=${ws}`,
    start: "npm start",
    installProd: "npm install --omit=dev",
    createNextAppFlag: "--use-npm",
  };
}

/**
 * Detect the preferred package manager for new project initialisation.
 *
 * Honor the invoking package manager before falling back to available binaries.
 */
export function detectFromUserAgent(pnpmIsInstalled: () => boolean = isPnpmInstalled): PackageManager {
  const agent = process.env.npm_config_user_agent || "";
  if (agent.startsWith("pnpm/")) return "pnpm";
  if (agent.startsWith("npm/")) return "npm";
  return pnpmIsInstalled() ? "pnpm" : "npm";
}

/**
 * Check whether pnpm is available on the system PATH.
 */
function isPnpmInstalled(): boolean {
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the package manager used in an existing project directory
 * by checking for lockfiles.
 *
 * Priority: explicit project metadata > lockfiles > workspace config > invocation/binaries
 */
export function detectFromProject(projectDir?: string): PackageManager {
  const dir = projectDir || process.cwd();

  const manifestPath = path.join(dir, "package.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const manager = manifest.devEngines?.packageManager?.name || manifest.packageManager?.split("@")[0];
    if (manager === "npm" || manager === "pnpm") return manager;
  }

  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(dir, "package-lock.json"))) {
    return "npm";
  }

  // No lockfile found — fall back to user agent detection
  if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return "pnpm";
  return detectFromUserAgent();
}

/**
 * Get spawn arguments (command + args array) for the package manager.
 * Useful when calling spawn() directly.
 *
 * Examples:
 *   spawnArgs("pnpm", ["add", "next@latest"]) => { cmd: "pnpm", args: ["add", "next@latest"] }
 *   spawnArgs("npm", ["add", "next@latest"])   => { cmd: "npm", args: ["install", "next@latest"] }
 */
export function spawnArgs(
  pm: PackageManager,
  args: string[]
): { cmd: string; args: string[] } {
  return { cmd: pm, args };
}

/**
 * Workspace configuration helpers
 */
export function getWorkspaceConfig(pm: PackageManager, workspaces: string[]) {
  if (pm === "pnpm") {
    return {
      /** pnpm uses pnpm-workspace.yaml */
      type: "file" as const,
      filename: "pnpm-workspace.yaml",
      content: `packages:\n${workspaces.map((w) => `  - ${w}`).join("\n")}\nallowBuilds:\n  protobufjs: false\n  unrs-resolver: false\n`,
    };
  }

  // npm uses "workspaces" field in package.json
  return {
    type: "packageJson" as const,
    field: "workspaces",
    value: workspaces,
  };
}

/**
 * CI/CD setup step for GitHub Actions
 */
export function getCiSetupStep(pm: PackageManager): string {
  if (pm === "pnpm") {
    return `      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11`;
  }
  // npm: no extra setup needed (comes with Node.js)
  return "";
}

export function getCiInstallCommand(ciPm: PackageManager, projectPm: PackageManager = ciPm): string {
  void projectPm; // Reserved for package-manager-specific CI bridging.
  if (ciPm === "pnpm") {
    return getCommands(ciPm).ci;
  }
  return getCommands(ciPm).ci;
}

export function getSwaAppBuildCommand(ciPm: PackageManager, projectPm: PackageManager = ciPm): string {
  if (ciPm === "pnpm") {
    return "pnpm install --frozen-lockfile && pnpm run build";
  }
  return `${getCiInstallCommand(ciPm, projectPm)} && npm run build`;
}

/**
 * CI/CD setup steps for Azure Pipelines
 */
export function getAzurePipelinesSetup(pm: PackageManager): string {
  if (pm === "pnpm") {
    return `  - script: |
      corepack enable
      corepack prepare pnpm@11 --activate
    displayName: 'Setup pnpm'`;
  }
  // npm: no extra step needed
  return "";
}

/**
 * Build script for generated package.json (depends on workspace command syntax)
 */
export function getBuildScript(pm: PackageManager): string {
  const copyStandaloneAssets = `node -e "const fs=require('fs');fs.mkdirSync('.next/standalone/.next',{recursive:true});if(fs.existsSync('.next/static'))fs.cpSync('.next/static','.next/standalone/.next/static',{recursive:true});if(fs.existsSync('public'))fs.cpSync('public','.next/standalone/public',{recursive:true});"`;

  if (pm === "pnpm") {
    return `pnpm --filter shared run build && next build --webpack && ${copyStandaloneAssets}`;
  }
  return `npm run --workspace=shared build && next build --webpack && ${copyStandaloneAssets}`;
}

/**
 * Functions prestart script
 */
export function getFunctionsPrestart(pm: PackageManager): string {
  if (pm === "pnpm") {
    return "pnpm run build";
  }
  return "npm run build";
}

/**
 * Functions:start script for root package.json
 */
export function getFunctionsStartScript(
  pm: PackageManager,
  backendLanguage: BackendLanguage = "typescript"
): string {
  if (backendLanguage === "typescript") {
    if (pm === "pnpm") {
      return "cd functions && pnpm start";
    }
    return "cd functions && npm start";
  }

  return "cd functions && func start";
}
