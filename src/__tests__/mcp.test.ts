import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { buildSwallowKitToolDefinitions } from "../mcp";

type MachineCliRunner = NonNullable<Parameters<typeof buildSwallowKitToolDefinitions>[0]>;
const builtMcpEntrypoint = path.resolve(__dirname, "..", "..", "dist", "mcp", "index.js");
const itWhenBuiltEntrypointExists = fs.existsSync(builtMcpEntrypoint) ? it : it.skip;

describe("SwallowKit MCP tool definitions", () => {
  it("delegates inspect_project to the machine CLI", async () => {
    const runner = jest.fn(async (_args: Parameters<MachineCliRunner>[0]) => ({
      stdout: JSON.stringify({
        ok: true,
        command: "inspect-project",
        data: { manifestSource: "file" },
      }),
      stderr: "",
      exitCode: 0,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find((candidate) => candidate.name === "swallowkit_inspect_project");
    expect(tool).toBeDefined();

    const result = await tool!.handler({});
    expect(runner).toHaveBeenCalledWith(["inspect", "project"]);
    expect(JSON.parse(result.content[0].text)).toEqual({
      manifestSource: "file",
      metadata: { swallowkitVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) },
    });
  });

  it("includes the MCP version in validate_project metadata", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({ ok: true, command: "validate-project", data: { valid: true } }),
      stderr: "",
      exitCode: 0,
    }));
    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find(
      (candidate) => candidate.name === "swallowkit_validate_project"
    );

    const result = await tool!.handler({});
    expect(JSON.parse(result.content[0].text)).toEqual({
      valid: true,
      metadata: { swallowkitVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) },
    });
  });

  it("delegates scaffold_model with explicit args", async () => {
    const runner = jest.fn(async (_args: Parameters<MachineCliRunner>[0]) => ({
      stdout: JSON.stringify({
        ok: true,
        command: "generate-scaffold",
        data: { createdFiles: ["functions/src/todo.ts"] },
      }),
      stderr: "",
      exitCode: 0,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find((candidate) => candidate.name === "swallowkit_scaffold_model");
    expect(tool).toBeDefined();

    const result = await tool!.handler({
      model: "todo",
      functionsDir: "functions",
      apiDir: "app/api",
      apiOnly: true,
    });

    expect(runner).toHaveBeenCalledWith([
      "generate",
      "scaffold",
      "todo",
      "--functions-dir",
      "functions",
      "--api-dir",
      "app/api",
      "--api-only",
    ]);
    expect(JSON.parse(result.content[0].text)).toEqual({ createdFiles: ["functions/src/todo.ts"] });
  });

  itWhenBuiltEntrypointExists("keeps the built MCP entrypoint alive long enough to complete the handshake", async () => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [builtMcpEntrypoint], {
        cwd: path.resolve(__dirname, "..", ".."),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let settled = false;
      let expectedShutdown = false;
      let stderr = "";

      const finishResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const finishReject = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const timer = setTimeout(() => {
        expectedShutdown = true;
        child.kill();
      }, 1000);

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        finishReject(error);
      });

      child.on("close", (code, signal) => {
        clearTimeout(timer);

        if (expectedShutdown) {
          expect(stderr).toMatch(/\[swallowkit-mcp\] version: \d+\.\d+\.\d+/);
          finishResolve();
          return;
        }

        finishReject(
          new Error(
            `Built MCP entrypoint exited early with code ${code ?? "null"} and signal ${signal ?? "null"}${stderr ? `: ${stderr}` : ""}`
          )
        );
      });
    });
  });

  itWhenBuiltEntrypointExists("preserves a runtime dynamic execa import in the built MCP entrypoint", () => {
    const source = fs.readFileSync(builtMcpEntrypoint, "utf8");
    expect(source).toContain('new Function("specifier", "return import(specifier);")');
    expect(source).not.toContain('require("execa")');
  });
});
