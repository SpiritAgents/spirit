import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { DiffCodeScrollView } from "@/components/diff-code-scroll-view";
import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import { buildToolCallDiffLines } from "@/lib/diff-display-lines";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import { DESKTOP_CONTENT_TRANSLUCENT_FILL } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

/** 文件 Diff 预览框: header (file icon + name + dir) over a content-hugging line-numbered diff. */
export type FileDiffPreviewFrameProps = {
  relativePath: string;
  languageId: string;
  original: string;
  modified: string;
  defaultOpen?: boolean;
};

export function FileDiffPreviewFrame({
  relativePath,
  languageId,
  original,
  modified,
  defaultOpen = true,
}: FileDiffPreviewFrameProps) {
  const [open, setOpen] = useState(defaultOpen);
  const fileName = workspaceFileBasename(relativePath);
  const dirLabel = relativePath
    .slice(0, Math.max(0, relativePath.length - fileName.length))
    .replace(/\/$/, "");
  const lines = useMemo(() => buildToolCallDiffLines(original, modified), [original, modified]);
  const delta = useMemo(
    () => ({
      added: lines.reduce((count, line) => count + (line.kind === "insert" ? 1 : 0), 0),
      removed: lines.reduce((count, line) => count + (line.kind === "delete" ? 1 : 0), 0),
    }),
    [lines],
  );

  return (
    <AnimatedCollapse open={open} onOpenChange={setOpen}>
      {/* The container owns the border and the shared rounding; children never draw their own
          corners, so the header/divider/diff junctions stay flush in both open and closed states. */}
      <div className="overflow-hidden rounded-md border border-outline-border">
        <AnimatedCollapseTrigger
          className={cn(
            "group/file-diff-frame flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs",
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
              className="group-hover/file-diff-frame:hidden group-focus-visible/file-diff-frame:hidden"
            />
            <ChevronRight
              className={cn(
                "absolute hidden size-3.5 transition-transform duration-150",
                "group-hover/file-diff-frame:inline-flex group-focus-visible/file-diff-frame:inline-flex",
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
          <EditFileLineDeltaBadge delta={delta} className="ml-auto" />
        </AnimatedCollapseTrigger>
        <AnimatedCollapseContent>
          {/* The shared diff body: hugs short diffs, caps tall ones, transparent rows let the
              card surface show through. */}
          <div className="border-t border-outline-border [&_.unified-diff-gutter]:text-muted-foreground/75">
            <DiffCodeScrollView lines={lines} languageId={languageId} />
          </div>
        </AnimatedCollapseContent>
      </div>
    </AnimatedCollapse>
  );
}
