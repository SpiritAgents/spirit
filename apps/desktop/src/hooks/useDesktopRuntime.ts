import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSingleTextQuestionNotificationReplyResult } from "@/lib/ask-questions-notification-reply";
import { applyConversationDelta } from "@/lib/live-update";
import {
  resolvePendingApprovalSessionPath,
  resolvePendingQuestionsSessionPath,
  resolvePendingQuestionsSnapshot,
} from "@/lib/pane-pending-turn-routing";
import { resolvePaneCanSend } from "@/lib/pane-conversation-controls";
import i18n, { getStoredLanguagePreference } from "@/lib/i18n";
import { DEFAULT_TRANSLUCENCY, parseTranslucencyPreference } from "@/lib/translucency";

import type { SettingsFormState } from "@/components/settings/types";
import { useHostApi } from "@/hooks/useHostApi";
import { emptyModelRef, modelRefsEqual } from "@spiritagent/host-internal/config-v2";
import type { ModelRef } from "@/types";
import {
  buildPaneComposerDraftKey,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/composer-draft-store";
import {
  composerAttachmentViewFromPath,
  type ComposerLocalFileAttachmentView,
} from "@/lib/local-file-attachments";
import { isCompactSlashComposerRequest, isExportSessionSlashInput } from "@/lib/skill-slash";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { followQuoteSessionPathsInSegments } from "@/lib/composer-chip-navigate-meta";
import {
  normalizeComposerPlain,
  segmentsToPlainText,
  type RichSegment,
} from "@/lib/composer-segment-model";
import { emptySegments, syncSegmentsFromExternalValue } from "@/lib/composer-segments";
import { isAgentModeChipKind } from "@/lib/composer-agent-mode-segments";
import { buildPostSendComposerSegments } from "@/lib/composer-agent-mode-policy";
import { clearGitHubAutomationRepositoriesCache } from "@/lib/github-automation-repositories-cache";
import { isSubagentToolCallPending } from "@/lib/subagent-viewer-pending";
import { resolveWorkspaceDisplayLabel } from "@/lib/workspace-display-label";
import {
  beginDoodleNavigation,
  cancelDoodleNavigation,
  commitDoodleNavigation,
} from "@/lib/doodle";
import { readSessionSplitBinding } from "@/lib/session-split-binding";
import { resolveWorkspaceGroupingRoot } from "@/lib/workspace-grouping";
import { collectPaneSessionPaths } from "@/lib/conversation-split-layout";
import {
  normalizePaneSessionPathKey,
  resolvePaneDesktopSnapshot,
} from "@/lib/pane-desktop-snapshot";
import {
  applySessionPathAliasesToSnapshot,
  followSessionPathAlias,
} from "@/lib/session-path-alias";
import { isProvisionalSessionPromotion } from "@/lib/session-path-kind";
import { getWebClientViewingSessionPath, setWebClientViewingSessionPath } from "@/adapters/web";
import { useDesktopSystemNotifications } from "@/hooks/useDesktopSystemNotifications";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsAnswer,
  AskQuestionsQuestionSpec,
  AskQuestionsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteRuleRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteSkillRequest,
  DesktopApprovalDecision,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  AddMarketplaceSourceRequest,
  RemoveMarketplaceSourceRequest,
  DesktopMarketplaceInstallResult,
  DesktopMarketplaceUpdateResult,
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  InstallMarketplaceExtensionRequest,
  UpdateExtensionRequest,
  RunExtensionRequest,
  SaveHookEntryRequest,
  SetExtensionEnabledRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
  SessionListItem,
  SubmitGitChipRequest,
  SubmitUserTurnRequest,
  AbortConversationRequest,
  BeginSplitPaneSessionResponse,
  BeginSideChatPaneSessionResponse,
  ForkSessionIntoSideChatRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  HostTextFileStatResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubPullRequestsRequest,
  MergeGitHubPullRequestRequest,
  ApprovalLevel,
  LocalFileComposerRoute,
  WorkLocationKind,
  WorkspaceCapabilityTrustDecision,
} from "@/types";

type BusyAction =
  | ""
  | "bootstrap"
  | "send"
  | "continue"
  | "rewind"
  | "fork"
  | "side-chat"
  | "approve"
  | "workspaceTrust"
  | "questions"
  | "reset"
  | "session"
  | "models"
  | "modelsPreview"
  | "mcps"
  | "hooks"
  | "skills"
  | "rules"
  | "extensions"
  | "extensionsImport"
  | "lspInstall"
  | "git"
  | "automation";

const DREAM_IDLE_POLL_INTERVAL_MS = 30_000;
const GIT_STATE_POLL_INTERVAL_MS = 5_000;
/** Snapshot poll interval while a remote Web client is busy; turn advancement is driven by the host pump, poll only fetches snapshots. */
const WEB_BUSY_POLL_INTERVAL_MS = 150;
const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 400;

type SessionUiState = {
  composerSegments: RichSegment[];
  questionDrafts: Record<string, QuestionDraft>;
  localFilePaths: string[];
  agentModeChipDismissed: boolean;
};

function pathsFromComposerAttachments(
  attachments: readonly ComposerLocalFileAttachmentView[],
): string[] {
  return attachments.map((attachment) => attachment.path);
}

function attachmentsFromPaths(paths: readonly string[]): ComposerLocalFileAttachmentView[] {
  return paths.map((filePath) => composerAttachmentViewFromPath(filePath));
}

function persistSessionUiDraft(
  sessionKey: string,
  state: Pick<SessionUiState, "localFilePaths" | "composerSegments">,
): void {
  writeComposerDraft(sessionKey, {
    localFilePaths: state.localFilePaths,
    segments: state.composerSegments,
  });
}

export interface QuestionDraft {
  selectedOptionIds: string[];
  customText: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export type CheckoutGitBranchResult =
  | { ok: true }
  | { ok: false; reason: "local-changes" }
  | { ok: false; reason: "error" };

function isCheckoutBlockedByLocalChanges(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "GIT_CHECKOUT_LOCAL_CHANGES") {
      return true;
    }
  }

  const message = describeError(error);
  return (
    /local changes to the following files would be overwritten by checkout/i.test(message) ||
    /please commit your changes or stash them before you switch branches/i.test(message) ||
    message.includes(i18n.t("error.uncommittedChangesBlockCheckout"))
  );
}

