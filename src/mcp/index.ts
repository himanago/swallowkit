#!/usr/bin/env node

import { spawn } from "child_process";
import * as path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import type { MachineErrorResponse, MachineNextAction, MachineOperationStatus, MachineResponse } from "../machine/contracts";
import { getSwallowKitVersion } from "../version";
import { detectFromProject, getCommands } from "../utils/package-manager";
import {
  MCP_DELEGATED_FROM_ENV,
  McpVersionContext,
  buildPinnedUpdateNotice,
  decideMcpLaunch,
  resolveProjectSwallowKit,
} from "./version-selection";

interface MachineSuccessPayload<TData> {
  ok: true;
  command: string;
  status?: MachineOperationStatus;
  nextActions?: MachineNextAction[];
  data: TData;
}

type MachineCliRunner = (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
type ToolContentResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
class MachineCliError extends Error {
  constructor(message: string, readonly response: MachineErrorResponse) {
    super(message);
  }
}
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
    throw new MachineCliError(`[${parsed.error.code}] ${parsed.error.message}${statusSuffix}${detailsSuffix}`, parsed);
  }

  return parsed;
}

function defaultVersionContext(): McpVersionContext {
  return {
    mcpVersion: getSwallowKitVersion(),
    requestedVersion: "latest",
    projectVersion: null,
    selection: "running-version",
    delegated: false,
    warnings: [],
    nextActions: [],
  };
}

