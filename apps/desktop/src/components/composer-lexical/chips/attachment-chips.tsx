import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import { MessageCircleMore } from "lucide-react";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { ChipIcon, ChipIconSvg, ChipShell } from "@/components/composer-lexical/chips/chip-shell";
import { NavigableChipLabel } from "@/contexts/composer-chip-navigate-context";
import {
  BROWSER_ELEMENT_CHIP_CLASS,
  BROWSER_ELEMENT_CHIP_ICON_CLASS,
} from "@/lib/browser-element-chip-styles";
import {
  formatFileSnippetChipLabel,
  formatFileSnippetChipTitle,
  FILE_SNIPPET_CHIP_CLASS,
  FILE_SNIPPET_CHIP_ICON_CLASS,
} from "@/lib/file-snippet-chip-styles";
import {
  formatGitCommitChipLabel,
  formatGitCommitChipTitle,
  GIT_COMMIT_CHIP_CLASS,
  GIT_COMMIT_CHIP_ICON_CLASS,
} from "@/lib/git-commit-chip-styles";
import {
  formatMessageQuoteChipLabel,
  formatMessageQuoteChipTitle,
  MESSAGE_QUOTE_CHIP_CLASS,
  MESSAGE_QUOTE_CHIP_ICON_CLASS,
} from "@/lib/message-quote-chip-styles";
import {
  formatPrDiffChipLabel,
  formatPrDiffChipTitle,
  prDiffChipClassForStatus,
  PR_DIFF_CHIP_ICON_CLASS,
} from "@/lib/github-pr-diff-chip-styles";
import {
  formatTerminalChipLabel,
  formatTerminalChipTitle,
  TERMINAL_CHIP_CLASS,
  TERMINAL_CHIP_ICON_CLASS,
} from "@/lib/terminal-chip-styles";
import {
  WORKSPACE_FILE_ICON_CHIP_CLASS,
  WORKSPACE_FILE_ICON_CHIP_SIZE_PX,
} from "@/lib/workspace-file-icon-sizes";

export function ElementChip({ attachment }: { attachment: BrowserElementAttachment }) {
  return (
    <ChipShell
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
      <NavigableChipLabel
        target={{
          kind: "element",
          pageUrl: attachment.pageUrl,
          ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
        }}
      >
        {`<${attachment.tagName}>`}
      </NavigableChipLabel>
    </ChipShell>
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
    <ChipShell
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
      <NavigableChipLabel
        target={{
          kind: "prDiff",
          prUrl: attachment.prUrl,
          ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
        }}
      >
        {formatPrDiffChipLabel(attachment.filename, attachment.lineStart, attachment.lineEnd)}
      </NavigableChipLabel>
    </ChipShell>
  );
}

export function GitCommitChip({ attachment }: { attachment: GitCommitAttachment }) {
  return (
    <ChipShell
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
      <NavigableChipLabel
        target={{
          kind: "gitCommit",
          ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
        }}
      >
        {formatGitCommitChipLabel(attachment.subject)}
      </NavigableChipLabel>
    </ChipShell>
  );
}

export function TerminalSnippetChip({ attachment }: { attachment: TerminalSnippetAttachment }) {
  return (
    <ChipShell
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
      <NavigableChipLabel
        target={{
          kind: "terminalSnippet",
          ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
        }}
      >
        {formatTerminalChipLabel(attachment.terminalName, attachment.lineStart, attachment.lineEnd)}
      </NavigableChipLabel>
    </ChipShell>
  );
}

export function FileSnippetChip({ attachment }: { attachment: FileSnippetAttachment }) {
  return (
    <ChipShell
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
        <WorkspaceFileIcon
          path={attachment.filePath}
          kind="file"
          size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX}
          colorMode="inherit"
        />
      </ChipIcon>
      <NavigableChipLabel
        target={{
          kind: "fileSnippet",
          filePath: attachment.filePath,
          lineStart: attachment.lineStart,
          lineEnd: attachment.lineEnd,
          ...(attachment.sourceTabId ? { sourceTabId: attachment.sourceTabId } : {}),
        }}
      >
        {formatFileSnippetChipLabel(attachment.filePath, attachment.lineStart, attachment.lineEnd)}
      </NavigableChipLabel>
    </ChipShell>
  );
}

export function MessageQuoteChip({ attachment }: { attachment: MessageQuoteAttachment }) {
  return (
    <ChipShell
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
      <NavigableChipLabel
        target={{
          kind: "messageQuote",
          quoteSessionPath: attachment.sessionPath,
          quoteMessageId: attachment.messageId,
          quoteOrigin: attachment.origin,
        }}
      >
        {formatMessageQuoteChipLabel(attachment.selectedText)}
      </NavigableChipLabel>
    </ChipShell>
  );
}
