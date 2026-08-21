import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { buildSwallowKitToolDefinitions } from "../mcp";

type MachineCliRunner = NonNullable<Parameters<typeof buildSwallowKitToolDefinitions>[0]>;
const builtMcpEntrypoint = path.resolve(__dirname, "..", "..", "dist", "mcp", "index.js");
const itWhenBuiltEntrypointExists = fs.existsSync(builtMcpEntrypoint) ? it : it.skip;

describe("SwallowKit MCP tool definitions", () => {
  it("delegates inspect_project to the machine CLI", async () => {
    const runner = jest.fn(async () => ({
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
    const runner = jest.fn(async () => ({
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

  it("exposes the agent-loop tools (plan/apply/artifacts/drift/verify/explain)", () => {
    const names = buildSwallowKitToolDefinitions(jest.fn() as unknown as MachineCliRunner).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "swallowkit_plan_scaffold",
        "swallowkit_apply_scaffold",
        "swallowkit_inspect_artifacts",
        "swallowkit_inspect_drift",
        "swallowkit_verify_project",
        "swallowkit_explain_failure",
      ])
    );
  });

  it("delegates plan_scaffold and passes through status and nextActions", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        command: "plan-scaffold",
        status: "requires-human",
        nextActions: [{ command: "swallowkit machine apply scaffold --plan abc --approve", description: "Apply." }],
        data: { planId: "abc", requiresApproval: true, operations: [] },
      }),
      stderr: "",
      exitCode: 0,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find(
      (candidate) => candidate.name === "swallowkit_plan_scaffold"
    );
    const result = await tool!.handler({ model: "todo", apiOnly: true });

    expect(runner).toHaveBeenCalledWith(["plan", "scaffold", "todo", "--api-only"]);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("requires-human");
    expect(parsed.planId).toBe("abc");
    expect(parsed.nextActions).toHaveLength(1);
  });

  it("delegates apply_scaffold with plan and approve flags", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        command: "apply-scaffold",
        status: "complete",
        data: { createdFiles: [] },
      }),
      stderr: "",
      exitCode: 0,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find(
      (candidate) => candidate.name === "swallowkit_apply_scaffold"
    );
    await tool!.handler({ planId: "abc", approve: true });

    expect(runner).toHaveBeenCalledWith(["apply", "scaffold", "--plan", "abc", "--approve"]);
  });

  it("surfaces machine error code, status, and details to the agent", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({
        ok: false,
        command: "apply-scaffold",
        status: "blocked",
        error: {
          code: "stale-plan",
          message: "Plan is stale.",
          details: { changedFiles: ["shared/models/todo.ts"] },
        },
      }),
      stderr: "",
      exitCode: 1,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find(
      (candidate) => candidate.name === "swallowkit_apply_scaffold"
    );

    await expect(tool!.handler({ planId: "abc" })).rejects.toThrow(
      /\[stale-plan\] Plan is stale\. \(status: blocked\)[\s\S]*changedFiles/
    );
  });

  it("delegates verify_project with selected checks", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({
        ok: true,
        command: "verify-project",
        status: "complete",
        data: { summary: { done: true } },
      }),
      stderr: "",
      exitCode: 0,
    }));

    const tool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find(
      (candidate) => candidate.name === "swallowkit_verify_project"
    );
    await tool!.handler({ checks: ["structure", "drift"] });

    expect(runner).toHaveBeenCalledWith(["verify", "project", "--checks", "structure,drift"]);
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

      let timer: NodeJS.Timeout | undefined;

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        // Start the aliveness window once the entrypoint has actually booted.
        if (!timer && /\[swallowkit-mcp\] version: /.test(stderr)) {
          timer = setTimeout(() => {
            expectedShutdown = true;
            child.kill();
          }, 1000);
        }
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
  }, 20000);

  itWhenBuiltEntrypointExists("preserves a runtime dynamic execa import in the built MCP entrypoint", () => {
    const source = fs.readFileSync(builtMcpEntrypoint, "utf8");
    expect(source).toContain('new Function("specifier", "return import(specifier);")');
    expect(source).not.toContain('require("execa")');
  });
});
