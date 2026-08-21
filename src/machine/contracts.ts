export type MachineOperationStatus =
  | "complete"
  | "in-progress"
  | "blocked"
  | "requires-human"
  | "unsafe"
  | "failed";

export interface MachineNextAction {
  command: string;
  description: string;
}

export interface MachineSuccessResponse<TData> {
  ok: true;
  command: string;
  status?: MachineOperationStatus;
  nextActions?: MachineNextAction[];
  data: TData;
}

export interface MachineErrorResponse {
  ok: false;
  command: string;
  status?: MachineOperationStatus;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type MachineResponse<TData> = MachineSuccessResponse<TData> | MachineErrorResponse;
