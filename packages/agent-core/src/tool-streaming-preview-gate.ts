import { finishTaskStreamingPreviewReady } from "./finish-task-preview.js";
import type { JsonValue } from "./ports.js";
import { isJsonObject } from "./tool-agent.js";

const PARTIAL_PATH_PATTERN = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/;
const PARTIAL_PLAN_NAME_PATTERN = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/;
const PARTIAL_QUERY_PATTERN = /"query"\s*:\s*"((?:\\.|[^"\\])*)/;
const PARTIAL_SUBAGENT_TASK_PATTERN = /"task"\s*:\s*"((?:\\.|[^"\\])*)/;
const PARTIAL_APPLY_PATCH_OPERATION_TYPE_PATTERN =
  /"type"\s*:\s*"(create_file|update_file|delete_file)"/;
const PARTIAL_POSITIVE_INT_FIELD_PATTERN = (key: string): RegExp =>
  new RegExp(`"${key}"\\s*:\\s*(\\d+)`);

export interface PartialReadFileToolFields {
  path?: string;
  offset?: number;
  limit?: number;
}

function tryExtractPartialPositiveInt(argumentsJson: string, key: string): number | undefined {
  const match = argumentsJson.match(PARTIAL_POSITIVE_INT_FIELD_PATTERN(key));
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Extract read_file fields tolerating incomplete JSON while arguments stream in. */
export function tryExtractPartialReadFileFields(argumentsJson: string): PartialReadFileToolFields {
  const path = tryExtractPartialToolPath(argumentsJson);
  const offset = tryExtractPartialPositiveInt(argumentsJson, "offset");
  const limit = tryExtractPartialPositiveInt(argumentsJson, "limit");
  return {
    ...(path ? { path } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function readFileStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const fields = tryExtractPartialReadFileFields(argumentsJson);
  if (!fields.path) {
    return undefined;
  }
  return `${fields.path}\0${fields.offset ?? ""}\0${fields.limit ?? ""}`;
}

function decodePartialJsonString(match: string): string | undefined {
  try {
    return JSON.parse(`"${match}"`) as string;
  } catch {
    return match;
  }
}

/** Extract apply_patch `operation.path` from complete or in-flight JSON. */
export function tryExtractPartialApplyPatchPath(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && isJsonObject(parsed.operation)) {
      const path = parsed.operation.path;
      if (typeof path === "string" && path.trim()) {
        return path.trim();
      }
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  return tryExtractPartialToolPath(argumentsJson);
}

/** Extract `path` from complete or in-flight tool argument JSON. */
export function tryExtractPartialToolPath(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.path === "string" && parsed.path.trim()) {
      return parsed.path.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_PATH_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return decodePartialJsonString(match[1]);
}

/** Extract `query` from complete or in-flight web_search argument JSON. */
export function tryExtractPartialWebSearchQuery(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_QUERY_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const decoded = decodePartialJsonString(match[1]);
  return decoded?.trim() ? decoded.trim() : undefined;
}

export function webSearchStreamingPreviewSignature(argumentsJson: string): string | undefined {
  return tryExtractPartialWebSearchQuery(argumentsJson);
}

/** Extract `task` from complete or in-flight subagent argument JSON. */
export function tryExtractPartialSubagentTask(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.task === "string" && parsed.task.trim()) {
      return parsed.task.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_SUBAGENT_TASK_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const decoded = decodePartialJsonString(match[1]);
  return decoded?.trim() ? decoded.trim() : undefined;
}

export function subagentStreamingPreviewSignature(argumentsJson: string): string | undefined {
  return tryExtractPartialSubagentTask(argumentsJson);
}

export function tryExtractPartialPlanName(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_PLAN_NAME_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return decodePartialJsonString(match[1]);
}

function tryExtractPartialLazyToolGatewayFields(argumentsJson: string): {
  provider?: string;
  server?: string;
  tool?: string;
} {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (!isJsonObject(parsed)) {
      return {};
    }
    return {
      ...(typeof parsed.provider === "string" && parsed.provider.trim()
        ? { provider: parsed.provider.trim() }
        : {}),
      ...(typeof parsed.server === "string" && parsed.server.trim()
        ? { server: parsed.server.trim() }
        : {}),
      ...(typeof parsed.tool === "string" && parsed.tool.trim()
        ? { tool: parsed.tool.trim() }
        : {}),
    };
  } catch {
    const providerMatch = trimmed.match(/"provider"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const serverMatch = trimmed.match(/"server"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const toolMatch = trimmed.match(/"tool"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const fields: { provider?: string; server?: string; tool?: string } = {};
    if (providerMatch?.[1]) {
      const provider = decodePartialJsonString(providerMatch[1]);
      if (provider) {
        fields.provider = provider;
      }
    }
    if (serverMatch?.[1]) {
      const server = decodePartialJsonString(serverMatch[1]);
      if (server) {
        fields.server = server;
      }
    }
    if (toolMatch?.[1]) {
      const tool = decodePartialJsonString(toolMatch[1]);
      if (tool) {
        fields.tool = tool;
      }
    }
    return fields;
  }
}

function tryExtractPartialFetchMcpResourceFields(argumentsJson: string): {
  server?: string;
  uri?: string;
} {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (!isJsonObject(parsed)) {
      return {};
    }
    return {
      ...(typeof parsed.server === "string" && parsed.server.trim()
        ? { server: parsed.server.trim() }
        : {}),
      ...(typeof parsed.uri === "string" && parsed.uri.trim() ? { uri: parsed.uri.trim() } : {}),
    };
  } catch {
    const serverMatch = trimmed.match(/"server"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const uriMatch = trimmed.match(/"uri"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const fields: { server?: string; uri?: string } = {};
    if (serverMatch?.[1]) {
      const server = decodePartialJsonString(serverMatch[1]);
      if (server) {
        fields.server = server;
      }
    }
    if (uriMatch?.[1]) {
      const uri = decodePartialJsonString(uriMatch[1]);
      if (uri) {
        fields.uri = uri;
      }
    }
    return fields;
  }
}

export function hostToolArgumentsReadyForEarlyStreamingPreview(
  name: string,
  argumentsJson: string,
): boolean {
  switch (name) {
    case "apply_patch":
      // Decoupled readiness: the model may stream the diff body (or the operation type) long
      // before `path` arrives — any parseable piece readies the preview, not just the path.
      return applyPatchStreamingPreviewSignature(argumentsJson) !== undefined;
    case "edit_file":
    case "create_file":
      return tryExtractPartialToolPath(argumentsJson) !== undefined;
    case "create_plan":
      return tryExtractPartialPlanName(argumentsJson) !== undefined;
    case "read_file":
    case "ls":
    case "delete_file":
      return tryExtractPartialToolPath(argumentsJson) !== undefined;
    case "glob":
    case "grep":
    case "shell":
    case "web_fetch":
      return hostToolArgumentsReadyForPreview(name, argumentsJson);
    case "subagent":
      return tryExtractPartialSubagentTask(argumentsJson) !== undefined;
    case "web_search":
      return tryExtractPartialWebSearchQuery(argumentsJson) !== undefined;
    case "tool_call":
    case "tool_describe": {
      const fields = tryExtractPartialLazyToolGatewayFields(argumentsJson);
      return Boolean(fields.provider || fields.server || fields.tool);
    }
    default:
      return false;
  }
}

export function hostToolArgumentsReadyForPreview(name: string, argumentsJson: string): boolean {
  if (name === "finish_task") {
    return finishTaskStreamingPreviewReady(name, argumentsJson);
  }

  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(trimmed) as JsonValue;
  } catch {
    return false;
  }

  if (!isJsonObject(parsed)) {
    return false;
  }

  const nonEmpty = (key: string): boolean => {
    const value = parsed[key];
    return typeof value === "string" && value.trim().length > 0;
  };

  switch (name) {
    case "shell":
      return nonEmpty("command");
    case "web_fetch":
      return nonEmpty("url");
    case "ls":
      return nonEmpty("path");
    case "read_file":
      return nonEmpty("path");
    case "glob":
      return nonEmpty("pattern");
    case "grep":
      return nonEmpty("query");
    case "subagent":
      return nonEmpty("task");
    case "apply_patch": {
      const operation = parsed.operation;
      if (!isJsonObject(operation)) {
        return false;
      }
      const opType = operation.type;
      const opPath = operation.path;
      if (typeof opType !== "string" || typeof opPath !== "string" || !opPath.trim()) {
        return false;
      }
      if (opType === "delete_file") {
        return true;
      }
      return typeof operation.diff === "string" && operation.diff.length > 0;
    }
    case "create_file":
      return nonEmpty("path") && nonEmpty("content");
    case "create_plan":
      return nonEmpty("name") && nonEmpty("content");
    case "edit_file":
      return nonEmpty("path") && nonEmpty("old_text") && nonEmpty("new_text");
    case "delete_file":
      return nonEmpty("path");
    case "ask_questions":
      return Array.isArray(parsed.questions) && parsed.questions.length > 0;
    default:
      return Object.values(parsed).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
  }
}

function lazyToolGatewayStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const fields = tryExtractPartialLazyToolGatewayFields(argumentsJson);
  const parts: string[] = [];
  if (fields.provider) {
    parts.push(`p:${fields.provider}`);
  }
  if (fields.server) {
    parts.push(`s:${fields.server}`);
  }
  if (fields.tool) {
    parts.push(`t:${fields.tool}`);
  }

  const titleMatch = argumentsJson.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/u);
  const rawTitle = titleMatch?.[1];
  if (rawTitle) {
    const title = decodePartialJsonString(rawTitle)?.trim();
    if (title) {
      parts.push(`title:${title}`);
    }
  }

  const hourMatch = argumentsJson.match(/"hour"\s*:\s*(\d+)/u);
  const minuteMatch = argumentsJson.match(/"minute"\s*:\s*(\d+)/u);
  if (hourMatch?.[1] && minuteMatch?.[1]) {
    parts.push(`tr:${hourMatch[1]}:${minuteMatch[1]}`);
  }

  return parts.length > 0 ? parts.join("|") : undefined;
}

/** Marker-line (+/-) counts in a possibly in-flight apply_patch diff. */
function applyPatchDiffLineCounts(diff: string): { added: number; removed: number } | undefined {
  let added = 0;
  let removed = 0;
  for (const rawLine of diff.split(/\r?\n/u)) {
    const marker = rawLine === "" ? " " : rawLine[0];
    if (marker === "+") {
      added += 1;
    } else if (marker === "-") {
      removed += 1;
    }
    // " " context lines, "@@" anchors and "***" markers carry no delta.
  }
  return added === 0 && removed === 0 ? undefined : { added, removed };
}

/** Re-emit when the apply_patch operation type / target path parse state or the diff's +/- counts change. */
function applyPatchStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts: string[] = [];
  const typeMatch = trimmed.match(PARTIAL_APPLY_PATCH_OPERATION_TYPE_PATTERN);
  if (typeMatch?.[1]) {
    parts.push(`t:${typeMatch[1]}`);
  }
  const path = tryExtractPartialApplyPatchPath(trimmed);
  if (path) {
    parts.push(`p:${path}`);
  }
  const diff = tryExtractPartialEditFileStringField(trimmed, "diff");
  if (diff !== undefined) {
    const counts = applyPatchDiffLineCounts(diff);
    if (counts) {
      parts.push(`d:${counts.added}:${counts.removed}`);
    }
  }
  return parts.length > 0 ? parts.join("|") : undefined;
}

export function shouldRepeatStreamingToolPreview(
  toolName: string,
  previousArgsLen: number,
  nextArgsLen: number,
  options?: {
    previousDetailSignature?: string;
    nextArgumentsJson?: string;
  },
): boolean {
  if (toolName === "read_file") {
    const nextSignature = options?.nextArgumentsJson
      ? readFileStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "edit_file") {
    const nextSignature = options?.nextArgumentsJson
      ? editFileStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "create_file" || toolName === "create_plan") {
    const nextSignature = options?.nextArgumentsJson
      ? createContentStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "web_search") {
    const nextSignature = options?.nextArgumentsJson
      ? webSearchStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "subagent") {
    const nextSignature = options?.nextArgumentsJson
      ? subagentStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "tool_call" || toolName === "tool_describe") {
    const nextSignature = options?.nextArgumentsJson
      ? lazyToolGatewayStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (toolName === "apply_patch") {
    const nextSignature = options?.nextArgumentsJson
      ? applyPatchStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  return false;
}

/**
 * Whether `read_file` args are safe to execute early.
 * Incomplete JSON must not start: offset/limit often stream after path, and a path-only
 * approval cannot be reused once the formal pass has a different range.
 */
export function readFilePartialAllowsEarlyExecution(argumentsJson: string): boolean {
  return hostToolArgumentsReadyForPreview("read_file", argumentsJson);
}

/**
 * Build minimal parseable tool-call JSON from in-flight arguments so preview-time early
 * execution can start before the model finishes the object.
 */
export function buildEarlyExecutableArgumentsJson(
  name: string,
  argumentsJson: string,
): string | undefined {
  if (!hostToolArgumentsReadyForEarlyStreamingPreview(name, argumentsJson)) {
    return undefined;
  }

  switch (name) {
    case "read_file":
      if (!readFilePartialAllowsEarlyExecution(argumentsJson)) {
        return undefined;
      }
      break;
    case "ls":
    case "delete_file":
      break;
    default:
      return undefined;
  }

  if (name === "read_file") {
    const fields = tryExtractPartialReadFileFields(argumentsJson);
    if (!fields.path) {
      return undefined;
    }
    return JSON.stringify({
      path: fields.path,
      ...(fields.offset !== undefined ? { offset: fields.offset } : {}),
      ...(fields.limit !== undefined ? { limit: fields.limit } : {}),
    });
  }

  const path = tryExtractPartialToolPath(argumentsJson);
  if (!path) {
    return undefined;
  }

  return JSON.stringify({ path });
}

/** Parse preview args for UI; tolerates incomplete JSON when `path` is already streamed. */
export function previewRequestFromStreamingArguments(
  toolName: string,
  argumentsJson: string,
): unknown {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    if (toolName === "read_file") {
      const fields = tryExtractPartialReadFileFields(argumentsJson);
      return fields.path ? fields : undefined;
    }
    if (
      toolName === "ls" ||
      toolName === "delete_file" ||
      toolName === "create_file" ||
      toolName === "edit_file"
    ) {
      const path = tryExtractPartialToolPath(argumentsJson);
      return path ? { path } : undefined;
    }
    if (toolName === "apply_patch") {
      const path = tryExtractPartialApplyPatchPath(argumentsJson);
      if (!path) {
        return undefined;
      }
      const typeMatch = trimmed.match(PARTIAL_APPLY_PATCH_OPERATION_TYPE_PATTERN);
      const operation: Record<string, string> = { path };
      if (typeMatch?.[1]) {
        operation.type = typeMatch[1];
      }
      return { operation };
    }
    if (toolName === "create_plan") {
      const name = tryExtractPartialPlanName(argumentsJson);
      return name ? { name } : undefined;
    }
    if (toolName === "tool_call" || toolName === "tool_describe") {
      const fields = tryExtractPartialLazyToolGatewayFields(argumentsJson);
      return fields.provider || fields.server || fields.tool ? fields : undefined;
    }
    if (toolName === "fetch_mcp_resource") {
      const fields = tryExtractPartialFetchMcpResourceFields(argumentsJson);
      return fields.server || fields.uri ? fields : undefined;
    }
    if (toolName === "web_search") {
      const query = tryExtractPartialWebSearchQuery(argumentsJson);
      return query ? { query } : undefined;
    }
    if (toolName === "subagent") {
      const task = tryExtractPartialSubagentTask(argumentsJson);
      return task ? { task } : undefined;
    }
    return undefined;
  }
}

/** Re-emit when create_file / create_plan `content` grows (line count + length). */
function createContentStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const content = tryExtractPartialEditFileStringField(argumentsJson, "content");
  if (content === undefined) {
    return undefined;
  }
  const lines = content ? content.split(/\r?\n/u).length : 0;
  if (lines === 0 && content.length === 0) {
    return undefined;
  }
  return `${lines}:${content.length}`;
}

/** Re-emit streaming preview when edit_file +/- line counts change (host/UI computes display). */
function editFileStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const oldText = tryExtractPartialEditFileStringField(argumentsJson, "old_text");
  const newText = tryExtractPartialEditFileStringField(argumentsJson, "new_text");
  if (oldText === undefined && newText === undefined) {
    return undefined;
  }
  const { added, removed } = editFileLineChangeCounts(oldText ?? "", newText ?? "");
  if (added === 0 && removed === 0) {
    return undefined;
  }
  return `${added}:${removed}`;
}

function tryExtractPartialEditFileStringField(
  argumentsJson: string,
  key: string,
): string | undefined {
  const marker = `"${key}"`;
  const keyIdx = argumentsJson.indexOf(marker);
  if (keyIdx < 0) {
    return undefined;
  }

  let i = keyIdx + marker.length;
  while (i < argumentsJson.length && /\s/u.test(argumentsJson[i]!)) {
    i += 1;
  }
  if (argumentsJson[i] !== ":") {
    return undefined;
  }
  i += 1;
  while (i < argumentsJson.length && /\s/u.test(argumentsJson[i]!)) {
    i += 1;
  }
  if (argumentsJson[i] !== '"') {
    return undefined;
  }
  i += 1;

  let result = "";
  while (i < argumentsJson.length) {
    const ch = argumentsJson[i]!;
    if (ch === '"') {
      return result;
    }
    if (ch === "\\") {
      i += 1;
      if (i >= argumentsJson.length) {
        break;
      }
      const esc = argumentsJson[i]!;
      if (esc === "u") {
        const hex = argumentsJson.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
          result += String.fromCodePoint(Number.parseInt(hex, 16));
          i += 5;
          continue;
        }
      }
      result += decodeEditFileJsonEscape(esc);
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }

  return result.length > 0 ? result : undefined;
}

function decodeEditFileJsonEscape(esc: string): string {
  switch (esc) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case '"':
      return '"';
    case "\\":
      return "\\";
    default:
      return esc;
  }
}

