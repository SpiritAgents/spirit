import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageCircle,
  MessageCircleMore,
  PenTool,
  Terminal,
  FileText,
} from "lucide-react";

import { BROWSER_ELEMENT_CHIP_ICON_CLASS } from "@/lib/browser-element-chip-styles";
import { ComposerLocalFileStrip } from "@/components/composer-local-file-strip";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import {
  isAttachmentOnlyDisplayText,
  localFileAttachmentsSnapshotKey,
  mergeComposerAttachmentViews,
  normalizeSlashPath,
  snapshotsToComposerAttachmentViews,
  uploadOnlyLocalFileAttachmentSnapshots,
  type ComposerLocalFileAttachmentView,
} from "@/lib/local-file-attachments";
import {
  parseMessageContentParts,
  trimMessageTextAroundElements,
  type MessageContentPart,
} from "@/lib/composer-segment-model";
import {
  alignChipNavigateMetaToParts,
  isNavigableComposerChipKind,
  type ComposerChipNavigateMeta,
} from "@/lib/composer-chip-navigate-meta";
import {
  formatGitCommitChipLabel,
  formatGitCommitChipTitle,
  GIT_COMMIT_CHIP_ICON_CLASS,
} from "@/lib/git-commit-chip-styles";
import {
  formatPrDiffChipLabel,
  formatPrDiffChipTitle,
  PR_DIFF_CHIP_ICON_CLASS,
} from "@/lib/github-pr-diff-chip-styles";
import {
  formatFileSnippetChipLabel,
  formatFileSnippetChipTitle,
  FILE_SNIPPET_CHIP_ICON_CLASS,
} from "@/lib/file-snippet-chip-styles";
import {
  formatTerminalChipLabel,
  formatTerminalChipTitle,
  TERMINAL_CHIP_ICON_CLASS,
} from "@/lib/terminal-chip-styles";
import {
  formatMessageQuoteChipLabel,
  formatMessageQuoteChipTitle,
  MESSAGE_QUOTE_CHIP_ICON_CLASS,
} from "@/lib/message-quote-chip-styles";
import type { PullRequestChipStatus } from "@/lib/pr-diff-attachment";
import { MESSAGE_BUBBLE_CHIP_CLASS } from "@/lib/composer-inline-chip-styles";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import {
  resolveWorkspaceFileChipPresentation,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "@/lib/workspace-file-chip-styles";
import { SKILL_CHIP_CLASS } from "@/lib/skill-chip-styles";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import {
  WORKSPACE_FILE_ICON_CHIP_CLASS,
  WORKSPACE_FILE_ICON_CHIP_SIZE_PX,
} from "@/lib/workspace-file-icon-sizes";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types";
import { NavigableChipLabel } from "@/contexts/composer-chip-navigate-context";

function sourceTabIdFields(
  meta: ComposerChipNavigateMeta | undefined,
): { sourceTabId: string } | Record<string, never> {
  const sourceTabId = meta?.sourceTabId?.trim();
  return sourceTabId ? { sourceTabId } : {};
}

function ElementCard({
  tagName,
  url,
  navigateMeta,
}: {
  tagName: string;
  url: string;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  return (
    <span title={url} className={MESSAGE_BUBBLE_CHIP_CLASS}>
      <PenTool
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, BROWSER_ELEMENT_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "element",
          pageUrl: url,
          ...sourceTabIdFields(navigateMeta),
        }}
      >{`<${tagName}>`}</NavigableChipLabel>
    </span>
  );
}

