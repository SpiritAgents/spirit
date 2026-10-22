import { useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS,
  ImagePreviewDialog,
} from "@/components/ui/image-preview-dialog";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types/spirit-desktop";

const floatingActionCardRevealClass =
  "opacity-0 group-hover/image-card:opacity-100 group-focus-within/image-card:opacity-100";

function resolvePreviewImageSrc(imagePaths: string[] | undefined): string {
  const path = imagePaths?.find((entry) => entry.trim().length > 0) ?? "";
  if (!path) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("/")) {
    return path;
  }
  return `/${path.replace(/^\/+/u, "")}`;
}

export function PreviewImageGenerationToolCard({ tool }: { tool: ToolBlockSnapshot }) {
  const { messages } = useI18n();
  const copy = messages.desktop.conversation.agentDemo;
  const previewSrc = resolvePreviewImageSrc(tool.imagePaths);
  const [viewerOpen, setViewerOpen] = useState(false);
  const loading =
    tool.phase === "preview" ||
    tool.phase === "running" ||
    (tool.phase === "succeeded" && !previewSrc);
  const canInteract = Boolean(previewSrc && tool.phase === "succeeded");

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div
        className={cn(
          "group/image-card relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200",
          canInteract && "cursor-zoom-in hover:border-border/70",
          tool.phase === "failed" && "border-destructive/45 bg-destructive/5",
        )}
        role={canInteract ? "button" : undefined}
        tabIndex={canInteract ? 0 : undefined}
        onClick={canInteract ? () => setViewerOpen(true) : undefined}
        onKeyDown={
          canInteract
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setViewerOpen(true);
                }
              }
            : undefined
        }
      >
        {previewSrc ? (
          // Desktop preview uses blob/data URLs; next/image cannot optimize them.
          // oxlint-disable-next-line nextjs/no-img-element
          <img
            src={previewSrc}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover/image-card:scale-[1.015]"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center">
            <span
              className={cn(
                `text-sm ${FONT_WEIGHT_NORMAL}`,
                loading ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
              )}
            >
              {loading ? copy.generatingImage : copy.previewUnavailable}
            </span>
          </div>
        )}
        {previewSrc ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "pointer-events-auto absolute right-3 bottom-3",
                IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS,
                floatingActionCardRevealClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                setViewerOpen(true);
              }}
              title={copy.viewLargeImage}
              aria-label={copy.viewLargeImage}
            >
              <Maximize2 className="size-4" aria-hidden strokeWidth={1.75} />
            </Button>
          </div>
        ) : null}
      </div>

      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-xs leading-relaxed text-destructive">
          {tool.outputExcerpt}
        </pre>
      ) : null}

      <ImagePreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        src={previewSrc || null}
        closeLabel={copy.closeImagePreview}
      />
    </div>
  );
}
