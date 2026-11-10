import {
  codeUnitIndexToCharCount,
  currentWorkspaceFileReferenceQuery,
} from "@spiritagent/host-internal/workspace-file-reference-query";
import type { ActiveWorkspaceFileReferenceQuery } from "@spiritagent/host-internal/workspace-file-reference-query";

import {
  mergeAdjacentTextSegments,
  workspaceFilePlainToken,
  type RichSegment,
} from "@spiritagent/ui/composer";

function segmentPlainTextCharCount(seg: RichSegment): number {
  if (seg.kind === "text") {
    return Array.from(seg.value).length;
  }
  if (seg.kind === "workspaceFile") {
    return Array.from(workspaceFilePlainToken(seg.path)).length;
  }
  return 0;
}

/** Plain-text @ query, but not when the token is a finalized workspaceFile chip. */
export function currentWorkspaceFileReferenceQueryFromSegments(
  segments: RichSegment[],
  plainText: string,
  cursorChars: number,
): ActiveWorkspaceFileReferenceQuery | undefined {
  const query = currentWorkspaceFileReferenceQuery(plainText, cursorChars);
  if (!query) {
    return undefined;
  }

  const merged = mergeAdjacentTextSegments(segments);
  let pos = 0;
  for (const seg of merged) {
    const len = segmentPlainTextCharCount(seg);
    const segStart = pos;
    const segEnd = pos + len;
    if (seg.kind === "workspaceFile" && query.start >= segStart && query.end <= segEnd) {
      return undefined;
    }
    pos = segEnd;
  }

  return query;
}

/** UTF-16 plain-text caret offset from Lexical selection (via `caretToPlainTextOffset`). */
export function currentWorkspaceFileReferenceQueryFromSegmentsAtOffset(
  segments: RichSegment[],
  plainText: string,
  cursorCodeUnits: number,
): ActiveWorkspaceFileReferenceQuery | undefined {
  const cursorChars = codeUnitIndexToCharCount(plainText, cursorCodeUnits);
  return currentWorkspaceFileReferenceQueryFromSegments(segments, plainText, cursorChars);
}
