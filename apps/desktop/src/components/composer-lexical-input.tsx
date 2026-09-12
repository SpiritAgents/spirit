import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
  useMemo,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";
import {
  INSERT_ATTACHMENT_CHIP_COMMAND,
  INSERT_PLAIN_TEXT_COMMAND,
  INSERT_SKILL_CHIP_COMMAND,
  INSERT_WORKSPACE_FILE_AT_CARET_COMMAND,
  INSERT_WORKSPACE_FILE_REFERENCE_COMMAND,
  INSERT_SESSION_REFERENCE_COMMAND,
  REMOVE_SKILL_SLASH_COMMAND,
  REPLACE_SKILL_SLASH_COMMAND,
} from "@/lib/composer-lexical/commands";
import { ComposerCommandsPlugin } from "@/lib/composer-lexical/plugins/composer-commands-plugin";
import { ComposerClipboardPlugin } from "@/lib/composer-lexical/plugins/composer-clipboard-plugin";
import { ComposerEditCommandPlugin } from "@/lib/composer-lexical/plugins/composer-edit-command-plugin";
import { ComposerNoInlineFormatPlugin } from "@/lib/composer-lexical/plugins/composer-no-inline-format-plugin";
import { SlashSelectionPlugin } from "@/lib/composer-lexical/plugins/slash-selection-plugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { KEY_DOWN_COMMAND, COMMAND_PRIORITY_HIGH, type LexicalEditor } from "lexical";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import {
  caretAtEnd,
  caretToPlainTextOffset,
  type ActiveSkillSlashQuery,
  type ActiveWorkspaceFileReferenceQuery,
} from "@/lib/composer-segment-model";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import {
  applyAgentModeChipPolicy,
  buildSegmentsAfterSend,
  composerShowsAgentModeChipPlaceholder,
  composerShowsPlaceholder,
  shouldPinAgentModeChip,
  type AgentModeChipPolicy,
} from "@/lib/composer-agent-mode-policy";
import type { AgentModeChipKind } from "@/lib/composer-agent-mode-segments";
import {
  emptySegments,
  caretAfterAgentModeChip,
  currentAgentModeSegment,
  ensureLoopPinned,
  hasAgentModeSegment,
  hasLoopSegment,
  insertAgentModeSegment,
  insertLoopSegment,
  isAgentModeChipKind,
  isCaretAtAgentModeRemovalPoint,
  isCaretAtInlineChipRemovalPoint,
  isCaretAtLoopRemovalPoint,
  isCaretOnStructuralChipLeadingSpacer,
  isStructuralChipInsertedSpacerOnly,
  mergeAdjacentTextSegments,
  normalizeCaretForComposer,
  removeInlineChipAtRemovalPoint,
  structuralChipKindBeforeCaret,
  trimStructuralChipLeadingSpacerAtCaret,
  removeAgentModeSegment,
  removeLoopSegment,
  segmentsEqual,
  segmentsToAttachments,
  type RichSegment,
  type SegmentCaret,
} from "@/lib/composer-segments";
import { COMPOSER_LEXICAL_NODES } from "@/lib/composer-lexical/composer-lexical-config";
import { ComposerChipLabelsProvider } from "@/lib/composer-lexical/chip-labels-context";
import {
  editorStateToRichSegments,
  richSegmentsToEditorState,
} from "@/lib/composer-lexical/bridge";
import {
  focusComposerAtEnd,
  lexicalSelectionToSegmentCaret,
  segmentCaretToLexicalSelection,
} from "@/lib/composer-lexical/caret";
import { ComposerOnChangePlugin } from "@/lib/composer-lexical/plugins/composer-on-change-plugin";
import { ComposerSegmentsHydratePlugin } from "@/lib/composer-lexical/plugins/composer-segments-hydrate-plugin";
import { AgentModeChipPlugin } from "@/lib/composer-lexical/plugins/agent-mode-chip-plugin";
import { LoopChipPlugin } from "@/lib/composer-lexical/plugins/loop-chip-plugin";
import { normalizeComposerSegmentsPolicy } from "@/lib/composer-lexical/composer-lexical-policy";
import { cn } from "@/lib/utils";
import { viewportLengthToScaleRootLocal } from "@/lib/ui-layout-scale";

export type { ActiveWorkspaceFileReferenceQuery } from "@/lib/composer-segment-model";
export type { RichSegment } from "@/lib/composer-segment-model";
export {
  segmentsToAttachments,
  segmentsToMessageText,
  segmentsToPlainText,
} from "@/lib/composer-segment-model";

const COMPOSER_PLACEHOLDER_CLASS =
  "pointer-events-none absolute top-2.5 text-sm leading-relaxed text-muted-foreground select-none";

const AGENT_MODE_CHIP_SELECTOR =
  "[data-chip-kind='plan'],[data-chip-kind='ask'],[data-chip-kind='debug']";

/** Absolute `left` inside Shell: getBoundingClientRect differences are in viewport units and must be converted to local px at the zoom root. */
function shellLocalLeftFromViewportDelta(delta: number): number {
  return viewportLengthToScaleRootLocal(delta);
}

function isLexicalChipDomNode(node: Node): boolean {
  return node instanceof HTMLElement && node.querySelector(AGENT_MODE_CHIP_SELECTOR) !== null;
}

