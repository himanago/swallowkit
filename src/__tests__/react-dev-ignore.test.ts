import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { spawn, spawnSync } from "child_process";
import ts from "typescript";
import { createReactDevConfig } from "../utils/react-dev";

const repoRoot = process.cwd();
interface ReadyMessage {
  directory: string;
  configPath: string;
  port: number;
  marker: string;
  ignored: string[];
  usePolling: boolean;
}

describe("React dev temporary config Git exclusion", () => {
  let root: string;

  function write(file: string, content: string): void {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }

  function git(...args: string[]) {
    return spawnSync("git", args, { cwd: root, encoding: "utf-8", shell: false });
  }

  function expectIgnored(configPath: string): void {
    const relative = path.relative(root, configPath);
    expect(git("check-ignore", "--no-index", relative).status).toBe(0);
    const status = git("status", "--short", "--untracked-files=all");
    expect(status.status).toBe(0);
    expect(status.stdout).not.toContain(relative.replace(/\\/g, "/"));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(repoRoot, ".swallowkit-dev ignore-"));
    expect(git("init", "--quiet").status).toBe(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(["new", "existing"])("ignores live and abandoned wrappers in a %s project without hiding shared metadata", (kind) => {
    if (kind === "existing") {
      write(".gitignore", "/node_modules/\n/custom-cache/\n");
      write(".swallowkit/.gitignore", "# User local rules\r\n/user-cache/\r\n/vite-dev-*/\r\n!vite-dev-keep/\r\n");
    }
    write(".swallowkit/vite-dev-legacy/config.mjs", "// Could still be in use\n");
    write(".swallowkit/artifacts.json", "{}\n");
    write(".swallowkit/project.json", "{}\n");
    write(".swallowkit/workflows/verify.md", "shared workflow\n");
    const rootIgnore = fs.existsSync(path.join(root, ".gitignore"))
      ? fs.readFileSync(path.join(root, ".gitignore"), "utf-8") : null;
    const first = createReactDevConfig(root);
    const ignore = fs.readFileSync(path.join(root, ".swallowkit", ".gitignore"), "utf-8");
    expectIgnored(first.configPath);
    expectIgnored(path.join(root, ".swallowkit", "vite-dev-legacy", "config.mjs"));
    for (const file of [".swallowkit/artifacts.json", ".swallowkit/project.json", ".swallowkit/workflows/verify.md"]) {
      expect(git("check-ignore", "--no-index", file).status).toBe(1);
      expect(git("status", "--short", "--untracked-files=all").stdout).toContain(file);
    }
    // Leave the first wrapper behind to represent an exit without cleanup.
    const second = createReactDevConfig(root);
    expect(fs.readFileSync(path.join(root, ".swallowkit", ".gitignore"), "utf-8")).toBe(ignore);
    expect(ignore.split(/\r?\n/).filter((line) => line === "/vite-dev-*/")).toHaveLength(1);
    if (kind === "existing") {
      expect(ignore).toContain("# User local rules\r\n/user-cache/\r\n");
      expect(ignore).toContain("!vite-dev-keep/\r\n");
      expect(fs.readFileSync(path.join(root, ".gitignore"), "utf-8")).toBe(rootIgnore);
    }
    expectIgnored(first.configPath);
    expectIgnored(second.configPath);
    second.cleanup();
    expect(fs.existsSync(second.directory)).toBe(false);
    expect(fs.existsSync(first.configPath)).toBe(true);
    expect(fs.existsSync(path.join(root, ".swallowkit", "vite-dev-legacy", "config.mjs"))).toBe(true);
  });

  it("reports the exact ignore failure before creating a temporary directory", () => {
    fs.mkdirSync(path.join(root, ".swallowkit", ".gitignore"), { recursive: true });
    expect(() => createReactDevConfig(root)).toThrow(/Cannot guarantee Git exclusion.*\.gitignore/);
    expect(fs.readdirSync(path.join(root, ".swallowkit"))).toEqual([".gitignore"]);
  });

  it("fails explicitly if writing the ignore rule is denied", () => {
    const writeFile = fs.writeFileSync;
    jest.spyOn(jest.requireActual<typeof fs>("fs"), "writeFileSync").mockImplementation((file, data, options) => {
      if (String(file).endsWith(".gitignore")) throw new Error("EACCES fixture");
      return writeFile(file, data, options);
    });
    expect(() => createReactDevConfig(root)).toThrow(/Cannot guarantee Git exclusion.*\.gitignore.*EACCES fixture/);
    expect(fs.readdirSync(path.join(root, ".swallowkit"))).toEqual([]);
  });

  it("starts real Vite with project dependencies and merged config, then cleans only its own wrapper on exit", async () => {
    write(".gitignore", "/node_modules/\n");
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "junction");
    write("index.html", "<html><body>React dev ignore smoke</body></html>");
    write("vite-settings.mjs", "export const marker = 'project-config-loaded';\n");
    write("vite.config.mjs", `import { defineConfig } from 'vite';
import { marker } from './vite-settings.mjs';
export default defineConfig({ define: { __MARKER__: JSON.stringify(marker) }, server: { watch: { ignored: ['**/custom/**'], usePolling: true } } });
`);
    write(".swallowkit/vite-dev-old/config.mjs", "// another run\n");
    const helperSource = fs.readFileSync(path.join(repoRoot, "src", "utils", "react-dev.ts"), "utf-8");
    write("react-dev.cjs", ts.transpileModule(helperSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
    const child = spawn(process.execPath, ["-e", `
      const { createReactDevConfig } = require('./react-dev.cjs');
      (async () => {
        const temporary = createReactDevConfig(process.cwd());
        process.once('exit', temporary.cleanup);
        const { createServer } = await import('vite');
        const server = await createServer({ configFile: temporary.configPath, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
        await server.listen();
        process.send({ directory: temporary.directory, configPath: temporary.configPath, port: server.httpServer.address().port,
          marker: server.config.define.__MARKER__, ignored: server.config.server.watch.ignored, usePolling: server.config.server.watch.usePolling });
        process.once('message', async () => { await server.close(); process.disconnect(); });
      })().catch(error => { console.error(error); process.exit(1); });
    `], { cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"], shell: false });
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    try {
      const ready = await new Promise<ReadyMessage>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Vite startup timed out: ${stderr}`)), 20_000);
        child.once("message", (message) => { clearTimeout(timeout); resolve(message as ReadyMessage); });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${stderr}`)); });
      });
      expectIgnored(ready.configPath);
      expect(ready.marker).toBe('"project-config-loaded"');
      expect(ready.ignored).toContain("**/custom/**");
      expect(ready.ignored).toContain(`${root.replace(/\\/g, "/")}/functions/**`);
      expect(ready.usePolling).toBe(true);
      const content = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${ready.port}/`, (response) => {
          let body = "";
          response.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          response.on("end", () => resolve(body));
        }).on("error", reject);
      });
      expect(content).toContain("React dev ignore smoke");
      child.send("stop");
      expect(await exited).toBe(0);
      expect(fs.existsSync(ready.directory)).toBe(false);
      expect(fs.existsSync(path.join(root, ".swallowkit", "vite-dev-old", "config.mjs"))).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    }
  }, 30_000);
});
