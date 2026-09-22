import { workspaceFileBasename } from "@/lib/file-picker-path";
import {
  COMPOSER_CHIP_ICON_SIZE_PX,
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "@/lib/composer-inline-chip-styles";
import type { PrDiffAttachment, PullRequestChipStatus } from "@/lib/pr-diff-attachment";

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

const GIT_PULL_REQUEST_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/>';

const GIT_PULL_REQUEST_CLOSED_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/>';

const GIT_PULL_REQUEST_DRAFT_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/><path d="M15 3h2v4"/><path d="M17 5h-4"/>';

const GIT_PULL_REQUEST_MERGED_ICON_PATH =
  '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>';

function prDiffIconPaths(status: PullRequestChipStatus): string {
  switch (status) {
    case "closed":
      return GIT_PULL_REQUEST_CLOSED_ICON_PATH;
    case "draft":
      return GIT_PULL_REQUEST_DRAFT_ICON_PATH;
    case "merged":
      return GIT_PULL_REQUEST_MERGED_ICON_PATH;
    default:
      return GIT_PULL_REQUEST_ICON_PATH;
  }
}

export function makePrDiffChipNode(attachment: PrDiffAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.prDiffId = attachment.id;
  span.dataset.prDiffUrl = attachment.prUrl;
  span.dataset.prDiffFilename = attachment.filename;
  span.dataset.prDiffLineStart = String(attachment.lineStart);
  span.dataset.prDiffLineEnd = String(attachment.lineEnd);
  span.dataset.prDiffText = attachment.diffText;
  span.dataset.prDiffStatus = attachment.status;
  span.dataset.prDiffChip = "true";
  span.setAttribute("data-pr-diff-chip", "true");
  span.className = prDiffChipClassForStatus(attachment.status);
  span.title = formatPrDiffChipTitle(attachment);

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", String(COMPOSER_CHIP_ICON_SIZE_PX));
  icon.setAttribute("height", String(COMPOSER_CHIP_ICON_SIZE_PX));
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.75");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("class", PR_DIFF_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = prDiffIconPaths(attachment.status);
  span.appendChild(icon);
  span.appendChild(
    doc.createTextNode(
      formatPrDiffChipLabel(attachment.filename, attachment.lineStart, attachment.lineEnd),
    ),
  );
  return span;
}
