import { scaffoldCommand } from "../../cli/commands/scaffold";
import {
  captureConsoleMessagesWithError,
  deriveCapturedErrorMessage,
  interceptProcessExit,
  ProcessExitInterceptError,
  trackFileMutations,
} from "./runtime";

export interface MachineScaffoldOperationOptions {
  model: string;
  functionsDir?: string;
  apiDir?: string;
  apiOnly?: boolean;
}

export interface MachineScaffoldOperationResult {
  createdFiles: string[];
  updatedFiles: string[];
  appendedFiles: string[];
  deletedFiles: string[];
  createdDirectories: string[];
  diagnostics: string[];
}

function deriveErrorMessage(messages: { errors: string[]; warnings: string[]; logs: string[] }): string {
  return deriveCapturedErrorMessage(messages, "Scaffold failed.");
}

export async function runMachineScaffoldOperation(
  options: MachineScaffoldOperationOptions
): Promise<MachineScaffoldOperationResult> {
  const originalMachineOutput = process.env.SWALLOWKIT_MACHINE_OUTPUT;
  process.env.SWALLOWKIT_MACHINE_OUTPUT = "1";

  try {
    const tracked = await trackFileMutations(async () => {
      const captured = await captureConsoleMessagesWithError(async () => {
        await interceptProcessExit(async () => {
          await scaffoldCommand(options);
        });
      });

      if (captured.error) {
        if (captured.error instanceof ProcessExitInterceptError) {
          throw new Error(deriveErrorMessage(captured.messages));
        }

        if (captured.error instanceof Error) {
          throw captured.error;
        }

        throw new Error(deriveErrorMessage(captured.messages));
      }

      return captured.messages;
    });

    return {
      createdFiles: tracked.mutations.createdFiles,
      updatedFiles: tracked.mutations.updatedFiles,
      appendedFiles: tracked.mutations.appendedFiles,
      deletedFiles: tracked.mutations.deletedFiles,
      createdDirectories: tracked.mutations.createdDirectories,
      diagnostics: [
        ...tracked.result.warnings.map((warning) => `warning:${warning}`),
        ...tracked.result.errors.map((error) => `error:${error}`),
      ],
    };
  } finally {
    if (originalMachineOutput === undefined) {
      delete process.env.SWALLOWKIT_MACHINE_OUTPUT;
    } else {
      process.env.SWALLOWKIT_MACHINE_OUTPUT = originalMachineOutput;
    }
  }
}
