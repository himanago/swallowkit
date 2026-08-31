#!/usr/bin/env node

import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import type { MachineNextAction, MachineOperationStatus, MachineResponse } from "../machine/contracts";
import { getSwallowKitVersion } from "../version";

interface MachineSuccessPayload<TData> {
  ok: true;
  command: string;
  status?: MachineOperationStatus;
  nextActions?: MachineNextAction[];
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
type ExecaModule = typeof import("execa");

// Keep this as a runtime dynamic import so CommonJS builds do not rewrite it to require().
const importModule = new Function("specifier", "return import(specifier);") as (
  specifier: string
) => Promise<ExecaModule>;

function resolveMachineCliEntrypoint(): string {
  return path.resolve(__dirname, "..", "cli", "index.js");
}

async function defaultMachineCliRunner(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execa } = await importModule("execa");
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
    const detailsSuffix =
      parsed.error.details !== undefined ? `\ndetails: ${JSON.stringify(parsed.error.details)}` : "";
    const statusSuffix = parsed.status ? ` (status: ${parsed.status})` : "";
    throw new Error(`[${parsed.error.code}] ${parsed.error.message}${statusSuffix}${detailsSuffix}`);
  }

  return parsed;
}

function withOperationStatus<TData>(response: MachineSuccessPayload<TData>): Record<string, unknown> {
  const data = response.data && typeof response.data === "object"
    ? (response.data as Record<string, unknown>)
    : { data: response.data };
  return {
    status: response.status ?? "complete",
    ...(response.nextActions && response.nextActions.length > 0 ? { nextActions: response.nextActions } : {}),
    ...data,
  };
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

function withSwallowKitMetadata<TData>(data: TData): TData & { metadata: Record<string, unknown> } {
  const value = data && typeof data === "object" ? data as Record<string, unknown> : { data };
  const metadata = value.metadata && typeof value.metadata === "object"
    ? value.metadata as Record<string, unknown>
    : {};

  return {
    ...value,
    metadata: {
      ...metadata,
      swallowkitVersion: getSwallowKitVersion(),
    },
  } as TData & { metadata: Record<string, unknown> };
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
      return jsonTextContent(withSwallowKitMetadata(response.data));
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
      return jsonTextContent(withSwallowKitMetadata(response.data));
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
    {
      name: "swallowkit_plan_scaffold",
      description: "Compute the scaffold change plan (files to create/update/overwrite, conflicts, warnings) without writing any files. Accepts one or more models; returns a planId per model usable with swallowkit_apply_scaffold.",
      inputSchema: z.object({
        model: z.string().optional(),
        models: z.array(z.string()).optional(),
        functionsDir: z.string().optional(),
        apiDir: z.string().optional(),
        apiOnly: z.boolean().optional(),
      }),
      handler: async ({ model, models, functionsDir, apiDir, apiOnly }: { model?: string; models?: string[]; functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
        const targets = models && models.length > 0 ? models : model ? [model] : [];
        if (targets.length === 0) throw new Error("Provide model or models.");
        const args = ["plan", "scaffold", ...targets];
        if (functionsDir) args.push("--functions-dir", functionsDir);
        if (apiDir) args.push("--api-dir", apiDir);
        if (apiOnly) args.push("--api-only");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_apply_scaffold",
      description: "Apply scaffold changes. Rejects stale plans (files changed after planning) and requires approve=true when user-modified files would be overwritten.",
      inputSchema: z.object({
        model: z.string().optional(),
        planId: z.string().optional(),
        approve: z.boolean().optional(),
        functionsDir: z.string().optional(),
        apiDir: z.string().optional(),
        apiOnly: z.boolean().optional(),
      }),
      handler: async ({ model, planId, approve, functionsDir, apiDir, apiOnly }: { model?: string; planId?: string; approve?: boolean; functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
        const args = ["apply", "scaffold"];
        if (model) args.push(model);
        if (planId) args.push("--plan", planId);
        if (approve) args.push("--approve");
        if (functionsDir) args.push("--functions-dir", functionsDir);
        if (apiDir) args.push("--api-dir", apiDir);
        if (apiOnly) args.push("--api-only");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_inspect_artifacts",
      description: "Return the generated-artifact ledger with ownership, source model, and modified/missing flags.",
      inputSchema: z.object({}),
      handler: async () => {
        const response = await executeMachineCommand(["inspect", "artifacts"], runMachineCli);
        return jsonTextContent(withSwallowKitMetadata(response.data));
      },
    },
    {
      name: "swallowkit_inspect_drift",
      description: "Detect drift between generated artifacts and the current project state (schema changes, manual edits, missing files, manifest mismatch). Each finding includes a repairAction.",
      inputSchema: z.object({}),
      handler: async () => {
        const response = await executeMachineCommand(["inspect", "drift"], runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_verify_project",
      description: "Run verification checks (structure, drift, typecheck by default; build, lint, test and custom checks from swallowkit.config verify.checks are also available) and return machine-readable evidence. summary.done=true means the project passed all checks. Set compact=true to suppress info-severity findings and keep the output small.",
      inputSchema: z.object({
        checks: z.array(z.string()).optional(),
        compact: z.boolean().optional(),
      }),
      handler: async ({ checks, compact }: { checks?: string[]; compact?: boolean }) => {
        const args = ["verify", "project"];
        if (checks && checks.length > 0) {
          args.push("--checks", checks.join(","));
        }
        if (compact) args.push("--compact");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_explain_failure",
      description: "Explain failures from the most recent swallowkit_verify_project run, including evidence and suggested actions.",
      inputSchema: z.object({
        check: z.string().optional(),
      }),
      handler: async ({ check }: { check?: string }) => {
        const args = ["explain", "failure"];
        if (check) {
          args.push("--check", check);
        }

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_inspect_boundaries",
      description: "Return the responsibility boundary contract: which paths are deterministic (regenerate via plan/apply), which are AI/human-authored (free edit), and which are shared extension points.",
      inputSchema: z.object({}),
      handler: async () => {
        const response = await executeMachineCommand(["inspect", "boundaries"], runMachineCli);
        return jsonTextContent(withSwallowKitMetadata(response.data));
      },
    },
    {
      name: "swallowkit_inspect_capabilities",
      description: "Return SwallowKit's capability contract: which declarations models support (partitionKey, authPolicy, displayName, connectorConfig, with format examples), the correct auth-introduction workflow, what generated CRUD does and does NOT guarantee (no owner scoping), how dev seeds are applied, and every machine command. Consult this before assuming SwallowKit can or cannot do something.",
      inputSchema: z.object({}),
      handler: async () => {
        const response = await executeMachineCommand(["inspect", "capabilities"], runMachineCli);
        return jsonTextContent(withSwallowKitMetadata(response.data));
      },
    },
    {
      name: "swallowkit_plan_auth",
      description: "Compute the add-auth change plan (files to create/update/overwrite, conflicts, warnings) without writing any files. Returns a planId usable with swallowkit_apply_auth. Never hand-write auth.schemes in swallowkit.config; this operation owns them.",
      inputSchema: z.object({
        provider: z.enum(["custom-jwt", "swa", "external-token", "none"]),
        scheme: z.string().optional(),
        allowedProviders: z.array(z.string()).optional(),
      }),
      handler: async ({ provider, scheme, allowedProviders }: { provider: string; scheme?: string; allowedProviders?: string[] }) => {
        const args = ["plan", "auth", "--provider", provider];
        if (scheme) args.push("--scheme", scheme);
        if (allowedProviders && allowedProviders.length > 0) args.push("--allowed-providers", allowedProviders.join(","));

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_apply_auth",
      description: "Apply add-auth changes. Rejects stale plans and requires approve=true when user-modified files would be overwritten. Follow the returned nextActions: policies and swa.allowedProviders are hand-edited afterwards, and external-token verifier stubs must be implemented.",
      inputSchema: z.object({
        provider: z.enum(["custom-jwt", "swa", "external-token", "none"]).optional(),
        scheme: z.string().optional(),
        allowedProviders: z.array(z.string()).optional(),
        planId: z.string().optional(),
        approve: z.boolean().optional(),
      }),
      handler: async ({ provider, scheme, allowedProviders, planId, approve }: { provider?: string; scheme?: string; allowedProviders?: string[]; planId?: string; approve?: boolean }) => {
        const args = ["apply", "auth"];
        if (planId) args.push("--plan", planId);
        if (provider) args.push("--provider", provider);
        if (scheme) args.push("--scheme", scheme);
        if (allowedProviders && allowedProviders.length > 0) args.push("--allowed-providers", allowedProviders.join(","));
        if (approve) args.push("--approve");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_inspect_infra",
      description: "Inspect Bicep infrastructure assets deterministically (params, modules, outputs, container wiring). Does not call Azure.",
      inputSchema: z.object({}),
      handler: async () => {
        const response = await executeMachineCommand(["inspect", "infra"], runMachineCli);
        return jsonTextContent(withSwallowKitMetadata(response.data));
      },
    },
    {
      name: "swallowkit_plan_provision",
      description: "Preflight Azure provisioning locally (Bicep analysis, az CLI availability, command preview). Never deploys. Set whatIf=true to run az what-if (requires az login). The returned plan always requires human approval.",
      inputSchema: z.object({
        resourceGroup: z.string(),
        location: z.string(),
        swaLocation: z.string(),
        subscription: z.string().optional(),
        whatIf: z.boolean().optional(),
      }),
      handler: async ({ resourceGroup, location, swaLocation, subscription, whatIf }: { resourceGroup: string; location: string; swaLocation: string; subscription?: string; whatIf?: boolean }) => {
        const args = ["plan", "provision", "--resource-group", resourceGroup, "--location", location, "--swa-location", swaLocation];
        if (subscription) args.push("--subscription", subscription);
        if (whatIf) args.push("--what-if");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
    {
      name: "swallowkit_apply_provision",
      description: "Apply an approved provisioning plan. Creates billable Azure resources; approve=true is always required and must reflect explicit human consent.",
      inputSchema: z.object({
        planId: z.string(),
        approve: z.boolean().optional(),
      }),
      handler: async ({ planId, approve }: { planId: string; approve?: boolean }) => {
        const args = ["apply", "provision", "--plan", planId];
        if (approve) args.push("--approve");

        const response = await executeMachineCommand(args, runMachineCli);
        return jsonTextContent(withOperationStatus(response));
      },
    },
  ];
}

export function createSwallowKitMcpServer(runMachineCli: MachineCliRunner = defaultMachineCliRunner): McpServer {
  const version = getSwallowKitVersion();
  const server = new McpServer({
    name: "swallowkit-mcp",
    version,
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
  console.error(`[swallowkit-mcp] version: ${getSwallowKitVersion()}`);
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
