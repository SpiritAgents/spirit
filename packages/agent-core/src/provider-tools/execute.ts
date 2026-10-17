import { getLlmFetch } from "../llm-fetch.js";
import type { JsonObject, JsonValue } from "../ports.js";
import { resolveProviderEndpointUrl } from "./resolve.js";
import {
  isPlainJsonObject,
  readJsonDotPathValue,
  type ProviderToolExecuteDeclaration,
  type ProviderToolFieldsMap,
  type ProviderToolResultField,
} from "./types.js";

type FetchFn = typeof fetch;

export type ProviderToolExecuteResult =
  | { kind: "succeeded"; content: string }
  | { kind: "failed"; error: string };

export interface ProviderToolCall {
  toolName: string;
  argumentsJson: string;
}

export interface ProviderToolExecuteSite {
  apiBase: string;
  apiKey: string;
  fetchImpl?: FetchFn;
}

const WHOLE_VALUE_PLACEHOLDER = /^\{([^{}]+)\}$/;
const EMBEDDED_PLACEHOLDER = /\{([^{}]+)\}/g;

type PlaceholderResolution =
  | { kind: "value"; value: JsonValue }
  /** Known placeholder whose source value is missing. */
  | { kind: "missing" }
  /** Unknown token; the raw text stays untouched. */
  | { kind: "literal" };

type InterpolationOutcome =
  | { kind: "value"; value: JsonValue }
  /** Whole-value placeholder with a missing source: the object field is dropped entirely. */
  | { kind: "omit" }
  | { kind: "error"; error: string };

interface PlaceholderContext {
  toolName: string;
  argumentsJson: string;
  /** Parsed arguments; undefined when the arguments JSON does not parse. */
  argumentsValue: JsonValue | undefined;
}

function resolvePlaceholder(token: string, context: PlaceholderContext): PlaceholderResolution {
  if (token === "toolName") {
    return { kind: "value", value: context.toolName };
  }
  if (token === "argumentsJson") {
    return { kind: "value", value: context.argumentsJson };
  }
  if (token.startsWith("arg.")) {
    const path = token.slice("arg.".length);
    if (path.length === 0 || context.argumentsValue === undefined) {
      return { kind: "missing" };
    }
    const value = readJsonDotPathValue(context.argumentsValue, path);
    return value === undefined ? { kind: "missing" } : { kind: "value", value };
  }
  return { kind: "literal" };
}

function stringifyEmbeddedValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function interpolateTemplateValue(
  template: JsonValue,
  context: PlaceholderContext,
): InterpolationOutcome {
  if (typeof template === "string") {
    const whole = WHOLE_VALUE_PLACEHOLDER.exec(template);
    if (whole !== null) {
      // A field whose value is exactly one placeholder keeps the raw JSON type (numbers stay numbers).
      const resolution = resolvePlaceholder(whole[1] ?? "", context);
      switch (resolution.kind) {
        case "value":
          return { kind: "value", value: resolution.value };
        case "missing":
          return { kind: "omit" };
        case "literal":
          return { kind: "value", value: template };
      }
    }

    let error: string | undefined;
    const interpolated = template.replace(EMBEDDED_PLACEHOLDER, (raw, token: string) => {
      const resolution = resolvePlaceholder(token, context);
      if (resolution.kind === "value") {
        return stringifyEmbeddedValue(resolution.value);
      }
      if (resolution.kind === "missing") {
        error ??= `${context.toolName}: placeholder {${token}} has no value in the tool call arguments.`;
      }
      return raw;
    });
    if (error !== undefined) {
      return { kind: "error", error };
    }
    return { kind: "value", value: interpolated };
  }

  if (Array.isArray(template)) {
    const items: JsonValue[] = [];
    for (const item of template) {
      const outcome = interpolateTemplateValue(item, context);
      if (outcome.kind === "error") {
        return outcome;
      }
      if (outcome.kind === "omit") {
        return {
          kind: "error",
          error: `${context.toolName}: a placeholder inside an array element has no value in the tool call arguments.`,
        };
      }
      items.push(outcome.value);
    }
    return { kind: "value", value: items };
  }

  if (isPlainJsonObject(template)) {
    const record: JsonObject = {};
    for (const [key, value] of Object.entries(template)) {
      const outcome = interpolateTemplateValue(value, context);
      if (outcome.kind === "error") {
        return outcome;
      }
      if (outcome.kind === "omit") {
        continue;
      }
      record[key] = outcome.value;
    }
    return { kind: "value", value: record };
  }

  return { kind: "value", value: template };
}

export type ProviderToolBodyInterpolation =
  | { kind: "ok"; body: JsonObject }
  | { kind: "failed"; error: string };

