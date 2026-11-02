import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

function formatSessionReferenceInfoLine(path: string, title: string): string {
  const normalized = path.replace(/\\/gu, "/").trim();
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return `session:${normalized}`;
  }
  return `session:${normalized}\t${trimmedTitle}`;
}

function parseSessionReferenceInfoLine(infoLine: string): { path: string; title: string } | null {
  if (!infoLine.startsWith("session:")) {
    return null;
  }
  const payload = infoLine.slice("session:".length);
  const tab = payload.indexOf("\t");
  if (tab < 0) {
    const path = payload.trim().replace(/\\/gu, "/");
    return path ? { path, title: "" } : null;
  }
  const path = payload.slice(0, tab).trim().replace(/\\/gu, "/");
  const title = payload.slice(tab + 1).trim();
  if (!path) {
    return null;
  }
  return { path, title };
}

/** Wire-format session reference (Git Commit / Terminal style fence in user text). */
export function sessionReferenceContextText(path: string, title: string, content = ""): string {
  return formatChipWireBlock(formatSessionReferenceInfoLine(path, title), content);
}

export type ParsedSessionReferenceWireBlock = {
  index: number;
  length: number;
  path: string;
  title: string;
  content: string;
};

/** Scan wire text for session reference blocks. */
export function scanSessionReferenceWireBlocks(content: string): ParsedSessionReferenceWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("session:"))
    .map((block) => {
      const parsed = parseSessionReferenceInfoLine(block.infoLine);
      if (!parsed) {
        return null;
      }
      return {
        index: block.index,
        length: block.length,
        path: parsed.path,
        title: parsed.title,
        content: block.body,
      };
    })
    .filter((block): block is ParsedSessionReferenceWireBlock => block !== null);
}