function skipTextSegmentDomInParagraph(
  paragraph: HTMLElement,
  startChildIdx: number,
  segText: string,
): number {
  let plain = 0;
  const children = paragraph.childNodes;
  for (let index = startChildIdx; index < children.length; index += 1) {
    const node = children[index];
    if (node instanceof HTMLElement && isLexicalChipDomNode(node)) {
      return index;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      plain += node.textContent?.length ?? 0;
    }
    if (plain >= segText.length) {
      return index + 1;
    }
  }
  return children.length;
}

function placeReadOnlyRangeInTextSegment(
  paragraph: HTMLElement,
  startChildIdx: number,
  segText: string,
  targetOffset: number,
  range: Range,
): boolean {
  let plain = 0;
  const target = Math.max(0, Math.min(targetOffset, segText.length));
  const children = paragraph.childNodes;

  for (let index = startChildIdx; index < children.length; index += 1) {
    const node = children[index];
    if (node instanceof HTMLElement && isLexicalChipDomNode(node)) {
      break;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      const segmentRemaining = segText.length - plain;
      const effectiveLen = Math.min(len, segmentRemaining);
      if (target <= plain + effectiveLen) {
        range.setStart(node, target - plain);
        range.collapse(true);
        return true;
      }
      plain += len;
    }
  }
  return false;
}

function measureReadOnlyDomCaretLeft(
  editorEl: HTMLElement,
  segments: RichSegment[],
  caret: SegmentCaret,
  shellRect: DOMRect,
  chipRightInShell: number,
): number | null {
  const paragraph = editorEl.querySelector(":scope > p");
  if (!(paragraph instanceof HTMLElement)) {
    return null;
  }

  const range = document.createRange();
  const index = Math.min(Math.max(caret.segmentIndex, 0), Math.max(segments.length - 1, 0));
  let childIdx = 0;
  let segIdx = 0;
  let placed = false;

  while (segIdx < segments.length && childIdx < paragraph.childNodes.length) {
    const seg = segments[segIdx];
    const node = paragraph.childNodes[childIdx];
    if (!seg || !node) {
      break;
    }

    if (seg.kind === "text") {
      if (segIdx === index) {
        placed = placeReadOnlyRangeInTextSegment(
          paragraph,
          childIdx,
          seg.value,
          caret.offset,
          range,
        );
        break;
      }
      childIdx = skipTextSegmentDomInParagraph(paragraph, childIdx, seg.value);
      segIdx += 1;
      continue;
    }

    if (segIdx === index && caret.offset === 0) {
      range.setStartAfter(node);
      range.collapse(true);
      placed = true;
      break;
    }

    childIdx += 1;
    segIdx += 1;
  }

  if (!placed) {
    return null;
  }

  const left = range.getBoundingClientRect().left - shellRect.left;
  return left >= chipRightInShell - 1 ? shellLocalLeftFromViewportDelta(left) : null;
}

function measureAgentModeChipPlaceholderLeft(
  shell: HTMLElement,
  editorEl: HTMLElement,
  segments: RichSegment[],
): {
  left: number | null;
  source: "no-chip" | "selection" | "dom-caret" | "chip-right-fallback" | "default-padding";
  chipWidth: number | null;
  selectionLeftInShell: number | null;
  chipRightInShell: number | null;
  publishable: boolean;
} {
  const chip = editorEl.querySelector(AGENT_MODE_CHIP_SELECTOR);
  if (!(chip instanceof HTMLElement)) {
    return {
      left: null,
      source: "no-chip",
      chipWidth: null,
      selectionLeftInShell: null,
      chipRightInShell: null,
      publishable: false,
    };
  }

  const shellRect = shell.getBoundingClientRect();
  const editorRect = editorEl.getBoundingClientRect();
  const editorPaddingLeft = parseFloat(getComputedStyle(editorEl).paddingLeft) || 0;
  const defaultPlaceholderLeft =
    editorPaddingLeft + shellLocalLeftFromViewportDelta(editorRect.left - shellRect.left);
  const chipRect = chip.getBoundingClientRect();
  const chipRightInShell = chipRect.right - shellRect.left;
  const chipWidth = chipRect.width;

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && editorEl.contains(selection.anchorNode)) {
    const selectionLeftInShell =
      selection.getRangeAt(0).cloneRange().getBoundingClientRect().left - shellRect.left;
    if (selectionLeftInShell >= chipRightInShell - 1) {
      return {
        left: shellLocalLeftFromViewportDelta(selectionLeftInShell),
        source: "selection",
        chipWidth,
        selectionLeftInShell,
        chipRightInShell,
        publishable: true,
      };
    }
  }

  const caret = caretAfterAgentModeChip(segments);
  const domCaretLeft = measureReadOnlyDomCaretLeft(
    editorEl,
    segments,
    caret,
    shellRect,
    chipRightInShell,
  );
  if (domCaretLeft !== null) {
    return {
      left: domCaretLeft,
      source: "dom-caret",
      chipWidth,
      selectionLeftInShell: domCaretLeft,
      chipRightInShell,
      publishable: true,
    };
  }

  if (chipWidth > 0) {
    return {
      left: shellLocalLeftFromViewportDelta(chipRightInShell),
      source: "chip-right-fallback",
      chipWidth,
      selectionLeftInShell: null,
      chipRightInShell,
      publishable: false,
    };
  }

  return {
    left: defaultPlaceholderLeft,
    source: "default-padding",
    chipWidth,
    selectionLeftInShell: null,
    chipRightInShell,
    publishable: false,
  };
}

