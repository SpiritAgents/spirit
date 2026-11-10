import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { ComposerLocalFileAttachmentView } from "@spiritagent/ui/composer";
import {
  isPreviewableImagePath,
  localFileAttachmentsSnapshotKey,
  normalizeSlashPath,
  readCachedLocalFilePreviewDataUrl,
  rememberLocalFilePreviewDataUrl,
} from "@spiritagent/ui/composer";

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;

export function useLocalFileAttachmentPreviews(
  attachments: readonly ComposerLocalFileAttachmentView[],
  setAttachments: Dispatch<SetStateAction<ComposerLocalFileAttachmentView[]>>,
  readLocalImagePreviewDataUrl: ReadLocalImagePreview | undefined,
): void {
  const attachmentSnapshotKey = localFileAttachmentsSnapshotKey(
    attachments.map((attachment) => ({
      path: attachment.path,
      name: attachment.name,
      isImage: attachment.isImage,
    })),
  );

  useEffect(() => {
    if (!readLocalImagePreviewDataUrl) {
      return;
    }

    for (const attachment of attachments) {
      const cachedPreview = readCachedLocalFilePreviewDataUrl(attachment.path);
      if (cachedPreview && !attachment.previewDataUrl) {
        setAttachments((current) =>
          current.map((item) =>
            normalizeSlashPath(item.path) === normalizeSlashPath(attachment.path)
              ? { ...item, previewDataUrl: cachedPreview }
              : item,
          ),
        );
      }

      if (
        !attachment.isImage ||
        !isPreviewableImagePath(attachment.path) ||
        attachment.previewDataUrl ||
        cachedPreview
      ) {
        continue;
      }

      const normalizedPath = normalizeSlashPath(attachment.path);
      void readLocalImagePreviewDataUrl(normalizedPath).then((previewDataUrl) => {
        if (!previewDataUrl) {
          return;
        }

        rememberLocalFilePreviewDataUrl(normalizedPath, previewDataUrl);

        setAttachments((current) =>
          current.map((item) =>
            normalizeSlashPath(item.path) === normalizedPath ? { ...item, previewDataUrl } : item,
          ),
        );
      });
    }
  }, [attachmentSnapshotKey, attachments, readLocalImagePreviewDataUrl, setAttachments]);
}
