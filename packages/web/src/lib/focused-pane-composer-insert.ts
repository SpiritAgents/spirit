import { useMemo } from "react";

import type { BrowserElementAttachment } from "@spiritagent/ui/composer";
import type { FileSnippetAttachment } from "@spiritagent/ui/composer";
import type { GitCommitAttachment } from "@spiritagent/ui/composer";
import type { MessageQuoteAttachment } from "@spiritagent/ui/composer";
import type { PrDiffAttachment } from "@spiritagent/ui/composer";
import type { TerminalSnippetAttachment } from "@spiritagent/ui/composer";

export type FocusedPaneComposerInsertHandlers = {
  handleBrowserElementPicked: (attachment: BrowserElementAttachment) => void | Promise<void>;
  handlePrDiffAddToThread: (attachment: PrDiffAttachment) => void;
  handleGitCommitAddToThread: (attachment: GitCommitAttachment) => void;
  handleTerminalAddToThread: (attachment: TerminalSnippetAttachment) => void;
  handleFileSnippetAddToThread: (attachment: FileSnippetAttachment) => void;
  handleWorkspaceFileAddToThread: (relativePath: string, sourceTabId?: string) => void;
  handleMessageQuoteAddToThread: (attachment: MessageQuoteAttachment) => void;
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
      handlePrDiffAddToThread: (attachment) =>
        (getFocusedInsert()?.handlePrDiffAddToThread ?? fallback.handlePrDiffAddToThread)(
          attachment,
        ),
      handleGitCommitAddToThread: (attachment) =>
        (getFocusedInsert()?.handleGitCommitAddToThread ?? fallback.handleGitCommitAddToThread)(
          attachment,
        ),
      handleTerminalAddToThread: (attachment) =>
        (getFocusedInsert()?.handleTerminalAddToThread ?? fallback.handleTerminalAddToThread)(
          attachment,
        ),
      handleFileSnippetAddToThread: (attachment) =>
        (getFocusedInsert()?.handleFileSnippetAddToThread ?? fallback.handleFileSnippetAddToThread)(
          attachment,
        ),
      handleWorkspaceFileAddToThread: (relativePath, sourceTabId) =>
        (
          getFocusedInsert()?.handleWorkspaceFileAddToThread ??
          fallback.handleWorkspaceFileAddToThread
        )(relativePath, sourceTabId),
      handleMessageQuoteAddToThread: (attachment) =>
        (
          getFocusedInsert()?.handleMessageQuoteAddToThread ??
          fallback.handleMessageQuoteAddToThread
        )(attachment),
    }),
    [
      fallback.handleBrowserElementPicked,
      fallback.handleFileSnippetAddToThread,
      fallback.handleGitCommitAddToThread,
      fallback.handleMessageQuoteAddToThread,
      fallback.handlePrDiffAddToThread,
      fallback.handleTerminalAddToThread,
      fallback.handleWorkspaceFileAddToThread,
      getFocusedInsert,
    ],
  );
}
