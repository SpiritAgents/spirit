import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  ReadLocalVideoPreview,
  ReadManagedVideoPreview,
} from "@/components/tool-call/tool-call-types";
import {
  isPreviewableVideoPath,
  readCachedLocalFilePreviewDataUrl,
  rememberLocalFilePreviewDataUrl,
} from "@spiritagent/ui/composer";
import { isManagedGeneratedVideoRef } from "@/lib/managed-generated-asset";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

export function VideoGenerationToolCard({
  tool,
  readLocalVideoPreviewUrl,
  readManagedVideoPreviewUrl,
}: {
  tool: ToolBlockSnapshot;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const { t } = useTranslation();
  const videoPath = tool.videoPaths?.find((path) => path.trim().length > 0) ?? "";
  const previewSourcePath =
    tool.videoPaths?.find(
      (path) => isManagedGeneratedVideoRef(path) || isPreviewableVideoPath(path),
    ) ?? "";
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    "idle",
  );

  useEffect(() => {
    let cancelled = false;
    if (!previewSourcePath) {
      setPreviewUrl(null);
      setPreviewState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    // The video preview resolves to a stable protocol URL (not a blob), so it shares the
    // module-level LRU cache with image data URLs; repeated remounts from virtualized scrolling
    // skip the IPC on a cache hit
    const cached = readCachedLocalFilePreviewDataUrl(previewSourcePath);
    if (cached) {
      setPreviewUrl(cached);
      setPreviewState("ready");
      return () => {
        cancelled = true;
      };
    }

    setPreviewUrl(null);
    setPreviewState("loading");
    const resolvePreview = isManagedGeneratedVideoRef(previewSourcePath)
      ? readManagedVideoPreviewUrl(previewSourcePath)
      : readLocalVideoPreviewUrl(previewSourcePath);

    void resolvePreview
      .then((url) => {
        if (cancelled) {
          return;
        }
        if (url) {
          rememberLocalFilePreviewDataUrl(previewSourcePath, url);
        }
        setPreviewUrl(url);
        setPreviewState(url ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewSourcePath, readLocalVideoPreviewUrl, readManagedVideoPreviewUrl]);

  const loading =
    tool.phase === "preview" || tool.phase === "running" || previewState === "loading";

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div className="relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200">
        {previewUrl ? (
          <video
            src={previewUrl}
            className="size-full object-contain"
            controls
            preload="metadata"
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
      {!previewUrl && videoPath ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={videoPath}>
          {videoPath}
        </p>
      ) : null}
      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border/45 bg-muted/20 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.outputExcerpt}
        </pre>
      ) : null}
    </div>
  );
}
