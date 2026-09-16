import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { TFunction } from "i18next";

import { codeUnitIndexToCharCount } from "@spiritagent/host-internal/workspace-file-reference-query";

import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { segmentsToMessageText, segmentsToPlainText } from "@/components/composer-rich-input";
import {
  extractComposerChipMetadata,
  hasInlineAttachmentChipSegments,
  normalizeComposerPlain,
} from "@/lib/composer-segment-model";
import { extractChipNavigateMeta } from "@/lib/composer-chip-navigate-meta";
import { emptySegments, syncSegmentsFromExternalValue } from "@/lib/composer-segments";
import { buildPostSendComposerSegments } from "@/lib/composer-agent-mode-policy";
import { currentAgentModeSegment, isAgentModeChipKind } from "@/lib/composer-agent-mode-segments";
import { cycleAgentMode, type DesktopAgentMode } from "@/lib/agent-mode";
import { currentWorkspaceFileReferenceQueryFromSegments } from "@/lib/composer-file-reference-query";
import {
  atReferenceNeedle,
  buildAtReferenceMenuItems,
  sessionCandidatesFromListItems,
  type AtReferenceMenuItem,
  type AtReferenceMenuView,
} from "@/lib/composer-at-reference-demo";
import { resolveComposerDirectMediaTool } from "@/lib/composer-direct-media";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { MessageQuoteAttachment } from "@/lib/message-quote-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import { useWorkspaceFileIndex } from "@/hooks/use-workspace-file-index";
import type { useDesktopRuntime, QuestionDraft } from "@/hooks/useDesktopRuntime";
import {
  appendComposerLocalFileAttachment,
  composerAttachmentViewFromPath,
  normalizeSlashPath,
  removeComposerLocalFileAttachment,
} from "@/lib/local-file-attachments";
import {
  isAppearanceMenuAction,
  isLocaleOptionAction,
  isNewSessionAction,
  isThemeOptionAction,
  type ActionPaletteItem,
} from "@/lib/action-palette";
import {
  buildSkillSlashSuggestions,
  COMPACT_SLASH_ALIAS,
  currentSkillSlashQueryAtCursor,
  FORK_SLASH_ALIAS,
  isCompactSlashComposerSegments,
  skillSlashAlias,
  skillSlashQueryKey,
  type SkillSlashSuggestion,
} from "@/lib/skill-slash";
import { canBeginSideChat, canForkSession } from "@/lib/fork-eligibility";
import { findLastForkableAssistantMessageId } from "@/lib/fork-session-utils";
import { shouldPromptGitBranchCheckoutBeforeSend } from "@/lib/composer-branch-checkout-gate";
import {
  buildPaneComposerDraftKey,
  resolvePaneComposerDraft,
  writeComposerDraft,
} from "@/lib/composer-draft-store";
import {
  isComposerFileDropAccepted,
  resolveComposerDropAbsolutePaths,
  resolveComposerDropEffect,
} from "@/lib/composer-file-drop";
import { normalizePaneSessionPathKey } from "@/lib/pane-desktop-snapshot";
import { resolvePaneCanSend, resolvePaneComposerBusy } from "@/lib/pane-conversation-controls";
import type {
  DesktopSnapshot,
  SubmitUserTurnRequest,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";
import type { RichSegment } from "@/lib/composer-segment-model";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

/** Draft persistence debounce interval, matching the non-pane path (useDesktopRuntime). */
const PANE_COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 400;

export type UseComposerControllerOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  t: TFunction;
  isEmptySession: boolean;
  activeSessionReadOnly: boolean;
  compactionDemoActive: boolean;
  longConversationListDemoActive: boolean;
  subagentViewActive: boolean;
  pendingApproval: DesktopSnapshot["conversation"]["pendingToolApproval"];
  pendingQuestions: ReturnType<typeof useDesktopRuntime>["pendingQuestions"];
  conversationInterruptible: boolean;
  handleNewSession: () => void;
  setActiveSurface: (
    surface: "conversation" | "settings" | "marketplace" | "automations" | "automation-detail",
  ) => void;
  setLastNonSettingsSurface: (surface: "conversation" | "marketplace" | "automations") => void;
  /** When set, composer state is isolated per pane and sends target this session path. */
  paneSessionPath?: string;
  onBeginSideChat?: () => void;
};

