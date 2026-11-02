import type { PrDiffAttachment } from "./pr-diff-attachment.js";
import { formatChipWireBlock, formatLineRange, scanChipWireBlocks } from "./chip-wire-block.js";

function formatPrDiffWireMeta(
  attachment: Pick<PrDiffAttachment, "filename" | "lineStart" | "lineEnd" | "status">,
): string {
  const normalized = attachment.filename.replace(/\\/gu, "/").trim() || "file";
  const hasLines = attachment.lineStart > 0 && attachment.lineEnd > 0;
  const linePart = hasLines
    ? attachment.lineStart === attachment.lineEnd
      ? `L${attachment.lineStart}`
      : `L${attachment.lineStart}-${attachment.lineEnd}`
    : "-";
  return `${normalized}\t${linePart}\t${attachment.status}`;
}

function formatPrDiffInfoLine(
  attachment: Pick<PrDiffAttachment, "prUrl" | "filename" | "lineStart" | "lineEnd" | "status">,
): string {
  const filename = attachment.filename.replace(/\\/gu, "/").trim() || "file";
  const lineSuffix = formatLineRange(attachment.lineStart, attachment.lineEnd).replace(/^:/u, "");
  return `diff:${attachment.prUrl}\t${filename}\t${lineSuffix}\t${attachment.status}`;
}

/** Wire-format PR diff block (shared by attachment + composer segment model). */
export function prDiffContextText(
  attachment: Pick<
    PrDiffAttachment,
    "prUrl" | "filename" | "lineStart" | "lineEnd" | "status" | "diffText"
  >,
): string {
  return formatChipWireBlock(formatPrDiffInfoLine(attachment), attachment.diffText);
}

export type ParsedPrDiffWireBlock = {
  index: number;
  length: number;
  prUrl: string;
  meta: string;
  diffText: string;
};

function parsePrDiffInfoLine(infoLine: string): {
  prUrl: string;
  filename: string;
  lineStart: number;
  lineEnd: number;
  status: PrDiffAttachment["status"];
} | null {
  if (!infoLine.startsWith("diff:")) {
    return null;
  }
  const parts = infoLine.slice("diff:".length).split("\t");
  if (parts.length !== 4) {
    return null;
  }
  const prUrl = parts[0]?.trim() ?? "";
  const filename = parts[1]?.trim() ?? "";
  const linePart = parts[2]?.trim() ?? "";
  const statusRaw = parts[3]?.trim() ?? "";
  if (
    !prUrl ||
    !filename ||
    (statusRaw !== "open" &&
      statusRaw !== "merged" &&
      statusRaw !== "closed" &&
      statusRaw !== "draft")
  ) {
    return null;
  }
  if (!linePart) {
    return { prUrl, filename, lineStart: 0, lineEnd: 0, status: statusRaw };
  }
  const singleMatch = /^(\d+)$/u.exec(linePart);
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    return { prUrl, filename, lineStart: line, lineEnd: line, status: statusRaw };
  }
  const rangeMatch = /^(\d+)-(\d+)$/u.exec(linePart);
  if (!rangeMatch) {
    return null;
  }
  return {
    prUrl,
    filename,
    lineStart: Number(rangeMatch[1]),
    lineEnd: Number(rangeMatch[2]),
    status: statusRaw,
  };
}

/** Scan wire text for PR diff blocks; closing fence must be a standalone line. */
export function scanPrDiffWireBlocks(content: string): ParsedPrDiffWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("diff:"))
    .map((block) => {
      const parsed = parsePrDiffInfoLine(block.infoLine);
      if (!parsed) {
        return null;
      }
      return {
        index: block.index,
        length: block.length,
        prUrl: parsed.prUrl,
        meta: formatPrDiffWireMeta(parsed),
        diffText: block.body,
      };
    })
    .filter((block): block is ParsedPrDiffWireBlock => block !== null);
}

export function parsePrDiffWireMeta(meta: string): {
  filename: string;
  lineStart: number;
  lineEnd: number;
  status: PrDiffAttachment["status"];
} | null {
  const tabParts = meta.trim().split("\t");
  if (tabParts.length !== 3) {
    return null;
  }
  const filename = tabParts[0]?.trim() ?? "";
  const linePart = tabParts[1]?.trim() ?? "";
  const statusRaw = tabParts[2]?.trim() ?? "";
  if (
    !filename ||
    (statusRaw !== "open" &&
      statusRaw !== "merged" &&
      statusRaw !== "closed" &&
      statusRaw !== "draft")
  ) {
    return null;
  }
  if (linePart === "-") {
    return { filename, lineStart: 0, lineEnd: 0, status: statusRaw };
  }
  const lineMatch = /^L(\d+)(?:-(\d+))?$/u.exec(linePart);
  if (!lineMatch) {
    return null;
  }
  const lineStart = Number(lineMatch[1]);
  const lineEnd = lineMatch[2] !== undefined ? Number(lineMatch[2]) : lineStart;
  return {
    filename,
    lineStart,
    lineEnd,
    status: statusRaw,
  };
}
