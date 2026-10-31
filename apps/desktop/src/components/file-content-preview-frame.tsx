import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { DiffCodeScrollView } from "@/components/diff-code-scroll-view";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import type { DiffDisplayLine } from "@/lib/diff-display-lines";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import { DESKTOP_CONTENT_TRANSLUCENT_FILL } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

/** Read approval preview: same chrome as FileDiffPreviewFrame, plain line-numbered content (no diff). */
export type FileContentPreviewFrameProps = {
  relativePath: string;
  languageId: string;
  content: string;
  defaultOpen?: boolean;
};

function contentLines(content: string): DiffDisplayLine[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const rows = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  return rows.map((row, index) => ({ kind: "normal", content: row, newLineNumber: index + 1 }));
}

export function FileContentPreviewFrame({
  relativePath,
  languageId,
  content,
  defaultOpen = true,
}: FileContentPreviewFrameProps) {
  const [open, setOpen] = useState(defaultOpen);
  const fileName = workspaceFileBasename(relativePath);
  const dirLabel = relativePath
    .slice(0, Math.max(0, relativePath.length - fileName.length))
    .replace(/\/$/, "");
  const lines = useMemo(() => contentLines(content), [content]);

  return (
    <AnimatedCollapse open={open} onOpenChange={setOpen}>
      {/* The container owns the border and the shared rounding; children never draw their own
          corners, so the header/divider/diff junctions stay flush in both open and closed states. */}
      <div className="overflow-hidden rounded-md border border-outline-border">
        <AnimatedCollapseTrigger
          className={cn(
            "group/file-content-frame flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs",
            // Same default fill as outline controls (background + translucent layer); hover
            // stays on canvas-hover.
            "bg-background outline-none hover:bg-canvas-hover focus-visible:bg-canvas-hover",
            DESKTOP_CONTENT_TRANSLUCENT_FILL,
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
          )}
          title={relativePath}
        >
          <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-foreground">
            <WorkspaceFileIcon
              name={fileName}
              className="group-hover/file-content-frame:hidden group-focus-visible/file-content-frame:hidden"
            />
            <ChevronRight
              className={cn(
                "absolute hidden size-3.5 transition-transform duration-150",
                "group-hover/file-content-frame:inline-flex group-focus-visible/file-content-frame:inline-flex",
                open && "rotate-90",
              )}
              aria-hidden
              strokeWidth={1.75}
            />
          </span>
          <span className="shrink-0 truncate text-foreground/90">{fileName}</span>
          {dirLabel ? (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">{dirLabel}</span>
          ) : null}
        </AnimatedCollapseTrigger>
        <AnimatedCollapseContent>
          {/* The shared diff body: hug-but-capped, transparent rows over the card surface. */}
          <div className="border-t border-outline-border [&_.unified-diff-gutter]:text-muted-foreground/75">
            <DiffCodeScrollView lines={lines} languageId={languageId} />
          </div>
        </AnimatedCollapseContent>
      </div>
    </AnimatedCollapse>
  );
}
