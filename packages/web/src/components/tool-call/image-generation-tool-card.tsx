import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LocalImagePreviewDialog } from "@/components/local-image-preview-dialog";
import type {
  ReadLocalImagePreview,
  SaveLocalImageAs,
} from "@/components/tool-call/tool-call-types";
import {
  isPreviewableImagePath,
  readCachedLocalFilePreviewDataUrl,
  rememberLocalFilePreviewDataUrl,
} from "@spiritagent/ui/composer";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

export function ImageGenerationToolCard({
  tool,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: {
  tool: ToolBlockSnapshot;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs: SaveLocalImageAs;
}) {
  const { t } = useTranslation();
  const previewableImagePath = tool.imagePaths?.find(isPreviewableImagePath) ?? "";
  const imagePath = tool.imagePaths?.find((path) => path.trim().length > 0) ?? "";
  const cachedPreview = previewableImagePath
    ? readCachedLocalFilePreviewDataUrl(previewableImagePath)
    : null;
  const [previewStatePath, setPreviewStatePath] = useState(previewableImagePath);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(cachedPreview ?? null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    previewableImagePath ? (cachedPreview ? "ready" : "loading") : "unavailable",
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  if (previewStatePath !== previewableImagePath) {
    setPreviewStatePath(previewableImagePath);
    setPreviewDataUrl(cachedPreview ?? null);
    setPreviewState(previewableImagePath ? (cachedPreview ? "ready" : "loading") : "unavailable");
  }

  useEffect(() => {
    let cancelled = false;
    if (!previewableImagePath || cachedPreview) {
      return;
    }

    void readLocalImagePreviewDataUrl(previewableImagePath)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }
        if (dataUrl) {
          rememberLocalFilePreviewDataUrl(previewableImagePath, dataUrl);
        }
        setPreviewDataUrl(dataUrl);
        setPreviewState(dataUrl ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cachedPreview, previewableImagePath, readLocalImagePreviewDataUrl]);

  const loading =
    tool.phase === "preview" || tool.phase === "running" || previewState === "loading";
  const canInteract = Boolean(previewDataUrl && previewableImagePath);

  const handleSaveImage = async () => {
    if (!imagePath || saving) {
      return;
    }

    setSaving(true);
    try {
      await saveLocalImageAs(imagePath);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div
        className={cn(
          "group/image-card relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200",
          canInteract && "cursor-zoom-in hover:border-border/70",
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
        {previewDataUrl ? (
          <img
            src={previewDataUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover/image-card:scale-[1.015]"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center">
            <span
              className={cn(
                "text-sm font-normal",
                loading ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
              )}
            >
              {loading ? t("common.loading") : t("app.previewUnavailable")}
            </span>
          </div>
        )}
      </div>
      {!previewDataUrl && imagePath ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={imagePath}>
          {imagePath}
        </p>
      ) : null}
      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border/45 bg-muted/20 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.outputExcerpt}
        </pre>
      ) : null}

      <LocalImagePreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        previewDataUrl={previewDataUrl}
        onSave={handleSaveImage}
        saving={saving}
      />
    </div>
  );
}
