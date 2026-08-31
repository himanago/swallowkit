import { Command, CommanderError } from "commander";
import { isSwallowKitProject } from "../core/config";
import { createModelOperation } from "../core/operations/create-model";
import { applyScaffoldOperation } from "../core/operations/scaffold-apply";
import { applyAuthOperation, planAuthOperation } from "../core/operations/auth-operations";
import { applyProvisionOperation, planProvisionOperation } from "../core/operations/provision-operations";
import { ProcessExitInterceptError } from "../core/operations/runtime";
import { inspectInfra } from "../core/project/infra";
import { runMachineScaffoldOperation } from "../core/operations/scaffold-machine";
import { planScaffoldOperation } from "../core/operations/scaffold-plan";
import { inspectArtifacts } from "../core/project/artifacts";
import { inspectBoundaries } from "../core/project/boundaries";
import { inspectCapabilities } from "../core/project/capabilities";
import { detectDrift } from "../core/project/drift";
import { loadProjectManifest } from "../core/project/manifest";
import { loadLastVerifyState } from "../core/project/state";
import { validateProject } from "../core/project/validation";
import { explainVerifyFailure, compactVerifyResult, runVerify, VerifyResult } from "../core/verify";
import {
  MachineErrorResponse,
  MachineNextAction,
  MachineOperationStatus,
  MachineResponse,
  MachineSuccessResponse,
} from "./contracts";
import { MachineCommandError, resolveMachineErrorStatus, toMachineError } from "./errors";

/** 最終 JSON envelope 専用の stdout writer。runMachineCli 実行中はこれ以外の stdout 書き込みを stderr へ逃がす。 */
let machineEnvelopeWrite: ((chunk: string) => void) | null = null;

function writeMachineResponse<TData>(response: MachineResponse<TData>): void {
  const payload = `${JSON.stringify(response, null, 2)}\n`;
  if (machineEnvelopeWrite) {
    machineEnvelopeWrite(payload);
  } else {
    process.stdout.write(payload);
  }
}

interface MachineResponseMeta {
  status?: MachineOperationStatus;
  nextActions?: MachineNextAction[];
}

function writeMachineSuccess<TData>(command: string, data: TData, meta?: MachineResponseMeta): void {
  const response: MachineSuccessResponse<TData> = {
    ok: true,
    command,
    status: meta?.status ?? "complete",
    ...(meta?.nextActions && meta.nextActions.length > 0 ? { nextActions: meta.nextActions } : {}),
    data,
  };
  writeMachineResponse(response);
}

function writeMachineError(command: string, error: unknown): void {
  const response: MachineErrorResponse = {
    ok: false,
    command,
    status: resolveMachineErrorStatus(error),
    error: toMachineError(error),
  };
  writeMachineResponse(response);
}

/** 書き込み系操作の前提チェック。プロジェクト外なら明確な blocked エラーを返す。 */
function ensureProjectForMachine(): void {
  if (!isSwallowKitProject()) {
    throw new MachineCommandError(
      "not-a-swallowkit-project",
      `No SwallowKit project found in ${process.cwd()}. Expected swallowkit.config.js, swallowkit.config.json, or .swallowkitrc.json in the current directory. Run this command from the project root, or create a project with "swallowkit init".`,
      { cwd: process.cwd() },
      "blocked"
    );
  }
}

/**
 * レガシーな人間向けコードパスが process.exit を直接呼んでも、
 * JSON envelope なしにプロセスが死なないようにする安全網。
 * console.error の出力を集めてエラーメッセージとして返す。
 */
async function runActionWithExitGuard<TData>(action: () => Promise<TData>): Promise<TData> {
  const capturedErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args
      .map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.stack || arg.message : JSON.stringify(arg)))
      .join(" ");
    capturedErrors.push(text);
    process.stderr.write(`${text}\n`);
  };
  const originalExit = process.exit;
  process.exit = ((code?: number | string | null) => {
    const normalized = typeof code === "number" ? code : typeof process.exitCode === "number" ? process.exitCode : 1;
    throw new ProcessExitInterceptError(normalized);
  }) as typeof process.exit;

  try {
    return await action();
  } catch (error) {
    if (error instanceof ProcessExitInterceptError) {
      const message = capturedErrors
        .map((entry) => entry.replace(/[❌💡]\s*/gu, "").trim())
        .filter((entry) => entry.length > 0)
        .join("\n");
      throw new MachineCommandError(
        "operation-aborted",
        message || `Operation aborted with exit code ${error.exitCode}.`,
        undefined,
        "failed"
      );
    }
    throw error;
  } finally {
    console.error = originalError;
    process.exit = originalExit;
  }
}

