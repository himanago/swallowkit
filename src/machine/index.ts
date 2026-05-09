import { Command, CommanderError } from "commander";
import { createModelOperation } from "../core/operations/create-model";
import { runMachineScaffoldOperation } from "../core/operations/scaffold-machine";
import { loadProjectManifest } from "../core/project/manifest";
import { validateProject } from "../core/project/validation";
import { MachineErrorResponse, MachineResponse, MachineSuccessResponse } from "./contracts";
import { MachineCommandError, toMachineError } from "./errors";

function writeMachineResponse<TData>(response: MachineResponse<TData>): void {
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function writeMachineSuccess<TData>(command: string, data: TData): void {
  const response: MachineSuccessResponse<TData> = {
    ok: true,
    command,
    data,
  };
  writeMachineResponse(response);
}

function writeMachineError(command: string, error: unknown): void {
  const response: MachineErrorResponse = {
    ok: false,
    command,
    error: toMachineError(error),
  };
  writeMachineResponse(response);
}

async function handleMachineAction<TData>(
  command: string,
  action: () => Promise<TData>
): Promise<void> {
  try {
    writeMachineSuccess(command, await action());
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
    .showHelpAfterError(false)
    .configureOutput({
      writeErr: () => undefined,
      writeOut: () => undefined,
    });

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
    .option("--api-only", "Generate only API artifacts", false)
    .action(async (model: string, options: { functionsDir?: string; apiDir?: string; apiOnly?: boolean }) => {
      await handleMachineAction("generate-scaffold", async () => runMachineScaffoldOperation({
        model,
        functionsDir: options.functionsDir,
        apiDir: options.apiDir,
        apiOnly: options.apiOnly,
      }));
    });

  program.addCommand(inspect);
  program.addCommand(validate);
  program.addCommand(generate);
  return program;
}

export function isMachineCommand(argv: string[]): boolean {
  return argv[2] === "machine";
}

export async function runMachineCli(argv: string[] = process.argv): Promise<void> {
  const program = createMachineProgram();
  program.exitOverride();

  try {
    await program.parseAsync(argv.slice(3), { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      writeMachineError("machine-parse", new MachineCommandError("invalid-command", error.message));
      process.exitCode = Number.isFinite(error.exitCode) ? error.exitCode : 1;
      return;
    }

    writeMachineError("machine-parse", error);
    process.exitCode = 1;
  }
}
