import { useMemo } from "react";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";

export type FocusedPaneComposerInsertHandlers = {
  handleBrowserElementPicked: (attachment: BrowserElementAttachment) => void | Promise<void>;
  handlePrDiffAddToChat: (attachment: PrDiffAttachment) => void;
  handleGitCommitAddToChat: (attachment: GitCommitAttachment) => void;
  handleTerminalAddToChat: (attachment: TerminalSnippetAttachment) => void;
  handleFileSnippetAddToChat: (attachment: FileSnippetAttachment) => void;
  handleWorkspaceFileAddToChat: (relativePath: string, sourceTabId?: string) => void;
  handleMessageQuoteAddToChat: (attachment: MessageQuoteAttachment) => void;
};

/** Stable proxies: read focused pane handlers via getter at call time (no Provider re-render on register). */
export function useFocusedPaneComposerInsertCallbacks(
  getFocusedInsert: () => FocusedPaneComposerInsertHandlers | null,
  fallback: FocusedPaneComposerInsertHandlers,
): FocusedPaneComposerInsertHandlers {
  return useMemo(
    () => ({
      handleBrowserElementPicked: (attachment) =>
        (getFocusedInsert()?.handleBrowserElementPicked ?? fallback.handleBrowserElementPicked)(
          attachment,
        ),
      handlePrDiffAddToChat: (attachment) =>
        (getFocusedInsert()?.handlePrDiffAddToChat ?? fallback.handlePrDiffAddToChat)(attachment),
      handleGitCommitAddToChat: (attachment) =>
        (getFocusedInsert()?.handleGitCommitAddToChat ?? fallback.handleGitCommitAddToChat)(
          attachment,
        ),
      handleTerminalAddToChat: (attachment) =>
        (getFocusedInsert()?.handleTerminalAddToChat ?? fallback.handleTerminalAddToChat)(
          attachment,
        ),
      handleFileSnippetAddToChat: (attachment) =>
        (getFocusedInsert()?.handleFileSnippetAddToChat ?? fallback.handleFileSnippetAddToChat)(
          attachment,
        ),
      handleWorkspaceFileAddToChat: (relativePath, sourceTabId) =>
        (getFocusedInsert()?.handleWorkspaceFileAddToChat ?? fallback.handleWorkspaceFileAddToChat)(
          relativePath,
          sourceTabId,
        ),
      handleMessageQuoteAddToChat: (attachment) =>
        (getFocusedInsert()?.handleMessageQuoteAddToChat ?? fallback.handleMessageQuoteAddToChat)(
          attachment,
        ),
    }),
    [
      fallback.handleBrowserElementPicked,
      fallback.handleFileSnippetAddToChat,
      fallback.handleGitCommitAddToChat,
      fallback.handleMessageQuoteAddToChat,
      fallback.handlePrDiffAddToChat,
      fallback.handleTerminalAddToChat,
      fallback.handleWorkspaceFileAddToChat,
      getFocusedInsert,
    ],
  );
}
