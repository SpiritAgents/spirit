import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";

import { UnifiedDiffCodeView } from "@/components/unified-diff-code-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { buildToolCallDiffLines } from "@/lib/diff-display-lines";
import { useDiffLineHighlight } from "@/lib/diff-line-highlight";
import { resolveToolCallDisplayLines } from "@/lib/tool-call-diff-display-lines";

import "@/styles/tool-call-diff-view.css";

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

const HIGHLIGHT_DEBOUNCE_MS = 32;

export type ToolCallDiffViewProps = {
  relativePath: string;
  languageId: string;
  original: string;
  modified: string;
  /** Scrolls to the last line while streaming writes */
  followTail?: boolean;
};

export function ToolCallDiffView({
  relativePath,
  languageId,
  original,
  modified,
  followTail = false,
}: ToolCallDiffViewProps) {
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);

  const lines = useMemo(() => buildToolCallDiffLines(original, modified), [original, modified]);

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
  }, [followTail, modified, highlightedLines]);

  if (lines.length === 0) {
    return (
      <pre className="overflow-x-auto whitespace-pre rounded-md border border-border/20 bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground">
        {modified || original}
      </pre>
    );
  }

  return (
    <ScrollArea
      ref={scrollAreaRef}
      type="always"
      scrollbars="both"
      className="h-[min(420px,50vh)] min-h-[120px] w-full rounded-md border border-border/20 bg-background pr-2 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
      data-tool-diff-path={relativePath}
      onWheel={(event) => {
        event.stopPropagation();
      }}
      onTouchMove={(event) => {
        event.stopPropagation();
      }}
    >
      <UnifiedDiffCodeView lines={displayLines} highlightedLines={highlightedLines} gutter="none" />
    </ScrollArea>
  );
}
