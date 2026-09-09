import { lstat, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteFileBaselineTextForPath,
  lineDeltaForDeleteFilePath,
} from "./delete-file-line-delta.js";
import i18n from "../lib/i18n-host.js";
import { resolveDesktopAgentMode } from "../lib/agent-mode.js";
import {
  buildBasicInfoSystemMessage,
  buildDreamsSystemMessage,
  buildExtensionsSystemMessage,
  buildAgentModeSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildMcpCatalogSystemMessage,
  buildToolAgentHostPrompt,
  createLlmTransport,
  type AssistantAuxArchiveEntry,
  type ChatArchive,
  type LlmExtensionSystemPrompt,
  type McpService,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
  type PendingWorkspaceFile,
  type RuntimeToolExecution,
  type SpiritLlmTransport,
  type LlmActiveSkill,
  type McpUiOpenRequest,
  type McpUiOpenResult,
} from "@spiritagent/agent-core";
import {
  buildStartImplementingUserTurn,
  extractActivePlanPathFromLlmHistory,
  createHostExtensionManager,
  collectEnabledExtensionInstructionContributions,
  overlayExtensionRulesAndSkills,
  ensureBuiltInExtensions,
  listAllMarketplaceSources,
  compareMarketplaceDisplayOrder,
  readMarketplaceCatalogForSource,
  localFileAttachmentFromPath,
  workspaceFileReferenceAttachmentFromPath,
  classifyLocalFileComposerRoute as resolveLocalFileComposerRoute,
  type LocalFileComposerRoute,
  restoreHostFileChanges,
  type HostDreamScope,
  type HostTodoRecord,
  type HostTodoScope,
  type HostExtensionEvent,
  type HostRecordedFileChange,
  type ApprovalLevel,
  normalizeApprovalLevel,
  normalizeWorkLocationKind,
  gitBranchLabelForBasicInfo,
  setGitHubFetchImplementation,
  type WorkLocationKind,
  type WorkspaceCapabilityTrustDecision,
  type WorkspaceCapabilityTrustRequest,
} from "@spiritagent/host-internal";
import type { HostExtensionInstructionContributions } from "@spiritagent/host-internal";

import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  BootstrapRequest,
  DesktopClientHost,
  CommitChangesRequest,
  CheckoutGitBranchRequest,
  ConversationMessageSnapshot,
  ConversationTodoSnapshot,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteRuleRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DesktopApprovalDecision,
  DesktopMcpServerInspection,
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogEntry,
  DesktopMarketplaceSource,
  DesktopExtensionCssLayer,
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubAutomationRepositoriesRequest,
  ListGitHubPullRequestsRequest,
  SearchGitHubAutomationRepositoriesRequest,
  MergeGitHubPullRequestRequest,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  HostTextFileStatResult,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  DesktopDreamCollectorSnapshot,
  PlanSnapshot,
  DeleteSkillRequest,
  DesktopSnapshot,
  WorkspaceContentInvalidation,
  FileRewindWarning,
  RunExtensionRequest,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PendingAssistantAux,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  ReplyPendingApprovalRequest,
  ReplyPendingQuestionsRequest,
  ReplyWorkspaceCapabilityTrustRequest,
  DesktopPendingExtensionUi,
  ResolveExtensionUiRequest,
  ForkSessionRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RemoveModelRequest,
  RemoveProviderGroupRequest,
  RemoveProviderModelsRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
  CodeCompletionResponse,
  SessionListItem,
  AddMarketplaceSourceRequest,
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  InstallMarketplaceExtensionRequest,
  MarketplaceInstallCommandResult,
  MarketplaceSourceCommandResult,
  MarketplaceUpdateCommandResult,
  RemoveMarketplaceSourceRequest,
  UpdateExtensionRequest,
  InstallLspProviderRequest,
  SetExtensionEnabledRequest,
  SubmitUserTurnRequest,
  AbortConversationRequest,
  BeginSplitPaneSessionRequest,
  BeginSplitPaneSessionResponse,
  BeginSideChatPaneSessionRequest,
  BeginSideChatPaneSessionResponse,
  ForkSessionIntoSideChatRequest,
  SetVisiblePaneSessionsRequest,
  CloseSplitPaneSessionRequest,
  FocusPaneSessionRequest,
  SyncSplitPaneSessionsRequest,
  SwitchPaneWorkspaceRequest,
  SwitchPaneModelRequest,
  SetPanePendingGitBranchRequest,
  SetPaneWorkLocationRequest,
  CheckoutPaneGitBranchRequest,
  PaneSessionSlice,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "../types.js";
import type { DesktopToolRequest, HostCommandName } from "./contracts.js";
import { createHostInvokeDispatch } from "./host-invoke-dispatch.js";
import {
  addModelCommand,
  addProviderModelsCommand,
  previewModelsCommand,
  removeModelCommand,
  removeProviderGroupCommand,
  removeProviderModelsCommand,
  updateConfigCommand,
  type HostModelCommandContext,
} from "./host-model-commands.js";
import {
  addMcpServerCommand,
  createRuleCommand,
  createSkillCommand,
  deleteExtensionCommand,
  deleteRuleCommand,
  deleteMcpServerCommand,
  addMarketplaceSourceCommand,
  deleteHookEntryCommand,
  deleteSkillCommand,
  importExtensionCommand,
  installBuiltInExtensionCommand,
  installMarketplaceExtensionCommand,
  inspectMcpServerCommand,
  removeMarketplaceSourceCommand,
  runExtensionCommand,
  setExtensionEnabledCommand,
  saveHookEntryCommand,
  submitSkillSlashCommand,
  updateExtensionCommand,
  updateExtensionSecretCommand,
  updateExtensionSettingsCommand,
  type HostExtensionCommandContext,
} from "./host-extension-commands.js";
import { submitGitChipCommand } from "./host-git-chip-commands.js";
import {
  checkoutGitBranchCommand,
  commitChangesCommand,
  listDreamsOverviewCommand,
  listSessionsCommand,
  listWorkspaceExplorerChildrenCommand,
  getWorkspaceFileReferenceIndexCommand,
  listWorkspaceFileReferenceSuggestionsCommand,
  primeWorkspaceFileReferenceIndexCommand,
  mergeWorktreeToMainCommand,
  pushGitBranchCommand,
  readGitHistoryCommand,
  readGitCommitMessageCommand,
  readGitWorkingTreeCommand,
  readHostTextFileCommand,
  readWorkspaceTextFileCommand,
  searchWorkspaceContentCommand,
  refreshGitSnapshotCommand,
  rememberWorkspaceRootCommand,
  forgetWorkspaceRootCommand,
  setWebHostAuthTokenHashCommand,
  statHostTextFileCommand,
  writeHostTextFileCommand,
  writeWorkspaceTextFileCommand,
  revealWorkspaceEntryCommand,
  openPathInDefaultAppCommand,
  renameWorkspaceEntryCommand,
  createWorkspaceEntryCommand,
  moveWorkspaceEntryCommand,
  trashWorkspaceEntryCommand,
  forceDeleteWorkspaceEntryCommand,
  type HostWorkspaceGitCommandContext,
} from "./host-workspace-git-commands.js";
import {
  beginGitHubDeviceLoginCommand,
  cancelGitHubDeviceLoginCommand,
  completeGitHubDeviceLoginCommand,
  disconnectGitHubCommand,
  getGitHubAuthStatusCommand,
  getGitHubPullRequestDetailCommand,
  getGitHubPullRequestConversationCommand,
  getGitHubPullRequestFilesCommand,
  getGitHubPullRequestCommitsCommand,
  getGitHubPullRequestChecksCommand,
  getGitHubPullRequestForCurrentBranchCommand,
  listGitHubAutomationRepositoriesCommand,
  listGitHubPullRequestsCommand,
  searchGitHubAutomationRepositoriesCommand,
  getGitHubPullRequestTabCountsCommand,
  markGitHubPullRequestReadyCommand,
  mergeGitHubPullRequestCommand,
} from "./host-github-commands.js";
import {
  abortConversationCommand,
  abortConversationInContext,
  applyDrainedRuntimeHostEvents,
  continueAssistantCompletionCommand,
  pollCommand,
  pumpSessionsCommand,
  replyPendingApprovalCommand,
  replyPendingQuestionsCommand,
  sendQueuedUserTurnNowCommand,
  submitUserTurnAfterInitializedCommand,
  tickSessionCommand,
  type SessionTurnOrchestratorContext,
  type SubmitUserTurnAfterInitializedOptions,
} from "./session-turn-orchestrator.js";
import {
  LIVE_SNAPSHOT_BUSY_HEARTBEAT_MS,
  LIVE_SNAPSHOT_EMIT_THROTTLE_MS,
  SESSION_LIST_NOTIFY_INTERVAL_MS,
  SessionPump,
  pumpDebugEnabled,
  sessionBundleNeedsPumpTick,
} from "./session-pump.js";
import {
  startWorktreeBootstrapTurnCommand,
  type WorktreeBootstrapHostContext,
} from "./worktree-bootstrap-orchestrator.js";
import { isSessionBundleBusy } from "./direct-media-turn.js";
import {
  appendQueuedUserTurnSnapshots,
  canEnqueueUserTurn,
  enqueueUserTurnCommand,
  removeQueuedUserTurnCommand,
  reorderQueuedUserTurnCommand,
} from "./message-queue.js";
import {
  openSessionBackgroundCommand,
  openSessionCommand,
  resetSessionBackgroundCommand,
  resetSessionCommand,
  type SessionActivationContext,
} from "./session-activation.js";
import { forkSessionCommand, type ForkSessionHostContext } from "./fork-session-host.js";
import {
  beginSideChatPaneSessionCommand,
  forkSessionIntoSideChatCommand,
  type SideChatSessionHostContext,
} from "./side-chat-session-host.js";
import {
  beginSplitPaneSessionCommand,
  closeSplitPaneSessionCommand,
  focusPaneSessionCommand,
  setVisiblePaneSessionsCommand,
  syncSplitPaneSessionsCommand,
  type SessionSplitHostContext,
} from "./session-split.js";
import { buildPaneSessionSlice } from "./pane-snapshot.js";
import {
  switchPaneWorkspaceCommand,
  setPanePendingGitBranchCommand,
  setPaneWorkLocationCommand,
  checkoutPaneGitBranchCommand,
  resolvePaneWorkspaceProjection,
  ensureVisiblePaneScopedGitSnapshots,
  prefetchScopedGitBeforeGlobalWorkspaceChange,
  type PaneWorkspaceHostContext,
} from "./host-pane-workspace.js";
import {
  withOptionalPaneSessionActivation,
  type PaneSessionScopeHostContext,
} from "./host-pane-session-scope.js";
import { resolvePendingApprovalSessionPath } from "../lib/pane-pending-turn-routing.js";
import { switchPaneModelCommand, type PaneModelHostContext } from "./host-pane-model.js";
import {
  needsHostActiveModelSync,
  resolveEffectivePaneActiveModel,
  resolvePaneModelProjection,
} from "./active-model-sync.js";
import { findModelRefByName, resolveModelProfile } from "./model-config-access.js";
import { deleteSessionCommand, type SessionDeleteContext } from "./session-delete.js";
import { modelRefKey, modelRefsEqual } from "@spiritagent/host-internal";
import type { ModelRef } from "../types.js";
import { renameSessionCommand, type SessionRenameContext } from "./session-rename.js";
import {
  finishSessionActivationCommand,
  isBundleRuntimeFresh,
  runtimeActivationSignature,
} from "./runtime-lifecycle.js";
import {
  startDreamCollectorIfNeeded as startDreamCollectorIfNeededFromService,
  startDreamCollectorMonitorIfNeeded as startDreamCollectorMonitorIfNeededFromService,
  type DreamCollectorServiceContext,
} from "./dream-collector-service.js";
import {
  startAutomationSchedulerMonitorIfNeeded as startAutomationSchedulerMonitorIfNeededFromService,
  type AutomationSchedulerServiceContext,
} from "./automation-scheduler-service.js";
import {
  createAutomationCommand,
  deleteAutomationCommand,
  getAutomationCommand,
  listAutomationsCommand,
  setAutomationEnabledCommand,
  updateAutomationCommand,
} from "./host-automation-commands.js";
import {
  clearAssistantContinuationMarkers as clearAssistantContinuationMarkersFromService,
  latestContinuableAssistantMessage as latestContinuableAssistantMessageFromService,
  logContinuationSnapshotState as logContinuationSnapshotStateFromService,
  logToolSnapshotState as logToolSnapshotStateFromService,
  markAssistantMessageContinuable as markAssistantMessageContinuableFromService,
  markLatestRenderableAssistantMessageContinuableInCurrentTurn as markLatestRenderableAssistantMessageContinuableInCurrentTurnFromService,
  refreshArchiveFromRuntime as refreshArchiveFromRuntimeFromService,
  syncSubagentToolStreamingOutput as syncSubagentToolStreamingOutputFromService,
  type ConversationContinuationContext,
} from "./conversation-continuation.js";
import { syncLivePendingAuxSnapshot } from "./live-snapshot-sync.js";
import {
  buildConversationTodoSnapshot as buildConversationTodoSnapshotFromService,
  cancelTodoClearing as cancelTodoClearingFromService,
  finalizeTodoScopeForNewActiveBundle as finalizeTodoScopeForNewActiveBundleFromService,
  maybeRefreshRuntimeAfterTodoScopeChange as maybeRefreshRuntimeAfterTodoScopeChangeFromService,
  reconcileTodoScopeAfterSessionPathChange as reconcileTodoScopeAfterSessionPathChangeFromService,
  refreshTodoSnapshotForBundle as refreshTodoSnapshotForBundleFromService,
  resolveTodoSessionKeyForBundle as resolveTodoSessionKeyForBundleFromService,
  scheduleTodoClearing as scheduleTodoClearingFromService,
  type SessionTodosHostContext,
} from "./session-todos-host.js";
import {
  applyTodosAfterRewind as applyTodosAfterRewindFromService,
  bindFileChangesToToolMessage as bindFileChangesToToolMessageFromService,
  buildRewindCheckpointSnapshot as buildRewindCheckpointSnapshotFromService,
  recordHostFileChange as recordHostFileChangeFromService,
  recordRewindCheckpoint as recordRewindCheckpointFromService,
  restoreBeforeRewindCheckpoint as restoreBeforeRewindCheckpointFromService,
  type RewindHostContext,
} from "./rewind-host.js";
import { ensureInitializedCommand, type HostInitializationContext } from "./host-initialization.js";
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  buildLlmHistoryFallbackFromDesktopMessages,
  deriveDisplayNameFromSeed,
  restoreStoredSessionState,
  type EphemeralSessionRecord,
  nextMessageIdFromMessages,
  removeEphemeralSessionRecord,
} from "./sessions.js";
import { prepareSessionTitleForFirstUserTurn as resetSessionTitleForFirstUserTurn } from "./session-title-first-turn.js";
import { applyGeneratedSessionTitle } from "./session-title-service.js";
import {
  abortCodeCompletionCommand,
  recordCodeCompletionFileStateCommand,
  requestCodeCompletionCommand,
  resetCodeCompletionJournalCommand,
  type CodeCompletionCommandContext,
} from "./code-completion-commands.js";
import {
  buildContextUsagePercent,
  type ContextUsageModelProfile,
  resolveModelContextLength,
} from "../lib/context-usage.js";
import {
  applyConfiguredModelCatalogRefreshResults,
  fetchConfiguredModelCatalogsOnStartup,
  forceRefreshModelCatalogForProfile,
} from "./model-catalog-startup-refresh.js";
import {
  defaultNewSessionPath,
  isProvisionalSessionPath,
  isSideChatProvisionalSessionPath,
  loadHostMetadata,
  loadStoredSession,
  modelSecretKeyPresence,
  resolveApiKeyForConfigModel,
  createDesktopExtensionStateStore,
  loadConfig,
  saveConfig,
  removeModelApiKey,
  spiritDataDir,
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
  mergeRecentWorkspaceRoots,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from "./storage.js";
import { DesktopToolExecutor } from "./tool-executor.js";
import { buildDesktopRuntimeBasicInfo, type DesktopHostRuntime } from "./runtime.js";
import { hydrateSessionReferenceWiresInUserText } from "./hydrate-session-reference-wires.js";
import {
  abortRemoteDesktopShell,
  closeRemoteDesktopRuntime,
  closeSharedDesktopServerClient,
  notifyDesktopServerRefreshExtensions,
  createRemoteDesktopRuntime,
  disposeRemoteDesktopRuntime,
  ensureRemoteChildSessionArchivesFresh,
  exportRemoteDesktopState,
  migrateRemoteConversationKey,
  openRemoteDesktopRuntime,
  remoteDesktopSessionId,
  replyRemoteWorkspaceCapabilityTrust,
  replyRemoteExtensionUi,
  remoteDesktopRuntimeNeedsProjection,
  runRemoteDesktopSessionEnd,
  runRemoteDesktopSessionStart,
  setRemoteDesktopApprovalLevel,
} from "./remote-runtime.js";
import { buildDesktopUiMarkdownPromptSection } from "./desktop-ui-markdown-prompt.js";
import { buildActiveSkillPayload } from "./skills.js";
import { buildDreamContextText, emptyDreamCollectorSnapshot } from "./dreams.js";
import { resolveLightweightChatModelProfile } from "./lightweight-chat-model.js";
import { createTodoScope } from "./todos.js";
import {
  buildDesktopExtensionListItems,
  buildDesktopExtensionToolDefinitions,
  buildDesktopMarketplaceCatalogEntries,
  collectDesktopExtensionCssLayers,
  collectExtensionSystemPrompts,
  resolveEnabledExtensionViewFile,
  resolveEnabledExtensionViewOwner,
} from "./extensions.js";
import {
  getDesktopExtensionHostAdapter,
  requireDesktopExtensionHostAdapter,
  setDesktopExtensionHostAdapter,
  type DesktopExtensionHostAdapter,
} from "./extension-host-adapter.js";
import { ExtensionWarmupCoordinator, type ExtensionWarmupTrigger } from "./extension-warmup.js";
import { emptyMcpStatusSnapshot, listDesktopMcpServersFromDisk } from "./mcp-config.js";
import { listDesktopHookListItems } from "./hooks.js";
import type { SessionEndHookInput, SessionStartHookInput } from "@spiritagent/agent-core";
import { disposeMcpServicesExcept, sharedMcpServiceForWorkspace } from "./service-mcp.js";
import {
  disposeAllLspServices,
  disposeLspServicesExcept,
  ensureLspServiceReady,
  lspUserConfigFromEnabled,
  sharedLspServiceForWorkspace,
} from "@spiritagent/host-internal/lsp";
import { buildDesktopLspSnapshot, defaultDesktopLspSnapshot } from "./lsp-snapshot.js";
import { installLspProviderCommand } from "./lsp-commands.js";
import {
  basicInfoHostFromClientHost,
  currentApiBase,
  mapPendingQuestions,
  sameDreamCollectorSnapshot,
  sameWorkspaceRoot,
} from "./service-utils.js";
import {
  needsHostWorkspaceRootSync,
  resolveEffectiveWorkspaceRoot,
} from "./workspace-root-sync.js";
import { DesktopConversationSnapshotView } from "./conversation-snapshot.js";
import { buildDesktopSnapshot, buildModelCatalogHints } from "./snapshot.js";
import {
  gitWorkingTreeFingerprint,
  nextWorkspaceContentInvalidation,
  toWorkspaceRelativePosixPath,
} from "../lib/workspace-content-invalidation.js";
import { applyToolCallSummaryCopy } from "./message-ordering.js";
import {
  mapPendingAuxState,
  mapPendingMcpResources,
  mapPendingToolApproval,
} from "./snapshot-mappers.js";
import { DesktopAssistantMessageStateMachine } from "./assistant-message-state.js";
import { DesktopRuntimeEventOrchestrator } from "./runtime-event-orchestrator.js";
import {
  DesktopMessageTimeline,
  type DesktopTimelineSegmentKind,
  type DesktopTimelineTurnSnapshot,
} from "./message-timeline.js";
import {
  createWorkspaceGitWorktree,
  applyGitRevision,
  readPrimaryRepoRoot,
  readWorkspaceGitSnapshot,
} from "./git.js";
import { generateWorktreeNamesFromModelTask } from "./ephemeral-llm-tasks.js";
import { buildSubagentViewerSnapshot } from "./subagent-viewer.js";
import { persistDesktopSessionBundle } from "./session-persistence.js";
import { SessionRegistry } from "./session-registry.js";
import type { SessionBundle } from "./session-bundle.js";
import {
  loadRewindCheckpointSnapshot,
  loadRewindFileChange,
  type DesktopRewindCheckpointSnapshot,
} from "./rewind.js";

export { setDesktopExtensionHostAdapter };

interface HostState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: PlanSnapshot;
  extensionsList: DesktopExtensionListItem[];
  marketplaceSources: DesktopMarketplaceSource[];
  marketplaceCatalogs: Record<string, DesktopMarketplaceCatalogEntry[]>;
  marketplaceCatalogAll: DesktopMarketplaceCatalogEntry[];
  marketplaceWarnings: string[];
  extensionCss: DesktopExtensionCssLayer[];
  extensionInstructionContributions: HostExtensionInstructionContributions;
  ephemeralSessions: EphemeralSessionRecord[];
}

