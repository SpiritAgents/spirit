import type { BrowserElementAttachment } from "../browser-element-attachment.js";
import type { FileSnippetAttachment } from "../file-snippet-attachment.js";
import type { GitCommitAttachment } from "../git-commit-attachment.js";
import type { MessageQuoteAttachment } from "../message-quote-attachment.js";
import type { PrDiffAttachment } from "../pr-diff-attachment.js";
import type { TerminalSnippetAttachment } from "../terminal-snippet-attachment.js";
import { MessageCircleMore } from "lucide-react";
import { WorkspaceFileIconSlot } from "../workspace-file-icon-context.js";
import { ChipIcon, ChipIconSvg, ChipLabel } from "./chip-shell.js";
import { NavigableChipShell } from "../chip-navigate-context.js";
import {
  BROWSER_ELEMENT_CHIP_CLASS,
  BROWSER_ELEMENT_CHIP_ICON_CLASS,
} from "../browser-element-chip-styles.js";
import {
  formatFileSnippetChipLabel,
  formatFileSnippetChipTitle,
  FILE_SNIPPET_CHIP_CLASS,
  FILE_SNIPPET_CHIP_ICON_CLASS,
} from "../file-snippet-chip-styles.js";
import {
  formatGitCommitChipLabel,
  formatGitCommitChipTitle,
  GIT_COMMIT_CHIP_CLASS,
  GIT_COMMIT_CHIP_ICON_CLASS,
} from "../git-commit-chip-styles.js";
import {
  formatMessageQuoteChipLabel,
  formatMessageQuoteChipTitle,
  MESSAGE_QUOTE_CHIP_CLASS,
  MESSAGE_QUOTE_CHIP_ICON_CLASS,
} from "../message-quote-chip-styles.js";
import {
  formatPrDiffChipLabel,
  formatPrDiffChipTitle,
  prDiffChipClassForStatus,
  PR_DIFF_CHIP_ICON_CLASS,
} from "../github-pr-diff-chip-styles.js";
import {
  formatTerminalChipLabel,
  formatTerminalChipTitle,
  TERMINAL_CHIP_CLASS,
  TERMINAL_CHIP_ICON_CLASS,
} from "../terminal-chip-styles.js";
import {
  WORKSPACE_FILE_ICON_CHIP_CLASS,
  WORKSPACE_FILE_ICON_CHIP_SIZE_PX,
} from "../workspace-file-icon-sizes.js";

export function ElementChip({ attachment }: { attachment: BrowserElementAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "element",
        pageUrl: attachment.pageUrl,
        ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
      }}
      data-chip-kind="element"
      data-element-chip="true"
      data-element-id={attachment.id}
      data-element-tag={attachment.tagName}
      data-element-html={attachment.outerHtml}
      data-element-url={attachment.pageUrl}
      className={BROWSER_ELEMENT_CHIP_CLASS}
      aria-label={`<${attachment.tagName}>`}
    >
      <ChipIconSvg className={BROWSER_ELEMENT_CHIP_ICON_CLASS}>
        <path d="M13 6 6.126 7.375a1 1 0 0 0-.776.746L2.028 20.765a1 1 0 0 0 1.207 1.207l12.644-3.322a1 1 0 0 0 .746-.776L18 11" />
        <path d="m2.3 21.7 7.286-7.286" />
        <path d="M21.293 8.293a1 1 0 0 1 0 1.414l-1.586 1.586a1 1 0 0 1-1.414 0l-5.586-5.586a1 1 0 0 1 0-1.414l1.586-1.586a1 1 0 0 1 1.414 0z" />
        <circle cx="11" cy="13" r="2" />
      </ChipIconSvg>
      <ChipLabel>{`<${attachment.tagName}>`}</ChipLabel>
    </NavigableChipShell>
  );
}

function prDiffIconPaths(status: PrDiffAttachment["status"]) {
  switch (status) {
    case "closed":
      return (
        <>
          <circle cx="6" cy="6" r="3" />
          <path d="M6 9v12" />
          <path d="M21 3v5a4 4 0 0 1-4 4H6" />
          <path d="m18 9-6 6" />
          <path d="m12 9 6 6" />
        </>
      );
    case "draft":
      return (
        <>
          <circle cx="6" cy="6" r="3" />
          <path d="M6 9v12" />
          <path d="M21 3v5a4 4 0 0 1-4 4H6" />
          <path d="M15 3h2v4" />
          <path d="M17 5h-4" />
        </>
      );
    case "merged":
      return (
        <>
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 21V9a9 9 0 0 0 9 9" />
        </>
      );
    default:
      return (
        <>
          <circle cx="6" cy="6" r="3" />
          <path d="M6 9v12" />
          <path d="M21 3v5a4 4 0 0 1-4 4H6" />
        </>
      );
  }
}

