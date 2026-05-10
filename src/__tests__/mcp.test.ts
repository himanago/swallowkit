import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { buildSwallowKitToolDefinitions } from "../mcp";

describe("SwallowKit MCP tool definitions", () => {
  it("delegates inspect_project to the machine CLI", async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        command: "inspect-project",
        data: { manifestSource: "file" },
      }),
      stderr: "",
      exitCode: 0,
    });

    const tool = buildSwallowKitToolDefinitions(runner).find((candidate) => candidate.name === "swallowkit_inspect_project");
    expect(tool).toBeDefined();

    const result = await tool!.handler({});
    expect(runner).toHaveBeenCalledWith(["inspect", "project"]);
    expect(JSON.parse(result.content[0].text)).toEqual({ manifestSource: "file" });
  });

  it("delegates scaffold_model with explicit args", async () => {
    const runner = jest.fn().mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        command: "generate-scaffold",
        data: { createdFiles: ["functions/src/todo.ts"] },
      }),
      stderr: "",
      exitCode: 0,
    });

    const tool = buildSwallowKitToolDefinitions(runner).find((candidate) => candidate.name === "swallowkit_scaffold_model");
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

  it("keeps the built MCP entrypoint alive long enough to complete the handshake", async () => {
    const entrypoint = path.resolve(__dirname, "..", "..", "dist", "mcp", "index.js");
    expect(fs.existsSync(entrypoint)).toBe(true);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [entrypoint], {
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
});