function sanitizeGitErrorMessage(error: unknown): string {
  return describeError(error)
    .replace(/^Error invoking remote method 'desktop:invoke': Error: /u, "")
    .replace(/^Error invoking remote method 'desktop:invoke': /u, "");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function updateConfigFromSettingsForm(
  s: SettingsFormState,
  webHost: NonNullable<UpdateConfigRequest["webHost"]>,
): UpdateConfigRequest {
  return {
    activeModel: s.activeModel,
    imageGenerationModel: s.imageGenerationModel,
    videoGenerationModel: s.videoGenerationModel,
    lightweightChatModel: s.lightweightChatModel,
    apiBase: s.apiBase,
    translucency: s.translucency,
    systemNotifications: s.systemNotifications,
    trayIcon: s.trayIcon,
    onboardingCompleted: s.onboardingCompleted,
    agentMode: s.agentMode,
    webHost,
    dreams: {
      enabled: s.dreamEnabled,
      clearCollectorModel: true,
      debugMode: s.dreamDebugMode,
    },
    agents: {
      lsp: {
        enabled: s.lspEnabled,
      },
      codeCompletion: {
        enabled: s.codeCompletionEnabled,
      },
      attribution: {
        commit: {
          enabled: s.commitAttributionEnabled,
        },
        pr: {
          enabled: s.prAttributionEnabled,
        },
      },
    },
    networks: {
      llmHttpVersion: s.llmHttpVersion,
    },
    ...(s.uiLocale.trim() ? { uiLocale: s.uiLocale.trim() } : { uiLocale: undefined }),
    ...(s.apiKey.trim() ? { apiKey: s.apiKey.trim() } : undefined),
  };
}

function buildAskQuestionsAnswer(
  question: AskQuestionsQuestionSpec,
  draft: QuestionDraft,
): AskQuestionsAnswer {
  const validOptionIds = new Set(question.options.map((option) => option.id));
  const selectedOptionIds = Array.from(new Set(draft.selectedOptionIds)).filter((id) =>
    validOptionIds.has(id),
  );
  const customText = draft.customText.trim();

  return {
    questionId: question.id,
    selectedOptionIds,
    ...(customText ? { customText } : {}),
  };
}

function buildAskQuestionsResult(
  request: AskQuestionsRequest,
  drafts: Record<string, QuestionDraft>,
): { result?: AskQuestionsResult; error?: string } {
  const answers = request.questions.map((question) =>
    buildAskQuestionsAnswer(question, drafts[question.id] ?? emptyQuestionDraft()),
  );

  return {
    result: {
      status: "answered",
      answers,
    },
  };
}

function emptyQuestionDraft(): QuestionDraft {
  return {
    selectedOptionIds: [],
    customText: "",
  };
}

function shouldRefreshDreamSessions(prev: DesktopSnapshot, next: DesktopSnapshot): boolean {
  if (!next.dreams.settings.debugMode) {
    return false;
  }

  return (
    prev.dreams.collector.state !== next.dreams.collector.state ||
    prev.dreams.collector.processedCount !== next.dreams.collector.processedCount ||
    prev.dreams.collector.lastSuccessAtUnixMs !== next.dreams.collector.lastSuccessAtUnixMs
  );
}

/**
 * Keep sidebar session title in sync with snapshot without waiting for listSessions IPC.
 * Match by file path only: `isActive` in the cached list can lag behind session switches.
 */
function patchActiveSessionDisplayNameInList(
  list: SessionListItem[],
  filePath: string | undefined,
  displayName: string | undefined,
): SessionListItem[] | null {
  if (!filePath || displayName === undefined) {
    return null;
  }

  let changed = false;
  const next = list.map((session) => {
    if (session.path !== filePath || session.displayName === displayName) {
      return session;
    }
    changed = true;
    return { ...session, displayName };
  });
  return changed ? next : null;
}

function normalizeSessionPathKey(sessionPath: string): string {
  return sessionPath.replace(/\\/g, "/").toLowerCase();
}

function shouldHoldSessionBusyForSplitRestore(
  sessionPath: string,
  snapshot: DesktopSnapshot,
): boolean {
  const binding = readSessionSplitBinding(sessionPath);
  if (!binding) {
    return false;
  }
  const bindingPaths = collectPaneSessionPaths(binding);
  const paneKeys = Object.keys(snapshot.paneSessions ?? {});
  return bindingPaths.some(
    (path) =>
      !paneKeys.some((key) => normalizeSessionPathKey(key) === normalizeSessionPathKey(path)),
  );
}

function isRemoteWebHostClient(apiKind: string | null | undefined): boolean {
  if (apiKind === "web") {
    return true;
  }
  return typeof window !== "undefined" && !window.spiritDesktop;
}

function webPollRequestForSnapshot(
  apiKind: string | null | undefined,
  snapshot: DesktopSnapshot | null | undefined,
  viewingSessionPath?: string,
): import("../types").PollRequest | undefined {
  if (!isRemoteWebHostClient(apiKind)) {
    return undefined;
  }
  const sessionPath =
    viewingSessionPath?.trim() ??
    getWebClientViewingSessionPath().trim() ??
    snapshot?.activeSession?.filePath?.trim();
  return sessionPath ? { sessionPath } : undefined;
}

function snapshotIncludesWorkspaceDoodleVariants(
  snapshot:
    | Pick<DesktopSnapshot, "workspaceRoot" | "workspaceBinding" | "availableWorkspaces">
    | null
    | undefined,
): boolean {
  return (
    resolveWorkspaceDisplayLabel(
      snapshot?.workspaceRoot ?? "",
      snapshot?.workspaceBinding ?? "project",
      snapshot?.availableWorkspaces ?? [],
    ) !== null
  );
}

export function useDesktopRuntime() {
  const { api, error: hostError, kind, ready: hostReady } = useHostApi();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [webViewingSessionPath, setWebViewingSessionPath] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [webHostPairingRequired, setWebHostPairingRequired] = useState(false);
  const [composerSegments, setComposerSegments] = useState<RichSegment[]>(() => emptySegments());
  const composer = useMemo(
    () => normalizeComposerPlain(segmentsToPlainText(composerSegments)),
    [composerSegments],
  );
  const [approvalGuidance, setApprovalGuidance] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [settings, setSettings] = useState<SettingsFormState>({
    activeModel: emptyModelRef(),
    imageGenerationModel: undefined,
    videoGenerationModel: undefined,
    lightweightChatModel: undefined,
    apiBase: "",
    uiLocale: getStoredLanguagePreference(),
    apiKey: "",
    translucency: DEFAULT_TRANSLUCENCY,
    systemNotifications: true,
    trayIcon: true,
    onboardingCompleted: false,
    agentMode: "agent",
    webHostEnabled: false,
    webHostHost: "127.0.0.1",
    webHostPort: 7788,
    dreamEnabled: false,
    dreamDebugMode: false,
    lspEnabled: true,
    codeCompletionEnabled: true,
    commitAttributionEnabled: true,
    prAttributionEnabled: true,
    llmHttpVersion: "http2",
  });
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [paneWorkspaceBusySessionPath, setPaneWorkspaceBusySessionPath] = useState<string | null>(
    null,
  );
  const [paneSendBusySessionPath, setPaneSendBusySessionPath] = useState<string | null>(null);
  const [layoutNavigationPending, setLayoutNavigationPendingState] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [unseenCompletedSessionPaths, setUnseenCompletedSessionPaths] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const sessionsBusySnapshotRef = useRef<Map<string, boolean>>(new Map());
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [composerLocalFileAttachments, setComposerLocalFileAttachments] = useState<
    ComposerLocalFileAttachmentView[]
  >([]);
  const [agentModeChipDismissed, setAgentModeChipDismissed] = useState(false);
  const agentModeChipDismissedRef = useRef(false);
  const appliedConversationRevisionRef = useRef(0);
  const appliedComposerSessionKeyRef = useRef("");
  const sessionNavigationGenerationRef = useRef(0);
  const [sessionNavigationGeneration, setSessionNavigationGeneration] = useState(0);
  const [navigationDoodleVariant, setNavigationDoodleVariant] = useState<
    import("@/lib/doodle").DoodleVariantId | null
  >(null);
  const busyActionRef = useRef<BusyAction>("");
  const paneWorkspaceBusySessionPathRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const snapshotRef = useRef<DesktopSnapshot | null>(null);
  const webViewingSessionPathRef = useRef("");

  const syncWebViewingSessionPath = useCallback((sessionPath: string | undefined) => {
    const trimmed = sessionPath?.trim();
    if (!trimmed) {
      return;
    }
    webViewingSessionPathRef.current = trimmed;
    setWebClientViewingSessionPath(trimmed);
    setWebViewingSessionPath(trimmed);
  }, []);
  const translucencySaveSeqRef = useRef(0);
  const translucencyInFlightRef = useRef(0);
  /** Settings patches accumulated while the Host API is not ready, persisted in one go once the api is available. */
  const pendingSettingsPatchRef = useRef<Partial<SettingsFormState>>({});
  const sessionUiCacheRef = useRef(new Map<string, SessionUiState>());

  const advanceSessionNavigationGeneration = useCallback(() => {
    const next = sessionNavigationGenerationRef.current + 1;
    sessionNavigationGenerationRef.current = next;
    setSessionNavigationGeneration(next);
    return next;
  }, []);

  const beginNavigationDoodle = useCallback((navGeneration: number) => {
    const variant = beginDoodleNavigation(navGeneration, {
      includeWorkspaceVariants: snapshotIncludesWorkspaceDoodleVariants(snapshotRef.current),
    });
    setNavigationDoodleVariant(variant);
    return variant;
  }, []);

  const finishNavigationDoodle = useCallback((navGeneration: number) => {
    cancelDoodleNavigation(navGeneration);
    setNavigationDoodleVariant(null);
  }, []);

  const sessionUiKey = useCallback(
    (sessionKey: string | undefined) => sessionKey?.trim() || "",
    [],
  );

  const resetComposerAfterSend = useCallback(
    (agentMode: DesktopAgentMode, options?: { loopEnabled?: boolean }) => {
      const loopEnabled =
        options?.loopEnabled ?? snapshotRef.current?.conversation.loopEnabled === true;
      const segments = buildPostSendComposerSegments(agentMode, loopEnabled);
      const key = sessionUiKey(snapshotRef.current?.composerSessionKey);

      setComposerSegments(segments);
      setComposerLocalFileAttachments([]);
      setAgentModeChipDismissed(false);

      if (!key) {
        return;
      }

      const cached = sessionUiCacheRef.current.get(key);
      sessionUiCacheRef.current.set(key, {
        composerSegments: segments,
        questionDrafts: cached?.questionDrafts ?? {},
        localFilePaths: [],
        agentModeChipDismissed: false,
      });
      persistSessionUiDraft(key, {
        localFilePaths: [],
        composerSegments: segments,
      });
    },
    [sessionUiKey],
  );

  const stashSessionUi = useCallback(
    (
      targetSnapshot:
        | Pick<DesktopSnapshot, "composerSessionKey" | "activeSession">
        | null
        | undefined,
    ) => {
      const snapshotLike = targetSnapshot ?? snapshotRef.current;
      if (snapshotLike?.activeSession?.readOnly) {
        return;
      }
      const key = sessionUiKey(snapshotLike?.composerSessionKey);
      if (!key) {
        return;
      }
      const state: SessionUiState = {
        composerSegments,
        questionDrafts,
        localFilePaths: pathsFromComposerAttachments(composerLocalFileAttachments),
        agentModeChipDismissed,
      };
      sessionUiCacheRef.current.set(key, state);
      persistSessionUiDraft(key, {
        localFilePaths: state.localFilePaths,
        composerSegments: state.composerSegments,
      });
    },
    [
      agentModeChipDismissed,
      composerLocalFileAttachments,
      composerSegments,
      questionDrafts,
      sessionUiKey,
    ],
  );

  const restoreSessionUi = useCallback(
    (
      targetSnapshot:
        | Pick<DesktopSnapshot, "composerSessionKey" | "activeSession">
        | null
        | undefined,
    ) => {
      const snapshotLike = targetSnapshot ?? snapshotRef.current;
      const key = sessionUiKey(snapshotLike?.composerSessionKey);
      if (snapshotLike?.activeSession?.readOnly) {
        setComposerSegments(emptySegments());
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setAgentModeChipDismissed(false);
        setQuestionError("");
        return;
      }
      if (!key) {
        setComposerSegments(emptySegments());
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setAgentModeChipDismissed(false);
        setQuestionError("");
        return;
      }
      const cached = sessionUiCacheRef.current.get(key);
      if (cached) {
        setComposerSegments(cached.composerSegments);
        setQuestionDrafts(cached.questionDrafts);
        setComposerLocalFileAttachments(attachmentsFromPaths(cached.localFilePaths));
        setAgentModeChipDismissed(cached.agentModeChipDismissed ?? false);
        setQuestionError("");
        return;
      }
      const stored = readComposerDraft(key);
      setComposerSegments(stored?.segments ?? emptySegments());
      setQuestionDrafts({});
      setComposerLocalFileAttachments(attachmentsFromPaths(stored?.localFilePaths ?? []));
      setAgentModeChipDismissed(false);
      setQuestionError("");
    },
    [sessionUiKey],
  );

  const applyComposerSeed = useCallback(
    (
      seed: string,
      targetSnapshot: Pick<DesktopSnapshot, "composerSessionKey" | "activeSession">,
    ) => {
      const key = sessionUiKey(targetSnapshot.composerSessionKey);
      const seedSegments = syncSegmentsFromExternalValue(emptySegments(), seed);
      const seedPayload = {
        localFilePaths: [] as string[],
        composerSegments: seedSegments,
      };
      setComposerSegments(seedSegments);
      setComposerLocalFileAttachments([]);
      setAgentModeChipDismissed(false);
      if (!key || targetSnapshot.activeSession?.readOnly) {
        return;
      }
      sessionUiCacheRef.current.set(key, {
        composerSegments: seedSegments,
        questionDrafts: {},
        localFilePaths: [],
        agentModeChipDismissed: false,
      });
      persistSessionUiDraft(key, seedPayload);
      const paneDraftKey = targetSnapshot.activeSession?.filePath
        ? buildPaneComposerDraftKey(targetSnapshot.activeSession.filePath)
        : "";
      if (paneDraftKey) {
        writeComposerDraft(paneDraftKey, {
          localFilePaths: seedPayload.localFilePaths,
          segments: seedSegments,
        });
      }
    },
    [sessionUiKey],
  );

  const setComposerFromPlain = useCallback((text: string) => {
    setComposerSegments(syncSegmentsFromExternalValue(emptySegments(), text));
  }, []);

  useEffect(() => {
    agentModeChipDismissedRef.current = agentModeChipDismissed;
  }, [agentModeChipDismissed]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    busyActionRef.current = busyAction;
  }, [busyAction]);

  useEffect(() => {
    paneWorkspaceBusySessionPathRef.current = paneWorkspaceBusySessionPath;
  }, [paneWorkspaceBusySessionPath]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (
      busyAction === "bootstrap" ||
      busyAction === "session" ||
      busyAction === "reset" ||
      snapshot?.activeSession?.readOnly
    ) {
      return;
    }
    const key = sessionUiKey(snapshot?.composerSessionKey);
    if (!key) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const localFilePaths = pathsFromComposerAttachments(composerLocalFileAttachments);
      sessionUiCacheRef.current.set(key, {
        composerSegments,
        questionDrafts,
        localFilePaths,
        agentModeChipDismissed,
      });
      persistSessionUiDraft(key, {
        localFilePaths,
        composerSegments,
      });
    }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [
    agentModeChipDismissed,
    busyAction,
    composerLocalFileAttachments,
    composerSegments,
    questionDrafts,
    sessionUiKey,
    snapshot?.activeSession?.readOnly,
    snapshot?.composerSessionKey,
  ]);

  const applySnapshot = useCallback(
    (
      next: DesktopSnapshot,
      options?: {
        navGeneration?: number;
        fromPaneWorkspaceSwitch?: boolean;
      },
    ) => {
      if (paneWorkspaceBusySessionPathRef.current && !options?.fromPaneWorkspaceSwitch) {
        return;
      }

      if (
        options?.navGeneration === undefined &&
        (busyActionRef.current === "session" || busyActionRef.current === "reset")
      ) {
        return;
      }

      if (
        options?.navGeneration !== undefined &&
        options.navGeneration !== sessionNavigationGenerationRef.current
      ) {
        return;
      }

      const revision = next.conversation.revision ?? 0;
      const sessionKey = next.composerSessionKey;
      const sameSession = sessionKey === appliedComposerSessionKeyRef.current;
      if (sameSession && revision < appliedConversationRevisionRef.current) {
        return;
      }

      if (!sameSession) {
        appliedConversationRevisionRef.current = 0;
      }

      let effectiveNext = next;
      if (isRemoteWebHostClient(api?.kind)) {
        const viewingPath = webViewingSessionPathRef.current.trim() || webViewingSessionPath.trim();
        const incomingPath = next.activeSession?.filePath?.trim() ?? "";
        if (viewingPath && incomingPath && viewingPath !== incomingPath) {
          const projected = resolvePaneDesktopSnapshot(next, viewingPath);
          if (projected) {
            effectiveNext = projected;
          }
        }
      }
      appliedComposerSessionKeyRef.current = effectiveNext.composerSessionKey;
      appliedConversationRevisionRef.current = effectiveNext.conversation.revision ?? revision;
      setSnapshot(applySessionPathAliasesToSnapshot(effectiveNext));
      setSessions((current) => {
        const patched = patchActiveSessionDisplayNameInList(
          current,
          effectiveNext.activeSession?.filePath,
          effectiveNext.activeSession?.displayName,
        );
        return patched ?? current;
      });
      setRuntimeError(effectiveNext.runtimeError ?? "");
      setSettings((current) => {
        const activeModelProfile = effectiveNext.config.models.find((model) =>
          modelRefsEqual(
            model.ref ?? { groupId: model.groupId ?? "", name: model.name },
            effectiveNext.config.activeModel,
          ),
        );
        const configAgentMode = (effectiveNext.config.agentMode ?? "agent") as DesktopAgentMode;
        // While a turn is in flight, poll may still carry the old config.agentMode; do not overwrite the optimistic agentMode set by saveSettingsPatch after the user dismissed the Chip.
        const turnInFlight =
          effectiveNext.conversation.isBusy === true || busyActionRef.current === "send";
        const chipDismissed = agentModeChipDismissedRef.current;
        let agentMode: DesktopAgentMode =
          turnInFlight && current.agentMode !== configAgentMode
            ? current.agentMode
            : configAgentMode;
        // After saveSettingsPatch's optimistic update, while the poll snapshot has not caught up, do not overwrite the local chip mode.
        if (
          !chipDismissed &&
          isAgentModeChipKind(current.agentMode) &&
          current.agentMode !== configAgentMode
        ) {
          agentMode = current.agentMode;
        }
        // After the user removed the chip with Backspace, poll must not set settings.agentMode back to ask/plan (otherwise the agentMode effect would re-insert the chip).
        if (chipDismissed && isAgentModeChipKind(agentMode)) {
          agentMode = "agent";
        }

        const snapshotTranslucency = parseTranslucencyPreference(next.config.translucency);
        const translucency =
          translucencyInFlightRef.current > 0 && current.translucency !== snapshotTranslucency
            ? current.translucency
            : snapshotTranslucency;

        return {
          activeModel: effectiveNext.config.activeModel,
          imageGenerationModel: effectiveNext.config.imageGenerationModel,
          videoGenerationModel: effectiveNext.config.videoGenerationModel,
          lightweightChatModel: effectiveNext.config.lightweightChatModel,
          apiBase: activeModelProfile?.apiBase ?? current.apiBase,
          uiLocale: next.config.uiLocale ?? getStoredLanguagePreference(),
          apiKey: current.apiKey,
          translucency,
          systemNotifications: next.config.systemNotifications !== false,
          trayIcon: next.config.trayIcon !== false,
          onboardingCompleted: next.config.onboardingCompleted === true,
          agentMode,
          webHostEnabled: next.webHost.config.enabled,
          webHostHost: next.webHost.config.host,
          webHostPort: next.webHost.config.port,
          dreamEnabled: next.dreams.settings.enabled,
          dreamDebugMode: next.dreams.settings.debugMode,
          lspEnabled: next.lsp.userEnabled,
          codeCompletionEnabled: next.codeCompletion.userEnabled,
          commitAttributionEnabled: next.attribution.commitEnabled,
          prAttributionEnabled: next.attribution.prEnabled,
          llmHttpVersion: next.config.networks.llmHttpVersion,
        };
      });
    },
    [],
  );

  const reapplySessionPathAliases = useCallback(() => {
    const follow = followSessionPathAlias;
    setSnapshot((current) =>
      current ? applySessionPathAliasesToSnapshot(current, follow) : current,
    );
    setComposerSegments((current) => followQuoteSessionPathsInSegments(current, follow));
  }, []);

  const acknowledgeSessionAttention = useCallback((path: string) => {
    setUnseenCompletedSessionPaths((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const applySessionList = useCallback((list: SessionListItem[]) => {
    const prev = sessionsBusySnapshotRef.current;
    const nextBusy = new Map<string, boolean>();
    const newlyCompleted: string[] = [];

    for (const session of list) {
      const wasBusy = prev.get(session.path) === true;
      const nowBusy = session.isBusy === true;
      nextBusy.set(session.path, nowBusy);
      if (wasBusy && !nowBusy && !session.isActive && !session.isBlocked) {
        newlyCompleted.push(session.path);
      }
    }
    sessionsBusySnapshotRef.current = nextBusy;

    if (newlyCompleted.length > 0) {
      setUnseenCompletedSessionPaths((current) => {
        const next = new Set(current);
        for (const path of newlyCompleted) {
          next.add(path);
        }
        return next;
      });
    }

    setSessions(list);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const list = await api.listSessions();
      applySessionList(list);
    } catch {
      sessionsBusySnapshotRef.current = new Map();
      setSessions([]);
    }
  }, [api, applySessionList]);

  const listDreamsOverview = useCallback(async (): Promise<DesktopDreamOverviewItem[]> => {
    if (!api) {
      return [];
    }
    return api.listDreamsOverview();
  }, [api]);

  const listAutomations = useCallback(async (): Promise<DesktopAutomationListItem[]> => {
    if (!api) {
      return [];
    }
    return api.listAutomations();
  }, [api]);

  const getAutomation = useCallback(
    async (automationId: string): Promise<DesktopAutomationDetail | undefined> => {
      if (!api) {
        return undefined;
      }
      return api.getAutomation(automationId);
    },
    [api],
  );

  const createAutomation = useCallback(
    async (request: DesktopCreateAutomationRequest) => {
      if (!api) {
        return;
      }
      setBusyAction("automation");
      try {
        const next = await api.createAutomation(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateAutomation = useCallback(
    async (automationId: string, patch: DesktopUpdateAutomationRequest) => {
      if (!api) {
        return;
      }
      setBusyAction("automation");
      try {
        const next = await api.updateAutomation(automationId, patch);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteAutomation = useCallback(
    async (automationId: string) => {
      if (!api) {
        return;
      }
      setBusyAction("automation");
      try {
        const next = await api.deleteAutomation(automationId);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const setAutomationEnabled = useCallback(
    async (automationId: string, enabled: boolean) => {
      if (!api) {
        return;
      }
      setBusyAction("automation");
      try {
        const next = await api.setAutomationEnabled(automationId, enabled);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const bootstrap = useCallback(
    async (request?: BootstrapRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("bootstrap");
      try {
        const next = await api.bootstrap(request);
        if (isRemoteWebHostClient(api.kind)) {
          syncWebViewingSessionPath(next.activeSession?.filePath);
        }
        applySnapshot(next);
        restoreSessionUi(next);
        setRuntimeError("");
        setWebHostPairingRequired(false);
        void refreshSessions();
      } catch (error) {
        setWebHostPairingRequired(errorCode(error) === "PAIRING_REQUIRED");
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions, restoreSessionUi, syncWebViewingSessionPath],
  );

  const switchWorkspaceRoot = useCallback(
    async (workspaceRoot: string): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("bootstrap");
      try {
        stashSessionUi(snapshotRef.current);
        const next = await api.bootstrap({ workspaceRoot, workspaceBinding: "project" });
        applySnapshot(next);
        restoreSessionUi(next);
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi],
  );

  const switchToNoWorkspaceBinding = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("bootstrap");
    try {
      stashSessionUi(snapshotRef.current);
      const next = await api.bootstrap({ workspaceBinding: "none" });
      applySnapshot(next);
      restoreSessionUi(next);
      setQuestionError("");
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi]);

  const switchPaneWorkspace = useCallback(
    async (sessionPath: string, workspaceRoot: string): Promise<boolean> => {
      if (!api?.switchPaneWorkspace) {
        return false;
      }

      setPaneWorkspaceBusySessionPath(normalizePaneSessionPathKey(sessionPath));
      try {
        const next = await api.switchPaneWorkspace({
          sessionPath,
          workspaceRoot,
          workspaceBinding: "project",
        });
        applySnapshot(next, { fromPaneWorkspaceSwitch: true });
        setQuestionError("");
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setPaneWorkspaceBusySessionPath(null);
      }
    },
    [api, applySnapshot],
  );

  const switchPaneModel = useCallback(
    async (sessionPath: string, modelRef: ModelRef): Promise<boolean> => {
      if (!api?.switchPaneModel) {
        return false;
      }

      try {
        const next = await api.switchPaneModel({ sessionPath, modelRef });
        applySnapshot(next);
        setQuestionError("");
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const setPanePendingGitBranch = useCallback(
    async (sessionPath: string, branch: string): Promise<boolean> => {
      if (!api?.setPanePendingGitBranch) {
        return false;
      }

      try {
        const next = await api.setPanePendingGitBranch({ sessionPath, branch });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const setPaneWorkLocation = useCallback(
    async (sessionPath: string, workLocation: WorkLocationKind): Promise<boolean> => {
      if (!api?.setPaneWorkLocation) {
        return false;
      }

      try {
        const next = await api.setPaneWorkLocation({ sessionPath, workLocation });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const switchPaneToNoWorkspaceBinding = useCallback(
    async (sessionPath: string): Promise<boolean> => {
      if (!api?.switchPaneWorkspace) {
        return false;
      }

      setPaneWorkspaceBusySessionPath(normalizePaneSessionPathKey(sessionPath));
      try {
        const next = await api.switchPaneWorkspace({
          sessionPath,
          workspaceBinding: "none",
        });
        applySnapshot(next, { fromPaneWorkspaceSwitch: true });
        setQuestionError("");
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setPaneWorkspaceBusySessionPath(null);
      }
    },
    [api, applySnapshot],
  );

  const rememberWorkspaceRoot = useCallback(
    async (workspaceRoot: string): Promise<boolean> => {
      if (!api?.rememberWorkspaceRoot) {
        setRuntimeError(i18n.t("error.hostNotSupportAddWorkspace"));
        return false;
      }

      setBusyAction("bootstrap");
      try {
        const next = await api.rememberWorkspaceRoot({ workspaceRoot });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const pickWorkspaceDirectory = useCallback(async (): Promise<string | null> => {
    if (!api?.pickWorkspaceDirectory) {
      setRuntimeError(i18n.t("error.hostNotSupportPickWorkspace"));
      return null;
    }

    try {
      return await api.pickWorkspaceDirectory();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const pickLocalFile = useCallback(async (): Promise<string[] | null> => {
    if (!api?.pickLocalFile) {
      setRuntimeError(i18n.t("error.hostNotSupportPickFile"));
      return null;
    }

    try {
      return await api.pickLocalFile();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const classifyLocalFileComposerRoute = useCallback(
    async (absolutePath: string): Promise<LocalFileComposerRoute> => {
      if (!api) {
        return "reference";
      }
      try {
        return await api.classifyLocalFileComposerRoute(absolutePath);
      } catch (error) {
        setRuntimeError(describeError(error));
        return "reference";
      }
    },
    [api],
  );

  const getPathForDroppedFile = useCallback(
    (file: File): string | null => {
      if (!api?.getPathForDroppedFile) {
        return null;
      }
      try {
        const path = api.getPathForDroppedFile(file);
        return path.trim() ? path : null;
      } catch {
        return null;
      }
    },
    [api],
  );

  const ingestClipboardImage = useCallback(async (): Promise<string | null> => {
    if (!api?.ingestClipboardImage) {
      return null;
    }

    try {
      return await api.ingestClipboardImage();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const readLocalImagePreviewDataUrl = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (!api?.readLocalImagePreviewDataUrl) {
        return null;
      }

      try {
        return await api.readLocalImagePreviewDataUrl(filePath);
      } catch {
        return null;
      }
    },
    [api],
  );

  const readManagedImagePreviewDataUrl = useCallback(
    async (reference: string): Promise<string | null> => {
      if (!api?.readManagedImagePreviewDataUrl) {
        return null;
      }

      try {
        return await api.readManagedImagePreviewDataUrl(reference);
      } catch {
        return null;
      }
    },
    [api],
  );

  const saveLocalImageAs = useCallback(
    async (filePath: string): Promise<boolean> => {
      if (!api?.saveLocalImageAs) {
        setRuntimeError(i18n.t("error.hostNotSupportSaveImage"));
        return false;
      }

      try {
        return await api.saveLocalImageAs(filePath);
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api],
  );

  const readLocalVideoPreviewUrl = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (!api?.readLocalVideoPreviewUrl) {
        return null;
      }

      try {
        return await api.readLocalVideoPreviewUrl(filePath);
      } catch {
        return null;
      }
    },
    [api],
  );

  const readManagedVideoPreviewUrl = useCallback(
    async (reference: string): Promise<string | null> => {
      if (!api?.readManagedVideoPreviewUrl) {
        return null;
      }

      try {
        return await api.readManagedVideoPreviewUrl(reference);
      } catch {
        return null;
      }
    },
    [api],
  );

  const commitChanges = useCallback(
    async (request: CommitChangesRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("git");
      try {
        const next = await api.commitChanges(request);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const pairWebHost = useCallback(
    async (code: string): Promise<boolean> => {
      if (!api?.pairWebHost) {
        setRuntimeError(i18n.t("error.hostNotSupportWebPair"));
        return false;
      }

      setBusyAction("bootstrap");
      try {
        await api.pairWebHost(code);
        setWebHostPairingRequired(false);
        setRuntimeError("");
        await bootstrap();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, bootstrap],
  );

  useEffect(() => {
    if (api && hostReady) {
      void refreshSessions();
    }
  }, [api, hostReady, refreshSessions]);

  const pendingQuestions = snapshot?.conversation.pendingQuestions ?? null;

  useEffect(() => {
    if (!pendingQuestions) {
      setQuestionError("");
      setQuestionDrafts({});
      return;
    }

    setQuestionError("");
    setQuestionDrafts((current) => {
      const next: Record<string, QuestionDraft> = {};
      for (const question of pendingQuestions.request.questions) {
        next[question.id] = current[question.id] ?? emptyQuestionDraft();
      }
      return next;
    });
  }, [pendingQuestions]);

  /**
   * Remote Web clients only: poll for snapshots at a fixed interval while busy (turn advancement is driven by the host pump; poll no longer drives the runtime).
   * Under Electron, streaming updates all go through host-throttled pushes (subscribeDreamUpdates), with no poll loop.
   */
  useEffect(() => {
    if (!api || !isRemoteWebHostClient(api.kind) || snapshot?.conversation.isBusy !== true) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        while (true) {
          if (cancelled) {
            break;
          }
          const pollRequest = webPollRequestForSnapshot(
            api.kind,
            snapshotRef.current,
            webViewingSessionPathRef.current,
          );
          const next = await api.poll(pollRequest);
          if (cancelled) {
            break;
          }
          applySnapshot(next);
          if (next.conversation.isBusy !== true) {
            const sessionItems = await api.listSessions();
            if (cancelled) {
              break;
            }
            applySessionList(sessionItems);
            const stillBusy = sessionItems.some((session) => session.isBusy === true);
            if (!stillBusy) {
              break;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, WEB_BUSY_POLL_INTERVAL_MS));
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(describeError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, applySessionList, applySnapshot, snapshot?.conversation.isBusy]);

  useEffect(() => {
    if (!api?.subscribeDreamUpdates) {
      return;
    }

    // A delta that cannot be applied (stale base revision after renderer-side skips, fresh
    // bootstrap still in flight, …) must trigger exactly one full-snapshot resync.
    let resyncInFlight = false;
    const resyncFromFullSnapshot = () => {
      if (resyncInFlight) {
        return;
      }
      resyncInFlight = true;
      void api
        .poll()
        .then((full) => {
          applySnapshot(full);
        })
        .catch(() => {
          // The next delta failure retries the resync.
        })
        .finally(() => {
          resyncInFlight = false;
        });
    };

    return api.subscribeDreamUpdates((update) => {
      let next: DesktopSnapshot | undefined;
      if (update.kind === "conversation-delta") {
        next = applyConversationDelta(snapshotRef.current ?? undefined, update);
        if (!next) {
          resyncFromFullSnapshot();
          return;
        }
      } else {
        next = update.snapshot;
      }
      const previous = snapshotRef.current;
      const prevPath = previous?.activeSession?.filePath;
      const nextPath = next.activeSession?.filePath;
      const blockForegroundSwap =
        api.kind === "electron" &&
        Boolean(prevPath) &&
        Boolean(nextPath) &&
        prevPath !== nextPath &&
        busyActionRef.current !== "session" &&
        prevPath &&
        nextPath &&
        !isProvisionalSessionPromotion(prevPath, nextPath);
      if (blockForegroundSwap && previous) {
        applySnapshot({
          ...next,
          activeSession: previous.activeSession!,
          conversation: previous.conversation,
          composerSessionKey: previous.composerSessionKey,
        });
      } else {
        applySnapshot(next);
      }
      const needRefreshSessions = previous ? shouldRefreshDreamSessions(previous, next) : false;
      if (needRefreshSessions) {
        void refreshSessions();
      }
    });
  }, [api, applySnapshot, refreshSessions]);

  useEffect(() => {
    if (!api?.subscribeAutomationsUpdates) {
      return;
    }

    return api.subscribeAutomationsUpdates((next) => {
      applySnapshot(next);
      void refreshSessions();
    });
  }, [api, applySnapshot, refreshSessions]);

  useEffect(() => {
    if (!api?.subscribeSessionListUpdates) {
      return;
    }

    return api.subscribeSessionListUpdates(() => {
      void refreshSessions();
    });
  }, [api, refreshSessions]);

  useEffect(() => {
    if (!api || !snapshot || snapshot.conversation.isBusy || !snapshot.dreams.settings.enabled) {
      return;
    }
    if (api.subscribeDreamUpdates) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollDreams = async () => {
      try {
        const pollRequest = webPollRequestForSnapshot(
          api.kind,
          snapshotRef.current,
          webViewingSessionPathRef.current,
        );
        const next = await api.poll(pollRequest);
        if (cancelled) {
          return;
        }
        const needRefreshSessions = shouldRefreshDreamSessions(snapshot, next);
        applySnapshot(next);
        if (needRefreshSessions) {
          void refreshSessions();
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(describeError(error));
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollDreams, DREAM_IDLE_POLL_INTERVAL_MS);
        }
      }
    };

    timer = setTimeout(pollDreams, DREAM_IDLE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [api, applySnapshot, refreshSessions, snapshot]);

  useEffect(() => {
    if (!api?.refreshGitSnapshot) {
      return;
    }
    if (!snapshot || snapshot.workspaceBinding !== "project" || !snapshot.git.isRepository) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      if (inFlight) {
        timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        return;
      }

      inFlight = true;
      try {
        const next = await api.refreshGitSnapshot();
        if (!cancelled) {
          applySnapshot(next);
        }
      } catch {
        // Background polling failures do not interrupt the main flow; Git APIs triggered by user actions still surface errors.
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        }
      }
    };

    timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    api,
    applySnapshot,
    snapshot?.workspaceBinding,
    snapshot?.git.isRepository,
    snapshot?.workspaceRoot,
  ]);

  const updateQuestionDraft = useCallback(
    (questionId: string, updater: (draft: QuestionDraft) => QuestionDraft) => {
      setQuestionError("");
      setQuestionDrafts((current) => ({
        ...current,
        [questionId]: updater(current[questionId] ?? emptyQuestionDraft()),
      }));
    },
    [],
  );

  const setActiveModel = useCallback(
    (modelRef: ModelRef) => {
      if (!snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) =>
        modelRefsEqual(item.ref ?? { groupId: item.groupId ?? "", name: item.name }, modelRef),
      );
      const current = settingsRef.current;
      const next: typeof settings = {
        ...current,
        activeModel: modelRef,
        apiBase: model?.apiBase ?? current.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      if (!api) {
        return;
      }

      void (async () => {
        try {
          const res = await api.updateConfig(
            updateConfigFromSettingsForm(next, {
              enabled: next.webHostEnabled,
              host: next.webHostHost,
              port: next.webHostPort,
            }),
          );
          applySnapshot(res);
          setRuntimeError("");
          setSettings((c) => ({ ...c, apiKey: "" }));
        } catch (error) {
          setRuntimeError(describeError(error));
        }
      })();
    },
    [api, applySnapshot, snapshot],
  );

  const addModel = useCallback(
    async (request: AddModelRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.addModel(request);
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const addProviderModels = useCallback(
    async (request: AddProviderModelsRequest) => {
      if (!api) {
        return;
      }
      setBusyAction("models");
      try {
        const next = await api.addProviderModels(request);
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const previewModels = useCallback(
    async (request: PreviewModelsRequest): Promise<PreviewModelsResponse> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      setBusyAction("modelsPreview");
      try {
        setRuntimeError("");
        return await api.previewModels(request);
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const removeModel = useCallback(
    async (name: string) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.removeModel(name);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const removeProviderModels = useCallback(
    async (groupId: string) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.removeProviderGroup({ groupId });
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const createSkill = useCallback(
    async (request: CreateSkillRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("skills");
      try {
        const next = await api.createSkill(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteSkill = useCallback(
    async (request: DeleteSkillRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("skills");
      try {
        const next = await api.deleteSkill(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const createRule = useCallback(
    async (request: CreateRuleRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("rules");
      try {
        const next = await api.createRule(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteRule = useCallback(
    async (request: DeleteRuleRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("rules");
      try {
        const next = await api.deleteRule(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const addMcpServer = useCallback(
    async (request: AddMcpServerRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("mcps");
      try {
        const next = await api.addMcpServer(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteMcpServer = useCallback(
    async (request: DeleteMcpServerRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("mcps");
      try {
        const next = await api.deleteMcpServer(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const saveHookEntry = useCallback(
    async (request: SaveHookEntryRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("hooks");
      try {
        const next = await api.saveHookEntry(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteHookEntry = useCallback(
    async (request: DeleteHookEntryRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("hooks");
      try {
        const next = await api.deleteHookEntry(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const inspectMcpServer = useCallback(
    async (name: string): Promise<DesktopMcpServerInspection> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.inspectMcpServer(name);
    },
    [api],
  );

  const importExtension = useCallback(
    async (request: ImportExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensionsImport");
      try {
        const next = await api.importExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const installBuiltInExtension = useCallback(
    async (request: InstallBuiltInExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.installBuiltInExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const addMarketplaceSource = useCallback(
    async (request: AddMarketplaceSourceRequest): Promise<{ sourceId: string }> => {
      if (!api) {
        throw new Error("runtime not ready");
      }

      setBusyAction("extensions");
      try {
        const result = await api.addMarketplaceSource(request);
        applySnapshot(result.snapshot);
        setRuntimeError("");
        return { sourceId: result.sourceId ?? "" };
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const removeMarketplaceSource = useCallback(
    async (request: RemoveMarketplaceSourceRequest) => {
      if (!api) {
        throw new Error("runtime not ready");
      }

      setBusyAction("extensions");
      try {
        const next = await api.removeMarketplaceSource(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const installMarketplaceExtension = useCallback(
    async (
      request: InstallMarketplaceExtensionRequest,
    ): Promise<DesktopMarketplaceInstallResult> => {
      if (!api) {
        throw new Error("runtime not ready");
      }

      setBusyAction("extensions");
      try {
        const result = await api.installMarketplaceExtension(request);
        if (result.status === "installed") {
          applySnapshot(result.snapshot);
          setRuntimeError("");
          return { status: "installed" };
        }
        return {
          status: "review-required",
          extensionId: result.extensionId,
          reviewStatus: result.reviewStatus,
        };
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateExtension = useCallback(
    async (request: UpdateExtensionRequest): Promise<DesktopMarketplaceUpdateResult> => {
      if (!api) {
        throw new Error("runtime not ready");
      }

      setBusyAction("extensions");
      try {
        const result = await api.updateExtension(request);
        if (result.status === "updated") {
          applySnapshot(result.snapshot);
          setRuntimeError("");
          return { status: "updated" };
        }
        if (result.status === "up-to-date") {
          return { status: "up-to-date" };
        }
        return {
          status: "review-required",
          extensionId: result.extensionId,
          reviewStatus: result.reviewStatus,
        };
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteExtension = useCallback(
    async (request: DeleteExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.deleteExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const setExtensionEnabled = useCallback(
    async (request: SetExtensionEnabledRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.setExtensionEnabled(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const runExtension = useCallback(
    async (request: RunExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.runExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateExtensionSettings = useCallback(
    async (request: UpdateExtensionSettingsRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.updateExtensionSettings(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateExtensionSecret = useCallback(
    async (request: UpdateExtensionSecretRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.updateExtensionSecret(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message, { cause: error });
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const saveSettingsPatch = useCallback(
    async (patch: Partial<SettingsFormState>) => {
      const translucencyPatch = patch.translucency !== undefined;
      let translucencySeq = 0;
      if (translucencyPatch) {
        translucencySaveSeqRef.current += 1;
        translucencySeq = translucencySaveSeqRef.current;
        translucencyInFlightRef.current += 1;
      }

      const prev = settingsRef.current;
      const nextActiveModel = patch.activeModel ?? prev.activeModel;
      const resolvedApiBase =
        patch.apiBase ??
        (patch.activeModel !== undefined
          ? (snapshotRef.current?.config.models.find((model) =>
              modelRefsEqual(
                model.ref ?? { groupId: model.groupId ?? "", name: model.name },
                nextActiveModel,
              ),
            )?.apiBase ?? prev.apiBase)
          : prev.apiBase);
      const s = {
        ...prev,
        ...patch,
        activeModel: nextActiveModel,
        apiBase: resolvedApiBase,
      };
      settingsRef.current = s;
      setSettings(s);

      if (!api) {
        pendingSettingsPatchRef.current = { ...pendingSettingsPatchRef.current, ...patch };
        if (translucencyPatch) {
          translucencyInFlightRef.current -= 1;
        }
        return;
      }

      const webHostEndpointChanged =
        s.webHostHost !== prev.webHostHost || s.webHostPort !== prev.webHostPort;
      try {
        const next = await api.updateConfig(
          updateConfigFromSettingsForm(s, {
            enabled: s.webHostEnabled,
            host: s.webHostHost,
            port: s.webHostPort,
            ...(webHostEndpointChanged ? { resetPairing: true } : {}),
          }),
        );
        const staleTranslucencySave =
          translucencyPatch && translucencySeq < translucencySaveSeqRef.current;
        if (!staleTranslucencySave) {
          applySnapshot(next);
        }
        setRuntimeError("");
        setSettings((current) => ({
          ...current,
          apiKey: "",
        }));
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        if (translucencyPatch) {
          translucencyInFlightRef.current -= 1;
        }
      }
    },
    [api, applySnapshot],
  );

  useEffect(() => {
    if (!api || snapshot) {
      return;
    }

    void (async () => {
      await bootstrap();
      const pending = pendingSettingsPatchRef.current;
      if (Object.keys(pending).length === 0) {
        return;
      }
      pendingSettingsPatchRef.current = {};
      await saveSettingsPatch(pending);
    })();
  }, [api, bootstrap, saveSettingsPatch, snapshot]);

  const setModelReasoningEffort = useCallback(
    async (modelRef: ModelRef, reasoningEffort: DesktopModelReasoningEffort) => {
      if (!api || !snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) =>
        modelRefsEqual(item.ref ?? { groupId: item.groupId ?? "", name: item.name }, modelRef),
      );
      if (!model) {
        return;
      }

      const next = {
        ...settingsRef.current,
        activeModel: modelRef,
        apiBase: model.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      try {
        const res = await api.updateConfig({
          ...updateConfigFromSettingsForm(next, {
            enabled: next.webHostEnabled,
            host: next.webHostHost,
            port: next.webHostPort,
          }),
          reasoningEffort,
        });
        applySnapshot(res);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        setRuntimeError(describeError(error));
      }
    },
    [api, applySnapshot, snapshot],
  );

  const setModelReasoningMode = useCallback(
    async (modelRef: ModelRef, reasoningMode: DesktopModelReasoningMode) => {
      if (!api || !snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) =>
        modelRefsEqual(item.ref ?? { groupId: item.groupId ?? "", name: item.name }, modelRef),
      );
      if (!model) {
        return;
      }

      const next = {
        ...settingsRef.current,
        activeModel: modelRef,
        apiBase: model.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      try {
        const res = await api.updateConfig({
          ...updateConfigFromSettingsForm(next, {
            enabled: next.webHostEnabled,
            host: next.webHostHost,
            port: next.webHostPort,
          }),
          reasoningMode,
        });
        applySnapshot(res);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        setRuntimeError(describeError(error));
      }
    },
    [api, applySnapshot, snapshot],
  );

  const setModelThinkingEnabled = useCallback(
    async (modelRef: ModelRef, enabled: boolean): Promise<boolean> => {
      if (!api || !snapshot) {
        return false;
      }

      const model = snapshot.config.models.find((item) =>
        modelRefsEqual(item.ref ?? { groupId: item.groupId ?? "", name: item.name }, modelRef),
      );
      if (!model) {
        return false;
      }

      const previousSettings = settingsRef.current;
      const next = {
        ...previousSettings,
        activeModel: modelRef,
        apiBase: model.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      try {
        const res = await api.updateConfig({
          ...updateConfigFromSettingsForm(next, {
            enabled: next.webHostEnabled,
            host: next.webHostHost,
            port: next.webHostPort,
          }),
          thinkingEnabled: enabled,
        });
        applySnapshot(res);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
        return true;
      } catch (error) {
        settingsRef.current = previousSettings;
        setSettings(previousSettings);
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot, snapshot],
  );

  const resetWebHostPairing = useCallback(async () => {
    if (!api) {
      return;
    }

    const s = settingsRef.current;
    try {
      const next = await api.updateConfig(
        updateConfigFromSettingsForm(s, {
          enabled: s.webHostEnabled,
          host: s.webHostHost,
          port: s.webHostPort,
          resetPairing: true,
        }),
      );
      applySnapshot(next);
      setRuntimeError("");
      setSettings((current) => ({
        ...current,
        apiKey: "",
      }));
    } catch (error) {
      setRuntimeError(describeError(error));
    }
  }, [api, applySnapshot]);

  const sendMessage = useCallback(
    async (request: SubmitUserTurnRequest = { text: composer }) => {
      if (!api) {
        return false;
      }

      const localFilePaths = request.localFilePaths ?? [];
      const referencedWorkspaceFilePaths = request.referencedWorkspaceFilePaths ?? [];
      const skillChipAliases = request.skillChipAliases ?? [];
      const hasLocalFiles = localFilePaths.length > 0;
      const hasReferencedPaths = referencedWorkspaceFilePaths.length > 0;
      const text = request.text.trim();
      if (!text && !hasLocalFiles && !hasReferencedPaths) {
        return false;
      }
      if (isExportSessionSlashInput(text)) {
        if (hasLocalFiles) {
          setRuntimeError(i18n.t("error.attachmentsNotSupportedWithSlash"));
          return false;
        }
        if (!api.exportSession) {
          setRuntimeError(i18n.t("error.hostNotSupportExportSession"));
          return false;
        }

        setBusyAction("send");
        try {
          const next = await api.exportSession();
          applySnapshot(next);
          resetComposerAfterSend(settingsRef.current.agentMode);
          setRuntimeError("");
          void refreshSessions();
          return true;
        } catch (error) {
          setRuntimeError(describeError(error));
          return false;
        } finally {
          setBusyAction("");
        }
      }
      if (isCompactSlashComposerRequest(text, skillChipAliases)) {
        if (hasLocalFiles) {
          setRuntimeError(i18n.t("error.attachmentsNotSupportedWithSlash"));
          return false;
        }

        setBusyAction("send");
        try {
          const next = await api.compactHistory();
          applySnapshot(next);
          resetComposerAfterSend(settingsRef.current.agentMode);
          setRuntimeError("");
          void refreshSessions();
          return true;
        } catch (error) {
          setRuntimeError(describeError(error));
          return false;
        } finally {
          setBusyAction("");
        }
      }
      const targetSessionPath =
        request.sessionPath?.trim() ??
        (isRemoteWebHostClient(api.kind)
          ? webViewingSessionPathRef.current.trim() || webViewingSessionPath.trim()
          : undefined);
      if (isRemoteWebHostClient(api.kind) && !targetSessionPath) {
        return false;
      }
      const effectiveSnapshot =
        targetSessionPath && snapshot
          ? resolvePaneDesktopSnapshot(snapshot, targetSessionPath)
          : snapshot;

      if (effectiveSnapshot?.activeSession?.readOnly) {
        setRuntimeError(i18n.t("error.readonlySessionSend"));
        return false;
      }

      const canEnqueueWhileBusy =
        effectiveSnapshot?.conversation.isBusy === true &&
        !effectiveSnapshot.conversation.pendingToolApproval &&
        !effectiveSnapshot.conversation.pendingQuestions;
      if (effectiveSnapshot?.conversation.isBusy && !canEnqueueWhileBusy) {
        setRuntimeError(i18n.t("error.pendingApprovalSend"));
        return false;
      }

      const paneSendKey = targetSessionPath ? normalizePaneSessionPathKey(targetSessionPath) : null;
      if (paneSendKey) {
        setPaneSendBusySessionPath(paneSendKey);
      } else {
        setBusyAction("send");
      }
      try {
        if (hasLocalFiles && skillChipAliases.length > 0) {
          setRuntimeError(i18n.t("error.attachmentsNotSupportedWithSlash"));
          return false;
        }
        const next = await api.submitUserTurn({
          text: request.text,
          ...(hasLocalFiles ? { localFilePaths } : {}),
          ...(hasReferencedPaths ? { referencedWorkspaceFilePaths } : {}),
          ...(skillChipAliases.length > 0 ? { skillChipAliases } : {}),
          ...(request.chipNavigateMeta?.length
            ? { chipNavigateMeta: request.chipNavigateMeta }
            : {}),
          ...(targetSessionPath ? { sessionPath: targetSessionPath } : {}),
        });
        if (isRemoteWebHostClient(api.kind)) {
          syncWebViewingSessionPath(next.activeSession?.filePath ?? targetSessionPath);
        }
        applySnapshot(next);
        if (!targetSessionPath) {
          resetComposerAfterSend(settingsRef.current.agentMode, {
            loopEnabled: next.conversation.loopEnabled === true,
          });
        }
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        if (paneSendKey) {
          setPaneSendBusySessionPath(null);
        } else {
          setBusyAction("");
        }
      }
    },
    [api, applySnapshot, resetComposerAfterSend, composer, refreshSessions, snapshot],
  );

  const submitGitChip = useCallback(
    async (request: SubmitGitChipRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        setBusyAction("send");
        const next = await api.submitGitChip(request);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const submitStartImplementing = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      // Host switches to agent before the turn; exit chip mode locally so applySnapshot
      // turn-in-flight / chip-preserve guards do not keep plan across the busy window.
      agentModeChipDismissedRef.current = true;
      setAgentModeChipDismissed(true);
      const prevSettings = settingsRef.current;
      const agentSettings = { ...prevSettings, agentMode: "agent" as DesktopAgentMode };
      settingsRef.current = agentSettings;
      setSettings(agentSettings);
      setBusyAction("send");
      const next = await api.submitStartImplementing();
      applySnapshot(next);
      resetComposerAfterSend("agent");
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, resetComposerAfterSend, refreshSessions]);

  const abortConversation = useCallback(
    async (request?: AbortConversationRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        const next = await api.abortConversation(request);
        applySnapshot(next);
        setRuntimeError("");
        const targetSessionPath = request?.sessionPath?.trim();
        const targetBusy = targetSessionPath
          ? resolvePaneDesktopSnapshot(next, targetSessionPath)?.conversation.isBusy === true
          : next.conversation.isBusy;
        if (!targetBusy) {
          void refreshSessions();
        }
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const abortShell = useCallback(
    async (toolCallId: string): Promise<boolean> => {
      if (!api?.abortShell) {
        return false;
      }

      const trimmed = toolCallId.trim();
      if (!trimmed) {
        return false;
      }

      try {
        const next = await api.abortShell(trimmed);
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const setLoopEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        const next = await api.setLoopEnabled(enabled);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const setSubagentViewerTarget = useCallback(
    async (parentToolCallId: string | null): Promise<boolean> => {
      if (!api?.setSubagentViewerTarget) {
        return false;
      }

      try {
        const next = await api.setSubagentViewerTarget(parentToolCallId);
        applySnapshot(next);
        setRuntimeError("");
        if (!parentToolCallId?.trim()) {
          return true;
        }
        const trimmed = parentToolCallId.trim();
        return (
          Boolean(next.subagentViewer) ||
          isSubagentToolCallPending(next.conversation.messages, trimmed)
        );
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const setApprovalLevel = useCallback(
    async (approvalLevel: ApprovalLevel): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        const next = await api.setApprovalLevel(approvalLevel);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const setPendingGitBranch = useCallback(
    async (branch: string): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        const next = await api.setPendingGitBranch(branch);
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const setWorkLocation = useCallback(
    async (workLocation: WorkLocationKind): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        const next = await api.setWorkLocation(workLocation);
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api, applySnapshot],
  );

  const checkoutGitBranch = useCallback(
    async (
      branch: string,
      options?: { discardLocalChanges?: boolean },
    ): Promise<CheckoutGitBranchResult> => {
      if (!api) {
        return { ok: false, reason: "error" };
      }

      setBusyAction("git");
      try {
        const next = await api.checkoutGitBranch({
          branch,
          discardLocalChanges: options?.discardLocalChanges === true,
        });
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return { ok: true };
      } catch (error) {
        if (isCheckoutBlockedByLocalChanges(error)) {
          return { ok: false, reason: "local-changes" };
        }
        setRuntimeError(sanitizeGitErrorMessage(error));
        return { ok: false, reason: "error" };
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const checkoutPaneGitBranch = useCallback(
    async (
      sessionPath: string,
      branch: string,
      options?: { discardLocalChanges?: boolean },
    ): Promise<CheckoutGitBranchResult> => {
      if (!api?.checkoutPaneGitBranch) {
        return { ok: false, reason: "error" };
      }

      setBusyAction("git");
      try {
        const next = await api.checkoutPaneGitBranch({
          sessionPath,
          branch,
          discardLocalChanges: options?.discardLocalChanges === true,
        });
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return { ok: true };
      } catch (error) {
        if (isCheckoutBlockedByLocalChanges(error)) {
          return { ok: false, reason: "local-changes" };
        }
        setRuntimeError(sanitizeGitErrorMessage(error));
        return { ok: false, reason: "error" };
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const mergeWorktreeToMain = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("git");
    try {
      const next = await api.mergeWorktreeToMain();
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(sanitizeGitErrorMessage(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const pushGitBranch = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("git");
    try {
      const next = await api.pushGitBranch();
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(sanitizeGitErrorMessage(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const continueAssistantCompletion = useCallback(
    async (messageId: number): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("continue");
      try {
        const next = await api.continueAssistantCompletion(messageId);
        applySnapshot(next);
        setRuntimeError("");
        if (!next.conversation.isBusy) {
          void refreshSessions();
        }
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const reorderQueuedUserTurn = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction("send");
      try {
        const next = await api.reorderQueuedUserTurn({ queueId });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const sendQueuedUserTurnNow = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction("send");
      try {
        const next = await api.sendQueuedUserTurnNow({ queueId });
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const removeQueuedUserTurn = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction("send");
      try {
        const next = await api.removeQueuedUserTurn({ queueId });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const rewindAndSubmitMessage = useCallback(
    async (request: RewindAndSubmitMessageRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("rewind");
      try {
        const next = await api.rewindAndSubmitMessage(request);
        applySnapshot(next);
        resetComposerAfterSend(settingsRef.current.agentMode);
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, resetComposerAfterSend, refreshSessions],
  );

  const forkSession = useCallback(
    async (request: ForkSessionRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("fork");
      try {
        const next = await api.forkSession(request);
        applySnapshot(next);
        resetComposerAfterSend(settingsRef.current.agentMode);
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, resetComposerAfterSend, refreshSessions],
  );

  const beginSideChatPaneSession = useCallback(
    async (paneId: string): Promise<BeginSideChatPaneSessionResponse> => {
      if (!api?.beginSideChatPaneSession) {
        throw new Error("Host does not support side-chat pane sessions.");
      }
      const response = await api.beginSideChatPaneSession({ paneId });
      setRuntimeError("");
      return response;
    },
    [api],
  );

  const forkSessionIntoSideChat = useCallback(
    async (request: ForkSessionIntoSideChatRequest): Promise<boolean> => {
      if (!api?.forkSessionIntoSideChat) {
        return false;
      }

      setBusyAction("side-chat");
      try {
        const next = await api.forkSessionIntoSideChat(request);
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const submitApproval = useCallback(
    async (decision: DesktopApprovalDecision, sessionPath?: string) => {
      if (!api) {
        return;
      }

      if (decision.kind === "guidance" && !decision.userMessage.trim()) {
        setRuntimeError(i18n.t("error.enterGuidance"));
        return;
      }

      setBusyAction("approve");
      try {
        const next = await api.replyPendingApproval({
          decision,
          ...(sessionPath?.trim() ? { sessionPath: sessionPath.trim() } : {}),
        });
        applySnapshot(next);
        setApprovalGuidance("");
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const resolveExtensionUi = useCallback(
    async (requestId: string, result: unknown) => {
      if (!api) {
        return;
      }
      try {
        const next = await api.resolveExtensionUi({ requestId, result });
        applySnapshot(next);
      } catch (error) {
        setRuntimeError(describeError(error));
      }
    },
    [api, applySnapshot],
  );

  const replyWorkspaceCapabilityTrust = useCallback(
    async (decision: WorkspaceCapabilityTrustDecision) => {
      if (!api) {
        return;
      }

      setBusyAction("workspaceTrust");
      try {
        const next = await api.replyWorkspaceCapabilityTrust({ decision });
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeApprovalFromNotification) {
      return;
    }
    return bridge.subscribeApprovalFromNotification(({ decision }) => {
      const sessionPath = resolvePendingApprovalSessionPath(snapshotRef.current);
      void submitApproval({ kind: decision }, sessionPath);
    });
  }, [submitApproval]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeNotificationReply) {
      return;
    }
    return bridge.subscribeNotificationReply((payload) => {
      if (payload.kind !== "approval") {
        return;
      }
      const current = snapshotRef.current?.conversation.pendingToolApproval;
      const userMessage = payload.text.trim();
      if (!current || !userMessage) {
        return;
      }
      const sessionPath = resolvePendingApprovalSessionPath(snapshotRef.current);
      void submitApproval({ kind: "guidance", userMessage }, sessionPath);
    });
  }, [submitApproval]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!api || !bridge?.subscribeNotificationReply) {
      return;
    }
    return bridge.subscribeNotificationReply((payload) => {
      if (payload.kind !== "ask-questions") {
        return;
      }
      const sessionPath = resolvePendingQuestionsSessionPath(snapshotRef.current);
      const pendingForReply = resolvePendingQuestionsSnapshot(snapshotRef.current, sessionPath);
      const result = buildSingleTextQuestionNotificationReplyResult(pendingForReply, payload);
      if (!result) {
        return;
      }
      void (async () => {
        setBusyAction("questions");
        try {
          const next = await api.replyPendingQuestions({
            result,
            ...(sessionPath ? { sessionPath } : {}),
          });
          applySnapshot(next);
          setQuestionError("");
          setRuntimeError("");
        } catch (error) {
          setRuntimeError(describeError(error));
        } finally {
          setBusyAction("");
        }
      })();
    });
  }, [api, applySnapshot]);

  const submitQuestions = useCallback(
    async (
      sessionPath?: string,
      questionsSource?: typeof pendingQuestions,
      draftsSource?: Record<string, QuestionDraft>,
    ) => {
      const effectiveQuestions = questionsSource ?? pendingQuestions;
      if (!api || !effectiveQuestions) {
        return;
      }

      const built = buildAskQuestionsResult(
        effectiveQuestions.request,
        draftsSource ?? questionDrafts,
      );
      if (!built.result) {
        setQuestionError(built.error ?? i18n.t("error.completeQuestionnaire"));
        return;
      }

      setBusyAction("questions");
      try {
        const next = await api.replyPendingQuestions({
          result: built.result,
          ...(sessionPath?.trim() ? { sessionPath: sessionPath.trim() } : {}),
        });
        applySnapshot(next);
        setQuestionError("");
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, pendingQuestions, questionDrafts],
  );

  const skipQuestions = useCallback(
    async (sessionPath?: string, questionsSource?: typeof pendingQuestions) => {
      const effectiveQuestions = questionsSource ?? pendingQuestions;
      if (!api || !effectiveQuestions) {
        return;
      }

      setBusyAction("questions");
      try {
        const next = await api.replyPendingQuestions({
          result: { status: "skipped" },
          ...(sessionPath?.trim() ? { sessionPath: sessionPath.trim() } : {}),
        });
        applySnapshot(next);
        setQuestionError("");
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, pendingQuestions],
  );

  const openSession = useCallback(
    async (path: string) => {
      if (!api) {
        return;
      }
      acknowledgeSessionAttention(path);
      const navGeneration = sessionNavigationGenerationRef.current + 1;
      sessionNavigationGenerationRef.current = navGeneration;
      let holdBusyForSplitRestore = false;
      setBusyAction("session");
      try {
        stashSessionUi(snapshotRef.current);
        const next = await api.openSession(path);
        if (navGeneration !== sessionNavigationGenerationRef.current) {
          return;
        }
        if (isRemoteWebHostClient(api.kind)) {
          syncWebViewingSessionPath(next.activeSession?.filePath ?? path);
        }
        applySnapshot(next, { navGeneration });
        restoreSessionUi(next);
        holdBusyForSplitRestore = shouldHoldSessionBusyForSplitRestore(path, next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        if (navGeneration === sessionNavigationGenerationRef.current) {
          if (!holdBusyForSplitRestore) {
            setBusyAction("");
          } else {
          }
        }
      }
    },
    [
      acknowledgeSessionAttention,
      api,
      applySnapshot,
      refreshSessions,
      restoreSessionUi,
      stashSessionUi,
      syncWebViewingSessionPath,
    ],
  );

  const releaseSessionNavigationBusy = useCallback(() => {
    if (busyActionRef.current !== "session") {
      return;
    }
    setBusyAction("");
  }, []);

  const setLayoutNavigationPending = useCallback((pending: boolean) => {
    setLayoutNavigationPendingState((current) => (current === pending ? current : pending));
  }, []);

  const beginSplitPaneSession = useCallback(
    async (
      paneId: string,
      options?: { deferSnapshot?: boolean },
    ): Promise<BeginSplitPaneSessionResponse> => {
      if (!api?.beginSplitPaneSession) {
        throw new Error("Host does not support split pane sessions.");
      }
      const response = await api.beginSplitPaneSession({
        paneId,
        deferSnapshot: options?.deferSnapshot,
      });
      if (response.snapshot) {
        applySnapshot(response.snapshot);
      }
      setRuntimeError("");
      void refreshSessions();
      return response;
    },
    [api, applySnapshot, refreshSessions],
  );

  const setVisiblePaneSessions = useCallback(
    async (sessionPaths: string[]) => {
      if (!api?.setVisiblePaneSessions) {
        return;
      }
      const next = await api.setVisiblePaneSessions({ sessionPaths });
      const navGeneration =
        busyActionRef.current === "session" ? sessionNavigationGenerationRef.current : undefined;
      applySnapshot(next, navGeneration !== undefined ? { navGeneration } : undefined);
    },
    [api, applySnapshot],
  );

  const syncSplitPaneSessions = useCallback(
    async (sessionPaths: string[], focusSessionPath?: string) => {
      if (!api?.syncSplitPaneSessions) {
        return;
      }
      const next = await api.syncSplitPaneSessions({ sessionPaths, focusSessionPath });
      applySnapshot(next);
    },
    [api, applySnapshot],
  );

  const focusPaneSession = useCallback(
    async (sessionPath: string) => {
      if (!api?.focusPaneSession) {
        return;
      }
      acknowledgeSessionAttention(sessionPath);
      const next = await api.focusPaneSession({ sessionPath });
      applySnapshot(next);
    },
    [acknowledgeSessionAttention, api, applySnapshot],
  );

  const closeSplitPaneSession = useCallback(
    async (sessionPath: string) => {
      if (!api?.closeSplitPaneSession) {
        return;
      }
      const next = await api.closeSplitPaneSession({ sessionPath });
      applySnapshot(next);
      void refreshSessions();
    },
    [api, applySnapshot, refreshSessions],
  );

  const deleteSession = useCallback(
    async (path: string) => {
      if (!api) {
        return;
      }
      acknowledgeSessionAttention(path);
      const navGeneration = sessionNavigationGenerationRef.current + 1;
      sessionNavigationGenerationRef.current = navGeneration;
      setBusyAction("session");
      try {
        const next = await api.deleteSession(path);
        if (navGeneration !== sessionNavigationGenerationRef.current) {
          return;
        }
        applySnapshot(next, { navGeneration });
        restoreSessionUi(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
        throw error;
      } finally {
        if (navGeneration === sessionNavigationGenerationRef.current) {
          setBusyAction("");
        }
      }
    },
    [acknowledgeSessionAttention, api, applySnapshot, refreshSessions, restoreSessionUi],
  );

  const renameSession = useCallback(
    async (path: string, displayName: string) => {
      if (!api) {
        return;
      }
      setBusyAction("session");
      try {
        const next = await api.renameSession(path, displayName);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
        throw error;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const deleteWorkspace = useCallback(
    async (workspacePath: string) => {
      if (!api?.forgetWorkspace) {
        return;
      }
      const normalizedTarget = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const workspaceSessions = sessions.filter((s) => {
        const rawRoot = (s.workspaceRoot ?? "").trim();
        if (!rawRoot) {
          return false;
        }
        const groupingRoot = resolveWorkspaceGroupingRoot(rawRoot)
          .replace(/\\/g, "/")
          .replace(/\/+$/, "")
          .toLowerCase();
        return groupingRoot === normalizedTarget;
      });
      setBusyAction("session");
      try {
        for (const session of workspaceSessions) {
          acknowledgeSessionAttention(session.path);
          await api.deleteSession(session.path);
        }
        const next = await api.forgetWorkspace({ workspaceRoot: workspacePath });
        applySnapshot(next);
        restoreSessionUi(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [acknowledgeSessionAttention, api, applySnapshot, refreshSessions, restoreSessionUi, sessions],
  );

  const listWorkspaceFileReferenceSuggestions = useCallback(
    async (
      request: QueryWorkspaceFileReferenceSuggestionsRequest,
    ): Promise<WorkspaceFileReferenceSuggestionsResponse> => {
      if (!api) {
        return null;
      }
      return api.listWorkspaceFileReferenceSuggestions(request);
    },
    [api],
  );

  const primeWorkspaceFileReferenceIndex = useCallback(async (): Promise<void> => {
    if (!api) {
      return;
    }
    await api.primeWorkspaceFileReferenceIndex();
  }, [api]);

  const getWorkspaceFileReferenceIndex = useCallback(async () => {
    if (!api) {
      return { ready: false, files: [] };
    }
    return api.getWorkspaceFileReferenceIndex();
  }, [api]);

  const listWorkspaceExplorerChildren = useCallback(
    async (relativePath: string): Promise<WorkspaceExplorerListResult> => {
      if (!api) {
        return { entries: [] };
      }
      return api.listWorkspaceExplorerChildren(relativePath);
    },
    [api],
  );

  const readGitWorkingTree = useCallback(async (): Promise<GitWorkingTreeSnapshot> => {
    if (!api) {
      return { isRepository: false, changes: [] };
    }
    return api.readGitWorkingTree();
  }, [api]);

  const readGitHistory = useCallback(
    async (request: ReadGitHistoryRequest = {}): Promise<GitHistorySnapshot> => {
      if (!api) {
        return { isRepository: false, commits: [], rows: [], hasMore: false, logCommits: [] };
      }
      return api.readGitHistory(request);
    },
    [api],
  );

  const readGitCommitMessage = useCallback(
    async (request: ReadGitCommitMessageRequest): Promise<GitCommitMessageSnapshot> => {
      if (!api) {
        return {
          isRepository: false,
          oid: "",
          subject: "",
          author: "",
          authoredAt: "",
          fullMessage: "",
        };
      }
      return api.readGitCommitMessage(request);
    },
    [api],
  );

  const getGitHubAuthStatus = useCallback(async () => {
    if (!api) {
      return { connected: false };
    }
    return api.getGitHubAuthStatus();
  }, [api]);

  const beginGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      throw new Error(i18n.t("error.hostNotReady"));
    }
    return api.beginGitHubDeviceLogin();
  }, [api]);

  const completeGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      throw new Error(i18n.t("error.hostNotReady"));
    }
    return api.completeGitHubDeviceLogin();
  }, [api]);

  const cancelGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      return;
    }
    await api.cancelGitHubDeviceLogin();
  }, [api]);

  const disconnectGitHub = useCallback(async () => {
    if (!api) {
      return { connected: false };
    }
    const status = await api.disconnectGitHub();
    clearGitHubAutomationRepositoriesCache();
    return status;
  }, [api]);

  const getGitHubPullRequestForCurrentBranch = useCallback(async () => {
    if (!api) {
      return { repository: null, branch: null, pullRequest: null };
    }
    return api.getGitHubPullRequestForCurrentBranch();
  }, [api]);

  const getGitHubPullRequestDetail = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.getGitHubPullRequestDetail(request);
    },
    [api],
  );

  const getGitHubPullRequestConversation = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.getGitHubPullRequestConversation(request);
    },
    [api],
  );

  const getGitHubPullRequestFiles = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.getGitHubPullRequestFiles(request);
    },
    [api],
  );

  const getGitHubPullRequestCommits = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.getGitHubPullRequestCommits(request);
    },
    [api],
  );

  const getGitHubPullRequestChecks = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.getGitHubPullRequestChecks(request);
    },
    [api],
  );

  const mergeGitHubPullRequest = useCallback(
    async (request: MergeGitHubPullRequestRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.mergeGitHubPullRequest(request);
    },
    [api],
  );

  const markGitHubPullRequestReady = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.markGitHubPullRequestReady(request);
    },
    [api],
  );

  const listGitHubPullRequests = useCallback(
    async (request: ListGitHubPullRequestsRequest) => {
      if (!api) {
        return { items: [], totalCount: 0, hasMore: false };
      }
      return api.listGitHubPullRequests(request);
    },
    [api],
  );

  const listGitHubAutomationRepositories = useCallback(
    async (page?: number) => {
      if (!api) {
        return { items: [], hasNextPage: false };
      }
      return api.listGitHubAutomationRepositories(page !== undefined ? { page } : {});
    },
    [api],
  );

  const searchGitHubAutomationRepositories = useCallback(
    async (query: string, page?: number) => {
      if (!api) {
        return { items: [], totalCount: 0 };
      }
      return api.searchGitHubAutomationRepositories({ query, ...(page ? { page } : {}) });
    },
    [api],
  );

  const getGitHubPullRequestTabCounts = useCallback(
    async (request: GetGitHubPullRequestTabCountsRequest) => {
      if (!api) {
        return { open: 0, closed: 0 };
      }
      return api.getGitHubPullRequestTabCounts(request);
    },
    [api],
  );

  const readWorkspaceTextFile = useCallback(
    async (
      relativePath: string,
      options?: import("@/types").ReadWorkspaceTextFileOptions,
    ): Promise<WorkspaceReadTextFileResult> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.readWorkspaceTextFile(relativePath, options);
    },
    [api],
  );

  const searchWorkspaceContent = useCallback(
    async (
      request: import("@/types").WorkspaceContentSearchRequest,
    ): Promise<import("@/types").WorkspaceContentSearchResult> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.searchWorkspaceContent(request);
    },
    [api],
  );

  const writeWorkspaceTextFile = useCallback(
    async (request: WriteWorkspaceTextFileRequest): Promise<void> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.writeWorkspaceTextFile(request);
    },
    [api],
  );

  const readHostTextFile = useCallback(
    async (absolutePath: string): Promise<WorkspaceReadTextFileResult> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.readHostTextFile(absolutePath);
    },
    [api],
  );

  const writeHostTextFile = useCallback(
    async (request: WriteHostTextFileRequest): Promise<void> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.writeHostTextFile(request);
    },
    [api],
  );

  const statHostTextFile = useCallback(
    async (absolutePath: string): Promise<HostTextFileStatResult> => {
      if (!api) {
        throw new Error(i18n.t("error.hostNotReady"));
      }
      return api.statHostTextFile(absolutePath);
    },
    [api],
  );

  const resetSession = useCallback(
    async (options?: { composerSeed?: string }): Promise<boolean> => {
      if (!api) {
        return false;
      }

      const navGeneration = advanceSessionNavigationGeneration();
      beginNavigationDoodle(navGeneration);
      setBusyAction("reset");
      try {
        stashSessionUi(snapshotRef.current);
        const next = await api.resetSession();
        if (navGeneration !== sessionNavigationGenerationRef.current) {
          finishNavigationDoodle(navGeneration);
          return false;
        }
        if (isRemoteWebHostClient(api.kind)) {
          syncWebViewingSessionPath(next.activeSession?.filePath);
        }
        applySnapshot(next, { navGeneration });
        restoreSessionUi(next);
        commitDoodleNavigation(navGeneration, next.composerSessionKey);
        setNavigationDoodleVariant(null);
        if (options?.composerSeed !== undefined) {
          applyComposerSeed(options.composerSeed, next);
        }
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        finishNavigationDoodle(navGeneration);
        setRuntimeError(describeError(error));
        return false;
      } finally {
        if (navGeneration === sessionNavigationGenerationRef.current) {
          setBusyAction("");
        }
      }
    },
    [
      api,
      advanceSessionNavigationGeneration,
      applyComposerSeed,
      applySnapshot,
      beginNavigationDoodle,
      finishNavigationDoodle,
      refreshSessions,
      restoreSessionUi,
      stashSessionUi,
      syncWebViewingSessionPath,
    ],
  );

  const summary = useMemo(() => {
    const canEnqueueWhileBusy =
      !!snapshot?.runtimeReady &&
      !!snapshot.conversation.isBusy &&
      !snapshot.conversation.pendingToolApproval &&
      !snapshot.conversation.pendingQuestions;
    return {
      canSend: resolvePaneCanSend(snapshot),
      canEnqueueWhileBusy,
      canInterrupt: canEnqueueWhileBusy,
      hostStatus: hostError
        ? hostError
        : hostReady
          ? kind === "electron"
            ? "Electron Desktop"
            : "localhost Web Host"
          : i18n.t("common.connectingHost"),
    };
  }, [hostError, hostReady, kind, snapshot]);

  const refreshFromHostPoll = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const pollRequest = webPollRequestForSnapshot(
        api.kind,
        snapshotRef.current,
        webViewingSessionPathRef.current,
      );
      const next = await api.poll(pollRequest);
      applySnapshot(next);
      void refreshSessions();
    } catch {
      // ignore poll errors from notification refresh
    }
  }, [api, applySnapshot, refreshSessions]);

  useDesktopSystemNotifications({
    enabled: settings.systemNotifications,
    apiKind: kind,
    snapshot,
    sessions,
    onNotifyRefresh: refreshFromHostPoll,
  });

  const installLspProvider = useCallback(
    async (providerId: string) => {
      if (!api?.installLspProvider) {
        throw new Error("LSP provider install is only available in the desktop app.");
      }

      setBusyAction("lspInstall");
      try {
        const next = await api.installLspProvider({ providerId });
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
        throw error;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  return {
    apiReady: hostReady,
    hostConnectionError: hostError,
    busyAction,
    paneWorkspaceBusySessionPath,
    paneSendBusySessionPath,
    layoutNavigationPending,
    setLayoutNavigationPending,
    agentModeChipDismissed,
    composer,
    composerSegments,
    composerLocalFileAttachments,
    setComposerSegments,
    setComposerFromPlain,
    resetComposerAfterSend,
    hostKind: kind,
    viewingSessionPath: isRemoteWebHostClient(kind)
      ? webViewingSessionPath || snapshot?.activeSession?.filePath || null
      : (snapshot?.activeSession?.filePath ?? null),
    pendingQuestions,
    questionDrafts,
    questionError,
    refreshSessions,
    listDreamsOverview,
    listAutomations,
    getAutomation,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    setAutomationEnabled,
    runtimeError,
    sessions,
    unseenCompletedSessionPaths,
    settings,
    snapshot,
    summary,
    webHostPairingRequired,
    approvalGuidance,
    setActiveModel,
    setModelReasoningEffort,
    setModelReasoningMode,
    setModelThinkingEnabled,
    setApprovalGuidance,
    setAgentModeChipDismissed,
    setComposerLocalFileAttachments,
    setQuestionDrafts,
    setSettings,
    updateQuestionDraft,
    bootstrap,
    switchWorkspaceRoot,
    switchToNoWorkspaceBinding,
    switchPaneWorkspace,
    switchPaneModel,
    setPanePendingGitBranch,
    setPaneWorkLocation,
    switchPaneToNoWorkspaceBinding,
    rememberWorkspaceRoot,
    pickWorkspaceDirectory,
    pickLocalFile,
    getPathForDroppedFile,
    classifyLocalFileComposerRoute,
    ingestClipboardImage,
    readLocalImagePreviewDataUrl,
    readManagedImagePreviewDataUrl,
    readLocalVideoPreviewUrl,
    readManagedVideoPreviewUrl,
    saveLocalImageAs,
    commitChanges,
    submitGitChip,
    addModel,
    addProviderModels,
    previewModels,
    removeModel,
    removeProviderModels,
    addMcpServer,
    importExtension,
    installBuiltInExtension,
    addMarketplaceSource,
    removeMarketplaceSource,
    installMarketplaceExtension,
    updateExtension,
    createSkill,
    createRule,
    deleteExtension,
    setExtensionEnabled,
    runExtension,
    updateExtensionSettings,
    updateExtensionSecret,
    deleteMcpServer,
    saveHookEntry,
    deleteHookEntry,
    deleteSkill,
    deleteRule,
    inspectMcpServer,
    abortConversation,
    abortShell,
    setLoopEnabled,
    setSubagentViewerTarget,
    setApprovalLevel,
    setPendingGitBranch,
    setWorkLocation,
    checkoutGitBranch,
    checkoutPaneGitBranch,
    mergeWorktreeToMain,
    pushGitBranch,
    continueAssistantCompletion,
    openSession,
    releaseSessionNavigationBusy,
    sessionNavigationGeneration,
    navigationDoodleVariant,
    beginSplitPaneSession,
    beginSideChatPaneSession,
    forkSessionIntoSideChat,
    setVisiblePaneSessions,
    syncSplitPaneSessions,
    focusPaneSession,
    closeSplitPaneSession,
    deleteSession,
    renameSession,
    deleteWorkspace,
    listWorkspaceFileReferenceSuggestions,
    primeWorkspaceFileReferenceIndex,
    getWorkspaceFileReferenceIndex,
    listWorkspaceExplorerChildren,
    readGitWorkingTree,
    readGitHistory,
    readGitCommitMessage,
    getGitHubAuthStatus,
    beginGitHubDeviceLogin,
    completeGitHubDeviceLogin,
    cancelGitHubDeviceLogin,
    disconnectGitHub,
    getGitHubPullRequestForCurrentBranch,
    listGitHubPullRequests,
    listGitHubAutomationRepositories,
    searchGitHubAutomationRepositories,
    getGitHubPullRequestTabCounts,
    getGitHubPullRequestDetail,
    getGitHubPullRequestConversation,
    getGitHubPullRequestFiles,
    getGitHubPullRequestCommits,
    getGitHubPullRequestChecks,
    mergeGitHubPullRequest,
    markGitHubPullRequestReady,
    readWorkspaceTextFile,
    searchWorkspaceContent,
    writeWorkspaceTextFile,
    readHostTextFile,
    writeHostTextFile,
    statHostTextFile,
    pairWebHost,
    resetSession,
    rewindAndSubmitMessage,
    reapplySessionPathAliases,
    forkSession,
    reorderQueuedUserTurn,
    sendQueuedUserTurnNow,
    removeQueuedUserTurn,
    saveSettingsPatch,
    resetWebHostPairing,
    installLspProvider,
    lspInstallBusy: busyAction === "lspInstall",
    sendMessage,
    submitStartImplementing,
    skipQuestions,
    submitApproval,
    replyWorkspaceCapabilityTrust,
    resolveExtensionUi,
    submitQuestions,
  };
}
