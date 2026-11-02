import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "./composer-inline-chip-styles.js";
import { workspaceFileBasename } from "./path-utils.js";
import type { FileSnippetAttachment } from "./file-snippet-attachment.js";

export const FILE_SNIPPET_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const FILE_SNIPPET_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

export function formatFileSnippetChipLabel(
  filePath: string,
  lineStart: number,
  lineEnd: number,
): string {
  const base = workspaceFileBasename(filePath.replace(/\\/gu, "/"));
  if (lineStart > 0 && lineEnd > 0) {
    return `${base} L${lineStart}-${lineEnd}`;
  }
  return base;
}

export function formatFileSnippetChipTitle(attachment: FileSnippetAttachment): string {
  const normalized = attachment.filePath.replace(/\\/gu, "/");
  const linePart =
    attachment.lineStart > 0 && attachment.lineEnd > 0
      ? ` — L${attachment.lineStart}-${attachment.lineEnd}`
      : "";
  return `${normalized}${linePart}`;
}
