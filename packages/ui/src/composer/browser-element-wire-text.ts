import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

/** Wire-format element block (shared by attachment + composer segment model). */
export function browserElementContextText(attachment: {
  pageUrl: string;
  outerHtml: string;
}): string {
  return formatChipWireBlock(`element:${attachment.pageUrl}`, attachment.outerHtml);
}

export type ParsedBrowserElementWireBlock = {
  index: number;
  length: number;
  pageUrl: string;
  outerHtml: string;
};

/** Scan wire text for browser element blocks. */
export function scanBrowserElementWireBlocks(content: string): ParsedBrowserElementWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("element:"))
    .map((block) => ({
      index: block.index,
      length: block.length,
      pageUrl: block.infoLine.slice("element:".length),
      outerHtml: block.body,
    }))
    .filter((block) => block.pageUrl.length > 0);
}