function WorkspaceFileCard({
  path,
  navigateMeta,
}: {
  path: string;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  const normalized = path.replace(/\\/gu, "/");
  const presentation = resolveWorkspaceFileChipPresentation(normalized);
  return (
    <span title={normalized} className={MESSAGE_BUBBLE_CHIP_CLASS}>
      <WorkspaceFileIcon
        path={presentation.iconPath}
        kind={presentation.iconKind}
        size={WORKSPACE_FILE_ICON_CHIP_SIZE_PX}
        colorMode="inherit"
        className={cn("shrink-0", presentation.iconClass)}
      />
      <NavigableChipLabel
        target={{
          kind: "workspaceFile",
          path: normalized,
          ...sourceTabIdFields(navigateMeta),
        }}
      >
        {workspaceFileBasename(normalized)}
      </NavigableChipLabel>
    </span>
  );
}

function SessionReferenceCard({ path, title }: { path: string; title: string }) {
  const label = title.trim() || path;
  return (
    <span title={path} className={MESSAGE_BUBBLE_CHIP_CLASS} aria-label={label}>
      <MessageCircle
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, WORKSPACE_FILE_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel target={{ kind: "sessionReference", transcriptPath: path }}>
        {label}
      </NavigableChipLabel>
    </span>
  );
}

function SkillCard({ alias }: { alias: string }) {
  return (
    <span title={alias} className={SKILL_CHIP_CLASS} aria-label={alias}>
      <NavigableChipLabel target={{ kind: "skill", alias }}>{alias}</NavigableChipLabel>
    </span>
  );
}

function prDiffStatusIcon(status: PullRequestChipStatus) {
  switch (status) {
    case "closed":
      return GitPullRequestClosed;
    case "draft":
      return GitPullRequestDraft;
    case "merged":
      return GitMerge;
    case "open":
    default:
      return GitPullRequest;
  }
}

function PrDiffCard({
  part,
  navigateMeta,
}: {
  part: Extract<MessageContentPart, { kind: "prDiff" }>;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  const Icon = prDiffStatusIcon(part.status);
  return (
    <span
      title={formatPrDiffChipTitle({
        id: "",
        prUrl: part.prUrl,
        filename: part.filename,
        lineStart: part.lineStart,
        lineEnd: part.lineEnd,
        diffText: part.diffText,
        status: part.status,
      })}
      className={MESSAGE_BUBBLE_CHIP_CLASS}
    >
      <Icon
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, PR_DIFF_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "prDiff",
          prUrl: part.prUrl,
          ...sourceTabIdFields(navigateMeta),
        }}
      >
        {formatPrDiffChipLabel(part.filename, part.lineStart, part.lineEnd)}
      </NavigableChipLabel>
    </span>
  );
}

function TerminalCard({
  part,
  navigateMeta,
}: {
  part: Extract<MessageContentPart, { kind: "terminalSnippet" }>;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  return (
    <span
      title={formatTerminalChipTitle({
        id: "",
        terminalName: part.terminalName,
        lineStart: part.lineStart,
        lineEnd: part.lineEnd,
        selectedText: part.selectedText,
      })}
      className={MESSAGE_BUBBLE_CHIP_CLASS}
    >
      <Terminal
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, TERMINAL_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "terminalSnippet",
          ...sourceTabIdFields(navigateMeta),
        }}
      >
        {formatTerminalChipLabel(part.terminalName, part.lineStart, part.lineEnd)}
      </NavigableChipLabel>
    </span>
  );
}

function FileSnippetCard({
  part,
  navigateMeta,
}: {
  part: Extract<MessageContentPart, { kind: "fileSnippet" }>;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  return (
    <span
      title={formatFileSnippetChipTitle({
        id: "",
        filePath: part.filePath,
        lineStart: part.lineStart,
        lineEnd: part.lineEnd,
        selectedText: part.selectedText,
      })}
      className={MESSAGE_BUBBLE_CHIP_CLASS}
    >
      <FileText
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, FILE_SNIPPET_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "fileSnippet",
          filePath: part.filePath,
          lineStart: part.lineStart,
          lineEnd: part.lineEnd,
          ...sourceTabIdFields(navigateMeta),
        }}
      >
        {formatFileSnippetChipLabel(part.filePath, part.lineStart, part.lineEnd)}
      </NavigableChipLabel>
    </span>
  );
}

function MessageQuoteCard({
  part,
  navigateMeta,
}: {
  part: Extract<MessageContentPart, { kind: "messageQuote" }>;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  return (
    <span
      title={formatMessageQuoteChipTitle({ selectedText: part.selectedText })}
      className={MESSAGE_BUBBLE_CHIP_CLASS}
    >
      <MessageCircleMore
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, MESSAGE_QUOTE_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "messageQuote",
          quoteSessionPath: navigateMeta?.quoteSessionPath,
          quoteMessageId: navigateMeta?.quoteMessageId,
          quoteOrigin: navigateMeta?.quoteOrigin,
        }}
      >
        {formatMessageQuoteChipLabel(part.selectedText)}
      </NavigableChipLabel>
    </span>
  );
}

