import { structuredPatch } from "diff";
import gitDiffParser, { type Change, type File } from "gitdiff-parser";

export type DiffDisplayLineKind = "normal" | "insert" | "delete";

export type DiffDisplayLine = {
  kind: DiffDisplayLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export function normalizeDiffPath(filename: string): string {
  return filename.replace(/\\/gu, "/").trim() || "file";
}

export function wrapPatchAsUnifiedDiff(filename: string, patch: string): string {
  const normalizedPath = normalizeDiffPath(filename);
  const hunk = patch.trim();
  if (!hunk) {
    return "";
  }
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    hunk,
  ].join("\n");
}

function changeToDisplayLine(change: Change): DiffDisplayLine {
  if (change.type === "insert") {
    return {
      kind: "insert",
      content: change.content,
      newLineNumber: change.lineNumber,
    };
  }
  if (change.type === "delete") {
    return {
      kind: "delete",
      content: change.content,
      oldLineNumber: change.lineNumber,
    };
  }
  return {
    kind: "normal",
    content: change.content,
    oldLineNumber: change.oldLineNumber,
    newLineNumber: change.newLineNumber,
  };
}

export function buildToolCallDiffLines(original: string, modified: string): DiffDisplayLine[] {
  const patch = structuredPatch("file", "file", original, modified, "", "", { context: 3 });
  const lines: DiffDisplayLine[] = [];

  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const line of hunk.lines) {
      const prefix = line.charAt(0);
      const content = line.slice(1);

      if (prefix === "+") {
        lines.push({ kind: "insert", content, newLineNumber: newLine });
        newLine += 1;
      } else if (prefix === "-") {
        lines.push({ kind: "delete", content, oldLineNumber: oldLine });
        oldLine += 1;
      } else if (prefix === " ") {
        lines.push({
          kind: "normal",
          content,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        });
        oldLine += 1;
        newLine += 1;
      }
    }
  }

  return lines;
}

export function parseUnifiedDiffFiles(diffText: string): File[] {
  try {
    return gitDiffParser.parse(diffText);
  } catch {
    return [];
  }
}

export function buildDiffLinesFromUnifiedText(diffText: string): DiffDisplayLine[] {
  const files = parseUnifiedDiffFiles(diffText);
  const lines: DiffDisplayLine[] = [];

  for (const hunk of files[0]?.hunks ?? []) {
    for (const change of hunk.changes) {
      lines.push(changeToDisplayLine(change));
    }
  }

  return lines;
}

export function displayLineNumberForChange(change: Change): number {
  if (change.type === "delete" || change.type === "insert") {
    return change.lineNumber;
  }
  return change.newLineNumber;
}
