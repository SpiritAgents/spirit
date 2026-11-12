import { useMemo } from "react";

import type { BrowserElementAttachment } from "@spiritagent/ui/composer";
import type { FileSnippetAttachment } from "@spiritagent/ui/composer";
import type { GitCommitAttachment } from "@spiritagent/ui/composer";
import type { MessageQuoteAttachment } from "@spiritagent/ui/composer";
import type { PrDiffAttachment } from "@spiritagent/ui/composer";
import type { TerminalSnippetAttachment } from "@spiritagent/ui/composer";

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
