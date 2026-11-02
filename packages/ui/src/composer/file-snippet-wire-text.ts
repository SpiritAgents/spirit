import type { FileSnippetAttachment } from "./file-snippet-attachment.js";
import {
  formatChipWireBlock,
  formatLineRange,
  scanChipWireBlocks,
  splitInfoPayloadAndLineRange,
} from "./chip-wire-block.js";

/** Wire-format file snippet block (shared by attachment + composer segment model). */
export function fileSnippetContextText(
  attachment: Pick<FileSnippetAttachment, "filePath" | "lineStart" | "lineEnd" | "selectedText">,
): string {
  const path = attachment.filePath.trim();
  const lineSuffix = formatLineRange(attachment.lineStart, attachment.lineEnd);
  return formatChipWireBlock(`file:${path}${lineSuffix}`, attachment.selectedText);
}

export type ParsedFileSnippetWireBlock = {
  index: number;
  length: number;
  filePath: string;
  meta: string;
  selectedText: string;
};

function formatFileSnippetMeta(lineStart: number, lineEnd: number): string {
  if (lineStart > 0 && lineEnd > 0) {
    return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}-${lineEnd}`;
  }
  return "-";
}

/** Scan wire text for file snippet blocks; closing fence must be a standalone line. */
export function scanFileSnippetWireBlocks(content: string): ParsedFileSnippetWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("file:") && block.body.length > 0)
    .map((block) => {
      const split = splitInfoPayloadAndLineRange(block.infoLine.slice("file:".length));
      if (!split) {
        return null;
      }
      return {
        index: block.index,
        length: block.length,
        filePath: split.payload,
        meta: formatFileSnippetMeta(split.lineStart, split.lineEnd),
        selectedText: block.body,
      };
    })
    .filter((block): block is ParsedFileSnippetWireBlock => block !== null);
}

export function parseFileSnippetLinePart(linePart: string): {
  lineStart: number;
  lineEnd: number;
} | null {
  const trimmed = linePart.trim();
  if (trimmed === "-") {
    return { lineStart: 0, lineEnd: 0 };
  }
  const lineMatch = /^L(\d+)(?:-(\d+))?$/u.exec(trimmed);
  if (!lineMatch) {
    return null;
  }
  const lineStart = Number(lineMatch[1]);
  const lineEnd = lineMatch[2] !== undefined ? Number(lineMatch[2]) : lineStart;
  return { lineStart, lineEnd };
}
