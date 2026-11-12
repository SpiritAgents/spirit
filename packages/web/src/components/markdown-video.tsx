import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

import type { ReadLocalVideoPreview } from "@/components/tool-call/tool-call-types";
import { isManagedGeneratedVideoRef } from "@/lib/managed-generated-asset";
import {
  classifyMarkdownImageSrc,
  resolveMarkdownLocalImageFilePath,
} from "@/lib/markdown-local-image-src";
import { cn } from "@/lib/utils";

export type ReadManagedVideoPreviewUrl = (reference: string) => Promise<string | null>;
type VideoLoadState = "idle" | "loading" | "unavailable";

export function MarkdownVideo({
  className,
  src,
  readManagedVideoPreviewUrl,
  readLocalVideoPreviewUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
  ...props
}: ComponentPropsWithoutRef<"video"> & {
  readManagedVideoPreviewUrl?: ReadManagedVideoPreviewUrl;
  readLocalVideoPreviewUrl?: ReadLocalVideoPreview;
  localImageBaseDir?: string;
  localImageAllowedRootDir?: string;
}) {
  const { t } = useTranslation();
  const normalizedSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;
  const srcKind = normalizedSrc ? classifyMarkdownImageSrc(normalizedSrc) : "invalid";
  const managedRef =
    normalizedSrc && isManagedGeneratedVideoRef(normalizedSrc) ? normalizedSrc : null;
  const localFilePath =
    srcKind === "local" && normalizedSrc
      ? resolveMarkdownLocalImageFilePath(
          normalizedSrc,
          localImageBaseDir,
          localImageAllowedRootDir,
        )
      : null;

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<VideoLoadState>("idle");

  useEffect(() => {
    let cancelled = false;

    if (!normalizedSrc || srcKind === "invalid") {
      setResolvedSrc(null);
      setLoadState("idle");
      return () => {
        cancelled = true;
      };
    }

    if (srcKind === "remote") {
      setResolvedSrc(normalizedSrc);
      setLoadState("idle");
      return () => {
        cancelled = true;
      };
    }

    if (managedRef) {
      if (!readManagedVideoPreviewUrl) {
        setResolvedSrc(null);
        setLoadState("unavailable");
        return () => {
          cancelled = true;
        };
      }

      setResolvedSrc(null);
      setLoadState("loading");
      void readManagedVideoPreviewUrl(managedRef)
        .then((previewUrl: string | null) => {
          if (!cancelled) {
            if (previewUrl) {
              setResolvedSrc(previewUrl);
              setLoadState("idle");
              return;
            }
            setResolvedSrc(null);
            setLoadState("unavailable");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResolvedSrc(null);
            setLoadState("unavailable");
          }
        });

      return () => {
        cancelled = true;
      };
    }

    if (!localFilePath || !readLocalVideoPreviewUrl) {
      setResolvedSrc(null);
      setLoadState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);
    setLoadState("loading");
    void readLocalVideoPreviewUrl(localFilePath)
      .then((previewUrl: string | null) => {
        if (!cancelled) {
          if (previewUrl) {
            setResolvedSrc(previewUrl);
            setLoadState("idle");
            return;
          }
          setResolvedSrc(null);
          setLoadState("unavailable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
          setLoadState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    localFilePath,
    managedRef,
    normalizedSrc,
    readLocalVideoPreviewUrl,
    readManagedVideoPreviewUrl,
    srcKind,
  ]);

  const placeholderClassName =
    "my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground";

  if (srcKind === "invalid" || loadState === "unavailable") {
    return (
      <span className={cn("block", placeholderClassName)}>
        {managedRef && !readManagedVideoPreviewUrl
          ? t("error.hostNotSupported")
          : t("error.unavailable")}
      </span>
    );
  }

  if (loadState === "loading") {
    return <span className={cn("block", placeholderClassName)}>{t("error.loading")}</span>;
  }

  if (!resolvedSrc) {
    return null;
  }

  return (
    <video
      className={cn(
        "my-3 block max-h-[28rem] w-full max-w-full rounded-md border border-border/40 bg-background/40 object-contain shadow-sm",
        className,
      )}
      src={resolvedSrc}
      controls
      preload="metadata"
      {...props}
      onError={() => setLoadState("unavailable")}
    />
  );
}
