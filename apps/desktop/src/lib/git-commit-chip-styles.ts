import {
  COMPOSER_CHIP_ICON_SIZE_PX,
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "@/lib/composer-inline-chip-styles";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";

export const GIT_COMMIT_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const GIT_COMMIT_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

const GIT_COMMIT_ICON_PATH =
  '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>';

export function formatGitCommitChipLabel(subject: string): string {
  const trimmed = subject.trim();
  // Truncate by code point to avoid splitting surrogate pairs (emoji, etc.) and producing mojibake.
  const points = [...trimmed];
  if (points.length <= 48) {
    return trimmed;
  }
  return `${points.slice(0, 45).join("")}…`;
}

export function formatGitCommitChipTitle(attachment: GitCommitAttachment): string {
  const shortOid = attachment.oid.length > 7 ? attachment.oid.slice(0, 7) : attachment.oid;
  return `${shortOid} — ${attachment.author} — ${attachment.authoredAt}`;
}

export function makeGitCommitChipNode(attachment: GitCommitAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-git-commit-chip", "true");
  span.dataset.gitCommitChip = "true";
  span.dataset.gitCommitId = attachment.id;
  span.dataset.gitCommitOid = attachment.oid;
  span.dataset.gitCommitSubject = attachment.subject;
  span.dataset.gitCommitAuthor = attachment.author;
  span.dataset.gitCommitAuthoredAt = attachment.authoredAt;
  span.dataset.gitCommitFullMessage = attachment.fullMessage;
  span.title = formatGitCommitChipTitle(attachment);
  span.className = GIT_COMMIT_CHIP_CLASS;
  span.setAttribute("aria-label", formatGitCommitChipLabel(attachment.subject));

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", String(COMPOSER_CHIP_ICON_SIZE_PX));
  icon.setAttribute("height", String(COMPOSER_CHIP_ICON_SIZE_PX));
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.75");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("class", GIT_COMMIT_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = GIT_COMMIT_ICON_PATH;

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(formatGitCommitChipLabel(attachment.subject)));
  return span;
}
