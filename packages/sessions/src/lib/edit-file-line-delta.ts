import type { ToolBlockSnapshot } from "../types.js";

export type EditFileLineDelta = {
  added: number;
  removed: number;
};

const TOOLS_WITH_LINE_DELTA = new Set([
  "edit_file",
  "create_file",
  "create_plan",
  "delete_file",
  "apply_patch",
]);

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/u);
}

/** Line-level insert/delete counts via LCS length (git-style stat, not char diff). */
export function lineChangeCounts(oldText: string, newText: string): EditFileLineDelta {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const lcs = longestCommonSubsequenceLength(oldLines, newLines);
  return {
    removed: oldLines.length - lcs,
    added: newLines.length - lcs,
  };
}

/**
 * During the preview (streaming arguments) phase every incremental batch recomputes the LCS;
 * on large edits O(n·m) would stall the event loop.
 * Beyond this cell count (old lines × new lines) preview skips the stats; the tool-completed
 * event computes them in full.
 */
const PREVIEW_MAX_LCS_CELLS = 40_000;

function lineChangeCountsForPhase(
  oldText: string,
  newText: string,
  preview: boolean,
): EditFileLineDelta | undefined {
  if (preview) {
    const oldCount = splitLines(oldText).length;
    const newCount = splitLines(newText).length;
    if (oldCount * newCount > PREVIEW_MAX_LCS_CELLS) {
      return undefined;
    }
  }
  return lineChangeCounts(oldText, newText);
}

function longestCommonSubsequenceLength(a: string[], b: string[]): number {
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

function appendDecodedEscape(result: string, esc: string): string {
  switch (esc) {
    case "n":
      return `${result}\n`;
    case "r":
      return `${result}\r`;
    case "t":
      return `${result}\t`;
    case '"':
      return `${result}"`;
    case "\\":
      return `${result}\\`;
    case "/":
      return `${result}/`;
    case "b":
      return `${result}\b`;
    case "f":
      return `${result}\f`;
    default:
      return `${result}${esc}`;
  }
}

/** Read a JSON string field from complete or in-flight tool argument JSON. */
export function tryExtractPartialJsonStringValue(
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
        result = appendDecodedEscape(result, esc);
        i += 1;
        continue;
      }
      result = appendDecodedEscape(result, esc);
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }

  return result.length > 0 ? result : undefined;
}

const PARTIAL_PLAN_NAME_PATTERN = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/u;

function decodePartialJsonStringMatch(match: string): string {
  try {
    return JSON.parse(`"${match}"`) as string;
  } catch {
    return match;
  }
}

/** Extract create_plan `name` from complete or in-flight argument JSON (renderer-safe). */
export function tryExtractPartialPlanName(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) {
        return name.trim();
      }
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_PLAN_NAME_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  const decoded = decodePartialJsonStringMatch(match[1]).trim();
  return decoded || undefined;
}

function createContentLineDelta(content: string): EditFileLineDelta | undefined {
  const added = splitLines(content).length;
  if (added === 0) {
    return undefined;
  }
  return { added, removed: 0 };
}

export function deleteFileLineDeltaFromContent(content: string): EditFileLineDelta | undefined {
  const removed = splitLines(content).length;
  if (removed === 0) {
    return undefined;
  }
  return { added: 0, removed };
}

/** apply_patch: git-stat-style +/- counts from the patch's own marker lines (pre-execution). */
export function lineDeltaFromApplyPatchDiff(diff: string): EditFileLineDelta | undefined {
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
  if (added === 0 && removed === 0) {
    return undefined;
  }
  return { added, removed };
}

function applyPatchDiffFromRecord(record: Record<string, unknown>): string | undefined {
  const operation = record.operation;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return undefined;
  }
  const diff = (operation as Record<string, unknown>).diff;
  return typeof diff === "string" && diff.trim().length > 0 ? diff : undefined;
}