function editFileLineChangeCounts(
  oldText: string,
  newText: string,
): { added: number; removed: number } {
  const oldLines = oldText ? oldText.split(/\r?\n/u) : [];
  const newLines = newText ? newText.split(/\r?\n/u) : [];
  const lcs = editFileLongestCommonSubsequenceLength(oldLines, newLines);
  return {
    removed: oldLines.length - lcs,
    added: newLines.length - lcs,
  };
}

function editFileLongestCommonSubsequenceLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const rows = b.length + 1;
  let prev = new Uint32Array(rows);
  let curr = new Uint32Array(rows);

  for (let i = 1; i <= a.length; i += 1) {
    const aLine = a[i - 1]!;
    for (let j = 1; j <= b.length; j += 1) {
      if (aLine === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        curr[j] = Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }

  return prev[b.length] ?? 0;
}

export interface StreamingToolPreviewEmitState {
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

/** Emit a tool card as soon as the streamed function name first becomes available. */
export function shouldEmitStreamingToolNamePreview(
  toolName: string,
  previousToolName: string,
): boolean {
  const trimmed = toolName.trim();
  return trimmed.length > 0 && previousToolName.trim().length === 0 && trimmed !== "finish_task";
}

export function resolveStreamingToolPreviewEmit(
  toolName: string,
  argumentsJson: string,
  state: StreamingToolPreviewEmitState,
): { emit: boolean; nextState: StreamingToolPreviewEmitState } {
  const argsLen = argumentsJson.length;
  const earlyReady = hostToolArgumentsReadyForEarlyStreamingPreview(toolName, argumentsJson);
  const fullReady = hostToolArgumentsReadyForPreview(toolName, argumentsJson);
  const ready = earlyReady || fullReady;

  if (!ready) {
    return { emit: false, nextState: state };
  }

  const nextDetailSignature =
    toolName === "read_file"
      ? readFileStreamingPreviewSignature(argumentsJson)
      : toolName === "edit_file"
        ? editFileStreamingPreviewSignature(argumentsJson)
        : toolName === "create_file" || toolName === "create_plan"
          ? createContentStreamingPreviewSignature(argumentsJson)
          : toolName === "web_search"
            ? webSearchStreamingPreviewSignature(argumentsJson)
            : toolName === "subagent"
              ? subagentStreamingPreviewSignature(argumentsJson)
              : toolName === "tool_call" || toolName === "tool_describe"
                ? lazyToolGatewayStreamingPreviewSignature(argumentsJson)
                : toolName === "apply_patch"
                  ? applyPatchStreamingPreviewSignature(argumentsJson)
                  : undefined;

  const emit =
    !state.readyPreviewEmitted ||
    shouldRepeatStreamingToolPreview(toolName, state.lastPreviewArgsLen ?? 0, argsLen, {
      ...(state.lastPreviewDetailSignature === undefined
        ? {}
        : { previousDetailSignature: state.lastPreviewDetailSignature }),
      nextArgumentsJson: argumentsJson,
    });

  if (!emit) {
    return { emit: false, nextState: state };
  }

  return {
    emit: true,
    nextState: {
      readyPreviewEmitted: true,
      lastPreviewArgsLen: argsLen,
      ...(nextDetailSignature ? { lastPreviewDetailSignature: nextDetailSignature } : {}),
    },
  };
}
