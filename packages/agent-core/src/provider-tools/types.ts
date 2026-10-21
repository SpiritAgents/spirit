import type { JsonObject, JsonValue } from "../ports.js";

/** Fixed result slots the markdown result renderer understands (`execute.fields` keys). */
export const PROVIDER_TOOL_RESULT_FIELDS = [
  "title",
  "url",
  "site",
  "time",
  "snippet",
  "content",
] as const;

export type ProviderToolResultField = (typeof PROVIDER_TOOL_RESULT_FIELDS)[number];

/** Maps a fixed result slot to the field name used inside each upstream result entry. */
export type ProviderToolFieldsMap = Partial<Record<ProviderToolResultField, string>>;

export interface ProviderToolsFromDeclaration {
  /** Relative to the provider `apiBase`; overridden by `url` when both are set. */
  path?: string;
  /** Absolute URL; overrides `path`. */
  url?: string;
  /** Dot path of the tool list inside the response JSON; defaults to `"tools"`. */
  listPath?: string;
}

export interface ProviderToolExecuteDeclaration {
  /** Relative to the provider `apiBase`; overridden by `url` when both are set. */
  path?: string;
  /** Absolute URL; overrides `path`. */
  url?: string;
  /**
   * Request body template. Literals pass through; placeholders `{toolName}`, `{argumentsJson}`,
   * and `{arg.<dot.path>}` interpolate from the tool call.
   */
  body?: JsonObject;
  /** Optional response status gate; the status value must equal `okValue`. */
  statusPath?: string;
  /** Expected value at `statusPath`; defaults to `"succeeded"`. */
  okValue?: string;
  /** Error lookup on status mismatch; an array is a first-non-empty-wins chain. */
  errorPath?: string | string[];
  /** Text result extraction; an array is a first-non-empty-wins chain. */
  resultPath?: string | string[];
  /** Result array extraction; must be paired with `fields`. */
  resultsPath?: string;
  /** Slot mapping for `resultsPath` entries; must be paired with `resultsPath`. */
  fields?: ProviderToolFieldsMap;
}

export interface ProviderToolUiDeclaration {
  /** `false` forbids expanding the tool-call details (e.g. server-side ciphertext output). Defaults to `true`. */
  expand?: boolean;
}

/**
 * One declared provider tool entry. Must carry at least one of `tools` / `toolsFrom` / `body`;
 * `execute` requires `tools` or `toolsFrom`.
 */
export interface ProviderToolEntry {
  label?: string;
  /**
   * Literal tool entries merged verbatim into the request `tools[]` while the entry is enabled.
   * Trace-marker entries (`function_name`-keyed) are the exception: recognition and trace only,
   * never wire-merged.
   */
  tools?: JsonObject[];
  toolsFrom?: ProviderToolsFromDeclaration;
  /** Literal body fields merged into the request body top level while the entry is enabled. */
  body?: JsonObject;
  execute?: ProviderToolExecuteDeclaration;
  ui?: ProviderToolUiDeclaration;
}

/** OpenAI function tool shape; the only shape that contributes names/schemas to recognition. */
export type OpenAiFunctionToolEntry = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonObject;
  };
};

export class ProviderToolConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderToolConfigError";
  }
}

export function isPlainJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a dot path (`a.b.0.c`) out of JSON data; array segments index arrays, missing links yield undefined. */
export function readJsonDotPathValue(value: unknown, path: string): JsonValue | undefined {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        return undefined;
      }
      current = current[Number(segment)];
      continue;
    }
    if (!isPlainJsonObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current as JsonValue | undefined;
}

export function isOpenAiFunctionToolEntry(value: unknown): value is OpenAiFunctionToolEntry {
  if (!isPlainJsonObject(value)) {
    return false;
  }
  if (value.type !== "function" || !isPlainJsonObject(value.function)) {
    return false;
  }
  const name = value.function.name;
  return typeof name === "string" && name.trim().length > 0;
}

/**
 * Trace-marker literal entries (formula-style registrations) key on `function_name`. They exist
 * for recognition and the request trace only and must never reach the wire: upstream chat
 * endpoints reject tool types they do not define.
 */
export function isTraceMarkerToolEntry(value: unknown): value is JsonObject {
  return (
    isPlainJsonObject(value) &&
    !isOpenAiFunctionToolEntry(value) &&
    typeof value.function_name === "string" &&
    value.function_name.trim().length > 0
  );
}

const ENTRY_KEYS = new Set(["label", "tools", "toolsFrom", "body", "execute", "ui"]);
const TOOLS_FROM_KEYS = new Set(["path", "url", "listPath"]);
const EXECUTE_KEYS = new Set([
  "path",
  "url",
  "body",
  "statusPath",
  "okValue",
  "errorPath",
  "resultPath",
  "resultsPath",
  "fields",
]);
const UI_KEYS = new Set(["expand"]);
const RESULT_FIELD_KEYS: ReadonlySet<string> = new Set(PROVIDER_TOOL_RESULT_FIELDS);

function rejectUnknownKeys(
  record: JsonObject,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ProviderToolConfigError(`${context}: unknown key ${JSON.stringify(key)}.`);
    }
  }
}

function requireOptionalString(record: JsonObject, key: string, context: string): void {
  const value = record[key];
  if (value !== undefined && typeof value !== "string") {
    throw new ProviderToolConfigError(`${context}: ${JSON.stringify(key)} must be a string.`);
  }
}

function requireOptionalStringOrStringArray(
  record: JsonObject,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return;
  }
  throw new ProviderToolConfigError(
    `${context}: ${JSON.stringify(key)} must be a string or an array of strings.`,
  );
}

function hasNonBlankString(record: JsonObject, key: string): boolean {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0;
}

