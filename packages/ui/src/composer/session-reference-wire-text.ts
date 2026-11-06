import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

function formatSessionReferenceInfoLine(path: string, title: string, sessionId?: string): string {
  const normalized = path.replace(/\\/gu, "/").trim();
  const trimmedTitle = title.trim();
  const base = trimmedTitle ? `session:${normalized}\t${trimmedTitle}` : `session:${normalized}`;
  const normalizedSessionId = sessionId?.trim();
  return normalizedSessionId ? `${base}\tsession_id=${normalizedSessionId}` : base;
}

function parseSessionReferenceInfoLine(
  infoLine: string,
): { path: string; title: string; sessionId?: string } | null {
  if (!infoLine.startsWith("session:")) {
    return null;
  }
  const payload = infoLine.slice("session:".length);
  const [rawPath, ...metadata] = payload.split("\t");
  const path = rawPath.trim().replace(/\\/gu, "/");
  const rawSessionId = metadata.at(-1)?.startsWith("session_id=") ? metadata.pop() : undefined;
  const title = metadata.join("\t").trim();
  const sessionId = rawSessionId?.slice("session_id=".length).trim();
  if (!path) {
    return null;
  }
  return { path, title, ...(sessionId ? { sessionId } : {}) };
}

/** Wire-format session reference (Git Commit / Terminal style fence in user text). */
export function sessionReferenceContextText(
  path: string,
  title: string,
  content = "",
  sessionId?: string,
): string {
  return formatChipWireBlock(formatSessionReferenceInfoLine(path, title, sessionId), content);
}

export type ParsedSessionReferenceWireBlock = {
  index: number;
  length: number;
  path: string;
  title: string;
  content: string;
  sessionId?: string;
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
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
      };
    })
    .filter((block): block is ParsedSessionReferenceWireBlock => block !== null);
}