async function handleMachineAction<TData>(
  command: string,
  action: () => Promise<TData>,
  meta?: (data: TData) => MachineResponseMeta
): Promise<void> {
  try {
    const data = await runActionWithExitGuard(action);
    writeMachineSuccess(command, data, meta?.(data));
  } catch (error) {
    writeMachineError(command, error);
    process.exitCode = 1;
  }
}

function createMachineProgram(): Command {
  const program = new Command();
  program
    .name("swallowkit machine")
    .description("SwallowKit machine-readable CLI for AI and MCP integrations")
    .showHelpAfterError(false);

  const inspect = new Command("inspect");
  inspect
    .command("project")
    .description("Inspect SwallowKit project metadata")
    .action(async () => {
      await handleMachineAction("inspect-project", async () => {
        const loaded = await loadProjectManifest();
        return {
          manifestSource: loaded.source,
          diagnostics: loaded.diagnostics,
          manifest: loaded.manifest,
        };
      });
    });

  inspect
    .command("entities")
    .description("Inspect SwallowKit entities")
    .action(async () => {
      await handleMachineAction("inspect-entities", async () => {
        const loaded = await loadProjectManifest();
        return {
          manifestSource: loaded.source,
          diagnostics: loaded.diagnostics,
          entities: loaded.manifest.entities,
        };
      });
    });

  inspect
    .command("routes")
    .description("Inspect SwallowKit routes")
    .action(async () => {
      await handleMachineAction("inspect-routes", async () => {
        const loaded = await loadProjectManifest();
        return {
          manifestSource: loaded.source,
          diagnostics: loaded.diagnostics,
          routes: loaded.manifest.routes,
        };
      });
    });

  inspect
    .command("artifacts")
    .description("Inspect generated artifacts and their ownership from the artifact ledger")
    .action(async () => {
      await handleMachineAction("inspect-artifacts", async () => inspectArtifacts());
    });

  inspect
    .command("boundaries")
    .description("Return the responsibility boundary contract between AI free-form authoring and deterministic generation")
    .action(async () => {
      await handleMachineAction("inspect-boundaries", async () => inspectBoundaries());
    });

  inspect
    .command("capabilities")
    .description("Return SwallowKit's machine-readable capability contract: model declarations, auth workflow, generated-CRUD scope, seeding, and available commands")
    .action(async () => {
      await handleMachineAction("inspect-capabilities", async () => inspectCapabilities());
    });

  inspect
    .command("infra")
    .description("Inspect Bicep infrastructure assets (params, modules, outputs, container wiring) without calling Azure")
    .action(async () => {
      await handleMachineAction("inspect-infra", async () => inspectInfra());
    });

  inspect
    .command("drift")
    .description("Detect drift between generated artifacts and the current project state")
    .action(async () => {
      await handleMachineAction(
        "inspect-drift",
        async () => detectDrift(),
        (result) => ({
          status: "complete",
          nextActions:
            result.findings.length > 0
              ? [
                  {
                    command: "swallowkit machine verify project",
                    description: "Run full verification to confirm the project is in a consistent state.",
                  },
                ]
              : [],
        })
      );
    });

  const validate = new Command("validate");
  validate
    .command("project")
    .description("Validate SwallowKit project metadata and conventions")
    .action(async () => {
      await handleMachineAction("validate-project", async () => validateProject());
    });

  const generate = new Command("generate");
  generate
    .command("model")
    .description("Generate model templates with deterministic JSON output")
    .argument("<names...>", "Model names to generate")
    .option("--models-dir <dir>", "Models directory", "shared/models")
    .option("--connector <name>", "Associate the models with a configured connector")
    .option("--overwrite <mode>", "Overwrite policy: always | never", "never")
    .action(async (names: string[], options: { modelsDir?: string; connector?: string; overwrite?: string }) => {
      await handleMachineAction("generate-model", async () => {
        ensureProjectForMachine();
        if (options.overwrite !== "always" && options.overwrite !== "never") {
          throw new MachineCommandError(
            "invalid-overwrite-mode",
            `Unsupported overwrite mode: ${options.overwrite}. Use "always" or "never".`
          );
        }

        return createModelOperation({
          names,
          modelsDir: options.modelsDir,
          connector: options.connector,
          overwriteMode: options.overwrite,
        });
      });
    });

  generate
    .command("scaffold")
    .description("Generate scaffold artifacts with deterministic JSON output")
    .argument("<model>", "Model file or model name")
    .option("--functions-dir <dir>", "Functions directory", "functions")
    .option("--api-dir <dir>", "API routes directory", "app/api")
    .option("--api-only", "Skip UI components; still update Functions, BFF routes, OpenAPI, and native schema assets", false)
    .action(async (model: string, options: { functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
      await handleMachineAction("generate-scaffold", async () => {
        ensureProjectForMachine();
        return runMachineScaffoldOperation({
        model,
        functionsDir: options.functionsDir,
        apiDir: options.apiDir,
        apiOnly: options.apiOnly,
      });
      });
    });

  const plan = new Command("plan");
  plan
    .command("scaffold")
    .description("Compute the scaffold change plan without writing any files (accepts multiple models)")
    .argument("<models...>", "Model files or model names")
    .option("--functions-dir <dir>", "Functions directory", "functions")
    .option("--api-dir <dir>", "API routes directory", "app/api")
    .option("--api-only", "Skip UI components in the plan", false)
    .action(async (models: string[], options: { functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
      await handleMachineAction(
        "plan-scaffold",
        async () => {
          ensureProjectForMachine();
          const plans = [];
          for (const model of models) {
            plans.push(
              await planScaffoldOperation({
                model,
                functionsDir: options.functionsDir,
                apiDir: options.apiDir,
                apiOnly: options.apiOnly,
              })
            );
          }
          return plans.length === 1 ? plans[0] : { planType: "scaffold-batch" as const, plans };
        },
        (data) => {
          const plans = "plans" in data ? data.plans : [data];
          return {
            status: plans.some((planData) => planData.requiresApproval) ? "requires-human" : "complete",
            nextActions: plans.map((planData) => ({
              command: `swallowkit machine apply scaffold --plan ${planData.planId}${planData.requiresApproval ? " --approve" : ""}`,
              description: planData.requiresApproval
                ? `Apply the plan for ${planData.model} after reviewing the listed conflicts (requires --approve).`
                : `Apply the plan for ${planData.model}.`,
            })),
          };
        }
      );
    });

  plan
    .command("auth")
    .description("Compute the add-auth change plan without writing any files")
    .requiredOption("--provider <provider>", "Auth provider: custom-jwt | swa | external-token | none")
    .option("--scheme <name>", "Add as a named authentication scheme")
    .option("--allowed-providers <list>", "Comma-separated SWA identity providers to allow (e.g. github,aad); defaults to aad")
    .action(async (options: { provider: string; scheme?: string; allowedProviders?: string }) => {
      await handleMachineAction(
        "plan-auth",
        async () => {
          ensureProjectForMachine();
          return planAuthOperation({
            provider: options.provider,
            scheme: options.scheme,
            allowedProviders: options.allowedProviders ? options.allowedProviders.split(",") : undefined,
          });
        },
        (planData) => ({
          status: planData.requiresApproval ? "requires-human" : "complete",
          nextActions: [
            {
              command: `swallowkit machine apply auth --plan ${planData.planId}${planData.requiresApproval ? " --approve" : ""}`,
              description: planData.requiresApproval
                ? "Apply the plan after reviewing the listed conflicts (requires --approve)."
                : "Apply the plan.",
            },
          ],
        })
      );
    });

  plan
    .command("provision")
    .description("Preflight Azure provisioning locally; use --what-if for an az what-if analysis (requires az login)")
    .requiredOption("-g, --resource-group <name>", "Resource group name")
    .requiredOption("--location <region>", "Primary location for Functions and Cosmos DB")
    .requiredOption("--swa-location <region>", "Static Web App location")
    .option("--subscription <id>", "Azure subscription GUID")
    .option("--what-if", "Run az deployment group what-if (requires az login)", false)
    .action(async (options: { resourceGroup: string; location: string; swaLocation: string; subscription?: string; whatIf?: boolean }) => {
      await handleMachineAction(
        "plan-provision",
        async () => {
          ensureProjectForMachine();
          return planProvisionOperation({
            resourceGroup: options.resourceGroup,
            location: options.location,
            swaLocation: options.swaLocation,
            subscription: options.subscription,
            whatIf: options.whatIf,
          });
        },
        (planData) => ({
          status: "requires-human",
          nextActions: [
            {
              command: `swallowkit machine apply provision --plan ${planData.planId} --approve`,
              description:
                "Provisioning creates billable Azure resources. A human must review plan.commands and approve before applying.",
            },
          ],
        })
      );
    });

  const apply = new Command("apply");
  apply
    .command("scaffold")
    .description("Apply scaffold changes, verifying plan freshness and overwrite approval (accepts multiple models)")
    .argument("[models...]", "Model files or model names (optional when --plan is given)")
    .option("--plan <planId>", "Apply a previously computed plan")
    .option("--approve", "Approve overwriting files that were modified after generation", false)
    .option("--functions-dir <dir>", "Functions directory")
    .option("--api-dir <dir>", "API routes directory")
    .option("--api-only", "Skip UI components; still update Functions, BFF routes, OpenAPI, and native schema assets")
    .action(
      async (
        models: string[],
        options: { plan?: string; approve?: boolean; functionsDir?: string; apiDir?: string; apiOnly?: boolean }
      ) => {
        await handleMachineAction(
          "apply-scaffold",
          async () => {
            ensureProjectForMachine();
            if (models.length > 1 && options.plan) {
              throw new MachineCommandError(
                "invalid-arguments",
                "--plan applies to a single model. Pass multiple models without --plan (each apply re-plans internally), or apply each plan separately.",
                undefined,
                "failed"
              );
            }
            if (models.length <= 1) {
              return applyScaffoldOperation({
                model: models[0],
                planId: options.plan,
                approve: options.approve,
                functionsDir: options.functionsDir,
                apiDir: options.apiDir,
                apiOnly: options.apiOnly,
              });
            }
            const results = [];
            for (const model of models) {
              results.push(
                await applyScaffoldOperation({
                  model,
                  approve: options.approve,
                  functionsDir: options.functionsDir,
                  apiDir: options.apiDir,
                  apiOnly: options.apiOnly,
                })
              );
            }
            return { applyType: "scaffold-batch" as const, results };
          },
          () => ({
            status: "complete",
            nextActions: [
              {
                command: "swallowkit machine verify project",
                description: "Verify the project after applying scaffold changes.",
              },
            ],
          })
        );
      }
    );

  apply
    .command("auth")
    .description("Apply add-auth changes, verifying plan freshness and overwrite approval")
    .option("--plan <planId>", "Apply a previously computed plan")
    .option("--provider <provider>", "Auth provider (optional when --plan is given)")
    .option("--scheme <name>", "Add as a named authentication scheme")
    .option("--allowed-providers <list>", "Comma-separated SWA identity providers to allow (e.g. github,aad); defaults to aad")
    .option("--approve", "Approve overwriting files that were modified after generation", false)
    .action(async (options: { plan?: string; provider?: string; scheme?: string; allowedProviders?: string; approve?: boolean }) => {
      await handleMachineAction(
        "apply-auth",
        async () => {
          ensureProjectForMachine();
          return applyAuthOperation({
            provider: options.provider,
            scheme: options.scheme,
            allowedProviders: options.allowedProviders ? options.allowedProviders.split(",") : undefined,
            planId: options.plan,
            approve: options.approve,
          });
        },
        (result) => {
          const configTarget = result.scheme
            ? `auth.authorization.policies (reference scheme "${result.scheme}")`
            : "auth.authorization.policies";
          const nextActions: MachineNextAction[] = [];
          if (result.provider !== "none") {
            nextActions.push({
              command: "edit swallowkit.config.js",
              description: `Define ${configTarget}. The config is an extension point: hand-editing policies is the expected workflow. Do NOT hand-write auth.schemes entries; only plan/apply auth may add schemes.`,
            });
          }
          if (result.provider === "swa") {
            nextActions.push({
              command: "edit swallowkit.config.js",
              description: `Confirm swa.allowedProviders${result.scheme ? ` for scheme "${result.scheme}"` : ""} lists the identity providers you use (e.g. ['github']). Generated login URLs and provider checks use this list; it can also be set at plan time with --allowed-providers.`,
            });
          }
          if (result.provider === "external-token") {
            nextActions.push({
              command: "edit the generated external token verifier",
              description:
                "Implement the verifier stub (it fails closed until implemented). typecheck and verify pass with the stub in place, so a passing verify does NOT mean external-token auth works.",
            });
          }
          nextActions.push({
            command: "swallowkit machine verify project",
            description: "Verify the project after applying auth changes.",
          });
          return { status: "complete", nextActions };
        }
      );
    });

  apply
    .command("provision")
    .description("Apply an approved provisioning plan (always requires --approve; creates billable Azure resources)")
    .requiredOption("--plan <planId>", "Provision plan to apply")
    .option("--approve", "Confirm human approval of the provisioning plan", false)
    .action(async (options: { plan: string; approve?: boolean }) => {
      await handleMachineAction(
        "apply-provision",
        async () => {
          ensureProjectForMachine();
          return applyProvisionOperation({ planId: options.plan, approve: options.approve });
        },
        () => ({
          status: "complete",
          nextActions: [
            {
              command: "swallowkit machine inspect infra",
              description: "Re-inspect infra assets after provisioning.",
            },
          ],
        })
      );
    });

  const verify = new Command("verify");
  verify
    .command("project")
    .description("Run verification checks (structure, drift, typecheck) with machine-readable evidence")
    .option(
      "--checks <ids>",
      "Comma-separated check ids to run (structure,drift,typecheck,build,lint,test, plus custom ids from swallowkit.config verify.checks)"
    )
    .option("--compact", "Suppress info-severity findings/violations from evidence to keep agent-facing output small", false)
    .action(async (options: { checks?: string; compact?: boolean }) => {
      await handleMachineAction(
        "verify-project",
        async () => {
          const result = await runVerify(options.checks ? options.checks.split(",") : undefined);
          return options.compact ? compactVerifyResult(result) : result;
        },
        (result) => ({
          status: result.summary.done ? "complete" : "in-progress",
          nextActions: result.summary.done
            ? []
            : [
                {
                  command: "swallowkit machine explain failure",
                  description: "Get evidence and suggested actions for the failed checks.",
                },
              ],
        })
      );
    });

  const explain = new Command("explain");
  explain
    .command("failure")
    .description("Explain failures from the most recent verify run")
    .option("--check <id>", "Explain a specific check id")
    .action(async (options: { check?: string }) => {
      await handleMachineAction("explain-failure", async () => {
        const lastVerify = loadLastVerifyState<VerifyResult>();
        if (!lastVerify) {
          throw new MachineCommandError(
            "no-verification-result",
            'No verify result found. Run "swallowkit machine verify project" first.',
            undefined,
            "blocked"
          );
        }

        try {
          return {
            verifiedAt: lastVerify.verifiedAt,
            failures: explainVerifyFailure(lastVerify, options.check),
          };
        } catch (error) {
          throw new MachineCommandError(
            "unknown-check",
            error instanceof Error ? error.message : String(error),
            { check: options.check },
            "failed"
          );
        }
      });
    });

  program.addCommand(inspect);
  program.addCommand(validate);
  program.addCommand(generate);
  program.addCommand(plan);
  program.addCommand(apply);
  program.addCommand(verify);
  program.addCommand(explain);
  return program;
}

export function isMachineCommand(argv: string[]): boolean {
  return argv[2] === "machine";
}

/**
 * すべてのコマンド階層に exitOverride と出力キャプチャを適用する。
 * commander の addCommand は親の出力設定を継承しないため、再帰的に設定する。
 */
function applyMachineOutputSettings(command: Command, sink: { text: string }): void {
  command.exitOverride();
  command.showHelpAfterError(false);
  command.configureOutput({
    writeErr: (str) => {
      sink.text += str;
    },
    writeOut: (str) => {
      sink.text += str;
    },
  });
  for (const sub of command.commands) {
    applyMachineOutputSettings(sub, sink);
  }
}

export async function runMachineCli(argv: string[] = process.argv): Promise<void> {
  const program = createMachineProgram();
  const commanderOutput = { text: "" };
  applyMachineOutputSettings(program, commanderOutput);

  // Keep stdout reserved for the single JSON envelope: any console output
  // produced by underlying operations (e.g. config-load logs) goes to stderr.
  // A hard guard on process.stdout.write catches direct writes that bypass console.
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const previousStdoutWrite = process.stdout.write;
  const boundStdoutWrite = previousStdoutWrite.bind(process.stdout);
  machineEnvelopeWrite = (chunk) => {
    boundStdoutWrite(chunk);
  };
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(`${args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;

  try {
    await program.parseAsync(argv.slice(3), { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      const capturedText = commanderOutput.text.trim();
      if (error.code === "commander.helpDisplayed" || error.code === "commander.help") {
        // --help / help は正常応答として usage を JSON envelope で返す
        writeMachineSuccess("machine-help", { help: capturedText });
        return;
      }
      writeMachineError(
        "machine-parse",
        new MachineCommandError(
          "invalid-command",
          error.message,
          capturedText ? { usage: capturedText } : undefined
        )
      );
      process.exitCode = Number.isFinite(error.exitCode) && error.exitCode !== 0 ? error.exitCode : 1;
      return;
    }

    writeMachineError("machine-parse", error);
    process.exitCode = 1;
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    process.stdout.write = previousStdoutWrite;
    machineEnvelopeWrite = null;
  }
}
