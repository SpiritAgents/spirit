import type { MessageQuoteAttachment } from "./message-quote-attachment.js";
import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

/** Wire-format message quote block (shared by attachment + composer segment model). */
export function messageQuoteContextText(
  attachment: Pick<MessageQuoteAttachment, "selectedText">,
): string {
  return formatChipWireBlock("quote", attachment.selectedText);
}

export type ParsedMessageQuoteWireBlock = {
  index: number;
  length: number;
  selectedText: string;
};

/** Scan wire text for message quote blocks; info line must be exactly "quote". */
export function scanMessageQuoteWireBlocks(content: string): ParsedMessageQuoteWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine === "quote" && block.body.length > 0)
    .map((block) => ({
      index: block.index,
      length: block.length,
      selectedText: block.body,
    }));
}