/** Builds the execute request body from its template; a missing embedded value is a tool-argument error. */
export function interpolateProviderToolExecuteBody(
  template: JsonObject,
  call: ProviderToolCall,
): ProviderToolBodyInterpolation {
  let argumentsValue: JsonValue | undefined;
  try {
    argumentsValue = JSON.parse(call.argumentsJson) as JsonValue;
  } catch {
    argumentsValue = undefined;
  }

  const outcome = interpolateTemplateValue(template, {
    toolName: call.toolName,
    argumentsJson: call.argumentsJson,
    argumentsValue,
  });
  if (outcome.kind === "error") {
    return { kind: "failed", error: outcome.error };
  }
  return {
    kind: "ok",
    body: outcome.kind === "value" && isPlainJsonObject(outcome.value) ? outcome.value : {},
  };
}

function readFirstNonEmptyString(
  payload: unknown,
  paths: string | string[] | undefined,
): string | undefined {
  if (paths === undefined) {
    return undefined;
  }
  for (const path of Array.isArray(paths) ? paths : [paths]) {
    const value = readJsonDotPathValue(payload, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readResultSlot(
  record: JsonObject,
  fields: ProviderToolFieldsMap,
  slot: ProviderToolResultField,
): string | undefined {
  const fieldName = fields[slot];
  if (fieldName === undefined) {
    return undefined;
  }
  const value = record[fieldName];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const RESULT_SLOT_LABELS: ReadonlyArray<readonly [ProviderToolResultField, string]> = [
  ["url", "URL"],
  ["site", "Site"],
  ["time", "Time"],
  ["snippet", "Snippet"],
  ["content", "Content"],
];

/** Fixed markdown renderer for `resultsPath` + `fields` result arrays. */
export function renderProviderToolResults(
  results: readonly unknown[],
  fields: ProviderToolFieldsMap,
): string {
  if (results.length === 0) {
    return "No search results.";
  }

  return results
    .map((result, index) => {
      const record = isPlainJsonObject(result) ? result : {};
      const title = readResultSlot(record, fields, "title") ?? "Untitled";
      const lines = [`## ${index + 1}. ${title}`];
      for (const [slot, label] of RESULT_SLOT_LABELS) {
        const value = readResultSlot(record, fields, slot);
        if (value !== undefined) {
          lines.push(`${label}: ${value}`);
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Host-side execution of a declared provider tool call: POST the interpolated body template,
 * gate on `statusPath`/`okValue`, then extract text via `resultPath`, render `resultsPath` +
 * `fields`, or fall back to the raw response JSON.
 */
export async function executeProviderToolCall(
  execute: ProviderToolExecuteDeclaration,
  call: ProviderToolCall,
  site: ProviderToolExecuteSite,
): Promise<ProviderToolExecuteResult> {
  let url: string;
  try {
    url = resolveProviderEndpointUrl(site.apiBase, execute);
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  const interpolation = interpolateProviderToolExecuteBody(execute.body ?? {}, call);
  if (interpolation.kind === "failed") {
    return { kind: "failed", error: interpolation.error };
  }

  const fetchImpl = site.fetchImpl ?? getLlmFetch();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${site.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(interpolation.body),
    });
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const suffix = text.trim() ? `: ${text.trim()}` : "";
    return {
      kind: "failed",
      error: `Provider tool "${call.toolName}" request failed (${response.status})${suffix}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      kind: "failed",
      error: `Provider tool "${call.toolName}" returned a non-JSON response.`,
    };
  }

  const statusPath = execute.statusPath?.trim();
  if (statusPath) {
    const status = readJsonDotPathValue(payload, statusPath);
    const okValue = execute.okValue ?? "succeeded";
    if (typeof status !== "string" || status !== okValue) {
      const detail = readFirstNonEmptyString(payload, execute.errorPath);
      const statusText = typeof status === "string" && status.trim() ? status : "unknown";
      return {
        kind: "failed",
        error: detail ?? `Provider tool "${call.toolName}" did not succeed (status=${statusText}).`,
      };
    }
  }

  if (execute.resultPath !== undefined) {
    const content = readFirstNonEmptyString(payload, execute.resultPath);
    if (content === undefined) {
      const paths = Array.isArray(execute.resultPath)
        ? execute.resultPath.join(", ")
        : execute.resultPath;
      return {
        kind: "failed",
        error: `Provider tool "${call.toolName}" response had no result at ${paths}.`,
      };
    }
    return { kind: "succeeded", content };
  }

  const resultsPath = execute.resultsPath?.trim();
  if (resultsPath && execute.fields !== undefined) {
    const list = readJsonDotPathValue(payload, resultsPath);
    return {
      kind: "succeeded",
      content: renderProviderToolResults(Array.isArray(list) ? list : [], execute.fields),
    };
  }

  return { kind: "succeeded", content: JSON.stringify(payload) };
}
