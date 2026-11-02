import type { GitCommitAttachment } from "./git-commit-attachment.js";
import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

function formatGitCommitInfoLine(
  attachment: Pick<GitCommitAttachment, "oid" | "author" | "authoredAt">,
): string {
  return `git:${attachment.oid}\t${attachment.author}\t${attachment.authoredAt}`;
}

function parseGitCommitInfoLine(infoLine: string): {
  oid: string;
  author: string;
  authoredAt: string;
} | null {
  if (!infoLine.startsWith("git:")) {
    return null;
  }
  const payload = infoLine.slice("git:".length);
  const parts = payload.split("\t");
  if (parts.length === 1) {
    const oid = parts[0]?.trim() ?? "";
    return oid ? { oid, author: "", authoredAt: "" } : null;
  }
  if (parts.length < 3) {
    return null;
  }
  const oid = parts[0]?.trim() ?? "";
  const authoredAt = parts[parts.length - 1]?.trim() ?? "";
  const author = parts.slice(1, -1).join("\t").trim();
  if (!oid) {
    return null;
  }
  return { oid, author, authoredAt };
}

/** Wire-format git commit block (shared by attachment + composer segment model). */
export function gitCommitContextText(
  attachment: Pick<
    GitCommitAttachment,
    "oid" | "subject" | "author" | "authoredAt" | "fullMessage"
  >,
): string {
  return formatChipWireBlock(formatGitCommitInfoLine(attachment), attachment.fullMessage);
}

export type ParsedGitCommitWireBlock = {
  index: number;
  length: number;
  oid: string;
  author: string;
  authoredAt: string;
  fullMessage: string;
};

/** Scan wire text for git commit blocks; closing fence must be a standalone line. */
export function scanGitCommitWireBlocks(content: string): ParsedGitCommitWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("git:"))
    .map((block) => {
      const parsed = parseGitCommitInfoLine(block.infoLine);
      if (!parsed) {
        return null;
      }
      return {
        index: block.index,
        length: block.length,
        oid: parsed.oid,
        author: parsed.author,
        authoredAt: parsed.authoredAt,
        fullMessage: block.body,
      };
    })
    .filter((block): block is ParsedGitCommitWireBlock => block !== null);
}

export function deriveGitCommitSubject(fullMessage: string): string {
  return fullMessage.split("\n")[0]?.trim() ?? "";
}
