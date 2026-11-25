import type { JsonValue } from "../ports.js";
import { isJsonObject } from "../tool-agent.js";

export interface ProviderErrorDetail {
  code?: string;
  status?: number;
  param?: string;
  requestId?: string;
  providerId?: string;
}

/**
 * Upstream error codes that represent terminal entitlement, quota, or OAuth state failures where
 * automatic transport retries will not recover and must stop immediately.
 */
export const NON_RETRYABLE_PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set([
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

export function isNonRetryableProviderErrorCode(code: string | undefined): boolean {
  return typeof code === "string" && NON_RETRYABLE_PROVIDER_ERROR_CODES.has(code.trim());
}

export class NonRetryableProviderError extends Error {
  readonly isRetryable = false;
  readonly code?: string;
  readonly statusCode?: number;
  readonly param?: string;
  readonly requestId?: string;
  readonly providerId?: string;

  constructor(message: string, detail: ProviderErrorDetail = {}) {
    super(message);
    this.name = "NonRetryableProviderError";
    if (detail.code !== undefined) this.code = detail.code;
    if (detail.status !== undefined) this.statusCode = detail.status;
    if (detail.param !== undefined) this.param = detail.param;
    if (detail.requestId !== undefined) this.requestId = detail.requestId;
    if (detail.providerId !== undefined) this.providerId = detail.providerId;
  }
}

type AiSdkApiCallError = Error & {
  statusCode?: number;
  status?: number;
  code?: string;
  param?: string;
  requestId?: string;
  providerId?: string;
  responseBody?: unknown;
  responseHeaders?: Record<string, string | undefined>;
  data?: unknown;
};

function tryParseJsonValue(value: unknown): JsonValue | undefined {
  if (typeof value !== "string") {
    return value as JsonValue | undefined;
  }

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function readNestedApiErrorMessage(body: JsonValue | undefined): string | undefined {
  if (!isJsonObject(body)) {
    return undefined;
  }

  const nestedError = body.error;
  if (isJsonObject(nestedError) && typeof nestedError.message === "string") {
    const message = nestedError.message.trim();
    if (message) {
      return message;
    }
  }

  if (typeof body.message === "string") {
    const message = body.message.trim();
    if (message) {
      return message;
    }
  }

  return undefined;
}

function isUselessRenderedProviderError(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === "[object Object]";
}

function readProviderErrorMessageField(error: Record<string, unknown>): string | undefined {
  const errorMessage = error.error_message;
  if (typeof errorMessage !== "string") {
    return undefined;
  }
  const trimmed = errorMessage.trim();
  if (!trimmed) {
    return undefined;
  }
  const fromNested = readNestedApiErrorMessage(tryParseJsonValue(trimmed));
  if (fromNested) {
    return fromNested;
  }
  return trimmed;
}

function extractPlainObjectProviderError(error: Record<string, unknown>): string | undefined {
  const fromErrorMessageField = readProviderErrorMessageField(error);
  if (fromErrorMessageField) {
    return fromErrorMessageField;
  }

  for (const key of ["value", "cause"] as const) {
    const nested = error[key];
    if (nested === undefined || nested === error) {
      continue;
    }
    const rendered = renderAiSdkProviderError(nested);
    if (!isUselessRenderedProviderError(rendered)) {
      return rendered;
    }
  }

  const fromNested = readNestedApiErrorMessage(error as JsonValue);
  if (fromNested) {
    return fromNested;
  }

  const asApiError = error as unknown as AiSdkApiCallError;
  if (
    typeof error.responseBody !== "undefined" ||
    typeof error.statusCode === "number" ||
    typeof error.message === "string"
  ) {
    const fromApi = extractAiSdkApiErrorMessage(asApiError);
    if (fromApi && !isUselessRenderedProviderError(fromApi)) {
      return fromApi;
    }
  }

  if (typeof error.message === "string") {
    const message = error.message.trim();
    if (message && !isUselessRenderedProviderError(message)) {
      return message;
    }
  }

  if (typeof error.name === "string" && typeof error.statusCode === "number") {
    const label = error.name.trim() || "API request failed";
    return `${label} (HTTP ${error.statusCode})`;
  }

  return undefined;
}

function extractAiSdkApiErrorMessage(error: AiSdkApiCallError): string | undefined {
  const direct = typeof error.message === "string" ? error.message.trim() : "";
  if (direct && !isUselessRenderedProviderError(direct)) {
    return direct;
  }

  const fromResponseBody = readNestedApiErrorMessage(tryParseJsonValue(error.responseBody));
  if (fromResponseBody) {
    return fromResponseBody;
  }

  const fromData = readNestedApiErrorMessage(tryParseJsonValue(error.data));
  if (fromData) {
    return fromData;
  }

  if (typeof error.statusCode === "number") {
    const label = error.name?.trim() || "API request failed";
    return `${label} (HTTP ${error.statusCode})`;
  }

  return undefined;
}

/** Render AI SDK provider errors for user-visible turn failure text. */
export function renderAiSdkProviderError(error: unknown): string {
  if (error instanceof Error) {
    const rendered = extractAiSdkApiErrorMessage(error);
    if (rendered && !isUselessRenderedProviderError(rendered)) {
      return rendered;
    }
    if ("cause" in error && error.cause !== undefined && error.cause !== error) {
      const fromCause = renderAiSdkProviderError(error.cause);
      if (!isUselessRenderedProviderError(fromCause)) {
        return fromCause;
      }
    }
    return rendered ?? (error.name.trim() || "Unknown error");
  }

  if (isJsonObject(error as JsonValue)) {
    const fromObject = extractPlainObjectProviderError(error as Record<string, unknown>);
    if (fromObject) {
      return fromObject;
    }
  }

  return String(error);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

export function extractProviderErrorDetailFromBody(
  body: unknown,
  fallbackStatus?: number,
  requestId?: string,
): ProviderErrorDetail | undefined {
  const parsed = tryParseJsonValue(body);
  let code: string | undefined;
  let param: string | undefined;
  let bodyRequestId: string | undefined;

  if (isJsonObject(parsed)) {
    const nested = parsed.error;
    if (isJsonObject(nested)) {
      code = readNonEmptyString(nested.code) ?? readNonEmptyString(nested.type);
      param = readNonEmptyString(nested.param);
      bodyRequestId = readNonEmptyString(nested.request_id);
    } else if (typeof nested === "string") {
      code = readNonEmptyString(nested);
    }
    if (!code) {
      code = readNonEmptyString(parsed.code);
    }
    if (!param) {
      param = readNonEmptyString(parsed.param);
    }
    if (!bodyRequestId) {
      bodyRequestId = readNonEmptyString(parsed.request_id);
    }
  }

  const resolvedRequestId = readNonEmptyString(requestId) ?? bodyRequestId;
  const resolvedStatus = readHttpStatus(fallbackStatus);
  if (!code && resolvedStatus === undefined && !param && !resolvedRequestId) {
    return undefined;
  }

  return {
    ...(code ? { code } : {}),
    ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
    ...(param ? { param } : {}),
    ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
  };
}

function mergeProviderErrorDetails(
  primary: ProviderErrorDetail | undefined,
  secondary: ProviderErrorDetail | undefined,
): ProviderErrorDetail | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return {
    ...((primary.code ?? secondary.code) ? { code: primary.code ?? secondary.code } : {}),
    ...((primary.status ?? secondary.status !== undefined)
      ? { status: primary.status ?? secondary.status }
      : {}),
    ...((primary.param ?? secondary.param) ? { param: primary.param ?? secondary.param } : {}),
    ...((primary.requestId ?? secondary.requestId)
      ? { requestId: primary.requestId ?? secondary.requestId }
      : {}),
    ...((primary.providerId ?? secondary.providerId)
      ? { providerId: primary.providerId ?? secondary.providerId }
      : {}),
  };
}

function readHeaderCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return readNonEmptyString(value);
    }
  }
  return undefined;
}