async function loadDesktopPlanSnapshot(
  planPath: string,
  _existsHint?: boolean,
): Promise<PlanSnapshot> {
  try {
    const stat = await lstat(planPath);
    if (!stat.isFile()) {
      return {
        path: planPath,
        exists: false,
      };
    }

    const content = await readFile(planPath, "utf8");
    return {
      path: planPath,
      exists: true,
      content,
      modifiedAtUnixMs: stat.mtimeMs,
    };
  } catch {
    return {
      path: planPath,
      exists: false,
    };
  }
}

class DesktopHostService {
  private readonly invokeDispatch = createHostInvokeDispatch(this);
  private runtimeTransport: SpiritLlmTransport = createLlmTransport();
  private readonly extensionStateStore = createDesktopExtensionStateStore({
    spiritDataDir: spiritDataDir(),
    hostKind: "desktop",
  });
  private readonly hostExtensionManager = createHostExtensionManager({
    spiritDataDir: spiritDataDir(),
    hostKind: "desktop",
    stateStore: this.extensionStateStore,
  });
  private readonly extensionWarmup = new ExtensionWarmupCoordinator();
  private state: HostState | undefined;
  private readonly sessionRegistry = new SessionRegistry((bundle) => {
    void closeRemoteDesktopRuntime(bundle.runtime);
  });
  /** Active bundle runtime mirror for legacy call sites; use `bundle.runtime` in session ticks. */
  private runtime: DesktopHostRuntime | undefined;
  private toolExecutor: DesktopToolExecutor | undefined;
  private initialized = false;
  private lastRuntimeError = "";
  private activeApiKeyConfigured = false;
  private modelKeyPresence: Record<string, boolean> = {};
  private readonly bundleOrchestrations = new WeakMap<
    SessionBundle,
    {
      assistantMessages: DesktopAssistantMessageStateMachine;
      runtimeEvents: DesktopRuntimeEventOrchestrator;
      conversationSnapshotView: DesktopConversationSnapshotView;
    }
  >();
  private serialized = Promise.resolve();
  /** Turn advancement for busy sessions is driven by the main-process pump, not the renderer poll. */
  private readonly sessionPump = new SessionPump({
    hasPumpWork: () => this.hasSessionPumpWork(),
    runTick: () => this.runSessionPumpTick(),
    onTickError: (error) => {
      console.error("[desktop-host][pump] tick failed", error);
    },
  });
  private liveSnapshotEmitTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLiveSnapshotEmitAtMs = 0;
  private debugLiveSnapshotEmitCount = 0;
  private debugLiveSnapshotEmitWindowStartedAtMs = 0;
  private lastSessionListNotifyAtMs = 0;
  private dreamCollectorStatus: DesktopDreamCollectorSnapshot =
    emptyDreamCollectorSnapshot("disabled");
  private dreamCollectorRunning = false;
  private dreamCollectorLastTickUnixMs = 0;
  private dreamCollectorMonitorTimer: ReturnType<typeof setInterval> | undefined;
  private automationMonitorTimer: ReturnType<typeof setInterval> | undefined;
  private readonly runningAutomationIds = new Set<string>();
  private automationsListCache: DesktopAutomationListItem[] = [];
  private readonly dreamUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly automationUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly sessionListUpdateListeners = new Set<() => void>();
  private subagentViewerTargetToolCallId: string | null = null;
  private gitRefreshInFlight: Promise<void> | null = null;
  private workspaceContentInvalidation: WorkspaceContentInvalidation | undefined;
  private workspaceContentInvalidationWorkspaceRoot = "";
  private contextUsageCatalogRefreshInFlight: Promise<void> | null = null;
  private modelCatalogStartupRefreshInFlight: Promise<void> | null = null;
  private pendingContextUsageCatalogRefresh:
    | {
        bundle: SessionBundle;
        usage: { inputTokens: number };
        activeModel: ContextUsageModelProfile;
      }
    | undefined;
  private gitRefreshQueued = false;
  private readonly todoClearingBySession = new Map<
    string,
    {
      untilUnixMs: number;
      items: HostTodoRecord[];
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private lastToolSnapshotLogSignature: string | undefined;
  /** buildSnapshot is called at high frequency; the MCP servers / hooks lists are cached by workspace+binding key and explicitly invalidated where config add/remove commands run. */
  private mcpServersListCache:
    | { key: string; items: ReturnType<typeof listDesktopMcpServersFromDisk> }
    | undefined;
  private hooksListCache:
    | { key: string; items: ReturnType<typeof listDesktopHookListItems> }
    | undefined;
  /** One MCP catalog per workspace — survives per-session DesktopToolExecutor rebuilds. */
  private readonly mcpServiceByWorkspaceRoot = new Map<string, McpService>();
  private readonly lspServiceByWorkspaceRoot = new Map<
    string,
    import("@spiritagent/host-internal/lsp").LspService
  >();
  private lspSnapshot = defaultDesktopLspSnapshot();
  private visiblePaneSessionPaths: string[] = [];
  private readonly paneSessionSliceCache = new Map<
    string,
    { signature: string; slice: PaneSessionSlice }
  >();
  private pendingWorkspaceCapabilityTrust: WorkspaceCapabilityTrustRequest | undefined;
  private pendingExtensionUi: DesktopPendingExtensionUi | undefined;
  private pendingExtensionUiWaiter:
    | { requestId: string; resolve: (result: McpUiOpenResult) => void }
    | undefined;
  private pendingRemoteWorkspaceCapabilityTrust:
    | {
        requestId: string;
        runtime: unknown;
        finish: () => void;
      }
    | undefined;
  private workspaceCapabilityTrustWaiter:
    | {
        resolve: (decision: WorkspaceCapabilityTrustDecision) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  /** Serialize trust prompts so one reply cannot authorize multiple workspaces. */
  private workspaceCapabilityTrustTail: Promise<void> = Promise.resolve();
  /** sessionStart may await interactive trust; never run it while holding runSerialized. */
  private sessionStartTail: Promise<void> = Promise.resolve();

  private replaceVisiblePaneSessionPath(before: string, after: string): void {
    const beforeResolved = path.resolve(before);
    const afterResolved = path.resolve(after);
    if (beforeResolved === afterResolved || this.visiblePaneSessionPaths.length === 0) {
      return;
    }
    this.visiblePaneSessionPaths = this.visiblePaneSessionPaths.map((entry) =>
      path.resolve(entry) === beforeResolved ? afterResolved : path.resolve(entry),
    );
    this.sessionRegistry.setProtectedSessionPaths(this.visiblePaneSessionPaths);
  }

  private orchestrationFor(bundle: SessionBundle): {
    assistantMessages: DesktopAssistantMessageStateMachine;
    runtimeEvents: DesktopRuntimeEventOrchestrator;
    conversationSnapshotView: DesktopConversationSnapshotView;
  } {
    let existing = this.bundleOrchestrations.get(bundle);
    if (existing) {
      return existing;
    }
    existing = this.createBundleOrchestration(bundle);
    this.bundleOrchestrations.set(bundle, existing);
    return existing;
  }

  private activeOrchestration() {
    return this.orchestrationFor(this.activeBundle());
  }

  private modelCommandContext(): HostModelCommandContext {
    return {
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      ensureInitialized: (options) => this.ensureInitialized(undefined, options),
      requireState: () => this.requireState(),
      activeBundle: () => this.activeBundle(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      refreshRuntime: () => this.refreshRuntime(),
      refreshActiveModelTransportConfig: () => this.refreshActiveModelTransportConfig(),
      refreshModelKeyPresence: () => this.refreshModelKeyPresence(),
      flushDeferredRuntimeRefreshIfIdle: () => this.flushDeferredRuntimeRefreshIfIdle(),
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
      clearActiveContextUsage: () => this.clearActiveBundleContextUsage(),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      buildSnapshot: () => this.buildSnapshot(),
      disposeAllLspServices: () => this.disposeAllLspServices(),
      invalidateToolExecutors: () => this.invalidateToolExecutors(),
      refreshLspSnapshot: () => this.refreshLspSnapshot(),
    };
  }

  private async refreshLspSnapshot(): Promise<void> {
    const state = this.state;
    this.lspSnapshot = state
      ? await buildDesktopLspSnapshot(state.config)
      : defaultDesktopLspSnapshot();
  }

  private async disposeAllLspServices(): Promise<void> {
    await disposeAllLspServices(this.lspServiceByWorkspaceRoot);
  }

  private invalidateToolExecutors(): void {
    this.toolExecutor = undefined;
    for (const bundle of this.sessionRegistry.all()) {
      bundle.toolExecutor = undefined;
    }
  }

  private extensionCommandContext(): HostExtensionCommandContext {
    return {
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      ensureInitialized: (workspaceRootOverride, options) =>
        this.ensureInitialized(workspaceRootOverride, options),
      isInitialized: () => this.initialized,
      requireState: () => this.requireState(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      requireRuntime: () => this.requireRuntime(),
      requireToolExecutor: () => this.requireToolExecutor(),
      toolExecutor: () => this.toolExecutor,
      sharedMcpServiceForWorkspace: (workspaceRoot, workspaceBinding) =>
        this.sharedMcpServiceForWorkspace(workspaceRoot, workspaceBinding),
      extensionManager: () => this.extensionManager(),
      requireExtensionHostAdapter: () => this.requireExtensionHostAdapter(),
      refreshExtensionsList: () => this.refreshExtensionsList(),
      refreshRuntime: () => this.refreshRuntime(),
      refreshRuntimeAfterExtensionMutation: () => this.refreshRuntimeAfterExtensionMutation(),
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
      dispatchExtensionEvent: (event, options) => this.dispatchExtensionEvent(event, options),
      requireEnabledSkillEntry: (skillName) => this.requireEnabledSkillEntry(skillName),
      submitUserTurnAfterInitialized: (text, options) =>
        this.submitUserTurnAfterInitialized(text, options),
      appendInlineAssistantReply: (displayText, assistantText) =>
        this.appendInlineAssistantReply(displayText, assistantText),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      invalidateConfigListCaches: () => this.invalidateConfigListCaches(),
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private workspaceGitCommandContext(): HostWorkspaceGitCommandContext {
    return {
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      ensureInitialized: (workspaceRootOverride, options) =>
        this.ensureInitialized(workspaceRootOverride, options),
      requireState: () => this.requireState(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      activeBundle: () => this.activeBundle(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      bundleRuntimeIsBusy: (sessionPath) =>
        isSessionBundleBusy(this.sessionRegistry.get(sessionPath)),
      bundleForSessionPath: (sessionPath) => this.sessionRegistry.findBySessionPath(sessionPath),
      refreshGitState: () => this.refreshGitState(),
      refreshRuntimeForActiveBundle: () => this.refreshRuntimeForBundle(this.activeBundle()),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      startDreamCollectorIfNeeded: () => this.startDreamCollectorIfNeeded(),
      runCoalescedGitRefresh: () => this.runCoalescedGitRefresh(),
      hasState: () => Boolean(this.state),
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private codeCompletionCommandContext(): CodeCompletionCommandContext {
    const state = this.requireState();
    return {
      workspaceRoot: state.workspaceRoot,
      config: state.config,
    };
  }

  private sessionTurnContext(): SessionTurnOrchestratorContext {
    return {
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      ensureInitialized: (workspaceRootOverride, options) =>
        this.ensureInitialized(workspaceRootOverride, options),
      requireRuntime: () => this.requireRuntime(),
      requireState: () => this.requireState(),
      requireConfig: () => this.requireState().config,
      resolveApiKeyForConfigModel: (model) =>
        resolveApiKeyForConfigModel(this.requireState().config, model),
      activeBundle: () => this.activeBundle(),
      allBundles: () => this.sessionRegistry.all(),
      bundleNeedsRuntimeProjection: (bundle) => remoteDesktopRuntimeNeedsProjection(bundle.runtime),
      getActiveBundle: () => this.sessionRegistry.getActive(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      emitLiveSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
      requestLiveSnapshotEmit: () => this.requestThrottledLiveSnapshotEmit(),
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      clearAssistantContinuationMarkers: (bundle) => this.clearAssistantContinuationMarkers(bundle),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      ensureActiveSession: (displayText, bundle) => this.ensureActiveSession(displayText, bundle),
      prepareSessionTitleForFirstUserTurn: (displayText, bundle) =>
        this.prepareSessionTitleForFirstUserTurn(displayText, bundle),
      reconcileTodoScopeAfterSessionPathChange: (bundle, previousSessionKey) =>
        this.reconcileTodoScopeAfterSessionPathChange(bundle, previousSessionKey),
      maybeRefreshRuntimeAfterTodoScopeChange: (bundle, previousSessionKey) =>
        this.maybeRefreshRuntimeAfterTodoScopeChange(bundle, previousSessionKey),
      buildRewindCheckpointSnapshot: (bundle) => this.buildRewindCheckpointSnapshot(bundle),
      allocateMessageId: (bundle) => this.allocateMessageId(bundle),
      resetStreamingPlacementState: (full, bundle) =>
        this.resetStreamingPlacementState(full, bundle),
      persistCurrentSessionIfNeeded: (bundle) => this.persistCurrentSessionIfNeeded(bundle),
      dispatchUserMessageExtensionEvent: (text, displayText, messageId) =>
        this.dispatchExtensionEvent({
          type: "onUserMessage",
          detail: {
            text,
            displayText,
            messageId,
          },
        }),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshArchiveFromRuntime: (bundle) => this.refreshArchiveFromRuntime(bundle),
      recordRewindCheckpoint: (messageId, beforeUserCheckpoint, bundle) =>
        this.recordRewindCheckpoint(
          messageId,
          beforeUserCheckpoint as DesktopRewindCheckpointSnapshot | undefined,
          bundle,
        ),
      orchestrationFor: (bundle) => this.orchestrationFor(bundle),
      rebuildMessageTimelineFromMessages: (bundle) =>
        this.rebuildMessageTimelineFromMessages(bundle),
      flushDeferredRuntimeRefreshIfIdle: (bundle) => this.flushDeferredRuntimeRefreshIfIdle(bundle),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      buildSnapshot: () => this.buildSnapshot(),
      startDreamCollectorIfNeeded: () => this.startDreamCollectorIfNeeded(),
      persistSessionBundle: (bundle, options) => this.persistSessionBundle(bundle, options),
      syncSubagentToolStreamingOutput: (bundle) => this.syncSubagentToolStreamingOutput(bundle),
      markInterruptedToolsInCurrentTurn: () => this.markInterruptedToolsInCurrentTurn(),
      markAssistantMessageContinuable: (content) => this.markAssistantMessageContinuable(content),
      markLatestRenderableAssistantMessageContinuableInCurrentTurn: () =>
        this.markLatestRenderableAssistantMessageContinuableInCurrentTurn(),
      latestContinuableAssistantMessage: () => this.latestContinuableAssistantMessage(),
      insertUserApprovalReplyMessage: (content, pendingToolCallId) =>
        this.insertUserApprovalReplyMessage(content, pendingToolCallId),
      normalizeApprovalDecision,
      runSessionEndForActive: (reason) => this.runSessionEndForBundle(this.activeBundle(), reason),
      worktreeBootstrapHost: this.worktreeBootstrapHost(),
    };
  }

  private worktreeBootstrapHost(): WorktreeBootstrapHostContext {
    return {
      validateWorktreeBootstrapPreconditions: () => this.validateWorktreeBootstrapPreconditions(),
      executeWorktreeBootstrap: (userPrompt) =>
        this.executeWorktreeBootstrapForActiveBundle(userPrompt),
      resolveWorktreeBootstrapSessionKey: () => this.activeBundle().id,
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
    };
  }

  private validateWorktreeBootstrapPreconditions(): void {
    const state = this.requireState();
    const bundle = this.activeBundle();

    if (!state.git.isRepository) {
      throw new Error(i18n.t("error.notGitRepoForWorktree"));
    }

    const baseBranch = bundle.pendingGitBranch ?? state.git.branch;
    if (!baseBranch) {
      throw new Error(i18n.t("error.cannotDetermineBaseBranch"));
    }
    if (!state.git.branches.includes(baseBranch)) {
      throw new Error(i18n.t("error.baseBranchNotFound", { branch: baseBranch }));
    }
  }

  private requestWorkspaceCapabilityTrust = (
    request: WorkspaceCapabilityTrustRequest,
  ): Promise<WorkspaceCapabilityTrustDecision> => {
    return new Promise<WorkspaceCapabilityTrustDecision>((resolve, reject) => {
      this.workspaceCapabilityTrustTail = this.workspaceCapabilityTrustTail
        .catch(() => undefined)
        .then(
          () =>
            new Promise<void>((slotDone) => {
              this.pendingWorkspaceCapabilityTrust = request;
              this.workspaceCapabilityTrustWaiter = {
                resolve: (decision) => {
                  resolve(decision);
                  slotDone();
                },
                reject: (error) => {
                  reject(error);
                  slotDone();
                },
              };
              this.emitLiveSnapshotUpdate();
            }),
        );
    });
  };

  private async runSessionEndForBundle(
    bundle: SessionBundle,
    reason: SessionEndHookInput["reason"],
  ): Promise<void> {
    await runRemoteDesktopSessionEnd(bundle.runtime, reason);
  }

  private async runSessionStartForBundle(
    bundle: SessionBundle,
    source: SessionStartHookInput["source"],
  ): Promise<void> {
    await runRemoteDesktopSessionStart(bundle.runtime, source);
  }

  private enqueueRemoteWorkspaceCapabilityTrust(
    requestId: string,
    request: WorkspaceCapabilityTrustRequest,
    runtime: unknown,
  ): void {
    this.workspaceCapabilityTrustTail = this.workspaceCapabilityTrustTail
      .catch(() => undefined)
      .then(
        () =>
          new Promise<void>((finish) => {
            this.pendingWorkspaceCapabilityTrust = request;
            this.pendingRemoteWorkspaceCapabilityTrust = {
              requestId,
              runtime,
              finish,
            };
            this.emitLiveSnapshotUpdate();
          }),
      );
    void this.workspaceCapabilityTrustTail;
  }

  /**
   * Queue sessionStart off the runSerialized critical section. Trust prompts await the
   * user and must not hold the host mutex (otherwise openSession / bootstrap stall).
   */
  private scheduleSessionStartForBundle(
    bundle: SessionBundle,
    source: SessionStartHookInput["source"],
  ): void {
    const bundleId = bundle.id;
    this.sessionStartTail = this.sessionStartTail
      .catch(() => undefined)
      .then(async () => {
        const target = this.sessionRegistry.get(bundleId);
        if (!target) {
          return;
        }
        try {
          await this.runSessionStartForBundle(target, source);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[desktop-host] sessionStart failed", { bundleId, source, error });
          this.lastRuntimeError = message;
          this.emitLiveSnapshotUpdate();
        }
      });
    void this.sessionStartTail;
  }

  private sessionActivationContext(): SessionActivationContext {
    return {
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      ensureInitialized: (workspaceRootOverride, options) =>
        this.ensureInitialized(workspaceRootOverride, options),
      requireState: () => this.requireState(),
      isInitialized: () => this.initialized,
      currentWorkspaceRoot: () => this.state?.workspaceRoot,
      currentRuntime: () => this.runtime,
      sessionRegistry: () => this.sessionRegistry,
      persistSessionBundle: (bundle, options) => this.persistSessionBundle(bundle, options),
      finalizeTodoScopeForNewActiveBundle: (bundle, workspaceRoot) =>
        this.finalizeTodoScopeForNewActiveBundle(bundle, workspaceRoot),
      resetStreamingPlacementState: (full, bundle) =>
        this.resetStreamingPlacementState(full, bundle),
      findEphemeralSession: (filePath) => this.findEphemeralSession(filePath),
      createMessageTimelineFromMessages: (messages, timelineSnapshot) =>
        this.createMessageTimelineFromMessages(messages, timelineSnapshot),
      syncPlanStateForBundle: (bundle) => this.syncPlanStateForBundle(bundle),
      syncHostWorkspaceRootToActiveBundle: (bundle) =>
        this.syncHostWorkspaceRootToActiveBundle(bundle),
      syncHostActiveModelToActiveBundle: (bundle) => this.syncHostActiveModelToActiveBundle(bundle),
      tickSession: (bundle) => this.tickSession(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      flushDeferredRuntimeRefreshIfIdle: (bundle) => this.flushDeferredRuntimeRefreshIfIdle(bundle),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      scheduleSessionExtensionWarmup: (event) =>
        this.scheduleExtensionWarmup({ type: "session", event }),
      buildSnapshot: () => this.buildSnapshot(),
      buildSnapshotProjectedForBundle: (bundle) => this.buildSnapshotProjectedForBundle(bundle),
      clearSubagentViewerTarget: () => this.clearSubagentViewerTarget(),
      runSessionEndForBundle: (bundle, reason) => this.runSessionEndForBundle(bundle, reason),
      runSessionStartForBundle: async (bundle, source) => {
        this.scheduleSessionStartForBundle(bundle, source);
      },
    };
  }

  private paneSessionScopeContext(): PaneSessionScopeHostContext {
    return {
      sessionRegistry: () => this.sessionRegistry,
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
    };
  }

  private sessionSplitContext(): SessionSplitHostContext {
    return {
      ...this.sessionActivationContext(),
      visiblePaneSessionPaths: () => this.visiblePaneSessionPaths,
      setVisiblePaneSessionPaths: (paths) => {
        this.visiblePaneSessionPaths = [...paths];
        this.sessionRegistry.setProtectedSessionPaths(paths);
      },
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
    };
  }

  private paneWorkspaceContext(): PaneWorkspaceHostContext {
    return {
      ...this.sessionSplitContext(),
      adoptProjectWorkspaceForForeground: async (workspaceRoot, options) => {
        await this.adoptWorkspaceRootForActiveBundle(workspaceRoot, options);
        const state = this.requireState();
        state.workspaceBinding = "project";
        state.config = {
          ...state.config,
          workspaceBinding: "project",
          recentWorkspaces: mergeRecentWorkspaceRoots(state.config.recentWorkspaces, workspaceRoot),
          lastProjectWorkspaceRoot: workspaceRoot,
        };
        await saveConfig(state.config);
      },
      adoptNoWorkspaceForForeground: (options) =>
        this.adoptNoWorkspaceBindingForActiveBundle(options),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      invalidatePaneSessionSliceCache: (sessionPath) => {
        this.paneSessionSliceCache.delete(path.resolve(sessionPath));
      },
      invalidateAllPaneSessionSliceCache: () => {
        this.paneSessionSliceCache.clear();
      },
    };
  }

  private async ensureVisiblePaneScopedGit(): Promise<void> {
    if (this.visiblePaneSessionPaths.length <= 1) {
      return;
    }
    await ensureVisiblePaneScopedGitSnapshots(this.paneWorkspaceContext());
    this.paneSessionSliceCache.clear();
  }

  private paneModelContext(): PaneModelHostContext {
    return {
      ...this.sessionSplitContext(),
      adoptActiveModelForForeground: (modelRef) => this.adoptActiveModelForForeground(modelRef),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      invalidatePaneSessionSliceCache: (sessionPath) => {
        this.paneSessionSliceCache.delete(path.resolve(sessionPath));
      },
      invalidateAllPaneSessionSliceCache: () => {
        this.paneSessionSliceCache.clear();
      },
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
    };
  }

  private async adoptActiveModelForForeground(modelRef: ModelRef): Promise<void> {
    const state = this.requireState();
    const bundle = this.activeBundle();
    const activeProfile = resolveModelProfile(state.config, modelRef);
    if (!activeProfile) {
      throw new Error(i18n.t("error.modelNotFound", { model: modelRef.name }));
    }
    const resolvedRef = activeProfile.ref;

    const modelChanged = !modelRefsEqual(state.config.activeModel, resolvedRef);
    bundle.activeModel = resolvedRef;
    const runtimeBusy = bundle.runtime?.isBusy() === true;
    if (!modelChanged) {
      if (!runtimeBusy) {
        await this.refreshRuntimeForBundle(bundle);
      }
      this.syncActiveRuntimePointer();
      return;
    }

    state.config.activeModel = resolvedRef;
    await saveConfig(state.config);
    this.clearActiveBundleContextUsage();
    if (runtimeBusy) {
      bundle.deferredRuntimeRefreshWhileBusy = true;
    } else {
      await this.refreshRuntimeForBundle(bundle);
    }
    this.syncActiveRuntimePointer();
    // Syncing pane model on session switch must not bump sidebar list order.
    await this.persistSessionBundle(bundle, {
      fromRuntime: this.runtime,
      bumpListSortAt: false,
    });
  }

  private async syncHostActiveModelToActiveBundle(
    bundle: SessionBundle = this.activeBundle(),
  ): Promise<boolean> {
    const state = this.requireState();
    if (!needsHostActiveModelSync(bundle, state)) {
      return false;
    }
    await this.adoptActiveModelForForeground(resolveEffectivePaneActiveModel(bundle, state));
    return true;
  }

  private sideChatSessionContext(): SideChatSessionHostContext {
    const split = this.sessionSplitContext();
    return {
      ...split,
      requireRuntime: () => this.requireRuntime(),
      currentRuntime: () => this.runtime,
      isBundleConversationBusy: (bundle) => this.isBundleConversationBusy(bundle),
      isBundleReadOnly: (bundle) => bundle.activeSession?.readOnly === true,
    };
  }

  private isBundleConversationBusy(bundle: SessionBundle): boolean {
    if (this.sessionRegistry.isBundleBusy(bundle)) {
      return true;
    }
    if (isSessionBundleBusy(bundle)) {
      return true;
    }
    return bundle.queuedUserTurns.length > 0;
  }

  private forkSessionContext(): ForkSessionHostContext {
    const activation = this.sessionActivationContext();
    return {
      ...activation,
      requireRuntime: () => this.requireRuntime(),
      isConversationBusy: () => {
        const runtime = this.runtime;
        const bundle = this.sessionRegistry.getActive();
        if (!runtime || !bundle) {
          return false;
        }
        if (runtime.isBusy()) {
          return true;
        }
        const snapshot = this.buildSnapshot();
        return (
          snapshot.conversation.pendingToolApproval !== undefined ||
          snapshot.conversation.pendingQuestions !== undefined
        );
      },
      isActiveSessionReadOnly: () => this.activeBundle().activeSession?.readOnly === true,
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
    };
  }

  private dreamCollectorContext(): DreamCollectorServiceContext {
    return {
      state: () => this.state,
      initialized: () => this.initialized,
      runtimeBusy: () => this.runtime?.isBusy() === true,
      running: () => this.dreamCollectorRunning,
      setRunning: (running) => {
        this.dreamCollectorRunning = running;
      },
      lastTickUnixMs: () => this.dreamCollectorLastTickUnixMs,
      setLastTickUnixMs: (value) => {
        this.dreamCollectorLastTickUnixMs = value;
      },
      status: () => this.dreamCollectorStatus,
      setStatus: (next) => this.setDreamCollectorStatus(next),
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      activeBundle: () => this.activeBundle(),
      refreshRuntime: () => this.refreshRuntime(),
      clearLastRuntimeError: () => {
        this.lastRuntimeError = "";
      },
    };
  }

  /** When a bundle is passed, the context applies to that bundle (background queue drain); otherwise it defaults to the foreground active one. */
  private conversationContinuationContext(bundle?: SessionBundle): ConversationContinuationContext {
    return {
      activeBundle: () => bundle ?? this.activeBundle(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      orchestrationFor: (bundle) => this.orchestrationFor(bundle),
      lastToolSnapshotLogSignature: () => this.lastToolSnapshotLogSignature,
      setLastToolSnapshotLogSignature: (signature) => {
        this.lastToolSnapshotLogSignature = signature;
      },
    };
  }

  private sessionTodosContext(): SessionTodosHostContext {
    return {
      todoClearingBySession: () => this.todoClearingBySession,
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      getActiveBundle: () => this.sessionRegistry.getActive(),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      emitLiveSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
    };
  }

  /** When a bundle is passed, the rewind record applies to that bundle (background queue drain); otherwise it defaults to the foreground active one. */
  private rewindHostContext(bundle?: SessionBundle): RewindHostContext {
    const target = () => bundle ?? this.activeBundle();
    return {
      state: () => this.state,
      requireState: () => this.requireState(),
      activeBundle: () => target(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      runtime: () => (bundle ? bundle.runtime : this.runtime),
      requireRuntime: () => this.requireRuntime(),
      desktopMessages: () => target().messageTimeline.toMessages(),
      archiveMessages: () =>
        buildArchiveMessagesFromConversation(target().messageTimeline.toMessages()),
      archiveAssistantAux: () =>
        buildArchiveAssistantAuxFromConversation(target().messageTimeline.toMessages()),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      cancelTodoClearing: (sessionKey) => this.cancelTodoClearing(sessionKey),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      createMessageTimelineFromMessages: (messages) =>
        this.createMessageTimelineFromMessages(messages),
      resetStreamingPlacementState: (full) => this.resetStreamingPlacementState(full),
    };
  }

  private hostInitializationContext(): HostInitializationContext {
    return {
      initialized: () => this.initialized,
      state: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      setInitialized: (initialized) => {
        this.initialized = initialized;
      },
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      setToolExecutor: (executor) => {
        this.toolExecutor = executor;
      },
      sessionRegistry: () => this.sessionRegistry,
      resetStreamingPlacementState: (full) => this.resetStreamingPlacementState(full),
      refreshExtensionsList: (options) => this.refreshExtensionsList(options),
      seedBuiltInExtensions: async () => {
        await ensureBuiltInExtensions({
          spiritDataDir: spiritDataDir(),
          hostKind: "desktop",
          manager: this.extensionManager(),
        });
      },
      refreshRuntime: () => this.refreshRuntime(),
      refreshLspSnapshot: () => this.refreshLspSnapshot(),
      deactivateExtensions: () => this.extensionManager().deactivateAll(),
      invalidateExtensionWarmup: () => this.invalidateExtensionWarmup(),
      scheduleExtensionWarmup: (trigger) => this.scheduleExtensionWarmup(trigger),
      loadDesktopPlanSnapshot,
    };
  }

  private createBundleOrchestration(bundle: SessionBundle): {
    assistantMessages: DesktopAssistantMessageStateMachine;
    runtimeEvents: DesktopRuntimeEventOrchestrator;
    conversationSnapshotView: DesktopConversationSnapshotView;
  } {
    const allocateMessageId = () => {
      const next = bundle.messageIdCounter;
      bundle.messageIdCounter += 1;
      return next;
    };
    const conversationSnapshotView = new DesktopConversationSnapshotView(allocateMessageId);
    const assistantMessages = new DesktopAssistantMessageStateMachine({
      messages: () => bundle.messages,
      setMessages: (messages) => {
        bundle.messages = messages;
      },
      allocateMessageId,
      isRuntimeBusy: () => bundle.runtime?.isBusy() ?? false,
    });
    const runtimeEvents = new DesktopRuntimeEventOrchestrator({
      runtime: () => bundle.runtime,
      messages: () => bundle.messages,
      allocateMessageId,
      assistantMessages,
      messageTimeline: () => bundle.messageTimeline,
      takeNextAssistantSegmentKind: () => this.takeNextTimelineAssistantSegmentKind(bundle),
      conversationSnapshotView,
      currentWorkspaceRoot: () => bundle.workspaceRoot,
      clearCurrentTurnSkills: () => {
        bundle.currentTurnSkills = [];
      },
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      refreshArchiveFromRuntime: () => this.refreshArchiveFromRuntime(bundle),
      dispatchExtensionEvent: (event) => {
        void this.dispatchExtensionEvent(event);
      },
      bindFileChangesToToolMessage: (execution, messageId) => {
        this.bindFileChangesToToolMessage(bundle, execution, messageId);
      },
      onTodoStoreMutated: () => {
        void this.runSerialized(async () => {
          await this.refreshTodoSnapshotForBundle(bundle);
          if (bundle.id === this.sessionRegistry.activeSessionId()) {
            this.emitLiveSnapshotUpdate();
          }
        });
      },
      todoItemsBeforeWrite: () =>
        bundle.cachedTodoSnapshot?.items.map(({ title, status }) => ({ title, status })) ?? [],
      lineDeltaForDeleteFile: (inputPath) =>
        lineDeltaForDeleteFilePath(
          { workspaceRoot: bundle.workspaceRoot, spiritDataDir: spiritDataDir() },
          inputPath,
        ),
      deleteFileBaselineForPath: (inputPath) =>
        deleteFileBaselineTextForPath(
          { workspaceRoot: bundle.workspaceRoot, spiritDataDir: spiritDataDir() },
          inputPath,
        ),
      resolveActiveModel: () => {
        const state = this.state;
        if (!state) {
          return undefined;
        }
        const activeModelRef = resolveEffectivePaneActiveModel(bundle, state);
        return resolveModelProfile(state.config, activeModelRef) ?? undefined;
      },
      resolveCatalogHints: () => buildModelCatalogHints(this.requireState().config),
      setContextUsage: (usage) => {
        bundle.contextUsage = usage;
      },
      refreshContextUsageCatalog: ({ usage, activeModel }) => {
        void this.refreshContextUsageCatalogForBundle(bundle, usage, activeModel);
      },
    });
    return { assistantMessages, runtimeEvents, conversationSnapshotView };
  }

  private syncActiveRuntimePointer(): void {
    this.runtime = this.sessionRegistry.getActive()?.runtime;
  }

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    const snapshot = await this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot, {
        workspaceBinding: request?.workspaceBinding,
        deferExtensionWarmup: true,
        ...(request?.workspaceBinding === "none" ? { preserveRecentWorkspaces: true } : {}),
      });
      this.startDreamCollectorMonitorIfNeeded();
      this.startAutomationSchedulerMonitorIfNeeded();
      await this.refreshAutomationsListCache();
      if (request?.isolateSession) {
        this.clearSubagentViewerTarget();
        const state = this.requireState();
        const bundle = this.sessionRegistry.beginNewBackground(state.workspaceRoot);
        const basicInfoHost = basicInfoHostFromClientHost(request.clientHost);
        if (basicInfoHost) {
          bundle.basicInfoHost = basicInfoHost;
        }
        await this.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
        this.lastRuntimeError = "";
        return this.buildSnapshotProjectedForBundle(bundle);
      }
      const active = this.activeBundle();
      const basicInfoHost = basicInfoHostFromClientHost(request?.clientHost);
      if (basicInfoHost) {
        active.basicInfoHost = basicInfoHost;
      }
      return this.buildSnapshot();
    }, "bootstrap");
    this.scheduleExtensionWarmup({ type: "startup", workspaceRoot: snapshot.workspaceRoot });
    this.scheduleModelCatalogStartupRefresh();
    return snapshot;
  }

  private scheduleModelCatalogStartupRefresh(): void {
    void this.runModelCatalogStartupRefresh();
  }

  private async runModelCatalogStartupRefresh(): Promise<void> {
    if (this.modelCatalogStartupRefreshInFlight) {
      return this.modelCatalogStartupRefreshInFlight;
    }

    this.modelCatalogStartupRefreshInFlight = (async () => {
      try {
        const state = this.state;
        if (!state) {
          return;
        }
        const fetchSummary = await fetchConfiguredModelCatalogsOnStartup(state.config, {
          forceRefresh: false,
        });
        await this.runSerialized(async () => {
          const applyState = this.state;
          if (!applyState) {
            return;
          }
          const summary = applyConfiguredModelCatalogRefreshResults(
            applyState.config,
            fetchSummary.fetched,
          );
          if (summary.merged > 0 || summary.synced > 0 || summary.pruned > 0) {
            await saveConfig(applyState.config);
            for (const name of summary.prunedModelNames) {
              await removeModelApiKey(name);
            }
            if (this.runtime?.isBusy() !== true) {
              await this.refreshRuntime();
            }
          }
          if (
            summary.refreshed > 0 ||
            summary.merged > 0 ||
            summary.synced > 0 ||
            summary.pruned > 0
          ) {
            this.emitLiveSnapshotUpdate();
          }
        }, "model-catalog-startup-refresh-apply");
      } catch {
        // best-effort: a catalog refresh failure at startup must not block Desktop
      } finally {
        this.modelCatalogStartupRefreshInFlight = null;
      }
    })();

    return this.modelCatalogStartupRefreshInFlight;
  }

  subscribeDreamUpdates(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.dreamUpdateListeners.add(listener);
    this.startDreamCollectorMonitorIfNeeded();
    return () => {
      this.dreamUpdateListeners.delete(listener);
    };
  }

  subscribeAutomationsUpdates(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.automationUpdateListeners.add(listener);
    this.startAutomationSchedulerMonitorIfNeeded();
    return () => {
      this.automationUpdateListeners.delete(listener);
    };
  }

  subscribeSessionListUpdates(listener: () => void): () => void {
    this.sessionListUpdateListeners.add(listener);
    return () => {
      this.sessionListUpdateListeners.delete(listener);
    };
  }

  async rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot> {
    return rememberWorkspaceRootCommand(this.workspaceGitCommandContext(), request);
  }

  async forgetWorkspace(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot> {
    return forgetWorkspaceRootCommand(this.workspaceGitCommandContext(), request);
  }

  async commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot> {
    return commitChangesCommand(this.workspaceGitCommandContext(), request);
  }

  async updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot> {
    return updateConfigCommand(this.modelCommandContext(), request);
  }

  async installLspProvider(request: InstallLspProviderRequest): Promise<DesktopSnapshot> {
    return installLspProviderCommand(this.modelCommandContext(), request);
  }

  async setWebHostAuthTokenHash(authTokenHash: string): Promise<DesktopSnapshot> {
    return setWebHostAuthTokenHashCommand(this.workspaceGitCommandContext(), authTokenHash);
  }

  async previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse> {
    return previewModelsCommand(request);
  }

  async addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot> {
    return addProviderModelsCommand(this.modelCommandContext(), request);
  }

  async addModel(request: AddModelRequest): Promise<DesktopSnapshot> {
    return addModelCommand(this.modelCommandContext(), request);
  }

  async removeModel(request: RemoveModelRequest): Promise<DesktopSnapshot> {
    return removeModelCommand(this.modelCommandContext(), request);
  }

  async removeProviderModels(request: RemoveProviderModelsRequest): Promise<DesktopSnapshot> {
    return removeProviderModelsCommand(this.modelCommandContext(), request);
  }

  async removeProviderGroup(request: RemoveProviderGroupRequest): Promise<DesktopSnapshot> {
    return removeProviderGroupCommand(this.modelCommandContext(), request);
  }

  async createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot> {
    return createSkillCommand(this.extensionCommandContext(), request);
  }

  async createRule(request: CreateRuleRequest): Promise<DesktopSnapshot> {
    return createRuleCommand(this.extensionCommandContext(), request);
  }

  async deleteRule(request: DeleteRuleRequest): Promise<DesktopSnapshot> {
    return deleteRuleCommand(this.extensionCommandContext(), request);
  }

  async addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot> {
    return addMcpServerCommand(this.extensionCommandContext(), request);
  }

  async deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot> {
    return deleteMcpServerCommand(this.extensionCommandContext(), request);
  }

  async saveHookEntry(request: SaveHookEntryRequest): Promise<DesktopSnapshot> {
    return saveHookEntryCommand(this.extensionCommandContext(), request);
  }

  async deleteHookEntry(request: DeleteHookEntryRequest): Promise<DesktopSnapshot> {
    return deleteHookEntryCommand(this.extensionCommandContext(), request);
  }

  async inspectMcpServer(name: string): Promise<DesktopMcpServerInspection> {
    return inspectMcpServerCommand(this.extensionCommandContext(), name);
  }

  async importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot> {
    return importExtensionCommand(this.extensionCommandContext(), request);
  }

  async installBuiltInExtension(request: InstallBuiltInExtensionRequest): Promise<DesktopSnapshot> {
    return installBuiltInExtensionCommand(this.extensionCommandContext(), request);
  }

  async addMarketplaceSource(
    request: AddMarketplaceSourceRequest,
  ): Promise<MarketplaceSourceCommandResult> {
    return addMarketplaceSourceCommand(this.extensionCommandContext(), request);
  }

  async removeMarketplaceSource(request: RemoveMarketplaceSourceRequest): Promise<DesktopSnapshot> {
    return removeMarketplaceSourceCommand(this.extensionCommandContext(), request);
  }

  async installMarketplaceExtension(
    request: InstallMarketplaceExtensionRequest,
  ): Promise<MarketplaceInstallCommandResult> {
    return installMarketplaceExtensionCommand(this.extensionCommandContext(), request);
  }

  async updateExtension(request: UpdateExtensionRequest): Promise<MarketplaceUpdateCommandResult> {
    return updateExtensionCommand(this.extensionCommandContext(), request);
  }

  async deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot> {
    return deleteExtensionCommand(this.extensionCommandContext(), request);
  }

  async setExtensionEnabled(request: SetExtensionEnabledRequest): Promise<DesktopSnapshot> {
    return setExtensionEnabledCommand(this.extensionCommandContext(), request);
  }

  async runExtension(request: RunExtensionRequest): Promise<DesktopSnapshot> {
    return runExtensionCommand(this.extensionCommandContext(), request);
  }

  async updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot> {
    return updateExtensionSettingsCommand(this.extensionCommandContext(), request);
  }

  async updateExtensionSecret(request: UpdateExtensionSecretRequest): Promise<DesktopSnapshot> {
    return updateExtensionSecretCommand(this.extensionCommandContext(), request);
  }

  async deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot> {
    return deleteSkillCommand(this.extensionCommandContext(), request);
  }

  async submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot> {
    return submitSkillSlashCommand(this.extensionCommandContext(), request);
  }

  async submitGitChip(request: SubmitGitChipRequest): Promise<DesktopSnapshot> {
    const snapshot = await submitGitChipCommand(this.extensionCommandContext(), request);
    void this.runCoalescedGitRefresh();
    return snapshot;
  }

  async submitStartImplementing(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error(i18n.t("error.runtimeBusy"));
      }

      const state = this.requireState();
      const bundle = this.activeBundle();
      if (resolveDesktopAgentMode(state.config) !== "agent") {
        state.config.agentMode = "agent";
        await saveConfig(state.config);
        state.metadata = await loadHostMetadata(state.workspaceRoot, "agent", {
          activePlanPath: bundle.activePlanPath,
          workspaceBinding: state.workspaceBinding,
        });
        bundle.toolExecutor?.setAgentModeToolExposure("agent");
      }
      return this.submitUserTurnAfterInitialized(
        buildStartImplementingUserTurn(
          {
            workspaceRoot: state.workspaceRoot,
            spiritDataDir: spiritDataDir(),
          },
          bundle.activePlanPath,
        ),
        {
          displayText: i18n.t("workspace.startImplementing"),
        },
      );
    });
  }

  async compactHistory(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (this.activeBundle().activeSession?.readOnly) {
        throw new Error(i18n.t("error.readonlySessionCompact"));
      }
      if (runtime.currentPendingApproval() || runtime.currentPendingQuestions()) {
        throw new Error(i18n.t("error.pendingApprovalCompact"));
      }
      if (runtime.isBusy()) {
        throw new Error(i18n.t("error.runtimeBusy"));
      }

      // Match CLI `/compact`: start async compaction and let poll() stream aux updates.
      await runtime.startManualHistoryCompaction();
      try {
        await runtime.poll();
        this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      } catch (error) {
        runtime.abort();
        this.activeBundle().messageTimeline.abortActiveAssistantSegment();
        this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
        throw error;
      }

      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.flushDeferredRuntimeRefreshIfIdle();
      return this.buildSnapshot();
    });
  }

  async exportSession(): Promise<{ snapshot: DesktopSnapshot; path: string }> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });

      const state = this.requireState();
      const runtime = this.requireRuntime();
      const remoteState = await exportRemoteDesktopState(runtime);
      const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
      const overlay = overlayExtensionRulesAndSkills(
        state.metadata.rules.enabledRules,
        state.metadata.skills.enabledSkillCatalog,
        state.extensionInstructionContributions,
      );
      const rulesSystemPrompt = buildRulesSystemMessage(overlay.rules);
      const skillsCatalogSystemPrompt = buildSkillsCatalogSystemMessage(overlay.skills);
      const mcpCatalogSystemPrompt = buildMcpCatalogSystemMessage(
        this.requireToolExecutor().mcpToolCatalogSnapshot(),
      );
      const agentModeSystemPrompt = buildAgentModeSystemMessage(state.metadata.planMetadata);
      const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
      const dreamsSystemPrompt = buildDreamsSystemMessage(
        await buildDreamContextText({
          workspaceRoot: state.workspaceRoot,
          gitBranch: state.git.branch,
        }),
      );
      const basicInfoSystemPrompt = buildBasicInfoSystemMessage(
        buildDesktopRuntimeBasicInfo(
          state.workspaceRoot,
          this.requireToolExecutor(),
          gitBranchLabelForBasicInfo(state.git),
          this.activeBundle().activeSession?.filePath ?? this.activeBundle().id,
        ),
      );
      const exportedAtUnixSecs = Math.floor(Date.now() / 1000);
      const filePath = path.join(
        tmpdir(),
        `spirit-llm-export-${exportedAtUnixSecs}-${process.pid}.json`,
      );
      const exportPayload = {
        export_version: 2,
        exported_at_unix_secs: exportedAtUnixSecs,
        active_model: modelRefKey(state.config.activeModel),
        api_base: currentApiBase(state.config),
        working_directory: state.workspaceRoot,
        system_prompts: remoteState?.systemPrompts ?? {
          ...(this.runtimeTransport.llmSystemPromptsForExport() as Record<string, unknown>),
          tool_agent: buildToolAgentHostPrompt(
            state.config.activeModel.name,
            resolveModelProfile(state.config, state.config.activeModel)?.provider,
          ),
          ...(rulesSystemPrompt === undefined ? {} : { rules: rulesSystemPrompt }),
          ...(skillsCatalogSystemPrompt === undefined
            ? {}
            : { skillsCatalog: skillsCatalogSystemPrompt }),
          ...(mcpCatalogSystemPrompt === undefined ? {} : { mcpCatalog: mcpCatalogSystemPrompt }),
          agentMode: agentModeSystemPrompt,
          ...(extensionsSystemPrompt === undefined ? {} : { extensions: extensionsSystemPrompt }),
          ...(dreamsSystemPrompt === undefined ? {} : { dreams: dreamsSystemPrompt }),
          ...(basicInfoSystemPrompt === undefined ? {} : { basicInfo: basicInfoSystemPrompt }),
          hostUi: buildDesktopUiMarkdownPromptSection(),
        },
        note: i18n.t("error.exportSessionNote"),
        message_count: remoteState?.apiMessages.length ?? runtime.history().length,
        messages:
          remoteState?.apiMessages ??
          this.runtimeTransport.llmHistoryAsApiMessages([...runtime.history()]),
        api_request_trace_count: remoteState?.requestTrace.length ?? runtime.requestTrace().length,
        api_request_trace: remoteState?.requestTrace ?? [...runtime.requestTrace()],
      };

      await writeFile(filePath, `${JSON.stringify(exportPayload, null, 2)}\n`, "utf8");

      const snapshot = await this.appendInlineAssistantReply(
        "/export-session",
        [i18n.t("error.exportSessionExported"), filePath].join("\n"),
      );

      return {
        snapshot,
        path: filePath,
      };
    });
  }

  async submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const trimmed = request.text.trim();
      const hasLocalFiles =
        Array.isArray(request.localFilePaths) && request.localFilePaths.length > 0;
      const hasReferencedPaths =
        Array.isArray(request.referencedWorkspaceFilePaths) &&
        request.referencedWorkspaceFilePaths.length > 0;
      if (!trimmed && !hasLocalFiles && !hasReferencedPaths) {
        throw new Error(i18n.t("error.messageRequired"));
      }

      const targetSessionPath = request.sessionPath?.trim();
      const previousActive = this.sessionRegistry.getActive();
      const previousActiveId = this.sessionRegistry.activeSessionId();
      let restoredActive = false;

      const restorePreviousActive = () => {
        if (!restoredActive && previousActive && previousActiveId) {
          this.sessionRegistry.activateExisting(previousActive);
          this.syncActiveRuntimePointer();
          restoredActive = true;
        }
      };

      try {
        if (targetSessionPath) {
          const targetBundle = this.sessionRegistry.findBySessionPath(targetSessionPath);
          if (!targetBundle) {
            throw new Error("Session not found.");
          }
          if (this.sessionRegistry.getActive() !== targetBundle) {
            this.sessionRegistry.activateExisting(targetBundle);
            this.syncActiveRuntimePointer();
          }
        }

        const hydratedText = await hydrateSessionReferenceWiresInUserText(request.text);
        const bundle = this.activeBundle();
        const explicitWorkspaceFiles = await this.resolveMergedExplicitWorkspaceFiles(request);
        const turnSkills = await this.resolveTurnSkillsFromChipAliases(request.skillChipAliases);
        const resolvedTargetPath = targetSessionPath ? path.resolve(targetSessionPath) : null;
        let snapshot: DesktopSnapshot;
        if (canEnqueueUserTurn(bundle)) {
          snapshot = await enqueueUserTurnCommand(this.sessionTurnContext(), {
            text: hydratedText,
            explicitWorkspaceFiles,
            turnSkills,
            chipNavigateMeta: request.chipNavigateMeta,
          });
        } else if (bundle.messages.length === 0 && bundle.workLocation === "worktree") {
          snapshot = await startWorktreeBootstrapTurnCommand(
            this.sessionTurnContext(),
            this.worktreeBootstrapHost(),
            hydratedText,
            { explicitWorkspaceFiles, turnSkills, chipNavigateMeta: request.chipNavigateMeta },
          );
        } else {
          snapshot = await this.submitUserTurnAfterInitialized(hydratedText, {
            explicitWorkspaceFiles,
            turnSkills,
            chipNavigateMeta: request.chipNavigateMeta,
          });
        }

        if (resolvedTargetPath) {
          const promotedPath = path.resolve(bundle.activeSession?.filePath ?? bundle.id);
          if (promotedPath !== resolvedTargetPath) {
            this.replaceVisiblePaneSessionPath(resolvedTargetPath, promotedPath);
          }
          restorePreviousActive();
          return this.buildSnapshotProjectedForBundle(bundle);
        }

        restorePreviousActive();
        return snapshot;
      } catch (error) {
        restorePreviousActive();
        throw error;
      }
    }, "submit-user-turn");
  }

  async setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const bundle = this.activeBundle();
      bundle.loopEnabled = enabled;
      const toolExecutor = await this.ensureToolExecutor(bundle);
      toolExecutor.setLoopToolExposure(enabled);
      this.runtime?.setLoopEnabled(enabled);
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async setApprovalLevel(approvalLevel: ApprovalLevel): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const normalized = normalizeApprovalLevel(approvalLevel);
      const bundle = this.activeBundle();
      bundle.approvalLevel = normalized;
      const toolExecutor = await this.ensureToolExecutor(bundle);
      toolExecutor.setApprovalLevel(normalized);
      await setRemoteDesktopApprovalLevel(bundle.runtime, normalized);
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async setPendingGitBranch(branch: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const normalized = branch.trim();
      if (!state.git.isRepository) {
        throw new Error(i18n.t("error.notGitRepo"));
      }
      if (!normalized) {
        throw new Error(i18n.t("error.branchNameRequired"));
      }
      if (!state.git.branches.includes(normalized)) {
        throw new Error(i18n.t("error.branchNotFound", { branch: normalized }));
      }
      this.activeBundle().pendingGitBranch = normalized;
      return this.buildSnapshot();
    });
  }

  async setWorkLocation(workLocation: WorkLocationKind): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      this.activeBundle().workLocation = normalizeWorkLocationKind(workLocation);
      return this.buildSnapshot();
    });
  }

  async checkoutGitBranch(request: CheckoutGitBranchRequest): Promise<DesktopSnapshot> {
    return checkoutGitBranchCommand(this.workspaceGitCommandContext(), request);
  }

  async mergeWorktreeToMain(): Promise<DesktopSnapshot> {
    return mergeWorktreeToMainCommand(this.workspaceGitCommandContext());
  }

  async pushGitBranch(): Promise<DesktopSnapshot> {
    return pushGitBranchCommand(this.workspaceGitCommandContext());
  }

  async abortConversation(request: AbortConversationRequest = {}): Promise<DesktopSnapshot> {
    await this.ensureInitialized(undefined, { fastPath: true });

    const targetSessionPath = request.sessionPath?.trim();
    const previousActive = this.sessionRegistry.getActive();
    const previousActiveId = this.sessionRegistry.activeSessionId();
    let restoredActive = false;

    const restorePreviousActive = () => {
      if (!restoredActive && previousActive && previousActiveId) {
        this.sessionRegistry.activateExisting(previousActive);
        this.syncActiveRuntimePointer();
        restoredActive = true;
      }
    };

    try {
      if (targetSessionPath) {
        const targetBundle = this.sessionRegistry.findBySessionPath(targetSessionPath);
        if (!targetBundle) {
          throw new Error("Session not found.");
        }
        if (this.sessionRegistry.getActive() !== targetBundle) {
          this.sessionRegistry.activateExisting(targetBundle);
          this.syncActiveRuntimePointer();
        }
      }

      const snapshot = await abortConversationCommand(this.sessionTurnContext());
      if (targetSessionPath) {
        restorePreviousActive();
        return this.buildSnapshot();
      }
      restorePreviousActive();
      return snapshot;
    } catch (error) {
      restorePreviousActive();
      throw error;
    }
  }

  async reorderQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return reorderQueuedUserTurnCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async sendQueuedUserTurnNow(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return sendQueuedUserTurnNowCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async removeQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return removeQueuedUserTurnCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot> {
    return continueAssistantCompletionCommand(this.sessionTurnContext(), messageId);
  }

  async forkSession(request: ForkSessionRequest): Promise<DesktopSnapshot> {
    return forkSessionCommand(this.forkSessionContext(), request);
  }

  async rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        const aborted = await abortConversationInContext(this.sessionTurnContext());
        if (!aborted && this.requireRuntime().isBusy()) {
          throw new Error(i18n.t("error.runtimeBusy"));
        }
      }
      if (!Number.isFinite(request.messageId)) {
        throw new Error(i18n.t("error.invalidMessageId"));
      }

      const checkpoint = this.activeBundle().rewind.checkpoints.find(
        (candidate) => candidate.messageId === request.messageId,
      );
      if (!checkpoint) {
        throw new Error(i18n.t("error.noCheckpoint"));
      }

      const snapshot = await loadRewindCheckpointSnapshot(
        spiritDataDir(),
        this.activeBundle().rewind.sessionId,
        checkpoint.id,
      );
      if (!snapshot) {
        throw new Error(i18n.t("error.checkpointFileMissing"));
      }

      const changesToRestore = this.activeBundle()
        .rewind.fileChanges.filter((change) => change.sequence > checkpoint.sequence)
        .sort((left, right) => left.sequence - right.sequence);
      const loadedChanges: HostRecordedFileChange[] = [];
      const missingWarnings: FileRewindWarning[] = [];
      for (const metadata of changesToRestore) {
        const stored = await loadRewindFileChange(
          spiritDataDir(),
          this.activeBundle().rewind.sessionId,
          metadata.id,
        );
        if (stored) {
          loadedChanges.push(stored);
        } else {
          missingWarnings.push({
            changeId: metadata.id,
            path: metadata.resolvedPath,
            action: metadata.kind,
            message: i18n.t("error.fileChangeSnapshotMissing"),
          });
        }
      }

      const restoreResult = await restoreHostFileChanges(loadedChanges);
      this.activeBundle().rewindWarnings = [
        ...missingWarnings,
        ...restoreResult.warnings.map((warning) => ({ ...warning })),
      ];

      this.restoreBeforeRewindCheckpoint(snapshot, checkpoint.sequence);
      await this.applyTodosAfterRewind(snapshot);
      return this.submitUserTurnAfterInitialized(request.text, {
        preserveRewindWarnings: true,
        explicitWorkspaceFiles: await this.resolveExplicitLocalFileAttachments(
          request.localFilePaths,
        ),
        chipNavigateMeta: request.chipNavigateMeta,
      });
    });
  }

  private async submitUserTurnAfterInitialized(
    text: string,
    options: SubmitUserTurnAfterInitializedOptions = {},
  ): Promise<DesktopSnapshot> {
    return submitUserTurnAfterInitializedCommand(this.sessionTurnContext(), text, options);
  }

  private async resolveExplicitLocalFileAttachments(
    localFilePaths: readonly string[] | undefined,
  ): Promise<PendingWorkspaceFile[]> {
    if (!Array.isArray(localFilePaths) || localFilePaths.length === 0) {
      return [];
    }

    const attachments: PendingWorkspaceFile[] = [];
    for (const localFilePath of localFilePaths) {
      try {
        attachments.push(await localFileAttachmentFromPath(localFilePath));
      } catch {
        // Consistent with @ file references: silently ignore files that do not exist, are unreadable, or are unsupported.
      }
    }
    return attachments;
  }

  private async resolveReferencedWorkspaceFileAttachments(
    referencePaths: readonly string[] | undefined,
  ): Promise<PendingWorkspaceFile[]> {
    if (!Array.isArray(referencePaths) || referencePaths.length === 0) {
      return [];
    }

    const state = this.requireState();
    const attachments: PendingWorkspaceFile[] = [];
    for (const referencePath of referencePaths) {
      try {
        attachments.push(
          await workspaceFileReferenceAttachmentFromPath(state.workspaceRoot, referencePath),
        );
      } catch {
        // Only workspaceFile chips explicitly inserted by the composer reach this path; silently ignore parse failures.
      }
    }
    return attachments;
  }

  private mergeExplicitWorkspaceFiles(
    ...groups: readonly PendingWorkspaceFile[][]
  ): PendingWorkspaceFile[] {
    const seen = new Set<string>();
    const merged: PendingWorkspaceFile[] = [];
    for (const group of groups) {
      for (const file of group) {
        const key = file.path.replace(/\\/gu, "/").toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        merged.push(file);
      }
    }
    return merged;
  }

  private async resolveMergedExplicitWorkspaceFiles(
    request: Pick<SubmitUserTurnRequest, "localFilePaths" | "referencedWorkspaceFilePaths">,
  ): Promise<PendingWorkspaceFile[]> {
    return this.mergeExplicitWorkspaceFiles(
      await this.resolveExplicitLocalFileAttachments(request.localFilePaths),
      await this.resolveReferencedWorkspaceFileAttachments(request.referencedWorkspaceFilePaths),
    );
  }

  private skillNameFromChipAlias(alias: string): string {
    const trimmed = alias.trim();
    if (!trimmed.startsWith("/")) {
      throw new Error(i18n.t("error.skillNameRequired"));
    }
    return trimmed.slice(1);
  }

  private async resolveTurnSkillsFromChipAliases(
    aliases: readonly string[] | undefined,
  ): Promise<LlmActiveSkill[]> {
    if (!Array.isArray(aliases) || aliases.length === 0) {
      return [];
    }

    const turnSkills: LlmActiveSkill[] = [];
    const seen = new Set<string>();
    for (const alias of aliases) {
      let skillName: string;
      try {
        skillName = this.skillNameFromChipAlias(alias);
      } catch {
        continue;
      }
      const key = skillName.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        const skill = this.requireEnabledSkillEntry(skillName);
        turnSkills.push(await buildActiveSkillPayload(skill));
      } catch {
        // Silently ignore skill chips that are not enabled or do not exist.
      }
    }
    return turnSkills;
  }

  private async appendInlineAssistantReply(
    displayText: string,
    assistantText: string,
  ): Promise<DesktopSnapshot> {
    this.activeBundle().rewindWarnings = [];
    this.clearAssistantContinuationMarkers();
    this.ensureActiveSession(displayText);
    const userMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: "user",
      content: displayText,
      pending: false,
    };
    this.activeBundle().messages.push(userMessage);
    this.activeBundle().messageTimeline.beginUserTurn(userMessage.content, {
      messageId: userMessage.id,
    });
    this.resetStreamingPlacementState(false);
    this.activeOrchestration().assistantMessages.appendAssistantMessage(assistantText);
    this.activeBundle().messageTimeline.beginAssistantSegment("initial");
    this.activeBundle().messageTimeline.materializeCompletedAssistantText(assistantText);
    await this.persistCurrentSessionIfNeeded();
    return this.buildSnapshot();
  }

  async poll(request?: import("../types.js").PollRequest): Promise<DesktopSnapshot> {
    await pollCommand(this.sessionTurnContext());
    const sessionPath = request?.sessionPath?.trim();
    if (!sessionPath) {
      return this.buildSnapshot();
    }
    const bundle = this.sessionRegistry.findBySessionPath(path.resolve(sessionPath));
    if (!bundle) {
      return this.buildSnapshot();
    }
    const projected = this.buildSnapshotProjectedForBundle(bundle);
    return projected;
  }

  async setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot> {
    const trimmed = parentToolCallId?.trim();
    this.subagentViewerTargetToolCallId = trimmed && trimmed.length > 0 ? trimmed : null;
    if (this.subagentViewerTargetToolCallId) {
      const bundle = this.activeBundle();
      await ensureRemoteChildSessionArchivesFresh(bundle.runtime);
      this.refreshArchiveFromRuntime(bundle);
    }
    const snapshot = await this.buildSnapshot();
    return snapshot;
  }

  async abortShell(toolCallId: string): Promise<DesktopSnapshot> {
    const bundle = this.activeBundle();
    await abortRemoteDesktopShell(bundle.runtime, toolCallId);
    return this.buildSnapshot();
  }

  private clearSubagentViewerTarget(): void {
    this.subagentViewerTargetToolCallId = null;
  }

  private applyDrainedRuntimeHostEvents(
    bundle: SessionBundle,
    drained: RuntimeEvent<DesktopToolRequest>[],
  ): void {
    applyDrainedRuntimeHostEvents(this.sessionTurnContext(), bundle, drained);
  }

  private async tickSession(
    bundle: SessionBundle,
    options: { light?: boolean } = {},
  ): Promise<void> {
    return tickSessionCommand(this.sessionTurnContext(), bundle, options);
  }

  async replyPendingApproval(request: ReplyPendingApprovalRequest): Promise<DesktopSnapshot> {
    const sessionPath =
      request.sessionPath?.trim() ?? resolvePendingApprovalSessionPath(this.buildSnapshot());
    if (sessionPath) {
      await withOptionalPaneSessionActivation(
        this.paneSessionScopeContext(),
        sessionPath,
        async () => {
          await replyPendingApprovalCommand(this.sessionTurnContext(), request.decision);
        },
      );
      await this.refreshConfigAfterRememberedApproval(request.decision);
      await this.ensureInitialized(undefined, { fastPath: true });
      return this.buildSnapshot();
    }
    const snapshot = await replyPendingApprovalCommand(this.sessionTurnContext(), request.decision);
    await this.refreshConfigAfterRememberedApproval(request.decision);
    return snapshot;
  }

  /**
   * A config-scope remembered approval is written to config.json inside the host-internal tool
   * service (`savePermissionRule`), bypassing desktop storage. Reload the in-memory config so
   * later desktop saves do not clobber the new rule.
   */
  private async refreshConfigAfterRememberedApproval(
    decision: DesktopApprovalDecision,
  ): Promise<void> {
    if (decision.kind !== "allow" || decision.remember !== "config") {
      return;
    }
    this.requireState().config = await loadConfig();
  }

  async replyPendingQuestions(request: ReplyPendingQuestionsRequest): Promise<DesktopSnapshot> {
    const sessionPath = request.sessionPath?.trim();
    if (sessionPath) {
      await withOptionalPaneSessionActivation(
        this.paneSessionScopeContext(),
        sessionPath,
        async () => {
          await replyPendingQuestionsCommand(this.sessionTurnContext(), request.result);
        },
      );
      await this.ensureInitialized(undefined, { fastPath: true });
      return this.buildSnapshot();
    }
    return replyPendingQuestionsCommand(this.sessionTurnContext(), request.result);
  }

  async replyWorkspaceCapabilityTrust(
    request: ReplyWorkspaceCapabilityTrustRequest,
  ): Promise<DesktopSnapshot> {
    const remote = this.pendingRemoteWorkspaceCapabilityTrust;
    if (remote) {
      try {
        await replyRemoteWorkspaceCapabilityTrust(
          remote.runtime,
          remote.requestId,
          request.decision,
        );
      } finally {
        this.pendingRemoteWorkspaceCapabilityTrust = undefined;
        this.pendingWorkspaceCapabilityTrust = undefined;
        remote.finish();
        this.emitLiveSnapshotUpdate();
      }
      return this.buildSnapshot();
    }
    if (!this.pendingWorkspaceCapabilityTrust || !this.workspaceCapabilityTrustWaiter) {
      throw new Error("No pending workspace capability trust request");
    }
    const waiter = this.workspaceCapabilityTrustWaiter;
    this.workspaceCapabilityTrustWaiter = undefined;
    this.pendingWorkspaceCapabilityTrust = undefined;
    waiter.resolve(request.decision);
    this.emitLiveSnapshotUpdate();
    return this.buildSnapshot();
  }

  openLocalExtensionUi(request: McpUiOpenRequest): Promise<McpUiOpenResult> {
    return new Promise((resolve) => {
      const previous = this.pendingExtensionUiWaiter;
      if (previous) {
        previous.resolve({ kind: "opened", result: { dismissed: true } });
      }
      const requestId = crypto.randomUUID();
      this.pendingExtensionUiWaiter = { requestId, resolve };
      this.pendingExtensionUi = {
        requestId,
        extensionId: request.extensionId,
        viewId: request.viewId,
        ...(request.params === undefined ? {} : { params: request.params }),
      };
      this.emitLiveSnapshotUpdate();
    });
  }

  dismissLocalExtensionUi(): void {
    const waiter = this.pendingExtensionUiWaiter;
    this.pendingExtensionUi = undefined;
    this.pendingExtensionUiWaiter = undefined;
    if (waiter) {
      waiter.resolve({ kind: "opened", result: { dismissed: true } });
    }
    this.emitLiveSnapshotUpdate();
  }

  async resolveExtensionUi(request: ResolveExtensionUiRequest): Promise<DesktopSnapshot> {
    const pending = this.pendingExtensionUi;
    if (!pending || pending.requestId !== request.requestId) {
      return this.buildSnapshot();
    }
    this.pendingExtensionUi = undefined;
    if (this.pendingExtensionUiWaiter?.requestId === request.requestId) {
      this.pendingExtensionUiWaiter.resolve({ kind: "opened", result: request.result });
      this.pendingExtensionUiWaiter = undefined;
      this.emitLiveSnapshotUpdate();
      return this.buildSnapshot();
    }
    await replyRemoteExtensionUi(this.activeBundle().runtime, request.requestId, request.result);
    this.emitLiveSnapshotUpdate();
    return this.buildSnapshot();
  }

  async resetSession(options?: {
    activate?: boolean;
    clientHost?: DesktopClientHost;
  }): Promise<DesktopSnapshot> {
    if (options?.activate === false) {
      return resetSessionBackgroundCommand(this.sessionActivationContext(), {
        clientHost: options.clientHost,
      });
    }
    const snapshot = await resetSessionCommand(this.sessionActivationContext());
    const basicInfoHost = basicInfoHostFromClientHost(options?.clientHost);
    if (basicInfoHost) {
      this.activeBundle().basicInfoHost = basicInfoHost;
    }
    return snapshot;
  }

  async listSessions(): Promise<SessionListItem[]> {
    return listSessionsCommand(this.workspaceGitCommandContext());
  }

  async listDreamsOverview(): Promise<DesktopDreamOverviewItem[]> {
    return listDreamsOverviewCommand(this.workspaceGitCommandContext());
  }

  async listAutomations(): Promise<DesktopAutomationListItem[]> {
    return listAutomationsCommand();
  }

  async getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined> {
    return getAutomationCommand(automationId);
  }

  async createAutomation(request: DesktopCreateAutomationRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await createAutomationCommand(request);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await updateAutomationCommand(automationId, patch);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async deleteAutomation(automationId: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await deleteAutomationCommand(automationId);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await setAutomationEnabledCommand(automationId, enabled);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult> {
    return listWorkspaceExplorerChildrenCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async readGitWorkingTree(): Promise<GitWorkingTreeSnapshot> {
    return readGitWorkingTreeCommand(this.workspaceGitCommandContext());
  }

  async readGitHistory(request: ReadGitHistoryRequest = {}): Promise<GitHistorySnapshot> {
    return readGitHistoryCommand(this.workspaceGitCommandContext(), request);
  }

  async readGitCommitMessage(
    request: ReadGitCommitMessageRequest,
  ): Promise<GitCommitMessageSnapshot> {
    return readGitCommitMessageCommand(this.workspaceGitCommandContext(), request);
  }

  async getGitHubAuthStatus() {
    return getGitHubAuthStatusCommand();
  }

  async beginGitHubDeviceLogin() {
    return beginGitHubDeviceLoginCommand();
  }

  async completeGitHubDeviceLogin() {
    return completeGitHubDeviceLoginCommand();
  }

  async cancelGitHubDeviceLogin() {
    cancelGitHubDeviceLoginCommand();
  }

  async disconnectGitHub() {
    return disconnectGitHubCommand();
  }

  async getGitHubPullRequestForCurrentBranch() {
    await this.ensureInitialized();
    const state = this.requireState();
    return getGitHubPullRequestForCurrentBranchCommand({
      workspaceRoot: state.workspaceRoot,
      git: state.git,
    });
  }

  async getGitHubPullRequestDetail(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestDetailCommand(request);
  }

  async getGitHubPullRequestConversation(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestConversationCommand(request);
  }

  async getGitHubPullRequestFiles(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestFilesCommand(request);
  }

  async getGitHubPullRequestCommits(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestCommitsCommand(request);
  }

  async getGitHubPullRequestChecks(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestChecksCommand(request);
  }

  async mergeGitHubPullRequest(request: MergeGitHubPullRequestRequest) {
    return mergeGitHubPullRequestCommand(request);
  }

  async markGitHubPullRequestReady(request: GetGitHubPullRequestDetailRequest) {
    return markGitHubPullRequestReadyCommand(request);
  }

  async listGitHubPullRequests(request: ListGitHubPullRequestsRequest) {
    return listGitHubPullRequestsCommand(request);
  }

  async listGitHubAutomationRepositories(request: ListGitHubAutomationRepositoriesRequest = {}) {
    return listGitHubAutomationRepositoriesCommand(request);
  }

  async searchGitHubAutomationRepositories(request: SearchGitHubAutomationRepositoriesRequest) {
    return searchGitHubAutomationRepositoriesCommand(request);
  }

  async getGitHubPullRequestTabCounts(request: GetGitHubPullRequestTabCountsRequest) {
    return getGitHubPullRequestTabCountsCommand(request);
  }

  async listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse> {
    return listWorkspaceFileReferenceSuggestionsCommand(this.workspaceGitCommandContext(), request);
  }

  async requestCodeCompletion(
    request: RequestCodeCompletionRequest,
  ): Promise<CodeCompletionResponse> {
    return requestCodeCompletionCommand(this.codeCompletionCommandContext(), request);
  }

  async abortCodeCompletion(): Promise<void> {
    abortCodeCompletionCommand(this.requireState().workspaceRoot);
  }

  async recordCodeCompletionFileState(
    request: RecordCodeCompletionFileStateRequest,
  ): Promise<void> {
    recordCodeCompletionFileStateCommand(this.codeCompletionCommandContext(), request);
  }

  async resetCodeCompletionJournal(): Promise<void> {
    resetCodeCompletionJournalCommand(this.codeCompletionCommandContext());
  }

  async primeWorkspaceFileReferenceIndex(): Promise<void> {
    return primeWorkspaceFileReferenceIndexCommand(this.workspaceGitCommandContext());
  }

  async getWorkspaceFileReferenceIndex(): Promise<
    import("../types.js").WorkspaceFileReferenceIndexSnapshot
  > {
    return getWorkspaceFileReferenceIndexCommand(this.workspaceGitCommandContext());
  }

  async readWorkspaceTextFile(
    relativePath: string,
    options?: import("../types.js").ReadWorkspaceTextFileOptions,
  ): Promise<WorkspaceReadTextFileResult> {
    return readWorkspaceTextFileCommand(this.workspaceGitCommandContext(), relativePath, options);
  }

  async searchWorkspaceContent(
    request: import("../types.js").WorkspaceContentSearchRequest,
  ): Promise<import("../types.js").WorkspaceContentSearchResult> {
    return searchWorkspaceContentCommand(this.workspaceGitCommandContext(), request);
  }

  async writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void> {
    return writeWorkspaceTextFileCommand(this.workspaceGitCommandContext(), request);
  }

  async revealWorkspaceEntry(relativePath: string, workspaceRoot?: string): Promise<void> {
    return revealWorkspaceEntryCommand(
      this.workspaceGitCommandContext(),
      relativePath,
      workspaceRoot,
    );
  }

  async openPathInDefaultApp(absolutePath: string): Promise<void> {
    return openPathInDefaultAppCommand(this.workspaceGitCommandContext(), absolutePath);
  }

  async renameWorkspaceEntry(
    relativePath: string,
    newName: string,
  ): Promise<{ relativePath: string }> {
    return renameWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath, newName);
  }

  async createWorkspaceEntry(
    parentDirectoryRel: string,
    name: string,
    kind: "file" | "dir",
  ): Promise<{ relativePath: string }> {
    return createWorkspaceEntryCommand(
      this.workspaceGitCommandContext(),
      parentDirectoryRel,
      name,
      kind,
    );
  }

  async moveWorkspaceEntry(
    relativePath: string,
    targetDirectoryRel: string,
  ): Promise<{ relativePath: string }> {
    return moveWorkspaceEntryCommand(
      this.workspaceGitCommandContext(),
      relativePath,
      targetDirectoryRel,
    );
  }

  async trashWorkspaceEntry(relativePath: string): Promise<void> {
    return trashWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async forceDeleteWorkspaceEntry(relativePath: string): Promise<void> {
    return forceDeleteWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async readHostTextFile(absolutePath: string): Promise<WorkspaceReadTextFileResult> {
    return readHostTextFileCommand(this.workspaceGitCommandContext(), absolutePath);
  }

  async writeHostTextFile(request: WriteHostTextFileRequest): Promise<void> {
    return writeHostTextFileCommand(this.workspaceGitCommandContext(), request);
  }

  async statHostTextFile(absolutePath: string): Promise<HostTextFileStatResult> {
    return statHostTextFileCommand(this.workspaceGitCommandContext(), absolutePath);
  }

  async classifyLocalFileComposerRoute(absolutePath: string): Promise<LocalFileComposerRoute> {
    return resolveLocalFileComposerRoute(absolutePath);
  }

  async openSession(
    filePath: string,
    options?: { activate?: boolean; clientHost?: DesktopClientHost },
  ): Promise<DesktopSnapshot> {
    if (options?.activate === false) {
      return openSessionBackgroundCommand(this.sessionActivationContext(), filePath, {
        clientHost: options.clientHost,
      });
    }
    const snapshot = await openSessionCommand(this.sessionActivationContext(), filePath);
    const basicInfoHost = basicInfoHostFromClientHost(options?.clientHost);
    if (basicInfoHost) {
      this.activeBundle().basicInfoHost = basicInfoHost;
    }
    return snapshot;
  }

  async beginSplitPaneSession(
    request: BeginSplitPaneSessionRequest,
  ): Promise<BeginSplitPaneSessionResponse> {
    return beginSplitPaneSessionCommand(this.sessionSplitContext(), request);
  }

  async beginSideChatPaneSession(
    request: BeginSideChatPaneSessionRequest,
  ): Promise<BeginSideChatPaneSessionResponse> {
    return beginSideChatPaneSessionCommand(this.sessionSplitContext(), request);
  }

  async forkSessionIntoSideChat(request: ForkSessionIntoSideChatRequest): Promise<DesktopSnapshot> {
    return forkSessionIntoSideChatCommand(this.sideChatSessionContext(), request);
  }

  async setVisiblePaneSessions(request: SetVisiblePaneSessionsRequest): Promise<DesktopSnapshot> {
    return setVisiblePaneSessionsCommand(this.sessionSplitContext(), request);
  }

  async focusPaneSession(request: FocusPaneSessionRequest): Promise<DesktopSnapshot> {
    return focusPaneSessionCommand(this.sessionSplitContext(), request);
  }

  async syncSplitPaneSessions(request: SyncSplitPaneSessionsRequest): Promise<DesktopSnapshot> {
    return syncSplitPaneSessionsCommand(this.sessionSplitContext(), request);
  }

  async closeSplitPaneSession(request: CloseSplitPaneSessionRequest): Promise<DesktopSnapshot> {
    return closeSplitPaneSessionCommand(this.sessionSplitContext(), request);
  }

  async switchPaneWorkspace(request: SwitchPaneWorkspaceRequest): Promise<DesktopSnapshot> {
    return switchPaneWorkspaceCommand(this.paneWorkspaceContext(), request);
  }

  async switchPaneModel(request: SwitchPaneModelRequest): Promise<DesktopSnapshot> {
    return switchPaneModelCommand(this.paneModelContext(), request);
  }

  async setPanePendingGitBranch(request: SetPanePendingGitBranchRequest): Promise<DesktopSnapshot> {
    return setPanePendingGitBranchCommand(this.paneWorkspaceContext(), request);
  }

  async setPaneWorkLocation(request: SetPaneWorkLocationRequest): Promise<DesktopSnapshot> {
    return setPaneWorkLocationCommand(this.paneWorkspaceContext(), request);
  }

  async checkoutPaneGitBranch(request: CheckoutPaneGitBranchRequest): Promise<DesktopSnapshot> {
    return checkoutPaneGitBranchCommand(this.paneWorkspaceContext(), request);
  }

  async deleteSession(filePath: string): Promise<DesktopSnapshot> {
    return deleteSessionCommand(this.sessionDeleteContext(), filePath);
  }

  async renameSession(filePath: string, displayName: string): Promise<DesktopSnapshot> {
    return renameSessionCommand(this.sessionRenameContext(), filePath, displayName);
  }

  private sessionRenameContext(): SessionRenameContext {
    return {
      ...this.sessionActivationContext(),
      bundleRuntimeIsBusy: (sessionPath) => {
        const bundle = this.sessionRegistry.findBySessionPath(sessionPath);
        return isSessionBundleBusy(bundle);
      },
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
      emitLiveSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
    };
  }

  private sessionDeleteContext(): SessionDeleteContext {
    const split = this.sessionSplitContext();
    return {
      ...this.sessionActivationContext(),
      visiblePaneSessionPaths: split.visiblePaneSessionPaths,
      setVisiblePaneSessionPaths: split.setVisiblePaneSessionPaths,
      removeEphemeralSession: (filePath) => {
        const state = this.requireState();
        state.ephemeralSessions = removeEphemeralSessionRecord(state.ephemeralSessions, filePath);
      },
      bundleRuntimeIsBusy: (sessionPath) => {
        const bundle = this.sessionRegistry.findBySessionPath(sessionPath);
        return isSessionBundleBusy(bundle);
      },
      disposeSessionRuntime: async (bundle) => {
        await closeRemoteDesktopRuntime(bundle.runtime);
        bundle.runtime = undefined;
      },
    };
  }

  private runtimeActivationSignature(bundle: SessionBundle): string {
    return runtimeActivationSignature(this.sessionActivationContext(), bundle);
  }

  private isBundleRuntimeFresh(bundle: SessionBundle): boolean {
    return isBundleRuntimeFresh(this.sessionActivationContext(), bundle);
  }

  /** After registry switch: wire runtime for new loads, resume in-flight runs without resetting timeline. */
  private async finishSessionActivation(bundle: SessionBundle): Promise<void> {
    return finishSessionActivationCommand(this.sessionActivationContext(), bundle);
  }

  async invoke(command: HostCommandName, payload?: unknown): Promise<unknown> {
    return this.invokeDispatch(command, payload);
  }

  private async ensureInitialized(
    workspaceRootOverride?: string,
    options: {
      fastPath?: boolean;
      preserveRecentWorkspaces?: boolean;
      /** Skip global runtime rebuild after workspace switch; caller will activate a session bundle. */
      deferRuntimeRefresh?: boolean;
      /** Skip extension warmup scheduling; caller will schedule after serialized work completes. */
      deferExtensionWarmup?: boolean;
      workspaceBinding?: DesktopWorkspaceBinding;
    } = {},
  ): Promise<void> {
    return ensureInitializedCommand(
      this.hostInitializationContext(),
      workspaceRootOverride,
      options,
    );
  }

  private async refreshRuntime(): Promise<void> {
    const bundle = this.activeBundle();
    const hadRuntime = bundle.runtime !== undefined;
    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    // First runtime creation (e.g. bootstrap) must still fire sessionStart so workspace
    // hook trust can prompt; previously only re-refresh of an existing runtime did.
    // Schedule unlocked: trust await must not hold runSerialized.
    if (bundle.runtime) {
      this.scheduleSessionStartForBundle(bundle, hadRuntime ? "resume" : "startup");
    }
  }

  private async refreshActiveModelTransportConfig(): Promise<void> {
    const bundle = this.activeBundle();
    await this.refreshRuntimeForBundle(bundle, { inferencePreferenceOnly: true });
    this.syncActiveRuntimePointer();
  }

  private resolveBundleActivePlanPath(bundle: SessionBundle): string | undefined {
    const existing = bundle.activePlanPath?.trim();
    if (existing) {
      return existing;
    }
    const fromArchive = extractActivePlanPathFromLlmHistory(bundle.archiveHistory);
    if (fromArchive) {
      bundle.activePlanPath = fromArchive;
    }
    return fromArchive;
  }

  private async syncPlanStateForBundle(bundle: SessionBundle): Promise<void> {
    const state = this.requireState();
    const activePlanPath = this.resolveBundleActivePlanPath(bundle);
    state.metadata = await loadHostMetadata(
      state.workspaceRoot,
      resolveDesktopAgentMode(state.config),
      { activePlanPath, workspaceBinding: state.workspaceBinding },
    );
    state.plan = await loadDesktopPlanSnapshot(
      state.metadata.planMetadata.path,
      state.metadata.planMetadata.exists,
    );
  }

  private async refreshRuntimeForBundle(
    bundle: SessionBundle,
    options: { inferencePreferenceOnly?: boolean } = {},
  ): Promise<void> {
    const state = this.requireState();
    const inferencePreferenceOnly = options.inferencePreferenceOnly === true;
    const hadRuntime = bundle.runtime !== undefined;
    if (hadRuntime && !inferencePreferenceOnly) {
      await this.runSessionEndForBundle(bundle, "switch");
    }
    if (!inferencePreferenceOnly) {
      await this.syncPlanStateForBundle(bundle);
    }
    // Preserve bundle.currentTurnSkills: slash-activated turn skills must be injected into the user message meta at startUserTurnStreaming
    const effectiveActiveModel = resolveEffectivePaneActiveModel(bundle, state);
    if (inferencePreferenceOnly && bundle.runtime?.isBusy()) {
      bundle.deferredRuntimeRefreshWhileBusy = true;
      return;
    }
    const desktopMessages = bundle.messageTimeline.toMessages();
    const llmHistoryForRuntime =
      bundle.archiveHistory.length > 0
        ? bundle.archiveHistory
        : buildLlmHistoryFallbackFromDesktopMessages(desktopMessages);
    const archive = {
      messages: buildArchiveMessagesFromConversation(desktopMessages),
      assistantAux: buildArchiveAssistantAuxFromConversation(desktopMessages),
      llmHistory: llmHistoryForRuntime,
      subagentSessions: bundle.archiveSubagentSessions ?? [],
      loopEnabled: bundle.loopEnabled,
      approvalLevel: bundle.approvalLevel,
    } satisfies ChatArchive;
    const previousRuntime = bundle.runtime;
    bundle.runtimeTransport = createLlmTransport();
    const conversationKey = bundle.activeSession?.filePath
      ? path.resolve(bundle.activeSession.filePath)
      : undefined;
    const remoteRuntimeInput = {
      dataDir: spiritDataDir(),
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      modelRef: effectiveActiveModel,
      agentMode: resolveDesktopAgentMode(state.config),
      archive,
      approvalLevel: normalizeApprovalLevel(bundle.approvalLevel),
      todoSessionKey: this.resolveTodoSessionKeyForBundle(bundle),
      ...(bundle.basicInfoHost ? { basicInfoHost: bundle.basicInfoHost } : {}),
      onActivity: () => {
        this.sessionPump.ensureRunning();
        this.requestThrottledLiveSnapshotEmit();
      },
      onWorkspaceCapabilityTrustRequested: (
        requestId: string,
        request: WorkspaceCapabilityTrustRequest,
      ) => {
        this.enqueueRemoteWorkspaceCapabilityTrust(requestId, request, bundle.runtime);
      },
      onExtensionUiRequested: (request: DesktopPendingExtensionUi) => {
        this.pendingExtensionUi = request;
        this.emitLiveSnapshotUpdate();
      },
      onRemoteUserTurnSubmitted: (input: {
        text: string;
        explicitWorkspaceFiles: PendingWorkspaceFile[];
      }) => {
        this.projectRemoteUserTurn(bundle, input);
      },
      onFileChange: (change: unknown) => {
        this.applyRecordedWorkspaceFileChange(bundle, change as HostRecordedFileChange);
      },
      onSessionTitleUpdated: (sessionId: string, title: string) => {
        this.applyRemoteSessionTitle(sessionId, title);
      },
    };
    try {
      const previousSessionId = remoteDesktopSessionId(previousRuntime);
      const runtime = conversationKey
        ? await openRemoteDesktopRuntime({ ...remoteRuntimeInput, conversationKey })
        : await createRemoteDesktopRuntime(remoteRuntimeInput);
      runtime.setLoopEnabled(bundle.loopEnabled);
      bundle.runtime = runtime;
      const newSessionId = remoteDesktopSessionId(runtime);
      if (previousRuntime) {
        if (previousSessionId && previousSessionId === newSessionId) {
          await disposeRemoteDesktopRuntime(previousRuntime);
        } else {
          await closeRemoteDesktopRuntime(previousRuntime);
        }
      }
      if (bundle.id === this.sessionRegistry.activeSessionId()) {
        this.runtime = runtime;
      }
      this.activeApiKeyConfigured = true;
      this.lastRuntimeError = "";
      await this.refreshTodoSnapshotForBundle(bundle);
      bundle.runtimeActivationSignature = this.runtimeActivationSignature(bundle);
    } catch (error) {
      await closeRemoteDesktopRuntime(previousRuntime);
      bundle.runtime = undefined;
      if (bundle.id === this.sessionRegistry.activeSessionId()) {
        this.runtime = undefined;
      }
      this.activeApiKeyConfigured = false;
      this.lastRuntimeError = error instanceof Error ? error.message : String(error);
    }
  }

  private async ensureToolExecutor(
    bundle: SessionBundle = this.activeBundle(),
    _options?: { skipMcpCatalogRefresh?: boolean },
  ): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const isActive = bundle.id === this.sessionRegistry.activeSessionId();
    const workspaceRoot = bundle.workspaceRoot || state.workspaceRoot;
    const dreamScope: HostDreamScope | undefined =
      isActive && state.git.branch
        ? {
            workspaceRoot,
            gitBranch: state.git.branch,
          }
        : undefined;
    const todoScope: HostTodoScope = createTodoScope(this.resolveTodoSessionKeyForBundle(bundle));

    const needsRebuild =
      !bundle.toolExecutor ||
      bundle.toolExecutorWorkspaceRoot !== workspaceRoot ||
      !bundle.toolExecutor.matchesDreamAccess(dreamScope, dreamScope ? "read-only" : undefined) ||
      !bundle.toolExecutor.matchesTodoAccess(todoScope);

    if (needsRebuild) {
      if (bundle.toolExecutorWorkspaceRoot && bundle.toolExecutorWorkspaceRoot !== workspaceRoot) {
        await disposeLspServicesExcept(this.lspServiceByWorkspaceRoot, workspaceRoot);
        disposeMcpServicesExcept(this.mcpServiceByWorkspaceRoot, workspaceRoot);
      }
      bundle.toolExecutor = await this.buildToolExecutorForBundle(bundle, dreamScope, todoScope);
      bundle.toolExecutorWorkspaceRoot = workspaceRoot;
      bundle.toolExecutorTodoSessionKey = todoScope.sessionKey;
    } else if (bundle.toolExecutor) {
      await this.refreshExtensionToolDefinitions(bundle.toolExecutor);
    }
    if (isActive) {
      this.toolExecutor = bundle.toolExecutor;
    }
    if (!bundle.toolExecutor) {
      throw new Error(i18n.t("error.mcpExecutorNotInitialized"));
    }
    bundle.toolExecutor.setApprovalLevel(bundle.approvalLevel);
    bundle.toolExecutor.setLoopToolExposure(bundle.loopEnabled);
    bundle.toolExecutor.setAgentModeToolExposure(
      resolveDesktopAgentMode(this.requireState().config),
    );
    await bundle.toolExecutor.ensureMcpToolingReady();
    return bundle.toolExecutor;
  }

  private sharedMcpServiceForWorkspace(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding = "project",
  ): McpService {
    return sharedMcpServiceForWorkspace(
      this.mcpServiceByWorkspaceRoot,
      workspaceRoot,
      workspaceBinding,
      async () => {
        const contributions = await collectEnabledExtensionInstructionContributions(
          await this.extensionManager().list(),
        );
        return {
          servers: contributions.mcp.servers,
          extensionServerOwnership: contributions.mcpOwnership,
        };
      },
    );
  }

  private sharedLspServiceForWorkspace(workspaceRoot: string) {
    const userConfig = lspUserConfigFromEnabled(this.requireState().config.agents.lsp.enabled);
    return sharedLspServiceForWorkspace(this.lspServiceByWorkspaceRoot, workspaceRoot, userConfig);
  }

  private async buildToolExecutorForBundle(
    bundle: SessionBundle,
    dreamScope?: HostDreamScope,
    todoScope?: HostTodoScope,
  ): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const workspaceRoot = bundle.workspaceRoot || state.workspaceRoot;
    const extensions = await this.extensionManager().list();
    const lsp = await ensureLspServiceReady(this.sharedLspServiceForWorkspace(workspaceRoot));
    return new DesktopToolExecutor(workspaceRoot, {
      mcp: this.sharedMcpServiceForWorkspace(workspaceRoot, state.workspaceBinding),
      mcpUiOpener: (request) => this.openLocalExtensionUi(request),
      ...(lsp ? { lsp } : {}),
      extensionToolDefinitions: buildDesktopExtensionToolDefinitions(extensions),
      fileChangeObserver: {
        recordFileChange: (change) => {
          void lsp?.syncFromRecordedChange(change);
          this.applyRecordedWorkspaceFileChange(bundle, change);
        },
      },
      extensions: {
        manager: this.extensionManager(),
        getHost: () => {
          const adapter = getDesktopExtensionHostAdapter();
          if (!adapter) {
            throw new Error(i18n.t("error.extensionHostNotConnected"));
          }
          return adapter;
        },
        logger: console,
      },
      ...(dreamScope
        ? {
            dreamScope,
            dreamToolMode: "read-only" as const,
          }
        : {}),
      hostContributedToolsEnabled: true,
      getAutomationCreateDefaults: () => {
        const currentState = this.requireState();
        const lightweightModel = resolveLightweightChatModelProfile(currentState.config);
        if (!lightweightModel) {
          throw new Error(i18n.t("error.lightweightChatModelNotConfigured"));
        }
        return {
          workspaceRoot,
          modelRef: lightweightModel.profile.ref,
          ...(lightweightModel.profile.reasoningEffort
            ? { reasoningEffort: lightweightModel.profile.reasoningEffort }
            : {}),
        };
      },
      onAutomationCreated: () => {
        void this.runSerialized(async () => {
          await this.refreshAutomationsListCache();
          this.emitAutomationUpdate();
        });
      },
      ...(todoScope ? { todoScope } : {}),
    });
  }

  private buildClientGitSnapshot(): DesktopGitSnapshot {
    const state = this.requireState();
    const bundle = this.activeBundle();
    const selectedBranch = bundle.pendingGitBranch ?? state.git.branch;
    return {
      ...state.git,
      ...(selectedBranch ? { selectedBranch } : {}),
      workLocation: bundle.workLocation,
    };
  }

  private async refreshGitState(options: { resetRevision?: boolean } = {}): Promise<void> {
    const state = this.state;
    if (!state) {
      return;
    }
    const previousFingerprint = gitWorkingTreeFingerprint(state.git);
    const snapshot = await readWorkspaceGitSnapshot(state.workspaceRoot);
    state.git = applyGitRevision(snapshot, state.git.revision ?? 0, {
      reset: options.resetRevision === true,
    });
    if (gitWorkingTreeFingerprint(state.git) !== previousFingerprint) {
      this.noteWorkspaceContentInvalidation([], "git-working-tree");
    }
  }

  private noteWorkspaceContentInvalidation(
    paths: readonly string[],
    reason: WorkspaceContentInvalidation["reason"],
  ): void {
    const workspaceRoot = this.state?.workspaceRoot ?? "";
    const current =
      workspaceRoot === this.workspaceContentInvalidationWorkspaceRoot
        ? this.workspaceContentInvalidation
        : undefined;
    this.workspaceContentInvalidationWorkspaceRoot = workspaceRoot;
    this.workspaceContentInvalidation = nextWorkspaceContentInvalidation(current, paths, reason);
  }

  private applyRecordedWorkspaceFileChange(
    bundle: SessionBundle,
    change: HostRecordedFileChange,
  ): void {
    void this.recordHostFileChange(bundle, change).then(() => {
      this.publishWorkspaceFileMutation(change);
    });
  }

  private publishWorkspaceFileMutation(change: HostRecordedFileChange): void {
    const state = this.state;
    if (!state) {
      return;
    }
    const relativePath = toWorkspaceRelativePosixPath(state.workspaceRoot, change.resolvedPath);
    this.noteWorkspaceContentInvalidation(relativePath ? [relativePath] : [], "agent-file-change");
    void this.runCoalescedGitRefresh()
      .catch(() => {})
      .finally(() => {
        this.emitLiveSnapshotUpdate();
      });
  }

  private async runCoalescedGitRefresh(options: { resetRevision?: boolean } = {}): Promise<void> {
    if (this.gitRefreshInFlight) {
      this.gitRefreshQueued = true;
      return this.gitRefreshInFlight;
    }

    this.gitRefreshInFlight = (async () => {
      try {
        do {
          this.gitRefreshQueued = false;
          await this.refreshGitState(options);
        } while (this.gitRefreshQueued);
      } finally {
        this.gitRefreshInFlight = null;
      }
    })();

    return this.gitRefreshInFlight;
  }

  async refreshGitSnapshot(): Promise<DesktopSnapshot> {
    return refreshGitSnapshotCommand(this.workspaceGitCommandContext());
  }

  private startDreamCollectorIfNeeded(): void {
    startDreamCollectorIfNeededFromService(this.dreamCollectorContext());
  }

  private startDreamCollectorMonitorIfNeeded(): void {
    startDreamCollectorMonitorIfNeededFromService(
      this.dreamCollectorMonitorTimer,
      (timer) => {
        this.dreamCollectorMonitorTimer = timer;
      },
      this.dreamCollectorContext(),
    );
  }

  private startAutomationSchedulerMonitorIfNeeded(): void {
    startAutomationSchedulerMonitorIfNeededFromService(
      this.automationMonitorTimer,
      (timer) => {
        this.automationMonitorTimer = timer;
      },
      this.automationSchedulerContext(),
    );
  }

  private automationSchedulerContext(): AutomationSchedulerServiceContext {
    return {
      initialized: () => this.initialized,
      config: () => this.state?.config,
      runningAutomationIds: () => this.runningAutomationIds,
      markAutomationRunning: (automationId, running) => {
        if (running) {
          this.runningAutomationIds.add(automationId);
        } else {
          this.runningAutomationIds.delete(automationId);
        }
      },
      onAutomationUpdated: (automationId) => {
        void this.runSerialized(async () => {
          await this.refreshAutomationsListCache();
          this.emitAutomationUpdate();
          void automationId;
        });
      },
      notifySessionListUpdated: () => {
        this.notifySessionListUpdated();
      },
      syncSessionFromDisk: (sessionPath) => this.syncAutomationSessionFromDisk(sessionPath),
    };
  }

  private async syncAutomationSessionFromDisk(sessionPath: string): Promise<void> {
    const loaded = await loadStoredSession(sessionPath);
    const workspaceRoot = loaded.workspaceRoot ?? this.requireState().workspaceRoot;
    const restored = restoreStoredSessionState({
      filePath: sessionPath,
      loaded,
    });
    const synced = this.sessionRegistry.reloadWarmBundleFromRestoredIfIdle(
      sessionPath,
      workspaceRoot,
      restored,
      (messages, timelineSnapshot) =>
        this.createMessageTimelineFromMessages(messages, timelineSnapshot),
    );
    if (!synced) {
      return;
    }
    const bundle = this.sessionRegistry.findBySessionPath(sessionPath);
    if (!bundle) {
      return;
    }
    if (this.sessionRegistry.activeSessionId() === path.resolve(sessionPath)) {
      await this.refreshRuntimeForBundle(bundle);
      this.syncActiveRuntimePointer();
      this.emitLiveSnapshotUpdate();
    }
  }

  private async refreshAutomationsListCache(): Promise<void> {
    this.automationsListCache = await listAutomationsCommand();
  }

  private emitAutomationUpdate(): void {
    if (!this.state || this.automationUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.automationUpdateListeners) {
      listener(snapshot);
    }
  }

  private setDreamCollectorStatus(next: DesktopDreamCollectorSnapshot): void {
    if (sameDreamCollectorSnapshot(this.dreamCollectorStatus, next)) {
      return;
    }
    this.dreamCollectorStatus = next;
    this.emitDreamUpdate();
  }

  private emitDreamUpdate(): void {
    if (!this.state || this.dreamUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.dreamUpdateListeners) {
      listener(snapshot);
    }
  }

  private emitLiveSnapshotUpdate(): void {
    this.lastLiveSnapshotEmitAtMs = Date.now();
    if (!this.state || this.dreamUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.dreamUpdateListeners) {
      listener(snapshot);
    }
    if (pumpDebugEnabled()) {
      this.debugLiveSnapshotEmitCount += 1;
      const windowMs = Date.now() - this.debugLiveSnapshotEmitWindowStartedAtMs;
      if (windowMs >= 5_000) {
        const hz = (this.debugLiveSnapshotEmitCount / Math.max(1, windowMs)) * 1_000;
        console.warn(
          `[desktop-host][pump] snapshot emits=${this.debugLiveSnapshotEmitCount} rate=${hz.toFixed(1)}/s`,
        );
        this.debugLiveSnapshotEmitCount = 0;
        this.debugLiveSnapshotEmitWindowStartedAtMs = Date.now();
      }
    }
  }

  private notifySessionListUpdated(): void {
    if (this.sessionListUpdateListeners.size === 0) {
      return;
    }
    for (const listener of this.sessionListUpdateListeners) {
      listener();
    }
  }

  private prepareSessionTitleForFirstUserTurn(
    displayText: string,
    bundle: SessionBundle = this.activeBundle(),
  ): void {
    if (!resetSessionTitleForFirstUserTurn(bundle, displayText)) {
      return;
    }
  }

  private applyRemoteSessionTitle(sessionId: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    let sessionPath: string | undefined;
    for (const bundle of this.sessionRegistry.all()) {
      if (remoteDesktopSessionId(bundle.runtime) === sessionId) {
        sessionPath = bundle.activeSession?.filePath;
        break;
      }
    }
    if (!sessionPath) {
      return;
    }
    void applyGeneratedSessionTitle({
      sessionPath,
      title: trimmed,
      registry: this.sessionRegistry,
      runSerialized: <T>(work: () => Promise<T>, label?: string) => this.runSerialized(work, label),
      persistBundle: (target) =>
        this.persistSessionBundle(target, {
          fromRuntime: target.runtime,
          bumpListSortAt: false,
        }),
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
      onActiveSessionTitleApplied: () => {
        this.emitLiveSnapshotUpdate();
      },
    }).catch((error) => {
      console.warn(
        "[session-title] apply failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  private async flushDeferredRuntimeRefreshIfIdle(
    bundle: SessionBundle = this.activeBundle(),
  ): Promise<void> {
    if (!bundle.deferredRuntimeRefreshWhileBusy) {
      return;
    }
    if (bundle.runtime?.isBusy()) {
      return;
    }
    bundle.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
    this.lastRuntimeError = "";
  }

  private async refreshModelKeyPresence(): Promise<void> {
    const state = this.state;
    if (!state) {
      this.modelKeyPresence = {};
      return;
    }
    this.modelKeyPresence = await modelSecretKeyPresence(state.config);
  }

  private clearActiveBundleContextUsage(): void {
    const bundle = this.sessionRegistry.getActive();
    if (!bundle) {
      return;
    }
    bundle.contextUsage = undefined;
  }

  private async refreshContextUsageCatalogForBundle(
    bundle: SessionBundle,
    usage: { inputTokens: number },
    activeModel: ContextUsageModelProfile,
  ): Promise<void> {
    if (!activeModel.provider) {
      return;
    }
    this.pendingContextUsageCatalogRefresh = { bundle, usage, activeModel };
    await this.runCoalescedContextUsageCatalogRefresh();
  }

  private async runCoalescedContextUsageCatalogRefresh(): Promise<void> {
    if (this.contextUsageCatalogRefreshInFlight) {
      return this.contextUsageCatalogRefreshInFlight;
    }

    this.contextUsageCatalogRefreshInFlight = (async () => {
      try {
        while (this.pendingContextUsageCatalogRefresh) {
          const pending = this.pendingContextUsageCatalogRefresh;
          this.pendingContextUsageCatalogRefresh = undefined;
          await this.runSerialized(async () => {
            await this.applyContextUsageCatalogRefresh(pending);
          });
        }
      } finally {
        this.contextUsageCatalogRefreshInFlight = null;
      }
    })();

    return this.contextUsageCatalogRefreshInFlight;
  }

  private async applyContextUsageCatalogRefresh(input: {
    bundle: SessionBundle;
    usage: { inputTokens: number };
    activeModel: ContextUsageModelProfile;
  }): Promise<void> {
    const { bundle, usage, activeModel } = input;
    const state = this.state;
    if (!state || !activeModel.provider) {
      return;
    }
    const activeRef = findModelRefByName(state.config, activeModel.name);
    const profile = activeRef ? resolveModelProfile(state.config, activeRef) : undefined;
    if (!profile) {
      return;
    }
    const refreshed = await forceRefreshModelCatalogForProfile(state.config, profile);
    if (!refreshed) {
      return;
    }
    const contextLength = resolveModelContextLength(
      activeModel,
      buildModelCatalogHints(state.config),
    );
    if (contextLength === undefined) {
      return;
    }
    bundle.contextUsage = {
      inputTokens: usage.inputTokens,
      contextLength,
      percent: buildContextUsagePercent(usage.inputTokens, contextLength),
    };
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.emitLiveSnapshotUpdate();
    }
  }

  private flushRuntimeHostEventsForBundle(bundle: SessionBundle): void {
    const runtime = bundle.runtime;
    if (!runtime) {
      return;
    }
    const changed = applyDrainedRuntimeHostEvents(
      this.sessionTurnContext(),
      bundle,
      runtime.drainEvents(),
    );
    if (changed) {
      this.emitLiveSnapshotUpdate();
    }
  }

  private resolveTodoSessionKeyForBundle(bundle: SessionBundle): string {
    return resolveTodoSessionKeyForBundleFromService(bundle);
  }

  private async maybeRefreshRuntimeAfterTodoScopeChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    return maybeRefreshRuntimeAfterTodoScopeChangeFromService(
      this.sessionTodosContext(),
      bundle,
      previousSessionKey,
    );
  }

  private async finalizeTodoScopeForNewActiveBundle(
    bundle: SessionBundle,
    workspaceRoot: string,
  ): Promise<void> {
    return finalizeTodoScopeForNewActiveBundleFromService(
      this.sessionTodosContext(),
      bundle,
      workspaceRoot,
    );
  }

  private async reconcileTodoScopeAfterSessionPathChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    return reconcileTodoScopeAfterSessionPathChangeFromService(
      this.sessionTodosContext(),
      bundle,
      previousSessionKey,
    );
  }

  private cancelTodoClearing(sessionKey: string): void {
    cancelTodoClearingFromService(this.sessionTodosContext(), sessionKey);
  }

  private scheduleTodoClearing(sessionKey: string, items: HostTodoRecord[]): void {
    scheduleTodoClearingFromService(this.sessionTodosContext(), sessionKey, items);
  }

  private async refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void> {
    return refreshTodoSnapshotForBundleFromService(this.sessionTodosContext(), bundle);
  }

  private async buildConversationTodoSnapshot(
    bundle: SessionBundle,
  ): Promise<ConversationTodoSnapshot | undefined> {
    return buildConversationTodoSnapshotFromService(this.sessionTodosContext(), bundle);
  }

  private buildSnapshotProjectedForBundle(bundle: SessionBundle): DesktopSnapshot {
    const base = this.buildSnapshot();
    const orchestration = this.orchestrationFor(bundle);
    const bundleRuntime = bundle.runtime;
    const pendingApproval = bundleRuntime?.currentPendingApproval();
    const pendingQuestions = bundleRuntime?.currentPendingQuestions();
    const pendingAux = bundleRuntime?.pendingAuxState();
    const slice = buildPaneSessionSlice({
      bundle,
      composerSessionKey: this.resolveTodoSessionKeyForBundle(bundle),
      conversationSnapshotView: orchestration.conversationSnapshotView,
      livePendingAux: pendingAux,
      isForegroundActive: false,
      ...(pendingApproval
        ? {
            pendingApproval: {
              toolName: pendingApproval.toolName,
              request: pendingApproval.request as DesktopToolRequest,
              prompt: pendingApproval.prompt,
              rememberTarget: pendingApproval.rememberTarget,
              subagentSessionId: pendingApproval.subagentSessionId,
              autoReviewBlockReason: pendingApproval.autoReviewBlockReason,
            },
          }
        : {}),
      ...(pendingQuestions ? { pendingQuestions } : {}),
      pendingImagePaths: [...(bundleRuntime?.pendingImagePaths() ?? [])],
      pendingMcpResources: mapPendingMcpResources(bundleRuntime?.pendingMcpResources() ?? []),
      ...(bundleRuntime?.pendingUserTurn()
        ? { pendingUserTurn: bundleRuntime.pendingUserTurn() }
        : {}),
    });
    const {
      conversation: _foregroundConversation,
      activeSession: _foregroundActiveSession,
      composerSessionKey: _foregroundComposerSessionKey,
      ...sharedSnapshot
    } = base;
    const projectedActiveSession =
      slice.activeSession ?? (bundle.activeSession ? { ...bundle.activeSession } : undefined);
    return {
      ...sharedSnapshot,
      conversation: slice.conversation,
      ...(projectedActiveSession ? { activeSession: projectedActiveSession } : {}),
      composerSessionKey: slice.composerSessionKey,
    };
  }

  private listMcpServersCached(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding,
  ): ReturnType<typeof listDesktopMcpServersFromDisk> {
    const key = `${path.resolve(workspaceRoot)}|${workspaceBinding}`;
    if (this.mcpServersListCache?.key !== key) {
      this.mcpServersListCache = {
        key,
        items: listDesktopMcpServersFromDisk(workspaceRoot, workspaceBinding),
      };
    }
    return this.mcpServersListCache.items;
  }

  private listHooksCached(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding,
  ): ReturnType<typeof listDesktopHookListItems> {
    const key = `${path.resolve(workspaceRoot)}|${workspaceBinding}`;
    if (this.hooksListCache?.key !== key) {
      this.hooksListCache = {
        key,
        items: listDesktopHookListItems(workspaceRoot, workspaceBinding),
      };
    }
    return this.hooksListCache.items;
  }

  /** Called after a command writes the MCP / hooks config file; workspace switches invalidate naturally via key change. */
  private invalidateConfigListCaches(): void {
    this.mcpServersListCache = undefined;
    this.hooksListCache = undefined;
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const activeBundle = this.activeBundle();
    const activeRuntime = activeBundle.runtime;
    const pendingApproval = activeRuntime?.currentPendingApproval();
    const pendingQuestions = activeRuntime?.currentPendingQuestions();
    const pendingAux = activeRuntime?.pendingAuxState();
    syncLivePendingAuxSnapshot({
      pendingAux,
      activeBundle,
      assistantMessages: this.activeOrchestration().assistantMessages,
      conversationSnapshotView: this.activeOrchestration().conversationSnapshotView,
    });

    const rawMessages = activeBundle.messages;
    const rawConversationMessages = this.desktopMessages();

    const conversationMessages = appendQueuedUserTurnSnapshots(
      this.activeOrchestration().conversationSnapshotView.buildMessagesWithPendingAssistant({
        messages: rawConversationMessages,
        livePendingAux: pendingAux,
        rewind: activeBundle.rewind,
      }),
      activeBundle.queuedUserTurns,
    );
    const conversationBusy = isSessionBundleBusy(activeBundle);

    this.logContinuationSnapshotState({
      rawMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: conversationBusy,
      pendingAux,
    });
    this.logToolSnapshotState({
      rawMessages,
      timelineMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: conversationBusy,
    });

    return buildDesktopSnapshot({
      workspaceRoot: state.workspaceRoot,
      config: state.config,
      git: this.buildClientGitSnapshot(),
      ...(this.workspaceContentInvalidation &&
      this.workspaceContentInvalidationWorkspaceRoot === state.workspaceRoot
        ? { workspaceContentInvalidation: this.workspaceContentInvalidation }
        : {}),
      metadata: state.metadata,
      plan: state.plan,
      extensionsList: state.extensionsList,
      marketplaceSources: state.marketplaceSources,
      marketplaceCatalogs: state.marketplaceCatalogs,
      marketplaceCatalogAll: state.marketplaceCatalogAll,
      ...(state.marketplaceWarnings.length > 0
        ? { marketplaceWarnings: state.marketplaceWarnings }
        : {}),
      extensionCss: state.extensionCss,
      extensionSkills: state.extensionInstructionContributions.skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        path: skill.path,
      })),
      ...(this.extensionWarmup.extensionsLoading ? { extensionsLoading: true } : {}),
      dreamCollectorStatus: this.dreamCollectorStatus,
      runtimeReady: activeRuntime !== undefined,
      runtimeError: this.lastRuntimeError,
      modelKeyPresence: this.modelKeyPresence,
      activeApiKeyConfigured: this.activeApiKeyConfigured,
      mcpStatus:
        this.activeBundle().toolExecutor?.mcpStatusSnapshot() ??
        this.toolExecutor?.mcpStatusSnapshot() ??
        emptyMcpStatusSnapshot(),
      mcpServers: this.listMcpServersCached(state.workspaceRoot, state.workspaceBinding),
      hooksList: this.listHooksCached(state.workspaceRoot, state.workspaceBinding),
      lsp: this.lspSnapshot,
      conversation: {
        revision: activeBundle.conversationRevision,
        messages: conversationMessages,
        loopEnabled: this.activeBundle().loopEnabled,
        approvalLevel: this.activeBundle().approvalLevel,
        ...(activeRuntime?.pendingUserTurn()
          ? { pendingUserTurn: activeRuntime.pendingUserTurn() }
          : {}),
        pendingImagePaths: [...(activeRuntime?.pendingImagePaths() ?? [])],
        pendingMcpResources: mapPendingMcpResources(activeRuntime?.pendingMcpResources() ?? []),
        ...(pendingAux ? { pendingAuxState: mapPendingAuxState(pendingAux)! } : {}),
        ...(pendingApproval
          ? {
              pendingToolApproval: mapPendingToolApproval({
                toolName: pendingApproval.toolName,
                request: pendingApproval.request as DesktopToolRequest,
                prompt: pendingApproval.prompt,
                rememberTarget: pendingApproval.rememberTarget,
                subagentSessionId: pendingApproval.subagentSessionId,
                autoReviewBlockReason: pendingApproval.autoReviewBlockReason,
              }),
            }
          : {}),
        ...(pendingQuestions ? { pendingQuestions: mapPendingQuestions(pendingQuestions) } : {}),
        isBusy: conversationBusy,
        ...(this.activeBundle().rewindWarnings.length > 0
          ? {
              rewindWarnings: this.activeBundle().rewindWarnings.map((warning) => ({ ...warning })),
            }
          : {}),
        ...(activeBundle.cachedTodoSnapshot ? { todos: activeBundle.cachedTodoSnapshot } : {}),
        ...(activeBundle.contextUsage ? { contextUsage: { ...activeBundle.contextUsage } } : {}),
      },
      ...(activeBundle.activeSession ? { activeSession: activeBundle.activeSession } : {}),
      composerSessionKey: this.resolveTodoSessionKeyForBundle(activeBundle),
      ...(this.subagentViewerTargetToolCallId
        ? (() => {
            const subagentViewer = buildSubagentViewerSnapshot(
              activeBundle,
              this.subagentViewerTargetToolCallId,
            );
            return subagentViewer ? { subagentViewer } : {};
          })()
        : {}),
      automationsList: this.automationsListCache.map((item) => ({ ...item })),
      ...(() => {
        const paneSessions = this.buildPaneSessionsSnapshot(activeBundle);
        return paneSessions ? { paneSessions } : {};
      })(),
      ...(this.pendingWorkspaceCapabilityTrust
        ? { pendingWorkspaceCapabilityTrust: this.pendingWorkspaceCapabilityTrust }
        : {}),
      ...(this.pendingExtensionUi ? { pendingExtensionUi: this.pendingExtensionUi } : {}),
    });
  }

  private buildPaneSessionsSnapshot(
    activeBundle: SessionBundle,
  ): Record<string, PaneSessionSlice> | undefined {
    if (this.visiblePaneSessionPaths.length === 0) {
      return undefined;
    }

    const activePath = path.resolve(activeBundle.activeSession?.filePath ?? activeBundle.id);
    const paneSessions: Record<string, PaneSessionSlice> = {};

    for (const sessionPath of this.visiblePaneSessionPaths) {
      const resolved = path.resolve(sessionPath);
      const bundle = this.sessionRegistry.findBySessionPath(resolved);
      if (!bundle) {
        continue;
      }

      const isForegroundActive = resolved === activePath;
      const orchestration = this.orchestrationFor(bundle);
      const bundleRuntime = isForegroundActive ? this.runtime : bundle.runtime;
      const pendingApproval = bundleRuntime?.currentPendingApproval();
      const pendingQuestions = bundleRuntime?.currentPendingQuestions();
      const pendingAux = bundleRuntime?.pendingAuxState();

      if (isForegroundActive && pendingAux) {
        syncLivePendingAuxSnapshot({
          pendingAux,
          activeBundle: bundle,
          assistantMessages: orchestration.assistantMessages,
          conversationSnapshotView: orchestration.conversationSnapshotView,
        });
      }

      const conversationView = orchestration.conversationSnapshotView;
      const paneWorkspace = resolvePaneWorkspaceProjection({
        bundle,
        state: this.requireState(),
        isForegroundActive,
      });
      const paneModel = resolvePaneModelProjection({
        bundle,
        state: this.requireState(),
        isForegroundActive,
      });
      const sliceSignature = [
        resolved,
        isForegroundActive ? 1 : 0,
        this.resolveTodoSessionKeyForBundle(bundle),
        bundle.conversationRevision,
        bundle.messageTimeline.toMessages().length,
        isSessionBundleBusy(bundle) ? 1 : 0,
        bundle.activeSession?.filePath ?? bundle.id,
        pendingApproval?.toolCallId ?? "",
        pendingQuestions ? JSON.stringify(pendingQuestions.request) : "",
        bundleRuntime?.pendingUserTurn() ?? "",
        bundleRuntime?.pendingImagePaths()?.length ?? 0,
        paneWorkspace?.workspaceRoot ?? "",
        paneWorkspace?.workspaceBinding ?? "",
        paneWorkspace?.git?.revision ?? 0,
        paneWorkspace?.git?.selectedBranch ?? paneWorkspace?.git?.branch ?? "",
        bundle.approvalLevel,
        paneModel?.activeModel
          ? modelRefKey(paneModel.activeModel)
          : modelRefKey(resolveEffectivePaneActiveModel(bundle, this.requireState())),
      ].join("\0");
      const cached = this.paneSessionSliceCache.get(resolved);
      // During a streaming turn the messageTimeline content changes while the revision/msgCount signature often stays the same; disable the cache while busy (19a224c6 regression).
      if (!isSessionBundleBusy(bundle) && cached?.signature === sliceSignature) {
        paneSessions[resolved] = cached.slice;
        continue;
      }

      const slice = buildPaneSessionSlice({
        bundle,
        composerSessionKey: this.resolveTodoSessionKeyForBundle(bundle),
        conversationSnapshotView: conversationView,
        livePendingAux: pendingAux,
        isForegroundActive,
        ...(paneWorkspace ? { paneWorkspace } : {}),
        ...(paneModel ? { paneModel } : {}),
        ...(pendingApproval
          ? {
              pendingApproval: {
                toolName: pendingApproval.toolName,
                request: pendingApproval.request as DesktopToolRequest,
                prompt: pendingApproval.prompt,
                rememberTarget: pendingApproval.rememberTarget,
                subagentSessionId: pendingApproval.subagentSessionId,
                autoReviewBlockReason: pendingApproval.autoReviewBlockReason,
              },
            }
          : {}),
        ...(pendingQuestions ? { pendingQuestions } : {}),
        pendingImagePaths: [...(bundleRuntime?.pendingImagePaths() ?? [])],
        pendingMcpResources: [...(bundleRuntime?.pendingMcpResources() ?? [])],
        ...(bundleRuntime?.pendingUserTurn()
          ? { pendingUserTurn: bundleRuntime.pendingUserTurn() }
          : {}),
      });
      this.paneSessionSliceCache.set(resolved, { signature: sliceSignature, slice });
      paneSessions[resolved] = slice;
    }

    for (const key of this.paneSessionSliceCache.keys()) {
      if (!paneSessions[key]) {
        this.paneSessionSliceCache.delete(key);
      }
    }

    return Object.keys(paneSessions).length > 0 ? paneSessions : undefined;
  }

  private findEphemeralSession(filePath: string): EphemeralSessionRecord | undefined {
    return this.state?.ephemeralSessions.find((session) => session.path === filePath);
  }

  private async executeWorktreeBootstrapForActiveBundle(userPrompt: string): Promise<void> {
    const state = this.requireState();
    const bundle = this.activeBundle();

    const repoRoot = await readPrimaryRepoRoot(state.workspaceRoot);
    const worktreeContext = await readWorkspaceGitSnapshot(state.workspaceRoot);
    if (worktreeContext.isWorktreeSession) {
      throw new Error(i18n.t("error.alreadyInWorktree"));
    }

    const baseBranch = bundle.pendingGitBranch ?? state.git.branch;
    if (!baseBranch) {
      throw new Error(i18n.t("error.cannotDetermineBaseBranch"));
    }

    const names = await this.generateWorktreeNamesFromModel(userPrompt, baseBranch, repoRoot);
    const created = await createWorkspaceGitWorktree(repoRoot, names, baseBranch);

    bundle.pendingGitBranch = undefined;
    bundle.workLocation = "local";
    bundle.workspaceRoot = created.worktreePath;

    await this.adoptWorkspaceRootForActiveBundle(created.worktreePath);
    this.startDreamCollectorIfNeeded();
  }

  private async syncHostWorkspaceRootToActiveBundle(
    bundle: SessionBundle = this.activeBundle(),
  ): Promise<boolean> {
    const state = this.requireState();
    if (!needsHostWorkspaceRootSync(bundle, state)) {
      return false;
    }
    await this.adoptWorkspaceRootForActiveBundle(resolveEffectiveWorkspaceRoot(bundle, state));
    return true;
  }

  private async adoptWorkspaceRootForActiveBundle(
    workspaceRoot: string,
    options?: { deferHeavyWork?: boolean },
  ): Promise<void> {
    const resolved = path.resolve(workspaceRoot);
    const state = this.requireState();
    const bundle = this.activeBundle();
    const switchingWorkspace = !sameWorkspaceRoot(state.workspaceRoot, resolved);

    if (this.visiblePaneSessionPaths.length > 1) {
      await prefetchScopedGitBeforeGlobalWorkspaceChange(
        this.paneWorkspaceContext(),
        resolved,
        "project",
      );
      this.paneSessionSliceCache.clear();
    }

    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
      this.invalidateExtensionWarmup();
      this.lastRuntimeError = "";
      this.toolExecutor = undefined;
      this.resetStreamingPlacementState(true);
    }

    state.workspaceRoot = resolved;
    state.git = applyGitRevision(await readWorkspaceGitSnapshot(resolved), 0, { reset: true });
    bundle.workspaceRoot = resolved;
    await this.syncPlanStateForBundle(bundle);

    if (options?.deferHeavyWork) {
      await this.ensureVisiblePaneScopedGit();
      void this.runSerialized(async () => {
        await this.completeWorkspaceAdoptionFollowUp(bundle, resolved, switchingWorkspace);
      });
      return;
    }

    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    if (switchingWorkspace) {
      await this.refreshExtensionsList({ metadataOnly: true });
      this.scheduleExtensionWarmup({ type: "startup", workspaceRoot: resolved });
    }
    await this.ensureVisiblePaneScopedGit();
  }

  private async completeWorkspaceAdoptionFollowUp(
    bundle: SessionBundle,
    workspaceRoot: string,
    switchingWorkspace: boolean,
  ): Promise<void> {
    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    if (switchingWorkspace) {
      await this.refreshExtensionsList({ metadataOnly: true });
      this.scheduleExtensionWarmup({ type: "startup", workspaceRoot });
    }
  }

  private async adoptNoWorkspaceBindingForActiveBundle(options?: {
    deferHeavyWork?: boolean;
  }): Promise<void> {
    const state = this.requireState();
    const bundle = this.activeBundle();
    const home = resolveDesktopHomeDirectory();
    const switchingWorkspace = !sameWorkspaceRoot(state.workspaceRoot, home);
    const previousBinding = normalizeWorkspaceBinding(state.workspaceBinding);

    if (this.visiblePaneSessionPaths.length > 1) {
      await prefetchScopedGitBeforeGlobalWorkspaceChange(this.paneWorkspaceContext(), home, "none");
      this.paneSessionSliceCache.clear();
    }

    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
      this.invalidateExtensionWarmup();
      this.lastRuntimeError = "";
      this.toolExecutor = undefined;
      this.resetStreamingPlacementState(true);
    }

    const git = applyGitRevision(await readWorkspaceGitSnapshot(home), 0, { reset: true });
    git.workLocation = bundle.workLocation;

    let lastProjectWorkspaceRoot = state.config.lastProjectWorkspaceRoot;
    if (
      previousBinding === "project" &&
      state.workspaceRoot &&
      !sameWorkspaceRoot(state.workspaceRoot, home)
    ) {
      lastProjectWorkspaceRoot = state.workspaceRoot;
    }

    state.workspaceBinding = "none";
    state.workspaceRoot = home;
    state.git = git;
    bundle.workspaceRoot = home;
    bundle.workspaceBinding = "none";
    bundle.scopedGit = undefined;

    state.config = {
      ...state.config,
      workspaceBinding: "none",
      ...(lastProjectWorkspaceRoot ? { lastProjectWorkspaceRoot } : {}),
    };
    await saveConfig(state.config);

    await this.syncPlanStateForBundle(bundle);

    if (options?.deferHeavyWork) {
      await this.ensureVisiblePaneScopedGit();
      void this.runSerialized(async () => {
        await this.completeWorkspaceAdoptionFollowUp(bundle, home, switchingWorkspace);
      });
      return;
    }

    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    if (switchingWorkspace) {
      await this.refreshExtensionsList({ metadataOnly: true });
      this.scheduleExtensionWarmup({ type: "startup", workspaceRoot: home });
    }
    await this.ensureVisiblePaneScopedGit();
  }

  private async generateWorktreeNamesFromModel(
    userPrompt: string,
    baseBranch: string,
    repoRoot: string,
  ): Promise<{ worktreeName: string; branchName: string }> {
    const state = this.requireState();
    const lightweightModel = resolveLightweightChatModelProfile(state.config);
    if (!lightweightModel) {
      throw new Error(i18n.t("error.lightweightChatModelNotConfigured"));
    }
    const apiKey = await resolveApiKeyForConfigModel(state.config, lightweightModel.profile.ref);
    if (!apiKey) {
      throw new Error(i18n.t("error.autoWorktreeNameFailedNoKey"));
    }

    const overlay = overlayExtensionRulesAndSkills(
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      state.extensionInstructionContributions,
    );
    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const toolExecutor = await this.ensureToolExecutor();
    return generateWorktreeNamesFromModelTask({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      config: state.config,
      taskModel: lightweightModel.name,
      taskProfile: lightweightModel.profile,
      apiKey,
      metadata: {
        ...state.metadata,
        rules: { ...state.metadata.rules, enabledRules: overlay.rules },
        skills: { ...state.metadata.skills, enabledSkillCatalog: overlay.skills },
      },
      extensionSystemPrompts,
      toolExecutor,
      runtimeBasicInfo: buildDesktopRuntimeBasicInfo(
        state.workspaceRoot,
        toolExecutor,
        gitBranchLabelForBasicInfo(state.git),
      ),
      userPrompt,
      baseBranch,
      repoRoot,
    });
  }

  private extensionManager() {
    return this.hostExtensionManager;
  }

  async resolveExtensionViewFile(
    extensionId: string,
    viewId: string,
  ): Promise<{ filePath: string; extensionRoot: string } | null> {
    return resolveEnabledExtensionViewFile(this.extensionManager(), extensionId, viewId);
  }

  async resolveExtensionViewOwner(
    viewId: string,
  ): Promise<{ extensionId: string; title?: string; width?: number; height?: number } | null> {
    return resolveEnabledExtensionViewOwner(this.extensionManager(), viewId);
  }

  private async refreshExtensionsList(options?: { metadataOnly?: boolean }): Promise<void> {
    const state = this.requireState();
    const manager = this.extensionManager();
    const extensions = await manager.list();
    state.extensionsList = await buildDesktopExtensionListItems(manager, extensions, options);

    // Multi-source marketplace: refresh every source, then read its catalog.
    const marketplaceContext = { spiritDataDir: spiritDataDir(), hostKind: "desktop" as const };
    const sources = await listAllMarketplaceSources(marketplaceContext);
    state.marketplaceSources = sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayName: source.displayName,
      kind: source.kind,
      locator: source.locator,
      ...(source.ref ? { ref: source.ref } : {}),
      internal: source.id === "built-in" || source.id === "personal",
    }));
    const catalogs: Record<string, DesktopMarketplaceCatalogEntry[]> = {};
    const warnings: string[] = [];
    for (const source of sources) {
      try {
        const read = await readMarketplaceCatalogForSource(marketplaceContext, source);
        catalogs[source.id] = await buildDesktopMarketplaceCatalogEntries(read.items);
        if (read.warning) {
          warnings.push(read.warning);
        }
      } catch (error) {
        catalogs[source.id] = [];
        warnings.push(
          `Failed to read marketplace "${source.displayName}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    state.marketplaceCatalogs = catalogs;
    // The All view's merged catalog: per-source rows concatenated and sorted
    // with the backend's comparator, so the renderer never re-sorts.
    state.marketplaceCatalogAll = Object.values(catalogs)
      .flat()
      .sort(compareMarketplaceDisplayOrder);
    state.marketplaceWarnings = warnings;

    state.extensionCss = await collectDesktopExtensionCssLayers(extensions);
    state.extensionInstructionContributions =
      await collectEnabledExtensionInstructionContributions(extensions);
  }

  private async refreshExtensionToolDefinitions(
    executor: DesktopToolExecutor = this.requireToolExecutor(),
  ): Promise<void> {
    const extensions = await this.extensionManager().list();
    executor.setExtensionToolDefinitions(buildDesktopExtensionToolDefinitions(extensions));
  }

  private async collectExtensionSystemPrompts(): Promise<LlmExtensionSystemPrompt[]> {
    const adapter = getDesktopExtensionHostAdapter();
    if (!adapter) {
      return [];
    }

    return collectExtensionSystemPrompts(this.extensionManager(), adapter);
  }

  private async refreshRuntimeAfterExtensionMutation(): Promise<void> {
    await this.refreshExtensionSystemPromptsCache();
    await this.refreshExtensionsList();
    await this.refreshSharedMcpConfigAfterExtensionMutation();

    if (this.runtime?.isBusy()) {
      this.activeBundle().deferredRuntimeRefreshWhileBusy = true;
      return;
    }

    this.activeBundle().deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntime();
    this.lastRuntimeError = "";
  }

  private async refreshSharedMcpConfigAfterExtensionMutation(): Promise<void> {
    const state = this.requireState();
    const mcp = this.sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding);
    await mcp.refreshConfig();
    mcp.startBackgroundRefreshInBackground(true);
    await notifyDesktopServerRefreshExtensions(spiritDataDir());
  }

  private invalidateExtensionWarmup(): void {
    this.extensionWarmup.invalidate();
  }

  private scheduleExtensionWarmup(trigger: ExtensionWarmupTrigger): void {
    this.extensionWarmup.schedule(trigger, {
      collectSystemPrompts: () => this.collectExtensionSystemPrompts(),
      refreshExtensionsListFull: () => this.refreshExtensionsList(),
      dispatchEvent: (event) => this.dispatchExtensionEvent(event),
      applyWarmupToRuntime: () => this.applyExtensionWarmupToRuntime(),
      emitSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
    });
  }

  private async refreshExtensionSystemPromptsCache(): Promise<void> {
    await this.extensionWarmup.refreshSystemPromptsCache({
      collectSystemPrompts: () => this.collectExtensionSystemPrompts(),
    });
  }

  private async applyExtensionWarmupToRuntime(): Promise<void> {
    const bundle = this.activeBundle();
    if (bundle.runtime?.isBusy()) {
      bundle.deferredRuntimeRefreshWhileBusy = true;
      return;
    }
    bundle.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
    this.lastRuntimeError = "";
  }

  private async dispatchExtensionEvent(
    event: HostExtensionEvent,
    options: {
      targetExtensionIds?: readonly string[];
    } = {},
  ): Promise<void> {
    const adapter = getDesktopExtensionHostAdapter();
    if (!adapter) {
      return;
    }

    try {
      await this.extensionManager().dispatchEvent({
        event,
        host: adapter,
        logger: console,
        ...(options.targetExtensionIds ? { targetExtensionIds: options.targetExtensionIds } : {}),
      });
    } catch (error) {
      this.lastRuntimeError = error instanceof Error ? error.message : String(error);
    }
  }

  private ensureActiveSession(seedText: string, bundle: SessionBundle = this.activeBundle()): void {
    if (bundle.activeSession) {
      this.promoteProvisionalSessionIfNeeded(seedText, bundle);
      return;
    }

    bundle.activeSession = {
      filePath: defaultNewSessionPath(),
      displayName: deriveDisplayNameFromSeed(seedText),
      kind: "stored",
    };
  }

  private projectRemoteUserTurn(
    bundle: SessionBundle,
    input: { text: string; explicitWorkspaceFiles: PendingWorkspaceFile[] },
  ): void {
    const displayText = input.text.trim();
    if (!displayText && input.explicitWorkspaceFiles.length === 0) {
      return;
    }
    const localFileAttachments =
      input.explicitWorkspaceFiles.length > 0
        ? input.explicitWorkspaceFiles.map((file) => ({
            path: file.path,
            name: path.basename(file.path),
            isImage: file.kind === "image",
          }))
        : undefined;
    this.clearAssistantContinuationMarkers(bundle);
    this.ensureActiveSession(displayText, bundle);
    this.prepareSessionTitleForFirstUserTurn(displayText, bundle);
    const userMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(bundle),
      role: "user",
      content: displayText,
      pending: false,
      ...(localFileAttachments ? { localFileAttachments } : {}),
    };
    bundle.messages.push(userMessage);
    bundle.messageTimeline.beginUserTurn(displayText, {
      messageId: userMessage.id,
      ...(localFileAttachments ? { localFileAttachments } : {}),
    });
    this.resetStreamingPlacementState(false, bundle);
    bundle.conversationRevision += 1;
    this.requestThrottledLiveSnapshotEmit();
    this.notifySessionListUpdated();
  }

  private promoteProvisionalSessionIfNeeded(
    seedText: string,
    bundle: SessionBundle = this.activeBundle(),
  ): void {
    const activeSession = bundle.activeSession;
    if (!activeSession || !isProvisionalSessionPath(activeSession.filePath)) {
      return;
    }
    if (isSideChatProvisionalSessionPath(activeSession.filePath)) {
      return;
    }

    const existingUserCount = bundle.messageTimeline
      .toMessages()
      .filter((message) => message.role === "user").length;
    const nextPath = defaultNewSessionPath();
    activeSession.filePath = nextPath;
    if (existingUserCount === 0) {
      activeSession.displayName = deriveDisplayNameFromSeed(seedText);
    }
    this.sessionRegistry.rekeyBundle(bundle, nextPath);
    void migrateRemoteConversationKey(bundle.runtime, path.resolve(nextPath)).catch((error) => {
      this.lastRuntimeError = error instanceof Error ? error.message : String(error);
    });
  }

  private archiveMessages(): Array<{ role: "user" | "assistant"; content: string }> {
    return buildArchiveMessagesFromConversation(this.desktopMessages());
  }

  private archiveAssistantAux(): AssistantAuxArchiveEntry[] {
    return buildArchiveAssistantAuxFromConversation(this.desktopMessages());
  }

  private desktopMessages(): ConversationMessageSnapshot[] {
    return this.activeBundle().messageTimeline.toMessages();
  }

  private createMessageTimelineFromMessages(
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: DesktopTimelineTurnSnapshot[],
  ): DesktopMessageTimeline {
    let nextTimelineMessageId = nextMessageIdFromMessages(messages);
    if (timelineSnapshot && timelineSnapshot.length > 0) {
      try {
        return DesktopMessageTimeline.fromSnapshot(timelineSnapshot, {
          allocateMessageId: () => nextTimelineMessageId++,
          reserveMessageId: (messageId) => {
            if (messageId >= nextTimelineMessageId) {
              nextTimelineMessageId = messageId + 1;
            }
          },
        });
      } catch {
        nextTimelineMessageId = nextMessageIdFromMessages(messages);
      }
    }
    return DesktopMessageTimeline.fromMessages(messages, {
      allocateMessageId: () => nextTimelineMessageId++,
      reserveMessageId: (messageId) => {
        if (messageId >= nextTimelineMessageId) {
          nextTimelineMessageId = messageId + 1;
        }
      },
    });
  }

  private rebuildMessageTimelineFromMessages(bundle: SessionBundle = this.activeBundle()): void {
    bundle.messageTimeline = this.createMessageTimelineFromMessages(bundle.messages);
  }

  private takeNextTimelineAssistantSegmentKind(bundle: SessionBundle): DesktopTimelineSegmentKind {
    const kind = bundle.nextTimelineAssistantSegmentKind;
    bundle.nextTimelineAssistantSegmentKind = "initial";
    return kind;
  }

  private markInterruptedToolsInCurrentTurn(): void {
    const messages = this.activeBundle().messages;
    let lastUser = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUser = index;
        break;
      }
    }
    for (let index = lastUser + 1; index < messages.length; index += 1) {
      const message = messages[index];
      const tool = message?.tool;
      if (!tool?.toolCallId) {
        continue;
      }
      if (
        tool.phase !== "preview" &&
        tool.phase !== "running" &&
        tool.phase !== "pending-approval"
      ) {
        continue;
      }
      const headline = i18n.t("error.interrupted", { toolName: tool.toolName });
      const failedTool = applyToolCallSummaryCopy(
        {
          ...tool,
          phase: "failed",
          headline,
          detailLines: [],
        },
        { headline },
      );
      message.tool = failedTool;
      this.activeBundle().messageTimeline.upsertToolMessage(tool.toolCallId, failedTool);
      const orchestration = this.activeOrchestration();
      orchestration.assistantMessages.upsertToolMessage(tool.toolCallId, failedTool, 0);
    }
    this.activeBundle().messages = this.desktopMessages();
  }

  private clearAssistantContinuationMarkers(bundle?: SessionBundle): void {
    clearAssistantContinuationMarkersFromService(this.conversationContinuationContext(bundle));
  }

  private markAssistantMessageContinuable(content: string): void {
    markAssistantMessageContinuableFromService(this.conversationContinuationContext(), content);
  }

  private latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined {
    return latestContinuableAssistantMessageFromService(this.conversationContinuationContext());
  }

  private markLatestRenderableAssistantMessageContinuableInCurrentTurn(): void {
    markLatestRenderableAssistantMessageContinuableInCurrentTurnFromService(
      this.conversationContinuationContext(),
    );
  }

  private logContinuationSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
    pendingAux: PendingAssistantAux | undefined;
  }): void {
    logContinuationSnapshotStateFromService(input);
  }

  private logToolSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    timelineMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
  }): void {
    logToolSnapshotStateFromService(this.conversationContinuationContext(), input);
  }

  private syncSubagentToolStreamingOutput(bundle: SessionBundle): void {
    syncSubagentToolStreamingOutputFromService(this.conversationContinuationContext(), bundle);
  }

  private refreshArchiveFromRuntime(bundle: SessionBundle = this.activeBundle()): void {
    refreshArchiveFromRuntimeFromService(this.conversationContinuationContext(), bundle);
  }

  private async recordHostFileChange(
    bundle: SessionBundle,
    change: HostRecordedFileChange,
  ): Promise<void> {
    return recordHostFileChangeFromService(this.rewindHostContext(), bundle, change);
  }

  private bindFileChangesToToolMessage(
    bundle: SessionBundle,
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    bindFileChangesToToolMessageFromService(bundle, execution, messageId);
  }

  private async recordRewindCheckpoint(
    messageId: number,
    beforeUserCheckpoint?: DesktopRewindCheckpointSnapshot,
    bundle?: SessionBundle,
  ): Promise<void> {
    return recordRewindCheckpointFromService(
      this.rewindHostContext(bundle),
      messageId,
      beforeUserCheckpoint,
    );
  }

  private async applyTodosAfterRewind(snapshot: DesktopRewindCheckpointSnapshot): Promise<void> {
    return applyTodosAfterRewindFromService(this.rewindHostContext(), snapshot);
  }

  private async buildRewindCheckpointSnapshot(
    bundle?: SessionBundle,
  ): Promise<DesktopRewindCheckpointSnapshot> {
    return buildRewindCheckpointSnapshotFromService(this.rewindHostContext(bundle));
  }

  private restoreBeforeRewindCheckpoint(
    snapshot: DesktopRewindCheckpointSnapshot,
    checkpointSequence: number,
  ): void {
    restoreBeforeRewindCheckpointFromService(
      this.rewindHostContext(),
      snapshot,
      checkpointSequence,
    );
  }

  private async persistCurrentSessionIfNeeded(bundle?: SessionBundle): Promise<void> {
    const target = bundle ?? this.sessionRegistry.getActive();
    if (!target) {
      return;
    }
    await this.persistSessionBundle(target, {
      // syncActiveRuntimePointer keeps this.runtime ≡ active.runtime; for an explicit bundle use its own runtime
      fromRuntime: bundle ? bundle.runtime : this.runtime,
      bumpListSortAt: true,
    });
  }

  private async persistSessionBundle(
    bundle: SessionBundle,
    options: {
      fromRuntime?: DesktopHostRuntime;
      bumpListSortAt?: boolean;
    } = {},
  ): Promise<void> {
    const state = this.requireState();
    const result = await persistDesktopSessionBundle({
      bundle,
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      gitBranch: state.git.branch,
      fromRuntime: options.fromRuntime,
      bumpListSortAt: options.bumpListSortAt,
    });
    if (!result.nextId) {
      return;
    }
    if (result.rekeyNeeded) {
      this.sessionRegistry.rekeyBundle(bundle, result.nextId);
    } else {
      bundle.id = result.nextId;
    }
    // The daemon keeps the latest snapshot per session; other attached hosts
    // (e.g. CLI) pull it on attach and on update notifications.
    const timelineRuntime = options.fromRuntime ?? bundle.runtime;
    if (result.desktopMessageTimeline && timelineRuntime) {
      timelineRuntime.pushDesktopTimeline(result.desktopMessageTimeline);
    }
  }

  private activeBundle(): SessionBundle {
    return this.sessionRegistry.requireActive();
  }

  private requireState(): HostState {
    if (!this.state) {
      throw new Error(i18n.t("error.hostNotInitialized"));
    }
    return this.state;
  }

  private requireRuntime(): DesktopHostRuntime {
    const runtime = this.activeBundle().runtime ?? this.runtime;
    if (!runtime) {
      throw new Error(this.lastRuntimeError || i18n.t("error.runtimeNotReady"));
    }
    return runtime;
  }

  private allocateMessageId(bundle: SessionBundle = this.activeBundle()): number {
    const next = bundle.messageIdCounter;
    bundle.messageIdCounter += 1;
    return next;
  }

  private insertUserApprovalReplyMessage(content: string, pendingToolCallId?: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const bundle = this.activeBundle();
    const inserted = bundle.messageTimeline.insertApprovalGuidanceUserReply(
      trimmed,
      pendingToolCallId,
      this.allocateMessageId(),
    );
    if (!inserted) {
      return;
    }
    bundle.messages = this.desktopMessages();
  }

  /**
   * @param full `false`: only clear the thinking insertion anchor (new user turn, to avoid inserting into an old tool chain). `true`: also clear finalize dedupe and apply batch counters (session reset / opening an archive).
   */
  private resetStreamingPlacementState(
    full: boolean,
    bundle: SessionBundle = this.activeBundle(),
  ): void {
    const orchestration = this.orchestrationFor(bundle);
    orchestration.assistantMessages.resetStreamingPlacementState(full);
    bundle.nextTimelineAssistantSegmentKind = "initial";
    if (!full) {
      return;
    }
    orchestration.conversationSnapshotView.clearStandalonePendingAuxState();
    orchestration.runtimeEvents.reset();
  }

  private async runSerialized<T>(work: () => Promise<T>, _label = "unlabeled"): Promise<T> {
    const previous = this.serialized;
    let release: (() => void) | undefined;
    this.serialized = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release?.();
      // Sole choke point: every command that makes a session busy (sending a message, approval resume, queue, automation...)
      // funnels through runSerialized, so this is where the pump is ensured to start.
      this.sessionPump.ensureRunning();
    }
  }

  private hasSessionPumpWork(): boolean {
    for (const bundle of this.sessionRegistry.all()) {
      if (
        sessionBundleNeedsPumpTick(bundle) ||
        remoteDesktopRuntimeNeedsProjection(bundle.runtime)
      ) {
        return true;
      }
    }
    return false;
  }

  private async runSessionPumpTick(): Promise<void> {
    await pumpSessionsCommand(this.sessionTurnContext());
    if (this.hasSessionPumpWork()) {
      // Busy but event-driven pushes may not arrive for a long time (pure network wait); the heartbeat keeps host-state animations like the spinner refreshing.
      if (Date.now() - this.lastLiveSnapshotEmitAtMs >= LIVE_SNAPSHOT_BUSY_HEARTBEAT_MS) {
        this.requestThrottledLiveSnapshotEmit();
      }
      this.maybeNotifySessionListDuringBackgroundActivity();
      return;
    }
    // busy → idle: push the final snapshot and refresh the session list (replacing the listSessions the renderer poll loop used to run on exit).
    this.requestThrottledLiveSnapshotEmit();
    this.notifySessionListUpdated();
  }

  /** When the foreground is idle and other bundles are busy, throttled-refresh the sidebar isBusy state. */
  private maybeNotifySessionListDuringBackgroundActivity(): void {
    const activeId = this.sessionRegistry.activeSessionId();
    let backgroundBusy = false;
    for (const bundle of this.sessionRegistry.all()) {
      if (bundle.id !== activeId && isSessionBundleBusy(bundle)) {
        backgroundBusy = true;
        break;
      }
    }
    if (!backgroundBusy) {
      return;
    }
    const now = Date.now();
    if (now - this.lastSessionListNotifyAtMs < SESSION_LIST_NOTIFY_INTERVAL_MS) {
      return;
    }
    this.lastSessionListNotifyAtMs = now;
    this.notifySessionListUpdated();
  }

  /** Sole push outlet for live snapshots during streaming: leading+trailing throttling. */
  private requestThrottledLiveSnapshotEmit(): void {
    if (this.liveSnapshotEmitTimer !== undefined) {
      return;
    }
    const elapsedMs = Date.now() - this.lastLiveSnapshotEmitAtMs;
    const delayMs = Math.max(0, LIVE_SNAPSHOT_EMIT_THROTTLE_MS - elapsedMs);
    const timer = setTimeout(() => {
      this.liveSnapshotEmitTimer = undefined;
      this.emitLiveSnapshotUpdate();
    }, delayMs);
    timer.unref?.();
    this.liveSnapshotEmitTimer = timer;
  }

  private requireEnabledSkillEntry(skillName: string): {
    source: {
      id: string;
      scope: LlmActiveSkill["scope"];
      name: string;
      description: string;
      path: string;
    };
    content: string;
  } {
    const normalized = skillName.trim();
    const entry = this.requireState().metadata.skills.entries.find(
      (candidate) => candidate.enabled && candidate.source.name === normalized,
    );
    if (entry) {
      return entry;
    }
    const extensionSkill = this.requireState().extensionInstructionContributions.skills.find(
      (candidate) => candidate.name === normalized,
    );
    if (extensionSkill) {
      return {
        source: {
          id: extensionSkill.id,
          scope: "extension",
          name: extensionSkill.name,
          description: extensionSkill.description,
          path: extensionSkill.path,
        },
        content: extensionSkill.content,
      };
    }
    throw new Error(i18n.t("error.skillNotFound", { name: normalized }));
  }

  private requireToolExecutor(): DesktopToolExecutor {
    const executor = this.activeBundle().toolExecutor ?? this.toolExecutor;
    if (!executor) {
      throw new Error(i18n.t("error.mcpExecutorNotInitialized"));
    }
    return executor;
  }

  private requireExtensionHostAdapter(): DesktopExtensionHostAdapter {
    return requireDesktopExtensionHostAdapter();
  }

  async shutdown(): Promise<void> {
    for (const bundle of this.sessionRegistry.all()) {
      if (!bundle.activeSession || bundle.activeSession.kind === "ephemeral") {
        continue;
      }
      try {
        await tickSessionCommand(this.sessionTurnContext(), bundle);
        await this.persistSessionBundle(bundle, {
          fromRuntime: bundle.runtime,
          bumpListSortAt: false,
        });
      } catch {
        // Best-effort flush before exit; do not block teardown.
      }
    }
    this.sessionPump.stop();
    const runtimes = [...this.sessionRegistry.all()].map((bundle) => bundle.runtime);
    await Promise.all(runtimes.map((runtime) => closeRemoteDesktopRuntime(runtime)));
    // After sessions close, drop the shared WS so daemon can idle-exit when we are the last host.
    await closeSharedDesktopServerClient();
  }
}

const desktopHostService = new DesktopHostService();

export function setDesktopGitHubFetchImplementation(fetchImpl: typeof fetch | undefined): void {
  setGitHubFetchImplementation(fetchImpl);
}

export async function invokeDesktopHostCommand(
  command: HostCommandName,
  payload?: unknown,
): Promise<unknown> {
  return desktopHostService.invoke(command, payload);
}

export async function resolveDesktopExtensionViewFile(
  extensionId: string,
  viewId: string,
): Promise<{ filePath: string; extensionRoot: string } | null> {
  return desktopHostService.resolveExtensionViewFile(extensionId, viewId);
}

export function openDesktopHostExtensionUi(request: McpUiOpenRequest): Promise<McpUiOpenResult> {
  return desktopHostService.openLocalExtensionUi(request);
}

export function closeDesktopHostExtensionUi(): void {
  desktopHostService.dismissLocalExtensionUi();
}

export async function resolveDesktopExtensionViewOwner(
  viewId: string,
): Promise<{ extensionId: string; title?: string; width?: number; height?: number } | null> {
  return desktopHostService.resolveExtensionViewOwner(viewId);
}

export function subscribeDesktopDreamUpdates(
  listener: (snapshot: DesktopSnapshot) => void,
): () => void {
  return desktopHostService.subscribeDreamUpdates(listener);
}

export function subscribeDesktopAutomationsUpdates(
  listener: (snapshot: DesktopSnapshot) => void,
): () => void {
  return desktopHostService.subscribeAutomationsUpdates(listener);
}

export function subscribeDesktopSessionListUpdates(listener: () => void): () => void {
  return desktopHostService.subscribeSessionListUpdates(listener);
}

export async function shutdownDesktopHostService(): Promise<void> {
  await desktopHostService.shutdown();
}

function normalizeApprovalDecision(
  decision: DesktopApprovalDecision | undefined,
): RuntimeApprovalDecision {
  switch (decision?.kind) {
    case "allow":
      return {
        kind: "allow",
        ...(decision.remember ? { remember: decision.remember } : {}),
      };
    case "deny":
      return {
        kind: "deny",
        ...(decision.resultText?.trim() ? { resultText: decision.resultText.trim() } : {}),
      };
    case "guidance": {
      const userMessage = decision.userMessage.trim();
      if (!userMessage) {
        throw new Error(i18n.t("error.enterGuidance"));
      }
      return {
        kind: "guidance",
        userMessage,
        ...(decision.resultText?.trim() ? { resultText: decision.resultText.trim() } : {}),
      };
    }
    default:
      throw new Error(i18n.t("error.invalidApproval"));
  }
}
