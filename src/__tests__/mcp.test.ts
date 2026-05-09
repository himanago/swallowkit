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
});
