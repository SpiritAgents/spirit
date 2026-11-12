import type { DiffDisplayLine } from "@/lib/diff-display-lines";
import { renderHighlightedCodeLines } from "@/lib/spirit-message-code-highlight";
import { cn } from "@/lib/utils";

import type { DiffLineHighlightTokens } from "@/lib/diff-line-highlight";

export type UnifiedDiffCodeViewProps = {
  lines: DiffDisplayLine[];
  highlightedLines: DiffLineHighlightTokens[];
  gutter?: "none" | "unified";
  highlightNewLine?: number | null;
  surface?: "default" | "card";
  className?: string;
};

function unifiedGutterLabel(line: DiffDisplayLine): string | null {
  if (line.kind === "delete") {
    return line.oldLineNumber != null ? String(line.oldLineNumber) : null;
  }
  if (line.kind === "insert" || line.kind === "normal") {
    return line.newLineNumber != null ? String(line.newLineNumber) : null;
  }
  return null;
}

function isHighlightedReviewLine(
  line: DiffDisplayLine,
  highlightNewLine: number | null | undefined,
): boolean {
  if (highlightNewLine == null) {
    return false;
  }
  if (line.kind === "delete") {
    return false;
  }
  return line.newLineNumber === highlightNewLine;
}

export function UnifiedDiffCodeView({
  lines,
  highlightedLines,
  gutter = "none",
  highlightNewLine = null,
  surface = "default",
  className,
}: UnifiedDiffCodeViewProps) {
  return (
    <div
      className={cn(
        "tool-call-diff unified-diff-root min-w-0",
        gutter === "unified" && "tool-call-diff--single-gutter",
        surface === "card" && "tool-call-diff--card-surface",
        className,
      )}
    >
      {lines.map((line, index) => {
        const gutterLabel = gutter === "unified" ? unifiedGutterLabel(line) : null;
        const highlighted = highlightedLines[index] ?? [];

        return (
          <div
            key={`${line.kind}-${line.oldLineNumber ?? "o"}-${line.newLineNumber ?? "n"}-${index}`}
            className={cn(
              "unified-diff-line",
              line.kind === "insert" && "unified-diff-line-insert",
              line.kind === "delete" && "unified-diff-line-delete",
              line.kind === "normal" && "unified-diff-line-normal",
              isHighlightedReviewLine(line, highlightNewLine) && "review-diff-target-line",
            )}
          >
            {gutter === "unified" ? (
              <span className="unified-diff-gutter">{gutterLabel ?? ""}</span>
            ) : null}
            <code className="unified-diff-code">
              {renderHighlightedCodeLines({ tokens: [highlighted] })}
            </code>
          </div>
        );
      })}
    </div>
  );
}
