import { workspaceFileBasename } from "./path-utils.js";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "./composer-inline-chip-styles.js";
import type { PrDiffAttachment, PullRequestChipStatus } from "./pr-diff-attachment.js";

export const PR_DIFF_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const PR_DIFF_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

export function prDiffChipClassForStatus(_status: PullRequestChipStatus): string {
  return PR_DIFF_CHIP_CLASS;
}

export function formatPrDiffChipLabel(
  filename: string,
  lineStart: number,
  lineEnd: number,
): string {
  const base = workspaceFileBasename(filename.replace(/\\/gu, "/"));
  if (lineStart > 0 && lineEnd > 0) {
    return `${base} L${lineStart}-${lineEnd}`;
  }
  return base;
}

export function formatPrDiffChipTitle(attachment: PrDiffAttachment): string {
  const normalized = attachment.filename.replace(/\\/gu, "/");
  const linePart =
    attachment.lineStart > 0 && attachment.lineEnd > 0
      ? ` — L${attachment.lineStart}-${attachment.lineEnd}`
      : "";
  return `${normalized} — ${attachment.prUrl}${linePart}`;
}
