import { X } from "@spiritagent/icons/x";
import { useState } from "react";
import { useTranslation } from "@/lib/desktop-preview-i18n";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { File } from "lucide-react";

import type { ComposerLocalFileAttachmentView } from "../lib/local-file-attachments.js";

export type { ComposerLocalFileAttachmentView };

const ATTACHMENT_VISUAL_CLASS = "size-[18px]";

type ComposerLocalFileStripProps = {
  attachments: readonly ComposerLocalFileAttachmentView[];
  readOnly?: boolean;
  className?: string;
  onRemove?(path: string): void;
};

function ComposerLocalFileCard({
  attachment,
  readOnly,
  onRemove,
}: {
  attachment: ComposerLocalFileAttachmentView;
  readOnly: boolean;
  onRemove?(path: string): void;
}) {
  const { t } = useTranslation();
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const showImage = attachment.isImage && !imageLoadFailed && Boolean(attachment.previewDataUrl);

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border/30 bg-input/40 pl-1 pr-1.5 py-0.75 dark:border-white/[0.07] dark:bg-white/[0.03]">
      {!readOnly && onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(attachment.path)}
          className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label={t("composer.removeAttachment", { name: attachment.name })}
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
      {showImage ? (
        // Local attachment previews are data URLs; next/image cannot optimize them.
        // oxlint-disable-next-line nextjs/no-img-element
        <img
          src={attachment.previewDataUrl ?? undefined}
          alt=""
          className={`${ATTACHMENT_VISUAL_CLASS} ${readOnly ? "" : "-ml-0.25"} shrink-0 rounded-sm object-cover`}
          onError={() => setImageLoadFailed(true)}
        />
      ) : (
        <div
          className={`${readOnly ? "" : "-ml-0.25"} inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground`}
        >
          <File className={`${ATTACHMENT_VISUAL_CLASS} shrink-0`} aria-hidden />
        </div>
      )}
      <div className="min-w-0 pr-0.5">
        <div
          className={`truncate text-xs leading-4 ${FONT_WEIGHT_NORMAL} text-foreground/90`}
          title={attachment.path}
        >
          {attachment.name}
        </div>
      </div>
    </div>
  );
}

export function ComposerLocalFileStrip({
  attachments,
  readOnly = false,
  className,
  onRemove,
}: ComposerLocalFileStripProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={className ?? "flex flex-wrap gap-1.5 pl-2 pr-3 pt-2 pb-1"}>
      {attachments.map((attachment) => (
        <ComposerLocalFileCard
          key={attachment.id ?? attachment.path}
          attachment={attachment}
          readOnly={readOnly}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