function mergeNextActions(
  first: MachineNextAction[] | undefined,
  second: MachineNextAction[]
): MachineNextAction[] {
  const merged = [...(first ?? [])];
  for (const action of second) {
    if (!merged.some((existing) => existing.command === action.command)) merged.push(action);
  }
  return merged;
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

function withVersionMetadata(data: unknown, context: McpVersionContext): Record<string, unknown> {
  const value = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : { data };
  const metadata = value.metadata && typeof value.metadata === "object"
    ? value.metadata as Record<string, unknown>
    : {};
  const existingNextActions = Array.isArray(value.nextActions) ? value.nextActions as MachineNextAction[] : undefined;
  const nextActions = mergeNextActions(existingNextActions, context.nextActions);

  return {
    ...value,
    ...(nextActions.length > 0 ? { nextActions } : {}),
    metadata: {
      ...metadata,
      swallowkitVersion: context.mcpVersion,
      mcp: {
        version: context.mcpVersion,
        requestedVersion: context.requestedVersion,
        projectVersion: context.projectVersion,
        selection: context.selection,
        delegated: context.delegated,
        ...(context.delegatedFrom ? { delegatedFrom: context.delegatedFrom } : {}),
      },
      ...(context.warnings.length > 0 ? { warnings: [...context.warnings] } : {}),
    },
  };
}

export function buildSwallowKitToolDefinitions(
  runMachineCli: MachineCliRunner = defaultMachineCliRunner,
  versionContext: McpVersionContext = defaultVersionContext()
): ToolDefinition[] {
  const withSwallowKitMetadata = (data: unknown) => withVersionMetadata(data, versionContext);
  const definitions: ToolDefinition[] = [
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
        skipInfra: z.boolean().optional().describe("Do not create or update anything under infra/; the container migration stays pending."),
      }),
      handler: async ({ model, functionsDir, apiDir, apiOnly, skipInfra }: { model: string; functionsDir?: string; apiDir?: string; apiOnly?: boolean; skipInfra?: boolean }) => {
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
      if (skipInfra) {
        args.push("--skip-infra");
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
        skipInfra: z.boolean().optional().describe("Exclude all infra/ changes (container migration) from the plan."),
      }),
      handler: async ({ model, models, functionsDir, apiDir, apiOnly, skipInfra }: { model?: string; models?: string[]; functionsDir?: string; apiDir?: string; apiOnly?: boolean; skipInfra?: boolean }) => {
        const targets = models && models.length > 0 ? models : model ? [model] : [];
        if (targets.length === 0) throw new Error("Provide model or models.");
        const args = ["plan", "scaffold", ...targets];
        if (functionsDir) args.push("--functions-dir", functionsDir);
        if (apiDir) args.push("--api-dir", apiDir);
        if (apiOnly) args.push("--api-only");
        if (skipInfra) args.push("--skip-infra");

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
        skipInfra: z.boolean().optional().describe("Do not create or update anything under infra/ (defaults to the plan's setting)."),
      }),
      handler: async ({ model, planId, approve, functionsDir, apiDir, apiOnly, skipInfra }: { model?: string; planId?: string; approve?: boolean; functionsDir?: string; apiDir?: string; apiOnly?: boolean; skipInfra?: boolean }) => {
        const args = ["apply", "scaffold"];
        if (model) args.push(model);
        if (planId) args.push("--plan", planId);
        if (approve) args.push("--approve");
        if (functionsDir) args.push("--functions-dir", functionsDir);
        if (apiDir) args.push("--api-dir", apiDir);
        if (apiOnly) args.push("--api-only");
        if (skipInfra) args.push("--skip-infra");

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
      description: "Run verification checks (structure, drift, typecheck, backend-build by default; build, lint, test and custom checks from swallowkit.config verify.checks are also available) and return machine-readable evidence. backend-build compiles standalone C#/TypeScript Functions or checks Python syntax; unavailable toolchains are skipped with a reason. summary.done=true means no checks failed, not that skipped checks were validated or runtime/auth flows work. Set compact=true to suppress info-severity findings and keep the output small.",
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
      description: "Plan Azure bootstrap or pending infrastructure migrations. Existing untagged environments require explicit adoption with what-if; full main.bicep redeployment requires reconcile=true. Never deploys and always requires human approval.",
      inputSchema: z.object({
        resourceGroup: z.string(),
        location: z.string(),
        swaLocation: z.string(),
        subscription: z.string().optional(),
        whatIf: z.boolean().optional(),
        adoptExisting: z.boolean().optional(),
        baseline: z.number().int().nonnegative().optional(),
        reconcile: z.boolean().optional(),
      }),
      handler: async ({ resourceGroup, location, swaLocation, subscription, whatIf, adoptExisting, baseline, reconcile }: { resourceGroup: string; location: string; swaLocation: string; subscription?: string; whatIf?: boolean; adoptExisting?: boolean; baseline?: number; reconcile?: boolean }) => {
        const args = ["plan", "provision", "--resource-group", resourceGroup, "--location", location, "--swa-location", swaLocation];
        if (subscription) args.push("--subscription", subscription);
        if (whatIf) args.push("--what-if");
        if (adoptExisting) args.push("--adopt-existing");
        if (baseline !== undefined) args.push("--baseline", String(baseline));
        if (reconcile) args.push("--reconcile");

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

  // Every response reports which SwallowKit version answered and why it was selected.
  return definitions.map((definition) => ({
    ...definition,
    handler: async (input: unknown) => {
      try {
        const result = await definition.handler(input);
        return jsonTextContent(withSwallowKitMetadata(JSON.parse(result.content[0].text)));
      } catch (error) {
        // Prerequisite failures carry nextActions; keep them structured so agents can follow them.
        if (error instanceof MachineCliError && error.response.nextActions?.length) {
          return { ...jsonTextContent(withSwallowKitMetadata(error.response)), isError: true };
        }
        throw error;
      }
    },
  }));
}

export function createSwallowKitMcpServer(
  runMachineCli: MachineCliRunner = defaultMachineCliRunner,
  versionContext: McpVersionContext = defaultVersionContext()
): McpServer {
  const version = versionContext.mcpVersion;
  const server = new McpServer({
    name: "swallowkit-mcp",
    version,
  });

  for (const tool of buildSwallowKitToolDefinitions(runMachineCli, versionContext)) {
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

function resolveExecCommand(cwd: string): string {
  try {
    return getCommands(detectFromProject(cwd)).exec;
  } catch {
    return "npx";
  }
}

async function fetchPublishedLatest(): Promise<string | null> {
  if (process.env.SWALLOWKIT_MCP_UPDATE_CHECK === "0") return null;
  const registry = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");
  try {
    const response = await fetch(`${registry}/swallowkit/latest`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.json() as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

function delegateToProjectMcp(entrypoint: string, fromVersion: string): void {
  const child = spawn(process.execPath, [entrypoint], {
    stdio: "inherit",
    env: { ...process.env, [MCP_DELEGATED_FROM_ENV]: fromVersion },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`[swallowkit-mcp] failed to start the project-installed MCP: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

export async function runMcpServer(): Promise<void> {
  const selfVersion = getSwallowKitVersion();
  const cwd = process.cwd();
  const execCommand = resolveExecCommand(cwd);
  const decision = decideMcpLaunch({
    selfVersion,
    selfPackageRoot: path.resolve(__dirname, "..", ".."),
    env: process.env,
    project: resolveProjectSwallowKit(cwd),
    execCommand,
  });

  if (decision.action === "delegate") {
    console.error(
      `[swallowkit-mcp] version: ${selfVersion}; delegating to the project-installed swallowkit-mcp ${decision.toVersion} (newer than the launcher).`
    );
    delegateToProjectMcp(decision.entrypoint, decision.fromVersion);
    return;
  }

  const context = decision.context;
  // One write keeps the version line and its warnings together for log readers.
  console.error([
    `[swallowkit-mcp] version: ${selfVersion} (selection: ${context.selection}${context.delegatedFrom ? `, delegated from ${context.delegatedFrom}` : ""})`,
    ...context.warnings.map((warning) => `[swallowkit-mcp] warning: ${warning}`),
  ].join("\n"));

  if (context.selection === "pinned") {
    void fetchPublishedLatest().then((latest) => {
      const notice = buildPinnedUpdateNotice(context, latest, execCommand);
      if (notice) {
        context.warnings.push(notice.warning);
        context.nextActions.push(notice.nextAction);
        console.error(`[swallowkit-mcp] warning: ${notice.warning}`);
      }
    });
  }

  const server = createSwallowKitMcpServer(defaultMachineCliRunner, context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  void runMcpServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