export function useComposerController({
  runtime,
  snapshot,
  t,
  isEmptySession,
  activeSessionReadOnly,
  compactionDemoActive,
  longConversationListDemoActive,
  subagentViewActive,
  pendingApproval,
  pendingQuestions,
  conversationInterruptible,
  handleNewSession,
  setActiveSurface,
  setLastNonSettingsSurface,
  paneSessionPath,
  onBeginSideChat,
}: UseComposerControllerOptions) {
  const isPaneIsolated = Boolean(paneSessionPath?.trim());
  const [paneComposerSegments, setPaneComposerSegments] = useState<RichSegment[]>(() =>
    emptySegments(),
  );
  const [paneLocalFileAttachments, setPaneLocalFileAttachments] = useState(
    runtime.composerLocalFileAttachments,
  );
  const [paneQuestionDrafts, setPaneQuestionDrafts] = useState<Record<string, QuestionDraft>>({});

  const composerSessionKey = snapshot?.composerSessionKey ?? "";
  const paneComposerDraftKey =
    isPaneIsolated && paneSessionPath?.trim()
      ? buildPaneComposerDraftKey(paneSessionPath)
      : composerSessionKey;
  const paneComposerDraftKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPaneIsolated || !paneComposerDraftKey) {
      return;
    }
    const stored = resolvePaneComposerDraft(paneComposerDraftKey, composerSessionKey);
    const keyChanged = paneComposerDraftKeyRef.current !== paneComposerDraftKey;
    paneComposerDraftKeyRef.current = paneComposerDraftKey;
    // Under the same pane session key, composerSessionKey may arrive late as empty (async pane snapshot sync);
    // do not reset then, to avoid clearing content inserted after mount (e.g. an Add to Side Chat quote Chip)
    if (!keyChanged && !stored) {
      return;
    }
    setPaneComposerSegments(stored?.segments ?? emptySegments());
    setPaneLocalFileAttachments(
      (stored?.localFilePaths ?? []).map((filePath) => composerAttachmentViewFromPath(filePath)),
    );
  }, [composerSessionKey, isPaneIsolated, paneComposerDraftKey]);

  useEffect(() => {
    if (!isPaneIsolated || !pendingQuestions) {
      setPaneQuestionDrafts({});
      return;
    }
    setPaneQuestionDrafts((current) => {
      const next: Record<string, QuestionDraft> = {};
      for (const question of pendingQuestions.request.questions) {
        next[question.id] = current[question.id] ?? { selectedOptionIds: [], customText: "" };
      }
      return next;
    });
  }, [isPaneIsolated, pendingQuestions]);

  const composerSegments = isPaneIsolated ? paneComposerSegments : runtime.composerSegments;
  const setComposerSegments = isPaneIsolated
    ? setPaneComposerSegments
    : runtime.setComposerSegments;
  const composerText = useMemo(
    () => normalizeComposerPlain(segmentsToPlainText(composerSegments)),
    [composerSegments],
  );
  const setComposerText = useCallback(
    (text: string) => {
      setComposerSegments(syncSegmentsFromExternalValue(emptySegments(), text));
    },
    [setComposerSegments],
  );
  const composerLocalFileAttachments = isPaneIsolated
    ? paneLocalFileAttachments
    : runtime.composerLocalFileAttachments;
  const setComposerLocalFileAttachments = isPaneIsolated
    ? setPaneLocalFileAttachments
    : runtime.setComposerLocalFileAttachments;

  const pendingComposerSendRef = useRef<{
    text: string;
    localFilePaths?: string[];
    referencedWorkspaceFilePaths?: string[];
    skillChipAliases?: string[];
    chipNavigateMeta?: import("@/lib/composer-chip-navigate-meta").ComposerChipNavigateMeta[];
  } | null>(null);
  const composerRichInputRef = useRef<ComposerRichInputHandle | null>(null);

  const resetComposerAfterSend = useCallback(() => {
    setComposerBrowserElementAttachments([]);
    if (!isPaneIsolated || !paneComposerDraftKey) {
      return;
    }
    const agentMode = runtime.settings.agentMode;
    const loopEnabled = snapshot?.conversation.loopEnabled === true;
    const segments = buildPostSendComposerSegments(agentMode, loopEnabled);
    setPaneComposerSegments(segments);
    setPaneLocalFileAttachments([]);
    writeComposerDraft(paneComposerDraftKey, {
      localFilePaths: [],
      segments,
    });
  }, [
    isPaneIsolated,
    paneComposerDraftKey,
    runtime.settings.agentMode,
    snapshot?.conversation.loopEnabled,
  ]);

  const [composerBrowserElementAttachments, setComposerBrowserElementAttachments] = useState<
    BrowserElementAttachment[]
  >([]);
  const [composerCursorCodeUnits, setComposerCursorCodeUnits] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1);
  const [fileReferenceSuggestions, setFileReferenceSuggestions] =
    useState<WorkspaceFileReferenceSuggestionsResponse>(null);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(-1);
  const [fileReferenceMenuView, setFileReferenceMenuView] = useState<AtReferenceMenuView>("root");
  const [dismissedFileReferenceKey, setDismissedFileReferenceKey] = useState<string | null>(null);
  const [dismissedSlashQueryKey, setDismissedSlashQueryKey] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [actionPickerOpen, setActionPickerOpen] = useState(false);
  const [branchCheckoutDialogOpen, setBranchCheckoutDialogOpen] = useState(false);
  const [branchCheckoutBlockedByChanges, setBranchCheckoutBlockedByChanges] = useState(false);

  useLocalFileAttachmentPreviews(
    composerLocalFileAttachments,
    setComposerLocalFileAttachments,
    runtime.readLocalImagePreviewDataUrl,
  );

  const panePendingDraftPersistRef = useRef<(() => void) | null>(null);
  const paneDraftFlushSnapshotRef = useRef<{
    key: string;
    localFilePaths: string[];
    segments: RichSegment[];
  } | null>(null);

  useEffect(() => {
    if (!isPaneIsolated || !paneComposerDraftKey) {
      paneDraftFlushSnapshotRef.current = null;
      return;
    }
    paneDraftFlushSnapshotRef.current = {
      key: paneComposerDraftKey,
      localFilePaths: composerLocalFileAttachments.map((item) => item.path),
      segments: composerSegments,
    };
  }, [composerLocalFileAttachments, composerSegments, isPaneIsolated, paneComposerDraftKey]);

  useEffect(() => {
    if (!isPaneIsolated || !paneComposerDraftKey) {
      panePendingDraftPersistRef.current = null;
      return;
    }
    const persist = () => {
      panePendingDraftPersistRef.current = null;
      writeComposerDraft(paneComposerDraftKey, {
        localFilePaths: composerLocalFileAttachments.map((item) => item.path),
        segments: composerSegments,
      });
    };
    panePendingDraftPersistRef.current = persist;
    const timeout = window.setTimeout(persist, PANE_COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [composerLocalFileAttachments, composerSegments, isPaneIsolated, paneComposerDraftKey]);

  useEffect(() => {
    const flushKey = paneComposerDraftKey;
    return () => {
      if (!flushKey) {
        return;
      }
      panePendingDraftPersistRef.current?.();
      const snapshot = paneDraftFlushSnapshotRef.current;
      if (!snapshot || snapshot.key !== flushKey) {
        return;
      }
      writeComposerDraft(flushKey, {
        localFilePaths: snapshot.localFilePaths,
        segments: snapshot.segments,
      });
    };
  }, [paneComposerDraftKey]);

  const composerDirectMediaMode = useMemo(() => {
    if (!snapshot?.config) {
      return null;
    }
    return resolveComposerDirectMediaTool(snapshot.config.activeModel, snapshot.config);
  }, [snapshot?.config]);

  const composerPlaceholder = activeSessionReadOnly
    ? t("app.readOnlySession")
    : composerDirectMediaMode === "generate_image"
      ? t("composer.placeholderGenerateImage")
      : composerDirectMediaMode === "generate_video"
        ? t("composer.placeholderGenerateVideo")
        : isEmptySession
          ? t("composer.placeholderEmptySession")
          : t("composer.placeholderContinueSession");

  const composerAgentModeChipPlaceholder = useMemo(() => {
    const mode = isAgentModeChipKind(runtime.settings.agentMode)
      ? runtime.settings.agentMode
      : currentAgentModeSegment(composerSegments);
    if (mode === undefined || !isAgentModeChipKind(mode)) {
      return undefined;
    }
    if (mode === "plan") {
      return t("composer.placeholderWithPlanChip");
    }
    if (mode === "ask") {
      return t("composer.placeholderWithAskChip");
    }
    return t("composer.placeholderWithDebugChip");
  }, [composerSegments, runtime.settings.agentMode, t]);

  const messageRewindComposerEnabled =
    !compactionDemoActive &&
    !longConversationListDemoActive &&
    !subagentViewActive &&
    !activeSessionReadOnly &&
    !pendingApproval &&
    !pendingQuestions &&
    runtime.busyAction !== "rewind" &&
    runtime.busyAction !== "session";

  const composerHasPayload = useMemo(() => {
    return (
      Boolean(composerText.trim()) ||
      composerLocalFileAttachments.length > 0 ||
      isCompactSlashComposerSegments(composerSegments) ||
      hasInlineAttachmentChipSegments(composerSegments)
    );
  }, [composerSegments, composerText, composerLocalFileAttachments.length]);

  const paneSessionPathKey =
    isPaneIsolated && paneSessionPath ? normalizePaneSessionPathKey(paneSessionPath) : "";
  const paneSendBusy =
    isPaneIsolated &&
    Boolean(paneSessionPathKey) &&
    runtime.paneSendBusySessionPath === paneSessionPathKey;
  const composerCanSend =
    !compactionDemoActive &&
    !longConversationListDemoActive &&
    !subagentViewActive &&
    composerHasPayload &&
    !activeSessionReadOnly &&
    runtime.busyAction !== "session" &&
    !pendingApproval &&
    !pendingQuestions &&
    snapshot?.config.activeApiKeyConfigured === true &&
    (isPaneIsolated
      ? resolvePaneCanSend(snapshot) || conversationInterruptible
      : runtime.summary.canSend || conversationInterruptible) &&
    !(isPaneIsolated
      ? paneSendBusy && !conversationInterruptible
      : runtime.busyAction === "send" && !conversationInterruptible);

  const commitBusy = runtime.busyAction === "git";
  const composerBusy = isPaneIsolated
    ? resolvePaneComposerBusy(snapshot, paneSendBusy)
    : runtime.busyAction === "send";
  const gitChipBusy = isPaneIsolated
    ? resolvePaneComposerBusy(snapshot, paneSendBusy)
    : runtime.busyAction === "send" || snapshot?.conversation.isBusy === true;

  const composerCursorChars = useMemo(
    () => codeUnitIndexToCharCount(composerText, composerCursorCodeUnits),
    [composerCursorCodeUnits, composerText],
  );

  const slashQuery = useMemo(() => {
    const query = currentSkillSlashQueryAtCursor(composerText, composerCursorChars);
    if (!query) {
      return undefined;
    }
    if (dismissedSlashQueryKey === skillSlashQueryKey(query)) {
      return undefined;
    }
    return query;
  }, [composerCursorChars, dismissedSlashQueryKey, composerText]);

  const slashSuggestions = useMemo(() => {
    const settingsSkills = snapshot?.skillsList ?? [];
    const extensionSkills = (snapshot?.extensionSkills ?? []).map((skill) => ({
      ...skill,
      enabled: true,
    }));
    const suggestions = buildSkillSlashSuggestions(slashQuery?.raw, [
      ...settingsSkills,
      ...extensionSkills,
    ]);
    const messageId = findLastForkableAssistantMessageId(snapshot?.conversation.messages ?? []);
    const showSideChat = canBeginSideChat({
      conversationBusy: snapshot?.conversation.isBusy === true,
      activeSessionReadOnly,
      forkBusy: runtime.busyAction === "fork",
      sideChatBusy: runtime.busyAction === "side-chat",
      hasForkableAssistantMessage: Boolean(messageId),
    });
    if (showSideChat) {
      return suggestions;
    }
    return suggestions.filter((item) => item.kind !== "side-chat");
  }, [
    activeSessionReadOnly,
    runtime.busyAction,
    slashQuery,
    snapshot?.conversation.isBusy,
    snapshot?.conversation.messages,
    snapshot?.skillsList,
    snapshot?.extensionSkills,
  ]);

  const fileReferenceQuery = useMemo(() => {
    return currentWorkspaceFileReferenceQueryFromSegments(
      composerSegments,
      composerText,
      composerCursorChars,
    );
  }, [composerCursorChars, composerSegments, composerText]);

  useEffect(() => {
    if (!fileReferenceQuery && dismissedFileReferenceKey !== null) {
      setDismissedFileReferenceKey(null);
    }
  }, [dismissedFileReferenceKey, fileReferenceQuery]);

  useEffect(() => {
    if (!fileReferenceQuery) {
      setFileReferenceMenuView("root");
    }
  }, [fileReferenceQuery]);

  useEffect(() => {
    const query = currentSkillSlashQueryAtCursor(composerText, composerCursorChars);
    if (!query && dismissedSlashQueryKey !== null) {
      setDismissedSlashQueryKey(null);
    }
  }, [composerCursorChars, dismissedSlashQueryKey, composerText]);

  const fileReferenceQueryKey = useMemo(
    () =>
      fileReferenceQuery
        ? `${fileReferenceQuery.start}\u0000${fileReferenceQuery.end}\u0000${fileReferenceQuery.raw}`
        : "",
    [fileReferenceQuery],
  );

  const activeFileReferenceQuery = useMemo(() => {
    if (!fileReferenceQuery) {
      return undefined;
    }
    if (dismissedFileReferenceKey === fileReferenceQueryKey) {
      return undefined;
    }
    return fileReferenceQuery;
  }, [dismissedFileReferenceKey, fileReferenceQuery, fileReferenceQueryKey]);

  const workspaceFileIndex = useWorkspaceFileIndex({
    workspaceRoot: snapshot?.workspaceRoot ?? "",
    workspaceBinding: snapshot?.workspaceBinding ?? "project",
    primeWorkspaceFileReferenceIndex: runtime.primeWorkspaceFileReferenceIndex,
    getWorkspaceFileReferenceIndex: runtime.getWorkspaceFileReferenceIndex,
  });

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery?.raw, slashQuery?.start, slashQuery?.end]);

  useEffect(() => {
    if (!fileReferenceQuery || dismissedFileReferenceKey === fileReferenceQueryKey) {
      setFileReferenceSuggestions(null);
      setFileReferenceSelectedIndex(-1);
      return;
    }

    if (!workspaceFileIndex.ready) {
      setFileReferenceSuggestions({
        query: fileReferenceQuery,
        suggestions: [],
      });
      return;
    }

    setFileReferenceSuggestions({
      query: fileReferenceQuery,
      suggestions: workspaceFileIndex.search(fileReferenceQuery.raw),
    });
    setFileReferenceSelectedIndex(0);
  }, [
    dismissedFileReferenceKey,
    fileReferenceQuery,
    fileReferenceQueryKey,
    workspaceFileIndex.ready,
    workspaceFileIndex.fileCount,
    workspaceFileIndex.search,
  ]);

  const atReferenceSessionCandidates = useMemo(
    () =>
      sessionCandidatesFromListItems(
        runtime.sessions,
        paneSessionPath?.trim() || snapshot?.activeSession?.filePath || null,
      ),
    [paneSessionPath, runtime.sessions, snapshot?.activeSession?.filePath],
  );

  const atReferenceMenuItems = useMemo((): AtReferenceMenuItem[] => {
    if (!fileReferenceSuggestions?.query) {
      return [];
    }
    return buildAtReferenceMenuItems({
      view: fileReferenceMenuView,
      rawQuery: fileReferenceSuggestions.query.raw,
      fileSuggestions: fileReferenceSuggestions.suggestions,
      sessions: atReferenceSessionCandidates,
    });
  }, [atReferenceSessionCandidates, fileReferenceMenuView, fileReferenceSuggestions]);

  useEffect(() => {
    if (slashSuggestions.length === 0) {
      if (slashSelectedIndex !== -1) {
        setSlashSelectedIndex(-1);
      }
      return;
    }
    if (slashSelectedIndex < 0 || slashSelectedIndex >= slashSuggestions.length) {
      setSlashSelectedIndex(0);
    }
  }, [slashSelectedIndex, slashSuggestions.length]);

  useEffect(() => {
    const itemCount = atReferenceMenuItems.length;
    if (itemCount === 0) {
      if (fileReferenceSelectedIndex !== -1) {
        setFileReferenceSelectedIndex(-1);
      }
      return;
    }

    if (fileReferenceSelectedIndex < 0 || fileReferenceSelectedIndex >= itemCount) {
      setFileReferenceSelectedIndex(0);
    }
  }, [atReferenceMenuItems.length, fileReferenceSelectedIndex]);

  const handleComposerAgentModeChange = useCallback(
    (agentMode: DesktopAgentMode) => {
      void runtime.saveSettingsPatch({ agentMode });
      if (agentMode === "plan" || agentMode === "ask" || agentMode === "debug") {
        runtime.setAgentModeChipDismissed(false);
      }
      if (agentMode === "plan") {
        composerRichInputRef.current?.insertPlanChip({ clearText: false });
      } else if (agentMode === "ask") {
        composerRichInputRef.current?.insertAskChip({ clearText: false });
      } else if (agentMode === "debug") {
        composerRichInputRef.current?.insertDebugChip({ clearText: false });
      } else {
        composerRichInputRef.current?.removeAgentModeChip();
      }
    },
    [runtime],
  );

  const applySlashSuggestion = useCallback(
    (replacement: string) => {
      if (slashQuery) {
        composerRichInputRef.current?.replaceSkillSlashQuery(slashQuery, replacement, true);
      } else {
        setComposerText(replacement);
      }
      setSlashSelectedIndex(-1);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.focus();
      });
    },
    [runtime, slashQuery],
  );

  const applyLoopSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    void runtime.setLoopEnabled(true);
    composerRichInputRef.current?.insertLoopChip({ clearText: false });
  }, [runtime, slashQuery]);

  const applyPlanSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    // Clear the slash text before inserting the chip, so remove does not rewrite chip-containing segments with stale offsets
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    void runtime.saveSettingsPatch({ agentMode: "plan" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertPlanChip({ clearText: false });
  }, [runtime, slashQuery]);

  const applyAskSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    void runtime.saveSettingsPatch({ agentMode: "ask" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertAskChip({ clearText: false });
  }, [runtime, slashQuery]);

  const applyDebugSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    void runtime.saveSettingsPatch({ agentMode: "debug" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertDebugChip({ clearText: false });
  }, [runtime, slashQuery]);

  const applyForkSlash = useCallback(() => {
    const messages = snapshot?.conversation.messages ?? [];
    const messageId = findLastForkableAssistantMessageId(messages);
    const conversationBusy = snapshot?.conversation.isBusy === true;
    const forkBusy = runtime.busyAction === "fork";
    if (
      !messageId ||
      !canForkSession({
        conversationBusy,
        activeSessionReadOnly,
        forkBusy,
        hasForkableAssistantMessage: true,
      })
    ) {
      return;
    }
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    void runtime.forkSession({ messageId }).then((ok) => {
      if (ok) {
        resetComposerAfterSend();
      }
    });
  }, [
    activeSessionReadOnly,
    resetComposerAfterSend,
    runtime,
    snapshot?.conversation.isBusy,
    snapshot?.conversation.messages,
  ]);

  const applySideChatSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    onBeginSideChat?.();
  }, [onBeginSideChat, slashQuery]);

  const applySlashSuggestionItem = useCallback(
    (suggestion: SkillSlashSuggestion) => {
      if (suggestion.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (suggestion.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (suggestion.kind === "ask") {
        applyAskSlash();
        return;
      }
      if (suggestion.kind === "debug") {
        applyDebugSlash();
        return;
      }
      if (suggestion.kind === "fork") {
        applyForkSlash();
        return;
      }
      if (suggestion.kind === "side-chat") {
        applySideChatSlash();
        return;
      }
      if (suggestion.kind === "skill" || suggestion.kind === "compact") {
        setSlashSelectedIndex(-1);
        setDismissedSlashQueryKey(null);
        if (slashQuery) {
          composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
        }
        queueMicrotask(() => {
          composerRichInputRef.current?.insertSkillChip(
            suggestion.kind === "compact" ? COMPACT_SLASH_ALIAS : suggestion.alias,
          );
        });
        return;
      }
      applySlashSuggestion(`${suggestion.alias} `);
    },
    [
      applyAskSlash,
      applyDebugSlash,
      applyForkSlash,
      applyLoopSlash,
      applyPlanSlash,
      applySideChatSlash,
      applySlashSuggestion,
      slashQuery,
    ],
  );

  const ensureConversationSurface = useCallback(() => {
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
  }, [setActiveSurface, setLastNonSettingsSurface]);

  const prefillSkillChip = useCallback(
    (skillName: string) => {
      const alias = skillSlashAlias(skillName);
      setComposerSegments(emptySegments());
      setSlashSelectedIndex(-1);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.insertSkillChip(alias, {
          clearText: true,
          appendTrailingSpace: true,
        });
        composerRichInputRef.current?.focus();
      });
    },
    [setComposerText],
  );

  const filterActionPaletteItem = useCallback(
    (item: ActionPaletteItem) => {
      if (isAppearanceMenuAction(item) || isThemeOptionAction(item) || isLocaleOptionAction(item)) {
        return true;
      }
      if (item.kind !== "side-chat") {
        return true;
      }
      const messageId = findLastForkableAssistantMessageId(snapshot?.conversation.messages ?? []);
      return canBeginSideChat({
        conversationBusy: snapshot?.conversation.isBusy === true,
        activeSessionReadOnly,
        forkBusy: runtime.busyAction === "fork",
        sideChatBusy: runtime.busyAction === "side-chat",
        hasForkableAssistantMessage: Boolean(messageId),
      });
    },
    [
      activeSessionReadOnly,
      runtime.busyAction,
      snapshot?.conversation.isBusy,
      snapshot?.conversation.messages,
    ],
  );

  const isActionPaletteItemDisabled = useCallback(
    (item: ActionPaletteItem) => {
      if (isAppearanceMenuAction(item) || isThemeOptionAction(item) || isLocaleOptionAction(item)) {
        return false;
      }
      if (!runtime.busyAction) {
        return false;
      }
      if (isNewSessionAction(item)) {
        return true;
      }
      return (
        item.kind === "export-session" ||
        item.kind === "compact" ||
        item.kind === "fork" ||
        item.kind === "side-chat"
      );
    },
    [runtime.busyAction],
  );

  const runActionPaletteItem = useCallback(
    (item: ActionPaletteItem) => {
      if (isAppearanceMenuAction(item) || isThemeOptionAction(item) || isLocaleOptionAction(item)) {
        return;
      }
      ensureConversationSurface();
      if (isNewSessionAction(item)) {
        handleNewSession();
        return;
      }
      if (item.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (item.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (item.kind === "ask") {
        applyAskSlash();
        return;
      }
      if (item.kind === "debug") {
        applyDebugSlash();
        return;
      }
      if (item.kind === "fork") {
        applyForkSlash();
        return;
      }
      if (item.kind === "side-chat") {
        applySideChatSlash();
        return;
      }
      if (item.kind === "export-session" || item.kind === "compact") {
        void runtime.sendMessage({ text: item.alias });
        return;
      }
      applySlashSuggestion(`${item.alias} `);
    },
    [
      applyAskSlash,
      applyDebugSlash,
      applyForkSlash,
      applyLoopSlash,
      applyPlanSlash,
      applySideChatSlash,
      applySlashSuggestion,
      ensureConversationSurface,
      handleNewSession,
      runtime,
    ],
  );

  const applyFileReferenceSuggestion = useCallback(
    (path: string) => {
      const query = fileReferenceSuggestions?.query;
      if (!query) {
        return;
      }

      composerRichInputRef.current?.insertWorkspaceFileReference(path, query, true);
      setFileReferenceSelectedIndex(-1);
      setFileReferenceMenuView("root");
      setDismissedFileReferenceKey(null);
    },
    [fileReferenceSuggestions?.query],
  );

  const applySessionReferenceSuggestion = useCallback(
    (session: { path: string; title: string }) => {
      const query = fileReferenceSuggestions?.query;
      if (!query) {
        return;
      }

      composerRichInputRef.current?.insertSessionReference(session, query, true);
      setFileReferenceSelectedIndex(-1);
      setFileReferenceMenuView("root");
      setDismissedFileReferenceKey(null);
    },
    [fileReferenceSuggestions?.query],
  );

  const openAtReferenceSessions = useCallback(() => {
    setFileReferenceMenuView("sessions");
    // After drilling in, default to the first session; index 0 is "back"
    setFileReferenceSelectedIndex(1);
  }, []);

  const backAtReferenceMenu = useCallback(() => {
    setFileReferenceMenuView("root");
    setFileReferenceSelectedIndex(0);
  }, []);

  const applyAtReferenceMenuItem = useCallback(
    (item: AtReferenceMenuItem | undefined) => {
      if (!item) {
        return;
      }
      if (item.kind === "back") {
        backAtReferenceMenu();
        return;
      }
      if (item.kind === "file") {
        applyFileReferenceSuggestion(item.path);
        return;
      }
      if (item.kind === "sessions-entry") {
        openAtReferenceSessions();
        return;
      }
      applySessionReferenceSuggestion({
        path: item.path,
        title: item.title,
      });
    },
    [
      applyFileReferenceSuggestion,
      applySessionReferenceSuggestion,
      backAtReferenceMenu,
      openAtReferenceSessions,
    ],
  );

  const insertComposerText = useCallback(
    (text: string) => {
      const richInput = composerRichInputRef.current;
      if (richInput) {
        richInput.insertPlainTextAtCaret(text);
      } else {
        const selectionStart = composerCursorCodeUnits;
        const selectionEnd = selectionStart;
        const nextPlain = `${composerText.slice(0, selectionStart)}${text}${composerText.slice(selectionEnd)}`;
        setComposerSegments(syncSegmentsFromExternalValue(composerSegments, nextPlain));
        setComposerCursorCodeUnits(selectionStart + text.length);
      }
      setSlashSelectedIndex(-1);
      setFileReferenceSelectedIndex(-1);
      setFileReferenceMenuView("root");
      setFileReferenceSuggestions(null);
      setDismissedFileReferenceKey(null);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.focus();
      });
    },
    [composerCursorCodeUnits, composerSegments, composerText, setComposerSegments],
  );

  const insertFileReferenceTrigger = useCallback(() => {
    insertComposerText("@");
  }, [insertComposerText]);

  const insertSkillTriggerFromPalette = useCallback(() => {
    insertComposerText("/");
  }, [insertComposerText]);

  const removeLocalFileAttachment = useCallback(
    (path: string) => {
      removeComposerLocalFileAttachment(setComposerLocalFileAttachments, path);
    },
    [setComposerLocalFileAttachments],
  );

  const attachLocalFilePath = useCallback(
    async (filePath: string) => {
      const route = await runtime.classifyLocalFileComposerRoute(filePath);
      if (route === "media") {
        appendComposerLocalFileAttachment(setComposerLocalFileAttachments, filePath, {
          onAfterAttach: () => {
            queueMicrotask(() => {
              composerRichInputRef.current?.focus();
            });
          },
        });
        return;
      }
      composerRichInputRef.current?.insertWorkspaceFileAtCaret(normalizeSlashPath(filePath));
      composerRichInputRef.current?.focus();
    },
    [runtime.classifyLocalFileComposerRoute, setComposerLocalFileAttachments],
  );

  const handleBrowserElementPicked = useCallback(
    async (attachment: BrowserElementAttachment) => {
      composerRichInputRef.current?.insertAttachment(attachment);
      const base64 = attachment.screenshotDataUrl.replace(/^data:image\/png;base64,/, "");
      const bridge = window.spiritDesktop;
      if (bridge?.ingestBrowserElementScreenshot) {
        const filePath = await bridge.ingestBrowserElementScreenshot(base64);
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      }
    },
    [attachLocalFilePath],
  );

  const handlePrDiffAddToSession = useCallback((attachment: PrDiffAttachment) => {
    composerRichInputRef.current?.insertPrDiffAttachment(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleGitCommitAddToSession = useCallback(
    (attachment: GitCommitAttachment) => {
      ensureConversationSurface();
      composerRichInputRef.current?.insertGitCommitAttachment(attachment);
      composerRichInputRef.current?.focus();
    },
    [ensureConversationSurface],
  );

  const handleTerminalAddToSession = useCallback((attachment: TerminalSnippetAttachment) => {
    composerRichInputRef.current?.insertTerminalSnippet(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleFileSnippetAddToSession = useCallback((attachment: FileSnippetAttachment) => {
    composerRichInputRef.current?.insertFileSnippet(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleMessageQuoteAddToSession = useCallback((attachment: MessageQuoteAttachment) => {
    composerRichInputRef.current?.insertMessageQuote(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleWorkspaceFileAddToSession = useCallback(
    (relativePath: string, sourceTabId?: string) => {
      ensureConversationSurface();
      composerRichInputRef.current?.insertWorkspaceFileAtCaret(relativePath, sourceTabId);
      composerRichInputRef.current?.focus();
    },
    [ensureConversationSurface],
  );

  const pickLocalFileFromPalette = useCallback(() => {
    void runtime.pickLocalFile().then(async (filePaths) => {
      for (const filePath of filePaths ?? []) {
        await attachLocalFilePath(filePath);
      }
    });
  }, [attachLocalFilePath, runtime]);

  const handleComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron") {
        return;
      }

      const hasClipboardImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (!hasClipboardImage) {
        return;
      }

      event.preventDefault();
      void runtime.ingestClipboardImage().then((filePath) => {
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      });
    },
    [activeSessionReadOnly, attachLocalFilePath, runtime],
  );

  const handleComposerDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron") {
        return;
      }
      if (!isComposerFileDropAccepted(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = resolveComposerDropEffect(event.dataTransfer);
    },
    [activeSessionReadOnly, runtime.hostKind],
  );

  const handleComposerDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron") {
        return;
      }
      if (!isComposerFileDropAccepted(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      const paths = resolveComposerDropAbsolutePaths(event, {
        workspaceRoot: snapshot?.workspaceRoot ?? "",
        getPathForFile: runtime.getPathForDroppedFile,
      });
      for (const filePath of paths) {
        void attachLocalFilePath(filePath);
      }
    },
    [
      activeSessionReadOnly,
      attachLocalFilePath,
      runtime.getPathForDroppedFile,
      runtime.hostKind,
      snapshot?.workspaceRoot,
    ],
  );

  const withPaneSessionPath = useCallback(
    (request: SubmitUserTurnRequest): SubmitUserTurnRequest => ({
      ...request,
      ...(isPaneIsolated && paneSessionPath ? { sessionPath: paneSessionPath } : {}),
    }),
    [isPaneIsolated, paneSessionPath],
  );

  const checkoutBranchForComposer = useCallback(
    (branch: string, options?: { discardLocalChanges?: boolean }) => {
      if (isPaneIsolated && paneSessionPath) {
        return runtime.checkoutPaneGitBranch(paneSessionPath, branch, options);
      }
      return runtime.checkoutGitBranch(branch, options);
    },
    [isPaneIsolated, paneSessionPath, runtime],
  );

  const submitComposerMessage = useCallback(() => {
    const fullText = segmentsToMessageText(composerSegments);
    const trimmed = fullText.trim();
    if (trimmed === FORK_SLASH_ALIAS) {
      applyForkSlash();
      return;
    }
    const chipMetadata = extractComposerChipMetadata(composerSegments);
    const chipNavigateMeta = extractChipNavigateMeta(composerSegments);
    const payload = {
      text: fullText,
      ...(composerLocalFileAttachments.length > 0
        ? {
            localFilePaths: composerLocalFileAttachments.map((item) => item.path),
          }
        : {}),
      ...(chipMetadata.referencedWorkspaceFilePaths.length > 0
        ? { referencedWorkspaceFilePaths: chipMetadata.referencedWorkspaceFilePaths }
        : {}),
      ...(chipMetadata.skillChipAliases.length > 0
        ? { skillChipAliases: chipMetadata.skillChipAliases }
        : {}),
      ...(chipNavigateMeta.length > 0 ? { chipNavigateMeta } : {}),
    };

    if (shouldPromptGitBranchCheckoutBeforeSend({ isEmptySession, git: snapshot?.git })) {
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (selectedBranch) {
        pendingComposerSendRef.current = payload;
        setBranchCheckoutDialogOpen(true);
        return;
      }
    }

    void runtime.sendMessage(withPaneSessionPath(payload)).then((ok) => {
      if (ok) {
        resetComposerAfterSend();
      }
    });
  }, [
    applyForkSlash,
    composerSegments,
    isEmptySession,
    isPaneIsolated,
    resetComposerAfterSend,
    runtime,
    snapshot?.git,
    withPaneSessionPath,
  ]);

  const confirmBranchCheckoutAndSend = useCallback(() => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await checkoutBranchForComposer(selectedBranch);
      if (result.ok) {
        pendingComposerSendRef.current = null;
        setBranchCheckoutBlockedByChanges(false);
        setBranchCheckoutDialogOpen(false);
        void runtime.sendMessage(withPaneSessionPath(pending)).then((ok) => {
          if (ok) {
            resetComposerAfterSend();
          }
        });
        return;
      }

      if (result.reason === "local-changes") {
        setBranchCheckoutBlockedByChanges(true);
      }
    })();
  }, [
    checkoutBranchForComposer,
    isPaneIsolated,
    resetComposerAfterSend,
    runtime,
    snapshot?.git,
    withPaneSessionPath,
  ]);

  const discardBranchChangesAndCheckoutSend = useCallback(() => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await checkoutBranchForComposer(selectedBranch, { discardLocalChanges: true });
      if (!result.ok) {
        return;
      }

      pendingComposerSendRef.current = null;
      setBranchCheckoutBlockedByChanges(false);
      setBranchCheckoutDialogOpen(false);
      void runtime.sendMessage(withPaneSessionPath(pending)).then((ok) => {
        if (ok) {
          resetComposerAfterSend();
        }
      });
    })();
  }, [
    checkoutBranchForComposer,
    isPaneIsolated,
    resetComposerAfterSend,
    runtime,
    snapshot?.git,
    withPaneSessionPath,
  ]);

  const handleBranchCheckoutDialogOpenChange = useCallback((open: boolean) => {
    setBranchCheckoutDialogOpen(open);
    if (!open) {
      pendingComposerSendRef.current = null;
      setBranchCheckoutBlockedByChanges(false);
    }
  }, []);

  const cancelBranchCheckoutDialog = useCallback(() => {
    pendingComposerSendRef.current = null;
    setBranchCheckoutBlockedByChanges(false);
    setBranchCheckoutDialogOpen(false);
  }, []);

  const handleComposerSuggestionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (slashQuery) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDismissedSlashQueryKey(skillSlashQueryKey(slashQuery));
          setSlashSelectedIndex(-1);
          return;
        }

        if (slashSuggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashSelectedIndex((current) => {
              if (current < 0) {
                return 0;
              }
              return (current + 1) % slashSuggestions.length;
            });
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashSelectedIndex((current) =>
              current <= 0 ? slashSuggestions.length - 1 : current - 1,
            );
            return;
          }

          if (event.key === "Tab") {
            event.preventDefault();
            const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
            if (selected) {
              applySlashSuggestionItem(selected);
            }
            return;
          }

          if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
            if (selected) {
              applySlashSuggestionItem(selected);
            }
            return;
          }
        }
      }

      const atReferenceActive = Boolean(fileReferenceSuggestions?.query);
      if (!atReferenceActive) {
        return;
      }

      const rawQuery = fileReferenceSuggestions?.query.raw ?? "";
      const needle = atReferenceNeedle(rawQuery);
      const menuItems = atReferenceMenuItems;

      if (fileReferenceMenuView === "sessions") {
        if (event.key === "Escape") {
          event.preventDefault();
          backAtReferenceMenu();
          return;
        }
        if (event.key === "Backspace" && needle.length === 0) {
          event.preventDefault();
          backAtReferenceMenu();
          return;
        }
      }

      if (menuItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setFileReferenceSelectedIndex((current) => {
            if (current < 0) {
              return 0;
            }
            return (current + 1) % menuItems.length;
          });
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setFileReferenceSelectedIndex((current) =>
            current <= 0 ? menuItems.length - 1 : current - 1,
          );
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setDismissedFileReferenceKey(fileReferenceQueryKey);
          setFileReferenceSelectedIndex(-1);
          setFileReferenceMenuView("root");
          setFileReferenceSuggestions(null);
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          applyAtReferenceMenuItem(menuItems[fileReferenceSelectedIndex] ?? menuItems[0]);
          return;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          applyAtReferenceMenuItem(menuItems[fileReferenceSelectedIndex] ?? menuItems[0]);
        }
        return;
      }

      if (fileReferenceMenuView === "root" && event.key === "Escape") {
        event.preventDefault();
        setDismissedFileReferenceKey(fileReferenceQueryKey);
        setFileReferenceSelectedIndex(-1);
        setFileReferenceMenuView("root");
        setFileReferenceSuggestions(null);
      }
    },
    [
      applyAtReferenceMenuItem,
      applySlashSuggestionItem,
      atReferenceMenuItems,
      backAtReferenceMenu,
      fileReferenceMenuView,
      fileReferenceQueryKey,
      fileReferenceSelectedIndex,
      fileReferenceSuggestions?.query,
      slashQuery,
      slashSelectedIndex,
      slashSuggestions,
    ],
  );

  const handleComposerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      handleComposerSuggestionKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      if (
        event.key === "Tab" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const nextMode = cycleAgentMode(runtime.settings.agentMode);
        handleComposerAgentModeChange(nextMode);
        return;
      }
      if (
        pendingApproval &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing &&
        runtime.busyAction !== "approve"
      ) {
        event.preventDefault();
        void runtime.submitApproval(
          { kind: "allow" },
          isPaneIsolated ? paneSessionPath : undefined,
        );
      }
    },
    [
      handleComposerAgentModeChange,
      handleComposerSuggestionKeyDown,
      isPaneIsolated,
      paneSessionPath,
      pendingApproval,
      runtime,
    ],
  );

  const focusComposer = useCallback(() => {
    composerRichInputRef.current?.focus();
  }, []);

  const dismissFileReferenceSuggestions = useCallback(() => {
    setDismissedFileReferenceKey(fileReferenceQueryKey);
    setFileReferenceSelectedIndex(-1);
    setFileReferenceMenuView("root");
    setFileReferenceSuggestions(null);
  }, [fileReferenceQueryKey]);

  const dismissSlashSuggestions = useCallback(() => {
    if (!slashQuery) {
      setSlashSelectedIndex(-1);
      return;
    }
    setDismissedSlashQueryKey(skillSlashQueryKey(slashQuery));
    setSlashSelectedIndex(-1);
  }, [slashQuery]);

  return {
    composerSegments,
    setComposerSegments,
    composerText,
    setComposerText,
    composerLocalFileAttachments,
    setComposerLocalFileAttachments,
    composerBrowserElementAttachments,
    setComposerBrowserElementAttachments,
    composerCursorCodeUnits,
    setComposerCursorCodeUnits,
    slashSelectedIndex,
    setSlashSelectedIndex,
    fileReferenceSuggestions,
    fileReferenceSelectedIndex,
    setFileReferenceSelectedIndex,
    fileReferenceMenuView,
    atReferenceMenuItems,
    activeFileReferenceQuery,
    filePickerOpen,
    setFilePickerOpen,
    actionPickerOpen,
    setActionPickerOpen,
    branchCheckoutDialogOpen,
    branchCheckoutBlockedByChanges,
    handleBranchCheckoutDialogOpenChange,
    cancelBranchCheckoutDialog,
    composerRichInputRef,
    handleComposerAgentModeChange,
    slashQuery,
    slashSuggestions,
    applySlashSuggestionItem,
    prefillSkillChip,
    runActionPaletteItem,
    isActionPaletteItemDisabled,
    filterActionPaletteItem,
    applyFileReferenceSuggestion,
    applySessionReferenceSuggestion,
    openAtReferenceSessions,
    backAtReferenceMenu,
    insertComposerText,
    insertFileReferenceTrigger,
    insertSkillTriggerFromPalette,
    removeLocalFileAttachment,
    handleBrowserElementPicked,
    handlePrDiffAddToSession,
    handleGitCommitAddToSession,
    handleTerminalAddToSession,
    handleFileSnippetAddToSession,
    handleMessageQuoteAddToSession,
    handleWorkspaceFileAddToSession,
    pickLocalFileFromPalette,
    handleComposerPaste,
    handleComposerDragOver,
    handleComposerDrop,
    submitComposerMessage,
    confirmBranchCheckoutAndSend,
    discardBranchChangesAndCheckoutSend,
    handleComposerSuggestionKeyDown,
    handleComposerKeyDown,
    workspaceFileIndex,
    composerPlaceholder,
    composerAgentModeChipPlaceholder,
    composerCanSend,
    composerHasPayload,
    composerBusy,
    messageRewindComposerEnabled,
    commitBusy,
    gitChipBusy,
    focusComposer,
    dismissFileReferenceSuggestions,
    dismissSlashSuggestions,
    paneQuestionControls:
      isPaneIsolated && pendingQuestions
        ? {
            questionDrafts: paneQuestionDrafts,
            onUpdateQuestionDraft: (
              questionId: string,
              updater: (draft: QuestionDraft) => QuestionDraft,
            ) => {
              setPaneQuestionDrafts((current) => ({
                ...current,
                [questionId]: updater(
                  current[questionId] ?? { selectedOptionIds: [], customText: "" },
                ),
              }));
            },
            onSubmitQuestions: () => {
              void runtime.submitQuestions(paneSessionPath, pendingQuestions, paneQuestionDrafts);
            },
            onSkipQuestions: () => {
              void runtime.skipQuestions(paneSessionPath, pendingQuestions);
            },
          }
        : null,
  };
}
