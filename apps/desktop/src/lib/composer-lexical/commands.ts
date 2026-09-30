import { createCommand, type LexicalCommand } from "lexical";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type {
  ActiveSkillSlashQuery,
  ActiveWorkspaceFileReferenceQuery,
} from "@/lib/composer-segment-model";

export type ComposerAttachmentChipPayload =
  | { kind: "element"; attachment: BrowserElementAttachment }
  | { kind: "prDiff"; attachment: PrDiffAttachment }
  | { kind: "gitCommit"; attachment: GitCommitAttachment }
  | { kind: "terminalSnippet"; attachment: TerminalSnippetAttachment }
  | { kind: "fileSnippet"; attachment: FileSnippetAttachment }
  | { kind: "messageQuote"; attachment: MessageQuoteAttachment };

export type InsertSkillChipCommandPayload = {
  alias: string;
  clearText?: boolean;
  appendTrailingSpace?: boolean;
};

export type ReplaceSkillSlashCommandPayload = {
  query: ActiveSkillSlashQuery;
  replacement: string;
  finalize?: boolean;
};

export type ReplaceWorkspaceFileReferenceCommandPayload = {
  path: string;
  query: ActiveWorkspaceFileReferenceQuery;
  finalize?: boolean;
  /** Inserted via the Plan row of the @ menu: the chip is the session Plan file reference. */
  isPlan?: boolean;
};

export type ReplaceSessionReferenceCommandPayload = {
  path: string;
  title: string;
  content?: string;
  query: ActiveWorkspaceFileReferenceQuery;
  finalize?: boolean;
};

export const INSERT_ATTACHMENT_CHIP_COMMAND: LexicalCommand<ComposerAttachmentChipPayload> =
  createCommand("SPIRIT_INSERT_ATTACHMENT_CHIP");

export const INSERT_WORKSPACE_FILE_AT_CARET_COMMAND: LexicalCommand<{
  path: string;
  sourceTabId?: string;
}> = createCommand("SPIRIT_INSERT_WORKSPACE_FILE_AT_CARET");

export const INSERT_WORKSPACE_FILE_REFERENCE_COMMAND: LexicalCommand<ReplaceWorkspaceFileReferenceCommandPayload> =
  createCommand("SPIRIT_INSERT_WORKSPACE_FILE_REFERENCE");

export const INSERT_SESSION_REFERENCE_COMMAND: LexicalCommand<ReplaceSessionReferenceCommandPayload> =
  createCommand("SPIRIT_INSERT_SESSION_REFERENCE");

export const INSERT_SKILL_CHIP_COMMAND: LexicalCommand<InsertSkillChipCommandPayload> =
  createCommand("SPIRIT_INSERT_SKILL_CHIP");

export const INSERT_PLAIN_TEXT_COMMAND: LexicalCommand<{ text: string }> = createCommand(
  "SPIRIT_INSERT_PLAIN_TEXT",
);

export const REPLACE_SKILL_SLASH_COMMAND: LexicalCommand<ReplaceSkillSlashCommandPayload> =
  createCommand("SPIRIT_REPLACE_SKILL_SLASH");

export const REMOVE_SKILL_SLASH_COMMAND: LexicalCommand<{ query: ActiveSkillSlashQuery }> =
  createCommand("SPIRIT_REMOVE_SKILL_SLASH");