/** apply_patch delete_file: the doomed path lives under operation.path (parsed or in-flight). */
function extractApplyPatchDeleteFilePath(
  request?: unknown,
  argumentsJson?: string,
): string | undefined {
  const extract = (record: Record<string, unknown>): string | undefined => {
    const operation = record.operation;
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      return undefined;
    }
    const op = operation as Record<string, unknown>;
    if (op.type !== "delete_file") {
      return undefined;
    }
    const pathValue = op.path;
    return typeof pathValue === "string" && pathValue.trim() ? pathValue.trim() : undefined;
  };

  if (request && typeof request === "object") {
    const fromRequest = extract(request as Record<string, unknown>);
    if (fromRequest) {
      return fromRequest;
    }
  }

  const trimmed = argumentsJson?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return extract(parsed as Record<string, unknown>);
    }
    return undefined;
  } catch {
    if (tryExtractPartialJsonStringValue(trimmed, "type") !== "delete_file") {
      return undefined;
    }
    const partial = tryExtractPartialJsonStringValue(trimmed, "path");
    return partial?.trim() ? partial.trim() : undefined;
  }
}

function extractDeleteFilePath(
  toolName: string,
  request?: unknown,
  argumentsJson?: string,
): string | undefined {
  if (toolName !== "delete_file") {
    return undefined;
  }

  if (request && typeof request === "object") {
    const pathValue = (request as Record<string, unknown>).path;
    if (typeof pathValue === "string" && pathValue.trim()) {
      return pathValue.trim();
    }
  }

  const trimmed = argumentsJson?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const pathValue = (parsed as Record<string, unknown>).path;
      if (typeof pathValue === "string" && pathValue.trim()) {
        return pathValue.trim();
      }
    }
  } catch {
    const partial = tryExtractPartialJsonStringValue(trimmed, "path");
    if (partial?.trim()) {
      return partial.trim();
    }
  }

  return undefined;
}

export type AttachEditFileLineDeltaSource = {
  request?: unknown;
  argumentsJson?: string;
  /** Streaming-argument preview phase: large edits skip the LCS; it is computed on completion. */
  preview?: boolean;
  resolveDeleteFileLines?: (inputPath: string) => EditFileLineDelta | undefined;
  resolveDeleteFileBaseline?: (inputPath: string) => string | undefined;
};

export function toolLineDeltaFromRequest(
  toolName: string,
  request: unknown,
  options?: { preview?: boolean },
): EditFileLineDelta | undefined {
  if (!TOOLS_WITH_LINE_DELTA.has(toolName) || !request || typeof request !== "object") {
    return undefined;
  }

  const record = request as Record<string, unknown>;

  if (toolName === "create_file" || toolName === "create_plan") {
    const content = typeof record.content === "string" ? record.content : "";
    return createContentLineDelta(content);
  }

  if (toolName === "delete_file") {
    return undefined;
  }

  if (toolName === "apply_patch") {
    const diff = applyPatchDiffFromRecord(record);
    return diff !== undefined ? lineDeltaFromApplyPatchDiff(diff) : undefined;
  }

  const oldText = typeof record.old_text === "string" ? record.old_text : "";
  const newText = typeof record.new_text === "string" ? record.new_text : "";
  if (!oldText && !newText) {
    return undefined;
  }

  const delta = lineChangeCountsForPhase(oldText, newText, options?.preview === true);
  if (!delta || (delta.added === 0 && delta.removed === 0)) {
    return undefined;
  }
  return delta;
}

export function toolLineDeltaFromArgumentsJson(
  toolName: string,
  argumentsJson: string,
  options?: { preview?: boolean },
): EditFileLineDelta | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed || !TOOLS_WITH_LINE_DELTA.has(toolName)) {
    return undefined;
  }

  try {
    return toolLineDeltaFromRequest(toolName, JSON.parse(trimmed) as unknown, options);
  } catch {
    if (toolName === "create_file" || toolName === "create_plan") {
      const content = tryExtractPartialJsonStringValue(trimmed, "content");
      return content !== undefined ? createContentLineDelta(content) : undefined;
    }

    if (toolName === "delete_file") {
      return undefined;
    }

    if (toolName === "apply_patch") {
      const diff = tryExtractPartialJsonStringValue(trimmed, "diff");
      return diff !== undefined ? lineDeltaFromApplyPatchDiff(diff) : undefined;
    }

    const oldText = tryExtractPartialJsonStringValue(trimmed, "old_text");
    const newText = tryExtractPartialJsonStringValue(trimmed, "new_text");
    if (oldText === undefined && newText === undefined) {
      return undefined;
    }
    const delta = lineChangeCountsForPhase(oldText ?? "", newText ?? "", options?.preview === true);
    if (!delta || (delta.added === 0 && delta.removed === 0)) {
      return undefined;
    }
    return delta;
  }
}

