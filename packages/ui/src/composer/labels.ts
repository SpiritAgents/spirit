import { createContext, useContext } from "react";

/** Structural subset of the hosts' i18n translation functions (i18next TFunction and the site's desktop translator both satisfy it). */
export type LabelTranslator = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined> & {
    defaultValue?: string;
  },
) => string;

/** All user-visible copy of the composer family; hosts localize via their i18n. */
export type ComposerLabels = {
  send: string;
  abort: string;
  enqueueWhileBusy: string;
  /** aria-label of the send shortcut kbd hint */
  sendEnterKeyAriaLabel: string;
  loopChip: string;
  planChip: string;
  askChip: string;
  openInsertPanel: string;
  insert: string;
  insertWorkspaceFile: string;
  selectLocalFile: string;
  slashCommand: string;
  /** aria-label of the image attachment card when it can be previewed */
  viewLargeImage: string;
  removeAttachment: (name: string) => string;
  closeImagePreview: string;
  copyImage: string;
  imageCopied: string;
  downloadImage: string;
};

const ComposerLabelsContext = createContext<ComposerLabels | null>(null);

export const ComposerLabelsProvider = ComposerLabelsContext.Provider;

export function useComposerLabels(): ComposerLabels {
  const labels = useContext(ComposerLabelsContext);
  if (!labels) {
    throw new Error("ComposerLabelsProvider is missing: the host must localize the composer");
  }
  return labels;
}

/** Composer copy mapped to the desktop i18n keys (the site resolves the same keys via the desktop packs). */
export function buildComposerLabels(t: LabelTranslator): ComposerLabels {
  return {
    send: t("app.send"),
    abort: t("app.abort"),
    enqueueWhileBusy: t("composer.enqueueWhileBusy"),
    sendEnterKeyAriaLabel: t("composer.sendEnterKey"),
    loopChip: t("composer.loopChipLabel"),
    planChip: t("composer.planChipLabel"),
    askChip: t("composer.askChipLabel"),
    openInsertPanel: t("composer.openInsertPanel"),
    insert: t("composer.insert"),
    insertWorkspaceFile: t("composer.insertWorkspaceFile"),
    selectLocalFile: t("composer.selectLocalFile"),
    slashCommand: t("composer.slashCommand"),
    viewLargeImage: t("app.viewLargeImage"),
    removeAttachment: (name) => t("composer.removeAttachment", { name }),
    closeImagePreview: t("app.closeImagePreview"),
    copyImage: t("app.copyImage"),
    imageCopied: t("app.imageCopied"),
    downloadImage: t("app.downloadImage"),
  };
}
