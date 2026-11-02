import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";
import { initCommand } from "../cli/commands/init";
import { buildAgentsMd } from "../core/project/agent-instructions";
import { generateDetailPage, generateEditPage } from "../core/scaffold/ui-generator";
import { createBasicModelInfo } from "./fixtures";

jest.mock("child_process", () => ({
  ...jest.requireActual<typeof import("child_process")>("child_process"),
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

describe("init persistence instructions", () => {
  const cwd = process.cwd();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(cwd, ".init-instructions-test-"));
    process.chdir(root);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("Unexpected init failure"); });
    jest.mocked(childProcess.execSync).mockReturnValue("main\n");
    const spawn = jest.mocked(childProcess.spawn as (
      file: string, args: readonly string[]
    ) => childProcess.ChildProcess);
    spawn.mockImplementation((_file, args = []) => {
      if (args.includes("create-next-app") || args.includes("create-next-app@latest")) {
        const project = path.join(root, "fictional-app");
        fs.mkdirSync(path.join(project, "app"), { recursive: true });
        fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "fictional-app", scripts: {}, dependencies: {} }));
        fs.writeFileSync(path.join(project, "next.config.ts"), "const nextConfig = { cacheComponents: true };\nexport default nextConfig;\n");
        fs.writeFileSync(path.join(project, "tsconfig.json"), '{"compilerOptions":{}}');
      }
      const child = new childProcess.ChildProcess();
      process.nextTick(() => child.emit("close", 0));
      return child;
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    { backendLanguage: "typescript", packageManager: "npm" },
    { backendLanguage: "typescript", packageManager: "pnpm" },
    { backendLanguage: "csharp", packageManager: "npm" },
    { backendLanguage: "csharp", packageManager: "pnpm" },
    { backendLanguage: "python", packageManager: "npm" },
    { backendLanguage: "python", packageManager: "pnpm" },
  ] as const)("writes runtime guidance through actual init using $backendLanguage and $packageManager, with subprocesses mocked", async ({ backendLanguage, packageManager }) => {
    await initCommand({
      name: "fictional-app", template: "default", cicd: "skip", backendLanguage,
      cosmosDbMode: "serverless", vnet: "none", swaPlan: "free", packageManager,
    });
    const project = path.join(root, "fictional-app");
    const home = fs.readFileSync(path.join(project, "app", "page.tsx"), "utf-8");
    expect(home).toMatch(/^'use client'/);
    expect(home).not.toMatch(/export const (dynamic|revalidate|fetchCache)\b/);
    expect(home).toContain("useState");
    expect(home).toContain("fetch('/api/greet?name=SwallowKit')");
    expect(home).toContain("onClick={testConnection}");
    expect(home).toContain("scaffoldConfig.models.map");
    const config = fs.readFileSync(path.join(project, "next.config.ts"), "utf-8");
    expect(config).toContain("cacheComponents: true");
    expect(config).toContain("output: 'standalone'");
    const model = createBasicModelInfo();
    for (const [route, code, content] of [
      [path.join("app", "todo", "[id]", "page.tsx"), generateDetailPage(model, "@fictional-app/shared"), "TodoDetailContent"],
      [path.join("app", "todo", "[id]", "edit", "page.tsx"), generateEditPage(model, "@fictional-app/shared"), "EditTodoContent"],
    ]) {
      const file = path.join(project, route);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, code);
      const generated = fs.readFileSync(file, "utf-8");
      expect(generated).toContain(`<${content} />`);
      expect(generated).toContain("<Suspense fallback=");
      expect(generated.slice(0, generated.indexOf(`function ${content}`))).not.toContain("useParams()");
      expect(generated).not.toMatch(/export const (dynamic|revalidate|fetchCache|instant)\b/);
    }
    expect(fs.readFileSync(path.join(project, "next.config.ts"), "utf-8")).toContain("cacheComponents: true");
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf-8");
    expect(agents).toBe(buildAgentsMd({ projectName: "fictional-app", backendLanguage, packageManager }));
    expect(agents).toContain("**whether or not it uses custom APIs**");
    expect(agents).toContain(".swallowkit/artifacts.json");
    expect(agents).toContain("Never describe a project as deployable");
    expect(agents).toContain(backendLanguage === "typescript" ? "TypeScript" : backendLanguage === "csharp" ? "C#" : "Python");
    expect(agents).toContain("Production persistent application data uses the configured Azure Cosmos DB");
    expect(agents).toContain("Local development uses the Cosmos DB Emulator");
    expect(agents).toContain("Never mask the problem with file, JSON, SQLite,");
    expect(agents).toContain("in-memory application storage or a fallback");
    expect(agents).toContain("dev-seeds/<environment>/<model-kebab-case>.json");
    expect(agents).toContain("learning-profile.json");
    expect(agents).toContain("top-level JSON array");
    expect(agents).toContain("same-origin Next.js BFF");
    expect(agents).toContain("restarting without re-seeding");
    expect(agents).toContain("configured external");
    expect(agents).toContain(packageManager === "npm" ? "npx swallowkit machine ..." : "pnpm exec swallowkit machine ...");
    for (const file of [
      path.join(".swallowkit", "workflows", "add-model.md"),
      path.join(".github", "skills", "swallowkit-add-model", "SKILL.md"),
      path.join(".github", "instructions", "shared-models.instructions.md"),
    ]) {
      const content = fs.readFileSync(path.join(project, file), "utf-8");
      expect(content).toContain("even when all APIs are custom");
      expect(content).toContain(".swallowkit/artifacts.json");
    }
    for (const file of ["CLAUDE.md", path.join(".github", "copilot-instructions.md")]) {
      expect(fs.readFileSync(path.join(project, file), "utf-8")).toContain("root `AGENTS.md`");
    }
  });
});
