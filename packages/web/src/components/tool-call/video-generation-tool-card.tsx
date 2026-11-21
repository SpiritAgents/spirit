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
  const cachedPreview = previewSourcePath
    ? readCachedLocalFilePreviewDataUrl(previewSourcePath)
    : null;
  const [ownPreview, setOwnPreview] = useState<{
    path: string;
    status: "ready" | "unavailable";
    url: string | null;
  } | null>(null);
  // Cache-first: a sibling consumer filling the shared preview cache mid-flight must surface
  // here at the next render instead of leaving this card stuck in its own cancelled fetch.
  const ownPreviewForPath = ownPreview?.path === previewSourcePath ? ownPreview : null;
  const previewUrl = cachedPreview ?? ownPreviewForPath?.url ?? null;
  const previewState = !previewSourcePath
    ? ("unavailable" as const)
    : cachedPreview
      ? ("ready" as const)
      : (ownPreviewForPath?.status ?? "loading");

  useEffect(() => {
    let cancelled = false;
    if (!previewSourcePath || readCachedLocalFilePreviewDataUrl(previewSourcePath)) {
      return;
    }

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
        setOwnPreview({
          path: previewSourcePath,
          status: url ? "ready" : "unavailable",
          url,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setOwnPreview({
            path: previewSourcePath,
            status: "unavailable",
            url: null,
          });
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
