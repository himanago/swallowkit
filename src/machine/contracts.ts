export interface MachineSuccessResponse<TData> {
  ok: true;
  command: string;
  data: TData;
}

export interface MachineErrorResponse {
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type MachineResponse<TData> = MachineSuccessResponse<TData> | MachineErrorResponse;
