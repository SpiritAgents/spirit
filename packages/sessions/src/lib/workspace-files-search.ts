import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";
import type { WorkspaceContentSearchMatch } from "@/types";

export type WorkspaceFileSearchGroup = {
  relativePath: string;
  matches: WorkspaceContentSearchMatch[];
};

export function groupWorkspaceSearchMatches(
  matches: readonly WorkspaceContentSearchMatch[],
): WorkspaceFileSearchGroup[] {
  const byPath = new Map<string, WorkspaceContentSearchMatch[]>();
  for (const match of matches) {
    const key = normalizeWorkspaceEntryRel(match.relativePath);
    const bucket = byPath.get(key);
    if (bucket) {
      bucket.push(match);
    } else {
      byPath.set(key, [match]);
    }
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, fileMatches]) => ({
      relativePath,
      matches: fileMatches.sort((a, b) => a.lineNumber - b.lineNumber),
    }));
}

export type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

/** ripgrep JSON submatch start/end are in-line UTF-8 byte offsets (not JS code units). */
export function ripgrepUtf8ByteOffsetToCodeUnitIndex(text: string, byteOffset: number): number {
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    if (bytes >= byteOffset) {
      break;
    }
    bytes += new TextEncoder().encode(char).length;
    index += 1;
  }
  return index;
}

export function ripgrepSubmatchToCodeUnitRange(
  lineText: string,
  submatch: { start: number; end: number },
): { start: number; end: number } {
  return {
    start: ripgrepUtf8ByteOffsetToCodeUnitIndex(lineText, submatch.start),
    end: ripgrepUtf8ByteOffsetToCodeUnitIndex(lineText, submatch.end),
  };
}

function buildHighlightedLineSegmentsFromCodeUnits(
  lineText: string,
  ranges: readonly { start: number; end: number }[],
): HighlightSegment[] {
  if (ranges.length === 0) {
    return [{ text: lineText, highlighted: false }];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const range of sorted) {
    const start = Math.max(cursor, Math.min(lineText.length, range.start));
    const end = Math.max(start, Math.min(lineText.length, range.end));
    if (start > cursor) {
      segments.push({ text: lineText.slice(cursor, start), highlighted: false });
    }
    if (end > start) {
      segments.push({ text: lineText.slice(start, end), highlighted: true });
    }
    cursor = end;
  }

  if (cursor < lineText.length) {
    segments.push({ text: lineText.slice(cursor), highlighted: false });
  }

  return segments.length > 0 ? segments : [{ text: lineText, highlighted: false }];
}

/** rg submatch start/end are UTF-8 byte offsets; the display lineText is sliced by code unit. */
export function buildHighlightedLineSegments(
  lineText: string,
  submatches: readonly { start: number; end: number }[],
): HighlightSegment[] {
  return buildHighlightedLineSegmentsFromCodeUnits(
    lineText,
    submatches.map((submatch) => ripgrepSubmatchToCodeUnitRange(lineText, submatch)),
  );
}

export function truncateSearchLinePreview(
  lineText: string,
  submatches: readonly { start: number; end: number }[],
  maxLength = 72,
): HighlightSegment[] {
  const segments = buildHighlightedLineSegments(lineText, submatches);
  const full = segments.map((segment) => segment.text).join("");
  if (full.length <= maxLength) {
    return segments;
  }

  const firstHighlight = segments.find((segment) => segment.highlighted);
  const highlightText = firstHighlight?.text ?? "";
  const highlightIndex = highlightText ? full.indexOf(highlightText) : 0;
  const windowStart = Math.max(0, highlightIndex - 20);
  const windowEnd = Math.min(full.length, windowStart + maxLength);
  const sliced = full.slice(windowStart, windowEnd);
  const prefix = windowStart > 0 ? "…" : "";
  const suffix = windowEnd < full.length ? "…" : "";

  const localSubmatches =
    submatches.length > 0
      ? submatches
          .map((item) => ripgrepSubmatchToCodeUnitRange(lineText, item))
          .map((item) => ({
            start: Math.max(0, item.start - windowStart) + prefix.length,
            end: Math.max(0, item.end - windowStart) + prefix.length,
          }))
      : [];

  return buildHighlightedLineSegmentsFromCodeUnits(`${prefix}${sliced}${suffix}`, localSubmatches);
}
