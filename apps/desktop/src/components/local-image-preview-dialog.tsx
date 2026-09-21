import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// backdrop-filter cannot composite correctly during an ancestor opacity animation; the card's
// hover fade-in and the blur must live on the same element.
export const LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS = "spirit-floating-action-button";

/** The async clipboard API only accepts image/png; other formats are re-encoded through a canvas. */
async function copyImageDataUrlToClipboard(dataUrl: string): Promise<void> {
  const source = await (await fetch(dataUrl)).blob();
  let png = source;
  if (source.type !== "image/png") {
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context unavailable");
    }
    context.drawImage(bitmap, 0, 0);
    png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (encoded) => (encoded ? resolve(encoded) : reject(new Error("PNG encode failed"))),
        "image/png",
      );
    });
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * Cap preview CSS size at natural/devicePixelRatio (1:1 device pixels).
 * Max-only sizing (viewport / 70rem) can upscale Retina screenshots and soften edges.
 */
function computeImagePreviewCssSize(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  let cssW = Math.max(1, Math.floor(naturalWidth / dpr));
  let cssH = Math.max(1, Math.floor(naturalHeight / dpr));

  if (typeof window === "undefined") {
    return { width: cssW, height: cssH };
  }

  const maxW = Math.max(1, Math.floor(Math.min(window.innerWidth - 32, 70 * 16)));
  const maxH = Math.max(1, Math.floor(window.innerHeight - 32));
  const fit = Math.min(1, maxW / cssW, maxH / cssH);
  if (fit < 1) {
    cssW = Math.max(1, Math.floor(cssW * fit));
    cssH = Math.max(1, Math.floor(cssH * fit));
  }
  return { width: cssW, height: cssH };
}

export function useImagePreviewAspectRatio(
  previewDataUrl: string | null,
): CSSProperties | undefined {
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewSize(null);
    if (!previewDataUrl) {
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setPreviewSize(computeImagePreviewCssSize(image.naturalWidth, image.naturalHeight));
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setPreviewSize(null);
      }
    };
    image.src = previewDataUrl;

    const onViewportChange = () => {
      if (cancelled || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        return;
      }
      setPreviewSize(computeImagePreviewCssSize(image.naturalWidth, image.naturalHeight));
    };
    window.addEventListener("resize", onViewportChange);

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      window.removeEventListener("resize", onViewportChange);
    };
  }, [previewDataUrl]);

  return previewSize
    ? {
        width: previewSize.width,
        height: previewSize.height,
      }
    : undefined;
}

export function LocalImagePreviewDialog({
  open,
  onOpenChange,
  previewDataUrl,
  onSave,
  saving = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  previewDataUrl: string | null;
  onSave?(): void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const viewerFrameStyle = useImagePreviewAspectRatio(previewDataUrl);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [previewDataUrl]);

  const handleCopyImage = () => {
    if (!previewDataUrl) {
      return;
    }
    void copyImageDataUrlToClipboard(previewDataUrl)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((error: unknown) => {
        console.error("[spirit-desktop] copy image to clipboard failed:", error);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-background/40 backdrop-blur-md"
        className="w-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
      >
        {previewDataUrl ? (
          <div
            // box-content: width/height refer to the content box, avoiding the 1px border eating into DPR-aligned sizes
            className="pointer-events-auto relative box-content inline-flex items-center justify-center overflow-hidden rounded-[1.1rem] border border-border/45"
            style={viewerFrameStyle}
          >
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "absolute top-3 left-3 z-20",
                  LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
                )}
                title={t("app.closeImagePreview")}
                aria-label={t("app.closeImagePreview")}
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">{t("app.closeImagePreview")}</span>
              </Button>
            </DialogClose>
            <img
              src={previewDataUrl}
              alt=""
              className="block size-full max-w-none object-fill"
              draggable={false}
            />
            <div className="pointer-events-none absolute top-3 right-3 z-10 flex gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn("pointer-events-auto", LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS)}
                onClick={handleCopyImage}
                title={copied ? t("app.imageCopied") : t("app.copyImage")}
                aria-label={copied ? t("app.imageCopied") : t("app.copyImage")}
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
              </Button>
              {onSave ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={cn("pointer-events-auto", LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS)}
                  onClick={() => void onSave()}
                  disabled={saving}
                  title={t("app.downloadImage")}
                  aria-label={t("app.downloadImage")}
                >
                  {saving ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
