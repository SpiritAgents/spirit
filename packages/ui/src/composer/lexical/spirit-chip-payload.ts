import { workspaceFilePlainToken, type RichSegment } from "../composer-segment-model.js";
import { formatFileSnippetChipLabel } from "../file-snippet-chip-styles.js";
import { formatGitCommitChipLabel } from "../git-commit-chip-styles.js";
import { formatPrDiffChipLabel } from "../github-pr-diff-chip-styles.js";
import { formatMessageQuoteChipLabel } from "../message-quote-chip-styles.js";
import { formatTerminalChipLabel } from "../terminal-chip-styles.js";

/** Non-text composer segment stored inside a Lexical SpiritChipNode. */
export type SpiritChipPayload = Exclude<RichSegment, { kind: "text" }>;

export function isSpiritChipPayload(value: RichSegment): value is SpiritChipPayload {
  return value.kind !== "text";
}

// The node layer cannot access ComposerChipLabelsContext (the host may localize labels), so clipboard text always uses the default English labels
const CHIP_KIND_DEFAULT_LABEL = {
  plan: "Plan",
  ask: "Ask",
  debug: "Debug",
  loop: "Loop",
} as const;

/** Canonical clipboard text for a chip: what Lexical copy / selection text should carry. */
export function spiritChipPlainText(payload: SpiritChipPayload): string {
  switch (payload.kind) {
    case "workspaceFile":
      return workspaceFilePlainToken(payload.path);
    case "sessionReference":
      return payload.title;
    case "skill":
      return payload.alias;
    case "element":
      return `<${payload.attachment.tagName}>`;
    case "prDiff":
      return formatPrDiffChipLabel(
        payload.attachment.filename,
        payload.attachment.lineStart,
        payload.attachment.lineEnd,
      );
    case "gitCommit":
      return formatGitCommitChipLabel(payload.attachment.subject);
    case "terminalSnippet":
      return formatTerminalChipLabel(
        payload.attachment.terminalName,
        payload.attachment.lineStart,
        payload.attachment.lineEnd,
      );
    case "fileSnippet":
      return formatFileSnippetChipLabel(
        payload.attachment.filePath,
        payload.attachment.lineStart,
        payload.attachment.lineEnd,
      );
    case "messageQuote":
      return formatMessageQuoteChipLabel(payload.attachment.selectedText);
    case "loop":
    case "plan":
    case "ask":
    case "debug":
      return CHIP_KIND_DEFAULT_LABEL[payload.kind];
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
