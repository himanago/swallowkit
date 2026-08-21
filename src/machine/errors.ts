import type { MachineOperationStatus } from "./contracts";

export class MachineCommandError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status?: MachineOperationStatus;

  constructor(code: string, message: string, details?: unknown, status?: MachineOperationStatus) {
    super(message);
    this.name = "MachineCommandError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function resolveMachineErrorStatus(error: unknown): MachineOperationStatus {
  if (error instanceof MachineCommandError && error.status) {
    return error.status;
  }
  return "failed";
}

export function toMachineError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof MachineCommandError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  if (error instanceof Error) {
    return {
      code: "internal-error",
      message: error.message,
    };
  }

  return {
    code: "internal-error",
    message: "Unknown error",
    details: error,
  };
}