/** @deprecated Use {@link toolLineDeltaFromArgumentsJson} with `edit_file`. */
export function editFileLineDeltaFromArgumentsJson(
  argumentsJson: string,
): EditFileLineDelta | undefined {
  return toolLineDeltaFromArgumentsJson("edit_file", argumentsJson);
}

export function resolveToolLineDelta(tool: ToolBlockSnapshot): EditFileLineDelta | undefined {
  if (!TOOLS_WITH_LINE_DELTA.has(tool.toolName)) {
    return undefined;
  }
  if (tool.editLineDelta) {
    return tool.editLineDelta;
  }
  if (tool.argsExcerpt?.trim()) {
    return toolLineDeltaFromArgumentsJson(tool.toolName, tool.argsExcerpt);
  }
  return undefined;
}

export function resolveToolLineDeltaForDisplay(
  tool: ToolBlockSnapshot,
): EditFileLineDelta | undefined {
  if (tool.phase === "failed") {
    return undefined;
  }
  return resolveToolLineDelta(tool);
}

export function attachEditFileLineDelta(
  tool: ToolBlockSnapshot,
  source: AttachEditFileLineDeltaSource,
): ToolBlockSnapshot {
  if (!TOOLS_WITH_LINE_DELTA.has(tool.toolName)) {
    return tool;
  }

  const phaseOptions = source.preview === true ? { preview: true } : undefined;
  let delta: EditFileLineDelta | undefined;
  if (tool.toolName === "apply_patch" && tool.fileChangeDiff) {
    // Post-execution: the executor's exact pair gives a git-style line stat (same as edit_file).
    const pairDelta = lineChangeCounts(tool.fileChangeDiff.before, tool.fileChangeDiff.after);
    delta = pairDelta.added > 0 || pairDelta.removed > 0 ? pairDelta : undefined;
  } else {
    delta =
      source.argumentsJson !== undefined
        ? toolLineDeltaFromArgumentsJson(tool.toolName, source.argumentsJson, phaseOptions)
        : toolLineDeltaFromRequest(tool.toolName, source.request, phaseOptions);
  }

  const deleteInputPath =
    tool.toolName === "delete_file"
      ? extractDeleteFilePath(tool.toolName, source.request, source.argumentsJson)
      : tool.toolName === "apply_patch"
        ? extractApplyPatchDeleteFilePath(source.request, source.argumentsJson)
        : undefined;

  if (!delta && deleteInputPath && source.resolveDeleteFileLines) {
    delta = source.resolveDeleteFileLines(deleteInputPath);
  }

  let deleteFileBaselineText = tool.deleteFileBaselineText;
  if (deleteInputPath && source.resolveDeleteFileBaseline && deleteFileBaselineText === undefined) {
    const baseline = source.resolveDeleteFileBaseline(deleteInputPath);
    if (baseline !== undefined) {
      deleteFileBaselineText = baseline;
    }
  }

  if (!delta && deleteFileBaselineText === undefined) {
    const { editLineDelta: _removed, deleteFileBaselineText: _baseline, ...rest } = tool;
    return rest;
  }

  return {
    ...tool,
    ...(delta ? { editLineDelta: delta } : {}),
    ...(deleteFileBaselineText !== undefined ? { deleteFileBaselineText } : {}),
  };
}

/** After delete_file completes the file no longer exists, so the line counts computed before execution must be preserved. */
export function preserveDeleteFileLineDelta(
  toolName: string,
  attached: ToolBlockSnapshot,
  priorDelta?: EditFileLineDelta,
): ToolBlockSnapshot {
  if (toolName !== "delete_file" || attached.editLineDelta || !priorDelta) {
    return attached;
  }
  return { ...attached, editLineDelta: priorDelta };
}

/** After delete_file completes, the full-text baseline frozen before execution must be preserved. */
export function preserveDeleteFileBaseline(
  toolName: string,
  attached: ToolBlockSnapshot,
  priorBaseline?: string,
): ToolBlockSnapshot {
  if (toolName !== "delete_file" || attached.deleteFileBaselineText || !priorBaseline) {
    return attached;
  }
  return { ...attached, deleteFileBaselineText: priorBaseline };
}
