import { useMemo } from "react";

import { UnifiedDiffCodeView } from "@/components/unified-diff-code-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildDiffLinesFromUnifiedText, wrapPatchAsUnifiedDiff } from "@/lib/diff-display-lines";
import { useDiffLineHighlight } from "@/lib/diff-line-highlight";
import { monacoLanguageId } from "@/lib/monaco-language";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

export type ReviewCommentHunkViewProps = {
  path: string;
  diffHunk: string;
  className?: string;
  /** Match parent card (`bg-muted`) instead of page background. */
  surface?: "default" | "card";
  /** Highlight the review comment target line in the new file. */
  highlightLine?: number | null;
  /** `scroll`: capped ScrollArea (review threads). `embedded`: no inner scroll (PR Changes). */
  layout?: "scroll" | "embedded";
};

function reviewDiffSurfaceClass(surface: ReviewCommentHunkViewProps["surface"]): string {
  return surface === "card" ? "bg-muted" : "bg-background";
}

function buildReviewCommentDiffText(path: string, diffHunk: string): string {
  return wrapPatchAsUnifiedDiff(path, diffHunk);
}

export function ReviewCommentHunkView({
  path,
  diffHunk,
  className,
  surface = "default",
  highlightLine = null,
  layout = "scroll",
}: ReviewCommentHunkViewProps) {
  const languageId = useMemo(() => monacoLanguageId(path), [path]);
  const lines = useMemo(() => {
    const diffText = buildReviewCommentDiffText(path, diffHunk);
    if (!diffText) {
      return [];
    }
    return buildDiffLinesFromUnifiedText(diffText);
  }, [diffHunk, path]);

  const highlightedLines = useDiffLineHighlight(lines, languageId);

  if (lines.length === 0) {
    if (!diffHunk.trim()) {
      return null;
    }
    return (
      <pre
        className={cn(
          "w-full overflow-x-auto whitespace-pre border border-border/20 p-2 font-mono text-xs leading-relaxed text-muted-foreground",
          reviewDiffSurfaceClass(surface),
          className,
        )}
      >
        {diffHunk}
      </pre>
    );
  }

  const diffContent = (
    <UnifiedDiffCodeView
      lines={lines}
      highlightedLines={highlightedLines}
      gutter="unified"
      highlightNewLine={highlightLine}
      surface={surface}
    />
  );

  if (layout === "embedded") {
    return (
      <div
        className={cn(
          "w-full overflow-x-auto border-t border-border/20",
          reviewDiffSurfaceClass(surface),
          className,
        )}
      >
        {diffContent}
      </div>
    );
  }

  return (
    <ScrollArea
      className={cn(
        "max-h-48 overflow-x-auto rounded-md border border-border/20",
        reviewDiffSurfaceClass(surface),
        className,
      )}
      type="always"
      scrollbars="both"
    >
      {diffContent}
    </ScrollArea>
  );
}
