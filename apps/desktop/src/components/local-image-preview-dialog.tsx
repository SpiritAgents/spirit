import { useTranslation } from "react-i18next";

import { ImagePreviewDialog } from "@/components/ui/image-preview-dialog";

export const LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS = "spirit-floating-action-button";

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

  return (
    <ImagePreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      src={previewDataUrl}
      closeLabel={t("app.closeImagePreview")}
      copyLabel={t("app.copyImage")}
      copiedLabel={t("app.imageCopied")}
      downloadLabel={t("app.downloadImage")}
      onSave={onSave}
      saving={saving}
    />
  );
}