function validateToolsFrom(toolsFrom: unknown, context: string): void {
  if (!isPlainJsonObject(toolsFrom)) {
    throw new ProviderToolConfigError(`${context}: "toolsFrom" must be an object.`);
  }
  rejectUnknownKeys(toolsFrom, TOOLS_FROM_KEYS, `${context} toolsFrom`);
  requireOptionalString(toolsFrom, "path", `${context} toolsFrom`);
  requireOptionalString(toolsFrom, "url", `${context} toolsFrom`);
  requireOptionalString(toolsFrom, "listPath", `${context} toolsFrom`);
  if (!hasNonBlankString(toolsFrom, "path") && !hasNonBlankString(toolsFrom, "url")) {
    throw new ProviderToolConfigError(
      `${context}: "toolsFrom" requires at least one of "path" or "url".`,
    );
  }
}

function validateExecute(execute: unknown, context: string): void {
  if (!isPlainJsonObject(execute)) {
    throw new ProviderToolConfigError(`${context}: "execute" must be an object.`);
  }
  rejectUnknownKeys(execute, EXECUTE_KEYS, `${context} execute`);
  requireOptionalString(execute, "path", `${context} execute`);
  requireOptionalString(execute, "url", `${context} execute`);
  requireOptionalString(execute, "statusPath", `${context} execute`);
  requireOptionalString(execute, "okValue", `${context} execute`);
  requireOptionalString(execute, "resultsPath", `${context} execute`);
  requireOptionalStringOrStringArray(execute, "errorPath", `${context} execute`);
  requireOptionalStringOrStringArray(execute, "resultPath", `${context} execute`);
  if (!hasNonBlankString(execute, "path") && !hasNonBlankString(execute, "url")) {
    throw new ProviderToolConfigError(
      `${context}: "execute" requires at least one of "path" or "url".`,
    );
  }
  if (execute.body !== undefined && !isPlainJsonObject(execute.body)) {
    throw new ProviderToolConfigError(`${context}: "execute.body" must be an object.`);
  }
  const hasResultsPath = execute.resultsPath !== undefined;
  const hasFields = execute.fields !== undefined;
  if (hasResultsPath !== hasFields) {
    throw new ProviderToolConfigError(
      `${context}: "resultsPath" and "fields" must be declared together.`,
    );
  }
  if (execute.resultPath !== undefined && hasResultsPath) {
    throw new ProviderToolConfigError(
      `${context}: "resultPath" and "resultsPath" are mutually exclusive.`,
    );
  }
  if (hasFields) {
    if (!isPlainJsonObject(execute.fields)) {
      throw new ProviderToolConfigError(`${context}: "execute.fields" must be an object.`);
    }
    for (const [slot, fieldName] of Object.entries(execute.fields)) {
      if (!RESULT_FIELD_KEYS.has(slot)) {
        throw new ProviderToolConfigError(
          `${context}: unknown "execute.fields" slot ${JSON.stringify(slot)}; allowed: ${PROVIDER_TOOL_RESULT_FIELDS.join(", ")}.`,
        );
      }
      if (typeof fieldName !== "string" || fieldName.trim().length === 0) {
        throw new ProviderToolConfigError(
          `${context}: "execute.fields.${slot}" must be a non-empty string.`,
        );
      }
    }
  }
}

function validateUi(ui: unknown, context: string): void {
  if (!isPlainJsonObject(ui)) {
    throw new ProviderToolConfigError(`${context}: "ui" must be an object.`);
  }
  rejectUnknownKeys(ui, UI_KEYS, `${context} ui`);
  if (ui.expand !== undefined && typeof ui.expand !== "boolean") {
    throw new ProviderToolConfigError(`${context}: "ui.expand" must be a boolean.`);
  }
}

/** Entry-level fail-fast validation per the providerTools contract; returns the entry typed on success. */
export function validateProviderToolEntry(
  entry: unknown,
  context = "providerTools entry",
): ProviderToolEntry {
  if (!isPlainJsonObject(entry)) {
    throw new ProviderToolConfigError(`${context} must be an object.`);
  }
  rejectUnknownKeys(entry, ENTRY_KEYS, context);
  requireOptionalString(entry, "label", context);
  if (entry.tools !== undefined) {
    if (!Array.isArray(entry.tools) || entry.tools.some((tool) => !isPlainJsonObject(tool))) {
      throw new ProviderToolConfigError(`${context}: "tools" must be an array of objects.`);
    }
  }
  if (entry.toolsFrom !== undefined) {
    validateToolsFrom(entry.toolsFrom, context);
  }
  if (entry.body !== undefined && !isPlainJsonObject(entry.body)) {
    throw new ProviderToolConfigError(`${context}: "body" must be an object.`);
  }
  if (entry.execute !== undefined) {
    validateExecute(entry.execute, context);
    if (entry.tools === undefined && entry.toolsFrom === undefined) {
      throw new ProviderToolConfigError(
        `${context}: "execute" requires "tools" or "toolsFrom" on the same entry.`,
      );
    }
  }
  if (entry.ui !== undefined) {
    validateUi(entry.ui, context);
  }
  if (entry.tools === undefined && entry.toolsFrom === undefined && entry.body === undefined) {
    throw new ProviderToolConfigError(
      `${context} must declare at least one of "tools", "toolsFrom", or "body".`,
    );
  }
  return entry as ProviderToolEntry;
}

export function validateProviderToolEntries(
  entries: unknown,
  context = "providerTools",
): ProviderToolEntry[] {
  if (!Array.isArray(entries)) {
    throw new ProviderToolConfigError(`${context} must be an array.`);
  }
  return entries.map((entry, index) => validateProviderToolEntry(entry, `${context}[${index}]`));
}
