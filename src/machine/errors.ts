export class MachineCommandError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "MachineCommandError";
    this.code = code;
    this.details = details;
  }
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
