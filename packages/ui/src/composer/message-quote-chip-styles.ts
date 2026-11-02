import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "./composer-inline-chip-styles.js";
import type { MessageQuoteAttachment } from "./message-quote-attachment.js";

export const MESSAGE_QUOTE_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const MESSAGE_QUOTE_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

const MESSAGE_QUOTE_LABEL_MAX_CHARS = 40;

function collapseToSingleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function formatMessageQuoteChipLabel(selectedText: string): string {
  const excerpt = collapseToSingleLine(selectedText);
  if (!excerpt) {
    return "Quote";
  }
  if (excerpt.length <= MESSAGE_QUOTE_LABEL_MAX_CHARS) {
    return excerpt;
  }
  return `${excerpt.slice(0, MESSAGE_QUOTE_LABEL_MAX_CHARS)}…`;
}

export function formatMessageQuoteChipTitle(
  attachment: Pick<MessageQuoteAttachment, "selectedText">,
): string {
  return attachment.selectedText;
}
