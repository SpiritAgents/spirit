import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

import type { ReadLocalImagePreview } from "@/components/tool-call/tool-call-types";
import {
  classifyMarkdownImageSrc,
  parseMarkdownImageSrcSet,
  resolveMarkdownLocalImageFilePath,
} from "@/lib/markdown-local-image-src";
import { isManagedGeneratedImageRef } from "@/lib/managed-generated-asset";
import { cn } from "@/lib/utils";

export type ReadManagedImagePreviewDataUrl = (reference: string) => Promise<string | null>;
type ImageLoadState = "idle" | "loading" | "unavailable";

type MarkdownImagePreviewProps = {
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
  readLocalImagePreviewDataUrl?: ReadLocalImagePreview;
  localImageBaseDir?: string;
  localImageAllowedRootDir?: string;
};

export function MarkdownImageSource({
  srcSet,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
  ...props
}: ComponentPropsWithoutRef<"source"> & MarkdownImagePreviewProps) {
  const [resolved, setResolved] = useState<{ input?: string; value: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    void Promise.all(
      parseMarkdownImageSrcSet(srcSet ?? "").map(async ({ src, descriptor }) => {
        let resolvedSrc: string | null = null;
        try {
          const kind = classifyMarkdownImageSrc(src);
          if (kind === "remote") {
            resolvedSrc = src;
          } else if (kind === "managed" && isManagedGeneratedImageRef(src)) {
            resolvedSrc = (await readManagedImagePreviewDataUrl?.(src)) ?? null;
          } else if (kind === "local") {
            const filePath = resolveMarkdownLocalImageFilePath(
              src,
              localImageBaseDir,
              localImageAllowedRootDir,
            );
            if (filePath) {
              resolvedSrc = (await readLocalImagePreviewDataUrl?.(filePath)) ?? null;
            }
          }
        } catch {
          return null;
        }
        return resolvedSrc ? `${resolvedSrc}${descriptor ? ` ${descriptor}` : ""}` : null;
      }),
    ).then((candidates) => {
      if (!cancelled) {
        setResolved({
          input: srcSet,
          value: candidates.filter((candidate) => candidate !== null).join(", "),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    srcSet,
    readManagedImagePreviewDataUrl,
    readLocalImagePreviewDataUrl,
    localImageBaseDir,
    localImageAllowedRootDir,
  ]);

  // Picture sources override img.src; unresolved local candidates must not reach the browser.
  return (
    <source
      {...props}
      srcSet={resolved?.input === srcSet ? resolved?.value || undefined : undefined}
    />
  );
}

export function MarkdownImage({
  className,
  src,
  alt,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
  ...props
}: ComponentPropsWithoutRef<"img"> & MarkdownImagePreviewProps) {
  const { t } = useTranslation();
  const normalizedSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;
  const srcKind = normalizedSrc ? classifyMarkdownImageSrc(normalizedSrc) : "invalid";
  const managedRef =
    normalizedSrc && isManagedGeneratedImageRef(normalizedSrc) ? normalizedSrc : null;
  const localFilePath =
    srcKind === "local" && normalizedSrc
      ? resolveMarkdownLocalImageFilePath(
          normalizedSrc,
          localImageBaseDir,
          localImageAllowedRootDir,
        )
      : null;

  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ImageLoadState>("idle");

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
      if (!readManagedImagePreviewDataUrl) {
        setResolvedSrc(null);
        setLoadState("unavailable");
        return () => {
          cancelled = true;
        };
      }

      setResolvedSrc(null);
      setLoadState("loading");
      void readManagedImagePreviewDataUrl(managedRef)
        .then((dataUrl: string | null) => {
          if (!cancelled) {
            if (dataUrl) {
              setResolvedSrc(dataUrl);
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

    if (!localFilePath || !readLocalImagePreviewDataUrl) {
      setResolvedSrc(null);
      setLoadState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);
    setLoadState("loading");
    void readLocalImagePreviewDataUrl(localFilePath)
      .then((dataUrl: string | null) => {
        if (!cancelled) {
          if (dataUrl) {
            setResolvedSrc(dataUrl);
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
    readLocalImagePreviewDataUrl,
    readManagedImagePreviewDataUrl,
    srcKind,
  ]);

  if (srcKind === "invalid" || loadState === "unavailable") {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        {managedRef && !readManagedImagePreviewDataUrl
          ? t("error.hostNotSupported")
          : t("error.unavailable")}
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        {t("error.loading")}
      </div>
    );
  }

  if (!resolvedSrc) {
    return null;
  }

  return (
    <img
      className={cn(
        "my-3 block max-h-[28rem] w-auto max-w-full rounded-md border border-border/40 bg-background/40 object-contain shadow-sm",
        className,
      )}
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      {...props}
      onError={() => setLoadState("unavailable")}
    />
  );
}
