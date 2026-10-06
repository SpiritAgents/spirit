import { useEffect, useRef, useState, type ComponentRef } from "react";

import { UnifiedDiffCodeView } from "@/components/unified-diff-code-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiffDisplayLine } from "@/lib/diff-display-lines";
import { useDiffLineHighlight } from "@/lib/diff-line-highlight";
import { resolveToolCallDisplayLines } from "@/lib/tool-call-diff-display-lines";

import "@/styles/tool-call-diff-view.css";

const HIGHLIGHT_DEBOUNCE_MS = 32;

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

/**
 * The shared scrollable diff body, used by the approval preview frames, the read/directory
 * previews, and the conversation tool-detail diff. Radix scroll chrome; hugs content with a
 * height cap; transparent rows so the surrounding box owns the fill; native scroll chaining (no
 * overscroll containment, no wheel capture). Box chrome (border/fill) belongs to the caller.
 */
export type DiffCodeScrollViewProps = {
  lines: DiffDisplayLine[];
  languageId: string;
  gutter?: "none" | "unified";
  /** Streaming previews: debounce highlight updates and keep the tail in view. */
  followTail?: boolean;
  relativePath?: string;
};

export function DiffCodeScrollView({
  lines,
  languageId,
  gutter = "unified",
  followTail = false,
  relativePath,
}: DiffCodeScrollViewProps) {
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);

  // Streaming previews rewrite lines continuously; highlight the debounced snapshot so the
  // shiki pass does not run on every chunk.
  const [debouncedLines, setDebouncedLines] = useState(lines);
  useEffect(() => {
    if (lines.length === 0) {
      setDebouncedLines([]);
      return undefined;
    }
    if (!followTail) {
      return undefined;
    }
    const timer = window.setTimeout(() => setDebouncedLines(lines), HIGHLIGHT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [followTail, lines]);

  const displayLines = resolveToolCallDisplayLines(lines, debouncedLines, followTail);
  const highlightedLines = useDiffLineHighlight(displayLines, languageId);

  useEffect(() => {
    if (!followTail) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [followTail, highlightedLines]);

  return (
    <ScrollArea
      ref={scrollAreaRef}
      type="always"
      scrollbars="both"
      className="[--diff-background-color:transparent] [&>[data-radix-scroll-area-viewport]]:max-h-[min(420px,50vh)]"
      {...(relativePath !== undefined ? { "data-tool-diff-path": relativePath } : {})}
    >
      <UnifiedDiffCodeView
        lines={displayLines}
        highlightedLines={highlightedLines}
        gutter={gutter}
      />
    </ScrollArea>
  );
}