function GitCommitCard({
  part,
  navigateMeta,
}: {
  part: Extract<MessageContentPart, { kind: "gitCommit" }>;
  navigateMeta?: ComposerChipNavigateMeta;
}) {
  return (
    <span
      title={formatGitCommitChipTitle({
        id: "",
        oid: part.oid,
        subject: part.subject,
        author: part.author,
        authoredAt: part.authoredAt,
        fullMessage: part.fullMessage,
      })}
      className={MESSAGE_BUBBLE_CHIP_CLASS}
    >
      <GitCommit
        className={cn(WORKSPACE_FILE_ICON_CHIP_CLASS, GIT_COMMIT_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      <NavigableChipLabel
        target={{
          kind: "gitCommit",
          ...sourceTabIdFields(navigateMeta),
        }}
      >
        {formatGitCommitChipLabel(part.subject)}
      </NavigableChipLabel>
    </span>
  );
}

function isInlineChipPart(part: MessageContentPart | null | undefined): part is Extract<
  MessageContentPart,
  {
    kind:
      | "element"
      | "workspaceFile"
      | "sessionReference"
      | "prDiff"
      | "gitCommit"
      | "terminalSnippet"
      | "fileSnippet"
      | "messageQuote"
      | "skill";
  }
> {
  return (
    part?.kind === "element" ||
    part?.kind === "workspaceFile" ||
    part?.kind === "sessionReference" ||
    part?.kind === "skill" ||
    part?.kind === "prDiff" ||
    part?.kind === "gitCommit" ||
    part?.kind === "terminalSnippet" ||
    part?.kind === "fileSnippet" ||
    part?.kind === "messageQuote"
  );
}

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;
type SaveLocalImageAs = (filePath: string) => Promise<boolean>;

type UserMessageBubbleProps = {
  message: ConversationMessageSnapshot;
  userBubbleClassName: string;
  canStartRewind: boolean;
  queued?: boolean;
  onRewindStart(): void;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs?: SaveLocalImageAs;
};

export function UserMessageBubble({
  message,
  userBubbleClassName,
  canStartRewind,
  queued = false,
  onRewindStart,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: UserMessageBubbleProps) {
  const { t } = useTranslation();
  const contentParts = useMemo(() => parseMessageContentParts(message.content), [message.content]);
  const alignedMeta = useMemo(
    () => alignChipNavigateMetaToParts(contentParts, message.chipNavigateMeta),
    [contentParts, message.chipNavigateMeta],
  );
  const partsWithMeta = useMemo(() => {
    let chipIndex = 0;
    return contentParts.map((part) => ({
      part,
      meta: isNavigableComposerChipKind(part.kind) ? alignedMeta?.[chipIndex++] : undefined,
    }));
  }, [alignedMeta, contentParts]);
  // `@` workspace-file references render as inline chips; their attachment snapshots are
  // attributed by matching the chip-recorded path and excluded from the upload card strip.
  const referencedFilePathKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const part of contentParts) {
      if (part.kind === "workspaceFile") {
        keys.add(normalizeSlashPath(part.path));
      }
    }
    return keys;
  }, [contentParts]);
  const uploadAttachmentSnapshots = useMemo(
    () =>
      uploadOnlyLocalFileAttachmentSnapshots(message.localFileAttachments, referencedFilePathKeys),
    [message.localFileAttachments, referencedFilePathKeys],
  );
  const attachmentSnapshotKey = localFileAttachmentsSnapshotKey(uploadAttachmentSnapshots);
  const initialViews = useMemo(
    () => snapshotsToComposerAttachmentViews(uploadAttachmentSnapshots),
    [attachmentSnapshotKey],
  );
  const [attachmentViews, setAttachmentViews] =
    useState<ComposerLocalFileAttachmentView[]>(initialViews);

  useEffect(() => {
    setAttachmentViews((previous) => mergeComposerAttachmentViews(previous, initialViews));
  }, [message.id, attachmentSnapshotKey, initialViews]);

  useLocalFileAttachmentPreviews(attachmentViews, setAttachmentViews, readLocalImagePreviewDataUrl);
  const visibleText = contentParts
    .filter((p) => p.kind === "text")
    .map((p) => p.value)
    .join("");
  const showText =
    (visibleText.trim().length > 0 ||
      contentParts.some(
        (p) =>
          p.kind === "element" ||
          p.kind === "workspaceFile" ||
          p.kind === "sessionReference" ||
          p.kind === "skill" ||
          p.kind === "prDiff" ||
          p.kind === "gitCommit" ||
          p.kind === "terminalSnippet" ||
          p.kind === "fileSnippet" ||
          p.kind === "messageQuote",
      )) &&
    !isAttachmentOnlyDisplayText(message.content, uploadAttachmentSnapshots);
  const hasAttachments = attachmentViews.length > 0;
  const showEmptyPlaceholder = !showText;

  if (!showText && !hasAttachments) {
    return null;
  }

  const bubbleClassName = cn(
    userBubbleClassName,
    queued && "opacity-60",
    canStartRewind &&
      "cursor-pointer transition-colors hover:bg-canvas-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
  );

  const handleRewindKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRewindStart();
    }
  };

  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {hasAttachments ? (
        <div
          className={cn(
            "w-full",
            !showText && queued && "opacity-60",
            !showText &&
              canStartRewind &&
              "cursor-pointer transition-colors hover:bg-canvas-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          )}
          role={!showText && canStartRewind ? "button" : undefined}
          tabIndex={!showText && canStartRewind ? 0 : undefined}
          onClick={!showText && canStartRewind ? onRewindStart : undefined}
          onKeyDown={!showText && canStartRewind ? handleRewindKeyDown : undefined}
        >
          <ComposerLocalFileStrip
            readOnly
            attachments={attachmentViews}
            className="flex flex-wrap justify-end gap-1.5"
            saveLocalImageAs={saveLocalImageAs}
          />
        </div>
      ) : null}
      {showEmptyPlaceholder ? (
        <div
          data-spirit-surface="message-bubble"
          className={cn(bubbleClassName, "max-w-full min-w-0")}
          role={canStartRewind ? "button" : undefined}
          tabIndex={canStartRewind ? 0 : undefined}
          onClick={canStartRewind ? onRewindStart : undefined}
          onKeyDown={canStartRewind ? handleRewindKeyDown : undefined}
        >
          <pre className="m-0 max-w-full min-w-0 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {t("app.emptyMessage")}
          </pre>
        </div>
      ) : null}
      {showText ? (
        <div
          data-spirit-surface="message-bubble"
          className={cn(bubbleClassName, "max-w-full min-w-0")}
          role={canStartRewind ? "button" : undefined}
          tabIndex={canStartRewind ? 0 : undefined}
          onClick={canStartRewind ? onRewindStart : undefined}
          onKeyDown={canStartRewind ? handleRewindKeyDown : undefined}
        >
          <pre className="m-0 max-w-full min-w-0 whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
            {partsWithMeta.map(({ part, meta }, i) => {
              if (part.kind === "element") {
                return (
                  <ElementCard key={i} tagName={part.tagName} url={part.url} navigateMeta={meta} />
                );
              }
              if (part.kind === "workspaceFile") {
                return <WorkspaceFileCard key={i} path={part.path} navigateMeta={meta} />;
              }
              if (part.kind === "sessionReference") {
                return <SessionReferenceCard key={i} path={part.path} title={part.title} />;
              }
              if (part.kind === "skill") {
                return <SkillCard key={i} alias={part.alias} />;
              }
              if (part.kind === "prDiff") {
                return <PrDiffCard key={i} part={part} navigateMeta={meta} />;
              }
              if (part.kind === "gitCommit") {
                return <GitCommitCard key={i} part={part} navigateMeta={meta} />;
              }
              if (part.kind === "terminalSnippet") {
                return <TerminalCard key={i} part={part} navigateMeta={meta} />;
              }
              if (part.kind === "fileSnippet") {
                return <FileSnippetCard key={i} part={part} navigateMeta={meta} />;
              }
              if (part.kind === "messageQuote") {
                return <MessageQuoteCard key={i} part={part} navigateMeta={meta} />;
              }
              const prev = i > 0 ? contentParts[i - 1] : null;
              const next = i < contentParts.length - 1 ? contentParts[i + 1] : null;
              const display = trimMessageTextAroundElements(part.value, {
                afterElement: isInlineChipPart(prev),
                beforeElement: isInlineChipPart(next),
              });
              return display;
            })}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
