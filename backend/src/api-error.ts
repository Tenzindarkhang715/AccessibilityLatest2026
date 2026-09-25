import type { ApiErrorCode } from "./models.js";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string) {
    super(message);
  }
}

export function invalid(message: string): never {
  throw new ApiError(400, "INVALID_REQUEST", message);
}