type Props = {
  /** Controlled rich segments; parent is source of truth. */
  segments: readonly RichSegment[];
  onSegmentsChange(segments: RichSegment[]): void;
  elementAttachments?: readonly BrowserElementAttachment[];
  placeholder?: string;
  agentModeChipPlaceholder?: string;
  readOnly?: boolean;
  className?: string;
  loopEnabled?: boolean;
  loopChipLabel?: string;
  agentMode?: DesktopAgentMode;
  planChipLabel?: string;
  askChipLabel?: string;
  onElementAttachmentsChange(attachments: BrowserElementAttachment[]): void;
  /** Rich segments committed locally; plain text / cursor may be unchanged. */
  onSegmentsCommit?(): void;
  onLoopEnabledChange?(enabled: boolean): void;
  onAgentModeChange?(mode: DesktopAgentMode): void;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  onPaste?(e: ClipboardEvent<HTMLDivElement>): void;
  /** UTF-16 offset in plain composer text (`segmentsToPlainText`), for @-file suggestions. */
  onSelectionChange?(selectionStart: number | null): void;
  /** Session-level: after the user Backspace-removes the Plan/Ask chip, poll must not re-pin it via the DOM. */
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
};

export type InsertLoopChipOptions = {
  /** Drop existing composer text; use after /loop or post-send reset. */
  clearText?: boolean;
};

export type InsertAgentModeChipOptions = InsertLoopChipOptions;

export type InsertSkillChipOptions = {
  /** Drop existing composer text; use when prefilling from settings or similar. */
  clearText?: boolean;
  /** Append a trailing space after the chip for natural-language follow-up. */
  appendTrailingSpace?: boolean;
};

export type ComposerRichInputHandle = {
  focus(): void;
  focusAtEnd(): void;
  insertAttachment(a: BrowserElementAttachment): void;
  insertPrDiffAttachment(attachment: PrDiffAttachment): void;
  insertGitCommitAttachment(attachment: GitCommitAttachment): void;
  insertTerminalSnippet(attachment: TerminalSnippetAttachment): void;
  insertFileSnippet(attachment: FileSnippetAttachment): void;
  insertMessageQuote(attachment: MessageQuoteAttachment): void;
  insertWorkspaceFileReference(
    path: string,
    query: ActiveWorkspaceFileReferenceQuery,
    finalize?: boolean,
  ): void;
  insertSessionReference(
    session: { path: string; title: string; content?: string },
    query: ActiveWorkspaceFileReferenceQuery,
    finalize?: boolean,
  ): void;
  insertWorkspaceFileAtCaret(path: string, sourceTabId?: string): void;
  insertLoopChip(options?: InsertLoopChipOptions): void;
  removeLoopChip(): void;
  insertPlanChip(options?: InsertAgentModeChipOptions): void;
  insertAskChip(options?: InsertAgentModeChipOptions): void;
  insertDebugChip(options?: InsertAgentModeChipOptions): void;
  removeAgentModeChip(): void;
  insertSkillChip(alias: string, options?: InsertSkillChipOptions): void;
  replaceSkillSlashQuery(
    query: ActiveSkillSlashQuery,
    replacement: string,
    finalize?: boolean,
  ): void;
  removeSkillSlashQuery(query: ActiveSkillSlashQuery): void;
  insertPlainTextAtCaret(text: string): void;
  /** Called by the host after a successful send: restores the chip (if still plan/ask) and places the cursor after the chip. */
  resetAfterSend(agentMode: DesktopAgentMode): void;
  getSegments(): RichSegment[];
  setSegments(segments: RichSegment[]): void;
  getPlainTextCaretClientRect(plainTextOffset: number): DOMRect | null;
};

type ComposerLexicalInputCoreProps = Props & {
  editorRef: React.RefObject<LexicalEditor | null>;
  skipEditorSyncRef: React.RefObject<boolean>;
  mountHydratedRef: React.RefObject<boolean>;
};

