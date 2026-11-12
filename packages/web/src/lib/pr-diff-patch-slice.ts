import {
  displayLineNumberForChange,
  parseUnifiedDiffFiles,
  wrapPatchAsUnifiedDiff,
} from "@/lib/diff-display-lines";

import type { PrDiffLineRange } from "./pr-diff-selection.js";

type ParsedDiffChange = {
  type: "normal" | "insert" | "delete";
  content: string;
};

function formatUnifiedChangeLine(change: ParsedDiffChange): string {
  if (change.type === "insert") {
    return `+${change.content}`;
  }
  if (change.type === "delete") {
    return `-${change.content}`;
  }
  return ` ${change.content}`;
}

/** Slice GitHub file patch hunks to the gutter line range shown in PR Changes diff view. */
export function extractPatchBodyForLineRange(
  filename: string,
  patch: string,
  lineStart: number,
  lineEnd: number,
): string {
  if (lineStart <= 0 || lineEnd <= 0 || lineStart > lineEnd) {
    return "";
  }

  const diffText = wrapPatchAsUnifiedDiff(filename, patch);
  if (!diffText) {
    return "";
  }

  const hunks = parseUnifiedDiffFiles(diffText)[0]?.hunks ?? [];
  const bodyLines: string[] = [];

  for (const hunk of hunks) {
    const selectedChanges = hunk.changes.filter((change) => {
      const line = displayLineNumberForChange(change);
      return line >= lineStart && line <= lineEnd;
    });
    if (selectedChanges.length === 0) {
      continue;
    }
    bodyLines.push(hunk.content);
    for (const change of selectedChanges) {
      bodyLines.push(formatUnifiedChangeLine(change));
    }
  }

  return bodyLines.join("\n");
}

/** Infer gutter line range by matching selected plain text against patch change lines. */
export function inferLineRangeFromPatch(
  filename: string,
  patch: string,
  selectedText: string,
): PrDiffLineRange | null {
  const needle = selectedText.trim();
  if (!needle) {
    return null;
  }

  const diffText = wrapPatchAsUnifiedDiff(filename, patch);
  if (!diffText) {
    return null;
  }

  const hunks = parseUnifiedDiffFiles(diffText)[0]?.hunks ?? [];
  const matchedLines: number[] = [];
  const selectedLines = needle.split("\n");

  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const content = change.content;
      if (selectedLines.some((line) => line === content || line.trim() === content.trim())) {
        matchedLines.push(displayLineNumberForChange(change));
      }
    }
  }

  const valid = matchedLines.filter((line) => line > 0);
  if (valid.length === 0) {
    return null;
  }
  return {
    lineStart: Math.min(...valid),
    lineEnd: Math.max(...valid),
  };
}
