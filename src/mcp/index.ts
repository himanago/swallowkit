#!/usr/bin/env node

import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import type { MachineResponse } from "../machine/contracts";

interface MachineSuccessPayload<TData> {
  ok: true;
  command: string;
  data: TData;
}

type MachineCliRunner = (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
type ToolContentResult = { content: Array<{ type: "text"; text: string }> };
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: any) => Promise<ToolContentResult>;
};

function resolveMachineCliEntrypoint(): string {
  return path.resolve(__dirname, "..", "cli", "index.js");
}

async function defaultMachineCliRunner(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execa } = await import("execa");
  const result = await execa(process.execPath, [resolveMachineCliEntrypoint(), "machine", ...args], {
    reject: false,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

async function executeMachineCommand<TData>(
  args: string[],
  runMachineCli: MachineCliRunner
): Promise<MachineSuccessPayload<TData>> {
  const result = await runMachineCli(args);

  let parsed: MachineResponse<TData>;
  try {
    parsed = JSON.parse(result.stdout) as MachineResponse<TData>;
  } catch {
    throw new Error(result.stderr || result.stdout || "Machine CLI returned invalid JSON.");
  }

  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }

  return parsed;
}

function jsonTextContent(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function buildSwallowKitToolDefinitions(
  runMachineCli: MachineCliRunner = defaultMachineCliRunner
): ToolDefinition[] {
  return [
    {
      name: "swallowkit_inspect_project",
      description: "Return framework-owned SwallowKit project metadata.",
      inputSchema: z.object({}),
      handler: async () => {
      const response = await executeMachineCommand(["inspect", "project"], runMachineCli);
      return jsonTextContent(response.data);
      },
    },
    {
      name: "swallowkit_inspect_entities",
      description: "Return SwallowKit entities, schema metadata, and connector/auth annotations.",
      inputSchema: z.object({}),
      handler: async () => {
      const response = await executeMachineCommand(["inspect", "entities"], runMachineCli);
      return jsonTextContent(response.data);
      },
    },
    {
      name: "swallowkit_inspect_routes",
      description: "Return BFF and Functions route metadata understood by SwallowKit.",
      inputSchema: z.object({}),
      handler: async () => {
      const response = await executeMachineCommand(["inspect", "routes"], runMachineCli);
      return jsonTextContent(response.data);
      },
    },
    {
      name: "swallowkit_validate_project",
      description: "Validate project metadata, generated artifacts, and framework conventions.",
      inputSchema: z.object({}),
      handler: async () => {
      const response = await executeMachineCommand(["validate", "project"], runMachineCli);
      return jsonTextContent(response.data);
      },
    },
    {
      name: "swallowkit_generate_model",
      description: "Generate SwallowKit model templates through the official generator.",
      inputSchema: z.object({
        names: z.array(z.string()).min(1),
        modelsDir: z.string().optional(),
        connector: z.string().optional(),
        overwrite: z.enum(["always", "never"]).optional(),
      }),
      handler: async ({ names, modelsDir, connector, overwrite }: { names: string[]; modelsDir?: string; connector?: string; overwrite?: "always" | "never" }) => {
      const response = await executeMachineCommand(["generate", "model", ...names, ...(modelsDir ? ["--models-dir", modelsDir] : []), ...(connector ? ["--connector", connector] : []), "--overwrite", overwrite || "never"], runMachineCli);
      return jsonTextContent(response.data);
      },
    },
    {
      name: "swallowkit_scaffold_model",
      description: "Generate SwallowKit scaffold artifacts through the official generator.",
      inputSchema: z.object({
        model: z.string(),
        functionsDir: z.string().optional(),
        apiDir: z.string().optional(),
        apiOnly: z.boolean().optional(),
      }),
      handler: async ({ model, functionsDir, apiDir, apiOnly }: { model: string; functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
      const args = ["generate", "scaffold", model];
      if (functionsDir) {
        args.push("--functions-dir", functionsDir);
      }
      if (apiDir) {
        args.push("--api-dir", apiDir);
      }
      if (apiOnly) {
        args.push("--api-only");
      }

      const response = await executeMachineCommand(args, runMachineCli);
      return jsonTextContent(response.data);
      },
    },
  ];
}

export function createSwallowKitMcpServer(runMachineCli: MachineCliRunner = defaultMachineCliRunner): McpServer {
  const server = new McpServer({
    name: "swallowkit-mcp",
    version: process.env.npm_package_version || "0.0.0",
  });

  for (const tool of buildSwallowKitToolDefinitions(runMachineCli)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      tool.handler
    );
  }

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createSwallowKitMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  void runMcpServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
