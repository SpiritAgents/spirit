import type { TerminalSnippetAttachment } from "./terminal-snippet-attachment.js";
import {
  formatChipWireBlock,
  formatLineRange,
  scanChipWireBlocks,
  splitInfoPayloadAndLineRange,
} from "./chip-wire-block.js";

/** Wire-format terminal snippet block (shared by attachment + composer segment model). */
export function terminalSnippetContextText(
  attachment: Pick<
    TerminalSnippetAttachment,
    "terminalName" | "lineStart" | "lineEnd" | "selectedText"
  >,
): string {
  const name = attachment.terminalName.trim() || "Terminal";
  const lineSuffix = formatLineRange(attachment.lineStart, attachment.lineEnd);
  return formatChipWireBlock(`terminal:${name}${lineSuffix}`, attachment.selectedText);
}

export type ParsedTerminalSnippetWireBlock = {
  index: number;
  length: number;
  terminalName: string;
  meta: string;
  selectedText: string;
};

function formatTerminalSnippetMeta(lineStart: number, lineEnd: number): string {
  if (lineStart > 0 && lineEnd > 0) {
    return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}-${lineEnd}`;
  }
  return "-";
}

/** Scan wire text for terminal snippet blocks; closing fence must be a standalone line. */
export function scanTerminalSnippetWireBlocks(content: string): ParsedTerminalSnippetWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("terminal:"))
    .map((block) => {
      const split = splitInfoPayloadAndLineRange(block.infoLine.slice("terminal:".length));
      if (!split) {
        return null;
      }
      return {
        index: block.index,
        length: block.length,
        terminalName: split.payload,
        meta: formatTerminalSnippetMeta(split.lineStart, split.lineEnd),
        selectedText: block.body,
      };
    })
    .filter((block): block is ParsedTerminalSnippetWireBlock => block !== null);
}

export function parseTerminalSnippetLinePart(linePart: string): {
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
