import { Check } from "@spiritagent/icons/check";
import { Copy } from "@spiritagent/icons/copy";
import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { X } from "@spiritagent/icons/x";

import { Download } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { Button } from "./button.js";
import { cn } from "./cn.js";
import { Dialog, DialogClose, DialogContent } from "./dialog.js";

// backdrop-filter cannot composite correctly during an ancestor opacity animation; the blur must
// live on the button itself.
export const IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS =
  "size-8 rounded-full border border-border/50 bg-background/55 text-foreground shadow-sm backdrop-blur-xl transition-[opacity,background-color,border-color,box-shadow] duration-200 ease-out hover:border-border/60 hover:bg-background/72 dark:border-white/12 dark:bg-input/30 dark:hover:bg-input/40 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25";

/** The async clipboard API only accepts image/png; other formats are re-encoded through a canvas. */
export async function copyImageToClipboard(src: string): Promise<void> {
  const source = await (await fetch(src)).blob();
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

export function useImagePreviewAspectRatio(src: string | null): CSSProperties | undefined {
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewSize(null);
    if (!src) {
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
    image.src = src;

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
  }, [src]);

  return previewSize
    ? {
        width: previewSize.width,
        height: previewSize.height,
      }
    : undefined;
}

export type ImagePreviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  src: string | null;
  closeLabel: string;
  copyLabel?: string;
  copiedLabel?: string;
  downloadLabel?: string;
  onSave?(): void;
  saving?: boolean;
};

export function ImagePreviewDialog({
  open,
  onOpenChange,
  src,
  closeLabel,
  copyLabel,
  copiedLabel,
  downloadLabel,
  onSave,
  saving = false,
}: ImagePreviewDialogProps) {
  const viewerFrameStyle = useImagePreviewAspectRatio(src);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [src]);

  const handleCopyImage = () => {
    if (!src) {
      return;
    }
    void copyImageToClipboard(src)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch((error: unknown) => {
        console.error("[spirit-ui] copy image to clipboard failed:", error);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
      >
        {src ? (
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
                  IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS,
                )}
                title={closeLabel}
                aria-label={closeLabel}
              >
                <X className="size-4" aria-hidden strokeWidth={1.75} />
                <span className="sr-only">{closeLabel}</span>
              </Button>
            </DialogClose>
            <img
              src={src}
              alt=""
              className="block size-full max-w-none object-fill"
              draggable={false}
            />
            {copyLabel || onSave ? (
              <div className="pointer-events-none absolute top-3 right-3 z-10 flex gap-2">
                {copyLabel ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "pointer-events-auto",
                      IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS,
                    )}
                    onClick={handleCopyImage}
                    title={copied ? (copiedLabel ?? copyLabel) : copyLabel}
                    aria-label={copied ? (copiedLabel ?? copyLabel) : copyLabel}
                  >
                    {copied ? (
                      <Check className="size-4" aria-hidden strokeWidth={1.75} />
                    ) : (
                      <Copy className="size-4" aria-hidden strokeWidth={1.75} />
                    )}
                  </Button>
                ) : null}
                {onSave ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "pointer-events-auto",
                      IMAGE_PREVIEW_FLOATING_ACTION_BUTTON_CLASS,
                    )}
                    onClick={() => void onSave()}
                    disabled={saving}
                    title={downloadLabel}
                    aria-label={downloadLabel}
                  >
                    {saving ? (
                      <LoaderCircle
                        className="size-4 animate-spin"
                        aria-hidden
                        strokeWidth={1.75}
                      />
                    ) : (
                      <Download className="size-4" aria-hidden strokeWidth={1.75} />
                    )}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