/** Extract structured machine-readable error metadata from AI SDK / upstream provider errors. */
export function extractAiSdkProviderErrorDetail(
  error: unknown,
  seen: Set<unknown> = new Set(),
): ProviderErrorDetail | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) {
    return undefined;
  }
  seen.add(error);

  const record = error as AiSdkApiCallError & Record<string, unknown>;
  const status = readHttpStatus(record.statusCode) ?? readHttpStatus(record.status);
  const requestId =
    readNonEmptyString(record.requestId) ??
    readHeaderCaseInsensitive(record.responseHeaders, "x-request-id");
  const directCode = readNonEmptyString(record.code);
  const directParam = readNonEmptyString(record.param);
  const directProviderId = readNonEmptyString(record.providerId);

  let detail: ProviderErrorDetail | undefined =
    directCode || status !== undefined || directParam || requestId || directProviderId
      ? {
          ...(directCode ? { code: directCode } : {}),
          ...(status !== undefined ? { status } : {}),
          ...(directParam ? { param: directParam } : {}),
          ...(requestId ? { requestId } : {}),
          ...(directProviderId ? { providerId: directProviderId } : {}),
        }
      : undefined;

  if (record.responseBody !== undefined) {
    detail = mergeProviderErrorDetails(
      detail,
      extractProviderErrorDetailFromBody(record.responseBody, status, requestId),
    );
  }
  if (record.data !== undefined) {
    detail = mergeProviderErrorDetails(
      detail,
      extractProviderErrorDetailFromBody(record.data, status, requestId),
    );
  }
  if (record.error !== undefined) {
    detail = mergeProviderErrorDetails(
      detail,
      extractProviderErrorDetailFromBody({ error: record.error }, status, requestId),
    );
  }
  if (record.lastError !== undefined) {
    detail = mergeProviderErrorDetails(
      detail,
      extractAiSdkProviderErrorDetail(record.lastError, seen),
    );
  }
  if (record.cause !== undefined) {
    detail = mergeProviderErrorDetails(detail, extractAiSdkProviderErrorDetail(record.cause, seen));
  }
  if (record.value !== undefined) {
    detail = mergeProviderErrorDetails(detail, extractAiSdkProviderErrorDetail(record.value, seen));
  }

  return detail;
}
