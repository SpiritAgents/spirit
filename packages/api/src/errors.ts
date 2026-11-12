export interface DomainErrorPayload {
  code: string;
  params?: Record<string, unknown>;
}

export class DomainError extends Error {
  readonly domainError: DomainErrorPayload;

  constructor(code: string, message: string, params?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.domainError = { code, ...(params ? { params } : {}) };
  }
}

export function domainErrorPayload(error: unknown): DomainErrorPayload | undefined {
  if (error instanceof DomainError) {
    return error.domainError;
  }
  if (typeof error === "object" && error !== null && "domainError" in error) {
    const value = error.domainError;
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string"
    ) {
      return value as DomainErrorPayload;
    }
  }
  return undefined;
}
