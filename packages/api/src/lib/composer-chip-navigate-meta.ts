import type { QuoteChipOrigin } from "@spiritagent/ui/composer";

export type { QuoteChipOrigin };

export type NavigableComposerChipKind =
  | "skill"
  | "workspaceFile"
  | "fileSnippet"
  | "sessionReference"
  | "element"
  | "gitCommit"
  | "terminalSnippet"
  | "prDiff"
  | "messageQuote";

export type ComposerChipNavigateMeta = {
  kind: NavigableComposerChipKind;
  sourceTabId?: string;
  isPlan?: boolean;
  quoteSessionPath?: string;
  quoteMessageId?: number;
  quoteOrigin?: QuoteChipOrigin;
};