const ComposerLexicalInputCore = forwardRef<ComposerRichInputHandle, ComposerLexicalInputCoreProps>(
  function ComposerLexicalInputCore(props, ref) {
    const {
      segments: controlledSegments,
      onSegmentsChange,
      elementAttachments,
      placeholder,
      agentModeChipPlaceholder,
      readOnly,
      className,
      loopEnabled = false,
      loopChipLabel: _loopChipLabel = "Loop",
      agentMode = "agent",
      planChipLabel: _planChipLabel = "Plan",
      askChipLabel: _askChipLabel = "Ask",
      onElementAttachmentsChange,
      onSegmentsCommit,
      onLoopEnabledChange,
      onAgentModeChange,
      onKeyDown,
      onPaste,
      onSelectionChange,
      agentModeChipDismissed = false,
      onAgentModeChipDismissChange,
      editorRef,
      skipEditorSyncRef,
      mountHydratedRef,
    } = props;

    const [editor] = useLexicalComposerContext();
    const contentEditableRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const [segments, setSegments] = useState<RichSegment[]>(() => {
      const base = controlledSegments.length
        ? ensureLoopPinned(mergeAdjacentTextSegments([...controlledSegments]))
        : loopEnabled
          ? insertLoopSegment(emptySegments()).segments
          : emptySegments();
      return applyAgentModeChipPolicy(base, {
        hostMode: agentMode,
        dismissed: agentModeChipDismissed,
      });
    });
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const isComposingRef = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const [agentModeChipPlaceholderLeft, setAgentModeChipPlaceholderLeft] = useState<number | null>(
      null,
    );
    const pendingCaretRef = useRef<SegmentCaret | null>(null);
    const lastSyncedToParentSegmentsRef = useRef<RichSegment[] | null>([...controlledSegments]);
    const skipExternalSegmentsSyncRef = useRef(false);
    const onElementAttachmentsChangeRef = useRef(onElementAttachmentsChange);
    const onLoopEnabledChangeRef = useRef(onLoopEnabledChange);
    const onAgentModeChangeRef = useRef(onAgentModeChange);
    const onSegmentsCommitRef = useRef(onSegmentsCommit);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const loopEnabledRef = useRef(loopEnabled);
    const agentModeRef = useRef(agentMode);
    const hadLoopRef = useRef(hasLoopSegment(segments));
    const hadAgentModeRef = useRef(isAgentModeChipKind(agentMode));
    const agentModeChipDismissedRef = useRef(agentModeChipDismissed);
    const onAgentModeChipDismissChangeRef = useRef(onAgentModeChipDismissChange);

    useEffect(() => {
      agentModeChipDismissedRef.current = agentModeChipDismissed;
    }, [agentModeChipDismissed]);

    useEffect(() => {
      onAgentModeChipDismissChangeRef.current = onAgentModeChipDismissChange;
    }, [onAgentModeChipDismissChange]);

    useEffect(() => {
      loopEnabledRef.current = loopEnabled;
    }, [loopEnabled]);

    useEffect(() => {
      agentModeRef.current = agentMode;
    }, [agentMode]);

    useEffect(() => {
      onLoopEnabledChangeRef.current = onLoopEnabledChange;
    }, [onLoopEnabledChange]);

    useEffect(() => {
      onAgentModeChangeRef.current = onAgentModeChange;
    }, [onAgentModeChange]);

    useEffect(() => {
      onSegmentsCommitRef.current = onSegmentsCommit;
    }, [onSegmentsCommit]);

    useEffect(() => {
      editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    const syncLoopEnabledFromSegments = useCallback((next: RichSegment[]) => {
      const hasLoop = hasLoopSegment(next);
      if (hasLoop === hadLoopRef.current) {
        return;
      }
      if (!hasLoop && loopEnabledRef.current) {
        return;
      }
      hadLoopRef.current = hasLoop;
      onLoopEnabledChangeRef.current?.(hasLoop);
    }, []);

    const syncAgentModeFromSegments = useCallback((next: RichSegment[]) => {
      const mode = agentModeRef.current;
      const hasChip = hasAgentModeSegment(next);
      if (isAgentModeChipKind(mode)) {
        if (hasChip) {
          hadAgentModeRef.current = true;
          return;
        }
        hadAgentModeRef.current = false;
        onAgentModeChangeRef.current?.("agent");
        return;
      }
      if (!hasChip && hadAgentModeRef.current) {
        hadAgentModeRef.current = false;
        onAgentModeChangeRef.current?.("agent");
      }
    }, []);

    const chipPolicy = useCallback((): AgentModeChipPolicy => {
      return {
        hostMode: agentModeRef.current,
        dismissed: agentModeChipDismissedRef.current,
      };
    }, []);

    const applyComposerPolicy = useCallback(
      (next: RichSegment[]): RichSegment[] =>
        normalizeComposerSegmentsPolicy(next, {
          agentMode: agentModeRef.current,
          agentModeChipDismissed: agentModeChipDismissedRef.current,
        }),
      [],
    );

    const pushSegmentsToEditor = useCallback(
      (next: RichSegment[], caret: SegmentCaret | null) => {
        skipEditorSyncRef.current = true;
        richSegmentsToEditorState(next, editor);
        if (caret) {
          segmentCaretToLexicalSelection(editor, next, normalizeCaretForComposer(next, caret));
        }
        skipEditorSyncRef.current = false;
      },
      [editor, skipEditorSyncRef],
    );

    const reportSelectionChange = useCallback(() => {
      const report = onSelectionChangeRef.current;
      if (!report) {
        return;
      }
      const caret = lexicalSelectionToSegmentCaret(editor, segmentsRef.current);
      if (!caret) {
        report(null);
        return;
      }
      report(caretToPlainTextOffset(segmentsRef.current, caret));
    }, [editor]);

    useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);

    useEffect(() => {
      onElementAttachmentsChangeRef.current = onElementAttachmentsChange;
    });

    const notifyParents = useCallback(
      (next: RichSegment[]) => {
        lastSyncedToParentSegmentsRef.current = next;
        skipExternalSegmentsSyncRef.current = true;
        onSegmentsChange(next);
        onElementAttachmentsChange(segmentsToAttachments(next));
      },
      [onElementAttachmentsChange, onSegmentsChange],
    );

    const commitSegments = useCallback(
      (
        next: RichSegment[],
        caret?: SegmentCaret | null,
        options?: {
          notifyParent?: boolean;
          syncLoop?: boolean;
          syncAgentMode?: boolean;
          pushEditor?: boolean;
        },
      ) => {
        const merged = applyComposerPolicy(next);
        let resolvedCaret = caret ?? null;
        if (
          hasLoopSegment(merged) ||
          (shouldPinAgentModeChip(chipPolicy()) && hasAgentModeSegment(merged))
        ) {
          resolvedCaret = normalizeCaretForComposer(merged, resolvedCaret);
        }
        segmentsRef.current = merged;
        pendingCaretRef.current = resolvedCaret;
        setSegments(merged);
        onSegmentsCommitRef.current?.();
        if (options?.syncLoop !== false && !loopEnabledRef.current) {
          syncLoopEnabledFromSegments(merged);
        }
        if (options?.syncAgentMode !== false && !isAgentModeChipKind(agentModeRef.current)) {
          syncAgentModeFromSegments(merged);
        }
        if (options?.notifyParent !== false) {
          notifyParents(merged);
        }
        if (options?.pushEditor !== false) {
          pushSegmentsToEditor(merged, resolvedCaret);
          pendingCaretRef.current = null;
          reportSelectionChange();
        }
      },
      [
        applyComposerPolicy,
        chipPolicy,
        notifyParents,
        pushSegmentsToEditor,
        reportSelectionChange,
        syncAgentModeFromSegments,
        syncLoopEnabledFromSegments,
      ],
    );

    const handleSegmentsNormalized = useCallback(
      (next: RichSegment[]) => {
        commitSegments(next, lexicalSelectionToSegmentCaret(editor, segmentsRef.current), {
          pushEditor: false,
          syncLoop: false,
          syncAgentMode: false,
        });
      },
      [commitSegments, editor],
    );

    const getSegments = useCallback((): RichSegment[] => segmentsRef.current, []);

    const insertAttachment = useCallback(
      (a: BrowserElementAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "element",
          attachment: a,
        });
      },
      [editor],
    );

    const insertPrDiffAttachment = useCallback(
      (attachment: PrDiffAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "prDiff",
          attachment,
        });
      },
      [editor],
    );

    const insertGitCommitAttachment = useCallback(
      (attachment: GitCommitAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "gitCommit",
          attachment,
        });
      },
      [editor],
    );

    const insertTerminalSnippet = useCallback(
      (attachment: TerminalSnippetAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "terminalSnippet",
          attachment,
        });
      },
      [editor],
    );

    const insertFileSnippet = useCallback(
      (attachment: FileSnippetAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "fileSnippet",
          attachment,
        });
      },
      [editor],
    );

    const insertMessageQuote = useCallback(
      (attachment: MessageQuoteAttachment) => {
        editor.dispatchCommand(INSERT_ATTACHMENT_CHIP_COMMAND, {
          kind: "messageQuote",
          attachment,
        });
      },
      [editor],
    );

    const insertWorkspaceFileReference = useCallback(
      (path: string, query: ActiveWorkspaceFileReferenceQuery, finalize = true) => {
        editor.dispatchCommand(INSERT_WORKSPACE_FILE_REFERENCE_COMMAND, {
          path,
          query,
          finalize,
        });
      },
      [editor],
    );

    const insertSessionReference = useCallback(
      (
        session: { path: string; title: string; content?: string },
        query: ActiveWorkspaceFileReferenceQuery,
        finalize = true,
      ) => {
        editor.dispatchCommand(INSERT_SESSION_REFERENCE_COMMAND, {
          path: session.path,
          title: session.title,
          ...(session.content !== undefined ? { content: session.content } : {}),
          query,
          finalize,
        });
      },
      [editor],
    );

    const insertWorkspaceFileAtCaret = useCallback(
      (path: string, sourceTabId?: string) => {
        editor.dispatchCommand(INSERT_WORKSPACE_FILE_AT_CARET_COMMAND, { path, sourceTabId });
      },
      [editor],
    );

    const replaceSkillSlashQuery = useCallback(
      (query: ActiveSkillSlashQuery, replacement: string, finalize = false) => {
        editor.dispatchCommand(REPLACE_SKILL_SLASH_COMMAND, {
          query,
          replacement,
          finalize,
        });
      },
      [editor],
    );

    const removeSkillSlashQuery = useCallback(
      (query: ActiveSkillSlashQuery) => {
        editor.dispatchCommand(REMOVE_SKILL_SLASH_COMMAND, { query });
      },
      [editor],
    );

    const applySegments = useCallback(
      (next: RichSegment[], caret?: SegmentCaret | null, notifyParent = true) => {
        commitSegments(next, caret ?? caretAtEnd(mergeAdjacentTextSegments(next)), {
          notifyParent,
        });
      },
      [commitSegments],
    );

    const insertLoopChip = useCallback(
      (options?: InsertLoopChipOptions) => {
        editor.focus();
        const base = options?.clearText ? emptySegments() : segmentsRef.current;
        if (!options?.clearText && hasLoopSegment(base)) {
          return;
        }
        const { segments: next, caret } = insertLoopSegment(base);
        if (options?.clearText) {
          loopEnabledRef.current = true;
        }
        hadLoopRef.current = true;
        commitSegments(next, caret, { syncLoop: false });
      },
      [commitSegments, editor],
    );

    const removeLoopChip = useCallback(() => {
      if (!hasLoopSegment(segmentsRef.current)) {
        return;
      }
      const next = applyComposerPolicy(removeLoopSegment(segmentsRef.current));
      loopEnabledRef.current = false;
      hadLoopRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncLoop: false });
      onLoopEnabledChangeRef.current?.(false);
    }, [applyComposerPolicy, commitSegments]);

    const insertAgentModeChip = useCallback(
      (mode: AgentModeChipKind, options?: InsertAgentModeChipOptions) => {
        editor.focus();
        const base = options?.clearText ? emptySegments() : segmentsRef.current;
        agentModeChipDismissedRef.current = false;
        onAgentModeChipDismissChangeRef.current?.(false);
        const { segments: next, caret } = insertAgentModeSegment(base, mode);
        agentModeRef.current = mode;
        hadAgentModeRef.current = true;
        commitSegments(next, caret, { syncAgentMode: false });
      },
      [commitSegments, editor],
    );

    const insertPlanChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("plan", options),
      [insertAgentModeChip],
    );

    const insertAskChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("ask", options),
      [insertAgentModeChip],
    );

    const insertDebugChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("debug", options),
      [insertAgentModeChip],
    );

    const insertPlainTextAtCaret = useCallback(
      (text: string) => {
        editor.dispatchCommand(INSERT_PLAIN_TEXT_COMMAND, { text });
      },
      [editor],
    );

    const insertSkillChip = useCallback(
      (alias: string, options?: InsertSkillChipOptions) => {
        editor.dispatchCommand(INSERT_SKILL_CHIP_COMMAND, {
          alias,
          clearText: options?.clearText,
          appendTrailingSpace: options?.appendTrailingSpace,
        });
      },
      [editor],
    );

    const removeAgentModeChip = useCallback(() => {
      if (!hasAgentModeSegment(segmentsRef.current)) {
        return;
      }
      agentModeChipDismissedRef.current = true;
      onAgentModeChipDismissChangeRef.current?.(true);
      const next = applyAgentModeChipPolicy(removeAgentModeSegment(segmentsRef.current), {
        hostMode: agentModeRef.current,
        dismissed: true,
      });
      hadAgentModeRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncAgentMode: false });
      if (isAgentModeChipKind(agentModeRef.current)) {
        onAgentModeChangeRef.current?.("agent");
      }
    }, [commitSegments]);

    const resetAfterSend = useCallback(
      (mode: DesktopAgentMode) => {
        agentModeChipDismissedRef.current = false;
        onAgentModeChipDismissChangeRef.current?.(false);
        let next = buildSegmentsAfterSend(mode);
        if (loopEnabledRef.current) {
          next = insertLoopSegment(next).segments;
        }
        const caret = hasAgentModeSegment(next) ? caretAfterAgentModeChip(next) : caretAtEnd(next);
        skipExternalSegmentsSyncRef.current = true;
        commitSegments(next, caret, { syncLoop: false, syncAgentMode: false });
      },
      [commitSegments],
    );

    const focusAtEnd = useCallback(() => {
      focusComposerAtEnd(editor, segmentsRef.current);
      reportSelectionChange();
    }, [editor, reportSelectionChange]);

    const getPlainTextCaretClientRect = useCallback(
      (plainTextOffset: number): DOMRect | null => {
        const root = contentEditableRef.current;
        if (!root) {
          return null;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return null;
        }
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) {
          return null;
        }

        const caret = lexicalSelectionToSegmentCaret(editor, segmentsRef.current);
        if (!caret || caretToPlainTextOffset(segmentsRef.current, caret) !== plainTextOffset) {
          return null;
        }
        return range.cloneRange().getBoundingClientRect();
      },
      [editor],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor.focus(),
        focusAtEnd,
        insertAttachment,
        insertPrDiffAttachment,
        insertGitCommitAttachment,
        insertTerminalSnippet,
        insertFileSnippet,
        insertMessageQuote,
        insertWorkspaceFileReference,
        insertSessionReference,
        insertWorkspaceFileAtCaret,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        insertDebugChip,
        removeAgentModeChip,
        insertSkillChip,
        replaceSkillSlashQuery,
        removeSkillSlashQuery,
        insertPlainTextAtCaret,
        resetAfterSend,
        getSegments,
        setSegments: (next: RichSegment[]) => applySegments(next),
        getPlainTextCaretClientRect,
      }),
      [
        editor,
        insertAttachment,
        insertPrDiffAttachment,
        insertGitCommitAttachment,
        insertTerminalSnippet,
        insertFileSnippet,
        insertMessageQuote,
        insertWorkspaceFileReference,
        insertSessionReference,
        insertWorkspaceFileAtCaret,
        replaceSkillSlashQuery,
        removeSkillSlashQuery,
        insertPlainTextAtCaret,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        insertDebugChip,
        removeAgentModeChip,
        insertSkillChip,
        resetAfterSend,
        focusAtEnd,
        getSegments,
        getPlainTextCaretClientRect,
        applySegments,
      ],
    );

    useEffect(() => {
      if (skipExternalSegmentsSyncRef.current) {
        const expected = lastSyncedToParentSegmentsRef.current;
        if (expected !== null && segmentsEqual([...controlledSegments], expected)) {
          skipExternalSegmentsSyncRef.current = false;
          return;
        }
        skipExternalSegmentsSyncRef.current = false;
      }
      const merged = mergeAdjacentTextSegments([...controlledSegments]);
      if (segmentsEqual(merged, segmentsRef.current)) {
        return;
      }
      applySegments(merged, caretAtEnd(merged), false);
    }, [applySegments, controlledSegments]);

    const handleEditorChange = useCallback(
      (changedEditor: LexicalEditor) => {
        if (skipEditorSyncRef.current || isComposingRef.current) {
          return;
        }
        const raw = editorStateToRichSegments(changedEditor);
        const caret = lexicalSelectionToSegmentCaret(changedEditor, segmentsRef.current);
        const policyApplied = applyComposerPolicy(raw);
        const needsEditorPush = !segmentsEqual(policyApplied, raw);
        commitSegments(policyApplied, caret, { pushEditor: needsEditorPush });
      },
      [applyComposerPolicy, commitSegments, skipEditorSyncRef],
    );

    const restoreNormalizedCaret = useCallback(() => {
      const raw = lexicalSelectionToSegmentCaret(editor, segmentsRef.current);
      if (!raw) {
        return;
      }
      const caret = normalizeCaretForComposer(segmentsRef.current, raw);
      if (caret.segmentIndex === raw.segmentIndex && caret.offset === raw.offset) {
        return;
      }
      segmentCaretToLexicalSelection(editor, segmentsRef.current, caret);
      reportSelectionChange();
    }, [editor, reportSelectionChange]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
      },
      [onKeyDown],
    );

    useEffect(() => {
      return editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event: globalThis.KeyboardEvent) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.isComposing
          ) {
            return true;
          }
          if (event.key !== "Backspace") {
            return false;
          }
          const segs = segmentsRef.current;
          const rawCaret = lexicalSelectionToSegmentCaret(editor, segs);
          if (!rawCaret) {
            return false;
          }
          const caret = normalizeCaretForComposer(segs, rawCaret);

          if (isCaretAtLoopRemovalPoint(segs, caret)) {
            event.preventDefault();
            removeLoopChip();
            return true;
          }
          if (isCaretAtAgentModeRemovalPoint(segs, caret)) {
            event.preventDefault();
            removeAgentModeChip();
            return true;
          }
          if (isCaretOnStructuralChipLeadingSpacer(segs, caret)) {
            if (isStructuralChipInsertedSpacerOnly(segs, caret)) {
              const chipKind = structuralChipKindBeforeCaret(segs, caret);
              event.preventDefault();
              if (chipKind === "loop") {
                removeLoopChip();
              } else if (chipKind === "plan" || chipKind === "ask" || chipKind === "debug") {
                removeAgentModeChip();
              }
              return true;
            }
            const trimmed = trimStructuralChipLeadingSpacerAtCaret(segs, caret);
            if (trimmed) {
              event.preventDefault();
              commitSegments(trimmed.segments, trimmed.caret);
              return true;
            }
          }
          if (isCaretAtInlineChipRemovalPoint(segs, caret)) {
            const removed = removeInlineChipAtRemovalPoint(segs, caret);
            if (removed) {
              event.preventDefault();
              commitSegments(removed.segments, removed.caret);
              return true;
            }
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      );
    }, [commitSegments, editor, removeAgentModeChip, removeLoopChip]);

    const handleKeyUp = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          restoreNormalizedCaret();
        }
      },
      [restoreNormalizedCaret],
    );

    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true;
      setIsComposing(true);
    }, []);

    const handleCompositionEnd = useCallback(() => {
      isComposingRef.current = false;
      setIsComposing(false);
      handleEditorChange(editor);
    }, [editor, handleEditorChange]);

    const isEmpty = composerShowsPlaceholder(segments, {
      composing: isComposing,
      attachmentCount: elementAttachments?.length ?? 0,
    });

    const showAgentModeChipPlaceholder =
      composerShowsAgentModeChipPlaceholder(segments, {
        composing: isComposing,
        attachmentCount: elementAttachments?.length ?? 0,
      }) && Boolean(agentModeChipPlaceholder);

    const chipPlaceholderLeftCacheRef = useRef<number | null>(null);
    const chipPlaceholderCacheKindRef = useRef<AgentModeChipKind | null>(null);
    const pinnedAgentModeChipKind = currentAgentModeSegment(segments);

    const effectiveChipPlaceholderLeft = showAgentModeChipPlaceholder
      ? (agentModeChipPlaceholderLeft ??
        (pinnedAgentModeChipKind && chipPlaceholderCacheKindRef.current === pinnedAgentModeChipKind
          ? chipPlaceholderLeftCacheRef.current
          : null))
      : null;

    const showDefaultPlaceholder = isEmpty && Boolean(placeholder);

    useEffect(() => {
      if (!showAgentModeChipPlaceholder) {
        chipPlaceholderLeftCacheRef.current = null;
        chipPlaceholderCacheKindRef.current = null;
      }
    }, [showAgentModeChipPlaceholder]);

    useEffect(() => {
      if (
        showAgentModeChipPlaceholder &&
        pinnedAgentModeChipKind &&
        chipPlaceholderCacheKindRef.current !== pinnedAgentModeChipKind
      ) {
        setAgentModeChipPlaceholderLeft(null);
      }
    }, [pinnedAgentModeChipKind, showAgentModeChipPlaceholder]);

    useLayoutEffect(() => {
      if (!showAgentModeChipPlaceholder) {
        setAgentModeChipPlaceholderLeft(null);
        return;
      }

      const shell = shellRef.current;
      const editorEl = contentEditableRef.current;
      if (!shell || !editorEl) {
        setAgentModeChipPlaceholderLeft(null);
        return;
      }

      const measure = () => {
        const measured = measureAgentModeChipPlaceholderLeft(shell, editorEl, segmentsRef.current);
        const nextLeft = measured.left;
        if (nextLeft === null || !measured.publishable) {
          return;
        }
        const chipKind = currentAgentModeSegment(segmentsRef.current);
        chipPlaceholderLeftCacheRef.current = nextLeft;
        chipPlaceholderCacheKindRef.current = chipKind ?? null;
        setAgentModeChipPlaceholderLeft(nextLeft);
      };

      measure();
      const unregisterUpdateListener = editor.registerUpdateListener(() => {
        measure();
      });
      const observer = new ResizeObserver(measure);
      observer.observe(editorEl);
      observer.observe(shell);
      window.addEventListener("resize", measure);
      return () => {
        unregisterUpdateListener();
        observer.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, [editor, showAgentModeChipPlaceholder, segments]);

    return (
      <div ref={shellRef} className="relative">
        {showDefaultPlaceholder ? (
          <span aria-hidden className={cn(COMPOSER_PLACEHOLDER_CLASS, "left-3")}>
            {placeholder}
          </span>
        ) : null}
        {showAgentModeChipPlaceholder &&
        agentModeChipPlaceholder &&
        effectiveChipPlaceholderLeft !== null ? (
          <span
            aria-hidden
            className={COMPOSER_PLACEHOLDER_CLASS}
            style={{ left: effectiveChipPlaceholderLeft }}
          >
            {agentModeChipPlaceholder}
          </span>
        ) : null}
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              ref={contentEditableRef}
              aria-multiline="true"
              aria-label={placeholder}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              className={cn(
                "spirit-scroll block max-h-[12rem] min-h-[3rem] w-full overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-sm leading-relaxed outline-none md:min-h-[3.5rem]",
                "whitespace-pre-wrap break-words",
                className,
              )}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ComposerEditCommandPlugin />
        <ComposerNoInlineFormatPlugin />
        <ComposerOnChangePlugin
          skipEditorSyncRef={skipEditorSyncRef}
          onEditorChange={handleEditorChange}
        />
        <ComposerSegmentsHydratePlugin
          editorRef={editorRef}
          segmentsRef={segmentsRef}
          skipEditorSyncRef={skipEditorSyncRef}
          mountHydratedRef={mountHydratedRef}
        />
        <AgentModeChipPlugin
          agentMode={agentMode}
          agentModeChipDismissed={agentModeChipDismissed}
          segmentsRef={segmentsRef}
          skipEditorSyncRef={skipEditorSyncRef}
          onSegmentsNormalized={handleSegmentsNormalized}
          onAgentModeChipDismissChange={onAgentModeChipDismissChange}
          onAgentModeChange={onAgentModeChange}
        />
        <LoopChipPlugin
          loopEnabled={loopEnabled}
          agentMode={agentMode}
          agentModeChipDismissed={agentModeChipDismissed}
          skipEditorSyncRef={skipEditorSyncRef}
          onSegmentsNormalized={handleSegmentsNormalized}
          onLoopEnabledChange={onLoopEnabledChange}
        />
        <ComposerCommandsPlugin segmentsRef={segmentsRef} commitSegments={commitSegments} />
        <ComposerClipboardPlugin
          segmentsRef={segmentsRef}
          commitSegments={commitSegments}
          onPaste={onPaste}
        />
        <SlashSelectionPlugin
          contentEditableRef={contentEditableRef}
          reportSelectionChange={reportSelectionChange}
          enabled={Boolean(onSelectionChange)}
        />
      </div>
    );
  },
);

export const ComposerLexicalInput = forwardRef<ComposerRichInputHandle, Props>(
  function ComposerLexicalInput(props, ref) {
    const {
      readOnly,
      loopChipLabel = "Loop",
      planChipLabel = "Plan",
      askChipLabel = "Ask",
    } = props;

    const editorRef = useRef<LexicalEditor | null>(null);
    const skipEditorSyncRef = useRef(false);
    const mountHydratedRef = useRef(false);

    const initialConfig = useMemo(
      () => ({
        namespace: "spirit-composer",
        nodes: [...COMPOSER_LEXICAL_NODES],
        editable: !readOnly,
        onError(error: Error) {
          throw error;
        },
      }),
      [readOnly],
    );

    return (
      <ComposerChipLabelsProvider
        labels={{
          planLabel: planChipLabel,
          askLabel: askChipLabel,
          loopLabel: loopChipLabel,
        }}
      >
        <LexicalComposer initialConfig={initialConfig}>
          <ComposerLexicalInputCore
            ref={ref}
            {...props}
            editorRef={editorRef}
            skipEditorSyncRef={skipEditorSyncRef}
            mountHydratedRef={mountHydratedRef}
          />
        </LexicalComposer>
      </ComposerChipLabelsProvider>
    );
  },
);
