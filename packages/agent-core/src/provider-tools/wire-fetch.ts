import type { JsonObject, JsonValue } from "../ports.js";
import { isPlainJsonObject } from "./types.js";
import type { ResolvedProviderTools } from "./runtime.js";

type FetchFn = typeof fetch;

/**
 * Identity key for dedup when merging literal tool entries into a request `tools[]`:
 * function-shaped entries key on `function.name`, server tools on `name`, provider references on
 * `id`, formula-style trace entries on `function_name`.
 */
function literalToolEntryKey(tool: unknown): string | undefined {
  if (!isPlainJsonObject(tool)) {
    return undefined;
  }
  if (isPlainJsonObject(tool.function)) {
    const name = tool.function.name;
    if (typeof name === "string") {
      return `function\0${name}`;
    }
  }
  const type = typeof tool.type === "string" ? tool.type : "";
  for (const field of ["name", "id", "function_name"] as const) {
    const value = tool[field];
    if (typeof value === "string" && value.length > 0) {
      return `${type}\0${field}\0${value}`;
    }
  }
  return undefined;
}

/** Model-request bodies carry the conversation under `messages` / `input` / `prompt` (array forms). */
function isModelRequestBody(body: JsonObject): boolean {
  return Array.isArray(body.messages) || Array.isArray(body.input) || Array.isArray(body.prompt);
}

export function mergeProviderToolLiteralEntries(
  existingTools: unknown,
  literalEntries: readonly JsonObject[],
): JsonValue[] {
  const merged: JsonValue[] = Array.isArray(existingTools) ? [...existingTools] : [];
  const seen = new Set<string>();
  for (const tool of merged) {
    const key = literalToolEntryKey(tool);
    if (key !== undefined) {
      seen.add(key);
    }
  }
  for (const entry of literalEntries) {
    const key = literalToolEntryKey(entry);
    if (key !== undefined && seen.has(key)) {
      continue;
    }
    if (key !== undefined) {
      seen.add(key);
    }
    merged.push(entry);
  }
  return merged;
}

/**
 * Fetch-layer merge for declaration-driven provider tools: literal (transport-native) tool entries
 * are appended to the request body's `tools[]`, and entry-level `body` patches merge into the body
 * top level. The caller layers this wrapper inside the provider-level declared wire merge, so an
 * explicit provider-level `body` declaration wins over entry-level patches on key conflicts.
 */
export function createProviderToolsWireFetch(
  resolved: Pick<ResolvedProviderTools, "literalEntries" | "bodyPatches">,
  baseFetch: FetchFn,
): FetchFn {
  if (resolved.literalEntries.length === 0 && resolved.bodyPatches.length === 0) {
    return baseFetch;
  }

  return async (input, init) => {
    if (init?.method?.toUpperCase() === "GET" || typeof init?.body !== "string") {
      return baseFetch(input, init);
    }

    let body: JsonValue;
    try {
      body = JSON.parse(init.body) as JsonValue;
    } catch {
      return baseFetch(input, init);
    }
    if (!isPlainJsonObject(body) || !isModelRequestBody(body)) {
      return baseFetch(input, init);
    }

    const patched: JsonObject = { ...body };
    for (const patch of resolved.bodyPatches) {
      Object.assign(patched, patch);
    }
    if (resolved.literalEntries.length > 0) {
      patched.tools = mergeProviderToolLiteralEntries(patched.tools, resolved.literalEntries);
    }

    return baseFetch(input, { ...init, body: JSON.stringify(patched) });
  };
}