export function PrDiffChip({ attachment }: { attachment: PrDiffAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "prDiff",
        prUrl: attachment.prUrl,
        ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
      }}
      data-chip-kind="prDiff"
      className={prDiffChipClassForStatus(attachment.status)}
      title={formatPrDiffChipTitle(attachment)}
      aria-label={formatPrDiffChipLabel(
        attachment.filename,
        attachment.lineStart,
        attachment.lineEnd,
      )}
    >
      <ChipIconSvg className={PR_DIFF_CHIP_ICON_CLASS}>
        {prDiffIconPaths(attachment.status)}
      </ChipIconSvg>
      <ChipLabel>
        {formatPrDiffChipLabel(attachment.filename, attachment.lineStart, attachment.lineEnd)}
      </ChipLabel>
    </NavigableChipShell>
  );
}

export function GitCommitChip({ attachment }: { attachment: GitCommitAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "gitCommit",
        ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
      }}
      data-chip-kind="gitCommit"
      className={GIT_COMMIT_CHIP_CLASS}
      title={formatGitCommitChipTitle(attachment)}
      aria-label={formatGitCommitChipLabel(attachment.subject)}
    >
      <ChipIconSvg className={GIT_COMMIT_CHIP_ICON_CLASS}>
        <circle cx="12" cy="12" r="4" />
        <line x1="1.05" y1="12" x2="7" y2="12" />
        <line x1="17.01" y1="12" x2="22.96" y2="12" />
      </ChipIconSvg>
      <ChipLabel>{formatGitCommitChipLabel(attachment.subject)}</ChipLabel>
    </NavigableChipShell>
  );
}

export function TerminalSnippetChip({ attachment }: { attachment: TerminalSnippetAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "terminalSnippet",
        ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
      }}
      data-chip-kind="terminalSnippet"
      className={TERMINAL_CHIP_CLASS}
      title={formatTerminalChipTitle(attachment)}
      aria-label={formatTerminalChipLabel(
        attachment.terminalName,
        attachment.lineStart,
        attachment.lineEnd,
      )}
    >
      <ChipIconSvg className={TERMINAL_CHIP_ICON_CLASS}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" x2="20" y1="19" y2="19" />
      </ChipIconSvg>
      <ChipLabel>
        {formatTerminalChipLabel(attachment.terminalName, attachment.lineStart, attachment.lineEnd)}
      </ChipLabel>
    </NavigableChipShell>
  );
}

export function FileSnippetChip({ attachment }: { attachment: FileSnippetAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "fileSnippet",
        filePath: attachment.filePath,
        lineStart: attachment.lineStart,
        lineEnd: attachment.lineEnd,
        ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
      }}
      data-chip-kind="fileSnippet"
      className={FILE_SNIPPET_CHIP_CLASS}
      title={formatFileSnippetChipTitle(attachment)}
      aria-label={formatFileSnippetChipLabel(
        attachment.filePath,
        attachment.lineStart,
        attachment.lineEnd,
      )}
    >
      <ChipIcon className={FILE_SNIPPET_CHIP_ICON_CLASS}>
        <WorkspaceFileIconSlot
          path={attachment.filePath}
          kind="file"
          size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX}
        />
      </ChipIcon>
      <ChipLabel>
        {formatFileSnippetChipLabel(attachment.filePath, attachment.lineStart, attachment.lineEnd)}
      </ChipLabel>
    </NavigableChipShell>
  );
}

export function MessageQuoteChip({ attachment }: { attachment: MessageQuoteAttachment }) {
  return (
    <NavigableChipShell
      target={{
        kind: "messageQuote",
        quoteSessionPath: attachment.sessionPath,
        quoteMessageId: attachment.messageId,
        quoteOrigin: attachment.origin,
      }}
      data-chip-kind="messageQuote"
      className={MESSAGE_QUOTE_CHIP_CLASS}
      title={formatMessageQuoteChipTitle(attachment)}
      aria-label={formatMessageQuoteChipLabel(attachment.selectedText)}
    >
      <ChipIcon className={MESSAGE_QUOTE_CHIP_ICON_CLASS}>
        <MessageCircleMore
          className={WORKSPACE_FILE_ICON_CHIP_CLASS}
          aria-hidden
          strokeWidth={1.75}
        />
      </ChipIcon>
      <ChipLabel>{formatMessageQuoteChipLabel(attachment.selectedText)}</ChipLabel>
    </NavigableChipShell>
  );
}
