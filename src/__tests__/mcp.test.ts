import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { buildSwallowKitToolDefinitions } from "../mcp";

type MachineCliRunner = NonNullable<Parameters<typeof buildSwallowKitToolDefinitions>[0]>;
const builtMcpEntrypoint = path.resolve(__dirname, "..", "..", "dist", "mcp", "index.js");
const itWhenBuiltEntrypointExists = fs.existsSync(builtMcpEntrypoint) ? it : it.skip;

describe("SwallowKit MCP tool definitions", () => {
  it("preserves blocked auth prerequisites and nextActions as structured MCP errors", async () => {
    const nextActions = [{ command: "swallowkit machine plan auth --provider swa", description: "Configure auth first." }];
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({ ok: false, command: "plan-scaffold", status: "blocked",
        error: { code: "auth-policy-without-auth", message: "Authentication is not configured." }, nextActions }),
      stderr: "", exitCode: 1,
    }));
    const tool = buildSwallowKitToolDefinitions(runner).find(candidate => candidate.name === "swallowkit_plan_scaffold")!;
    const result = await tool.handler({ model: "probe-item" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: "blocked", error: { code: "auth-policy-without-auth" }, nextActions,
      metadata: { swallowkitVersion: expect.any(String) },
    });
  });
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
      metadata: {
        swallowkitVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
        mcp: expect.objectContaining({ selection: "running-version", delegated: false }),
      },
    });
  });

  it("reports delegation, the serving version, and version warnings on every tool", async () => {
    const runner = jest.fn(async () => ({
      stdout: JSON.stringify({ ok: true, command: "inspect-entities", data: { entities: [] } }),
      stderr: "",
      exitCode: 0,
    }));
    const context = {
      mcpVersion: "2.0.0-alpha.3",
      requestedVersion: "latest",
      projectVersion: "2.0.0-alpha.4",
      selection: "project-version" as const,
      delegated: true,
      delegatedFrom: "1.1.2",
      warnings: ["mcp-older-than-project: example"],
      nextActions: [{ command: "pnpm exec swallowkit configure-mcp", description: "Re-select." }],
    };
    const tools = buildSwallowKitToolDefinitions(runner as MachineCliRunner, context);
    for (const name of ["swallowkit_inspect_entities", "swallowkit_inspect_capabilities", "swallowkit_inspect_boundaries"]) {
      const parsed = JSON.parse((await tools.find((tool) => tool.name === name)!.handler({})).content[0].text);
      expect(parsed.metadata).toEqual({
        swallowkitVersion: "2.0.0-alpha.3",
        mcp: {
          version: "2.0.0-alpha.3",
          requestedVersion: "latest",
          projectVersion: "2.0.0-alpha.4",
          selection: "project-version",
          delegated: true,
          delegatedFrom: "1.1.2",
        },
        warnings: ["mcp-older-than-project: example"],
      });
      expect(parsed.nextActions).toEqual(context.nextActions);
    }
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
      metadata: expect.objectContaining({ swallowkitVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) }),
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
    expect(JSON.parse(result.content[0].text)).toEqual({
      createdFiles: ["functions/src/todo.ts"],
      metadata: expect.objectContaining({ swallowkitVersion: expect.any(String) }),
    });
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
    await tool!.handler({ model: "todo", skipInfra: true });
    expect(runner).toHaveBeenLastCalledWith(["plan", "scaffold", "todo", "--skip-infra"]);
    const applyTool = buildSwallowKitToolDefinitions(runner as MachineCliRunner).find((candidate) => candidate.name === "swallowkit_apply_scaffold");
    await applyTool!.handler({ model: "todo", skipInfra: true });
    expect(runner).toHaveBeenLastCalledWith(["apply", "scaffold", "todo", "--skip-infra"]);
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
