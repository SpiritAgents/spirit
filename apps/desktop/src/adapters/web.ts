import type { HostApi } from "../host-api";
import type { ApprovalLevel, LocalFileComposerRoute, WorkLocationKind } from "../types.js";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  BootstrapRequest,
  CommitChangesRequest,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteRuleRequest,
  DesktopDreamOverviewItem,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallLspProviderRequest,
  RunExtensionRequest,
  SaveHookEntryRequest,
  SetExtensionEnabledRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  ReadExtensionDocumentRequest,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
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
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  HostTextFileStatResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  DesktopModelProvider,
} from "../types";

const DEFAULT_HOST_URL = import.meta.env.VITE_SPIRIT_HOST_URL?.toString().trim() || "";
const WEB_HOST_TOKEN_STORAGE_KEY = "spirit-web-host-token";

type WebHostPairingResponse = {
  token: string;
};

/** Remote web client viewing session; HTTP submit/poll always scope to this path. */
let webViewingSessionPath = "";

export function setWebClientViewingSessionPath(sessionPath: string): void {
  webViewingSessionPath = sessionPath.trim();
}

export function getWebClientViewingSessionPath(): string {
  return webViewingSessionPath;
}

function rememberWebViewingSession(snapshot: DesktopSnapshot | null | undefined): void {
  const sessionPath = snapshot?.activeSession?.filePath?.trim();
  if (sessionPath) {
    webViewingSessionPath = sessionPath;
  }
}

function rememberWebViewingSessionAfterSubmit(
  request: { sessionPath?: string },
  snapshot: DesktopSnapshot,
): void {
  const responsePath = snapshot.activeSession?.filePath?.trim();
  if (!responsePath) {
    return;
  }
  const requestPath = request.sessionPath?.trim();
  if (requestPath) {
    webViewingSessionPath = responsePath;
  }
}

function withWebViewingSessionPath<T extends { sessionPath?: string }>(request: T): T {
  const sessionPath = request.sessionPath?.trim() || webViewingSessionPath.trim();
  return sessionPath ? { ...request, sessionPath } : request;
}

function webClientHost(): { kind: "web"; pageUrl: string } {
  return { kind: "web", pageUrl: window.location.href };
}

function withWebClientHost<T extends Record<string, unknown>>(
  request?: T,
): T & {
  clientHost: { kind: "web"; pageUrl: string };
} {
  return { ...(request ?? ({} as T)), clientHost: webClientHost() };
}

export function createWebHostApi(): HostApi {
  const baseUrl = DEFAULT_HOST_URL || "";

  return {
    kind: "web",
    bootstrap(request?: BootstrapRequest) {
      const shouldIsolate = !request?.workspaceRoot;
      return post<DesktopSnapshot>(
        baseUrl,
        "/api/bootstrap",
        withWebClientHost({
          ...request,
          ...(shouldIsolate ? { isolateSession: true } : {}),
        }),
      ).then((snapshot) => {
        rememberWebViewingSession(snapshot);
        return snapshot;
      });
    },
    commitChanges(request: CommitChangesRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/git/commit", request);
    },
    updateConfig(request: UpdateConfigRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/config", request);
    },
    installLspProvider(_request: InstallLspProviderRequest) {
      return Promise.reject(
        new Error("LSP provider install is only available in the desktop app."),
      );
    },
    addModel(request: AddModelRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/models", request);
    },
    addProviderModels(request: AddProviderModelsRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/models/add-provider", request);
    },
    previewModels(request: PreviewModelsRequest) {
      return post<PreviewModelsResponse>(baseUrl, "/api/models/preview", request);
    },
    removeModel(name: string) {
      return post<DesktopSnapshot>(baseUrl, "/api/models/remove", { name });
    },
    removeProviderModels(provider: DesktopModelProvider) {
      return post<DesktopSnapshot>(baseUrl, "/api/models/remove-provider", { provider });
    },
    removeProviderGroup(request: import("../types").RemoveProviderGroupRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/models/remove-provider-group", request);
    },
    addMcpServer(request: AddMcpServerRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/mcps", request);
    },
    deleteMcpServer(request: DeleteMcpServerRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/mcps/remove", request);
    },
    saveHookEntry(request: SaveHookEntryRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/hooks", request);
    },
    deleteHookEntry(request: DeleteHookEntryRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/hooks/remove", request);
    },
    inspectMcpServer(name: string) {
      return post<DesktopMcpServerInspection>(baseUrl, "/api/mcps/inspect", { name });
    },
    importExtension(request: ImportExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions", request);
    },
    deleteExtension(request: DeleteExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions/remove", request);
    },
    setExtensionEnabled(request: SetExtensionEnabledRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions/enabled", request);
    },
    readExtensionDocument(request: ReadExtensionDocumentRequest) {
      return post<string>(baseUrl, "/api/extensions/document", request);
    },
    runExtension(request: RunExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions/run", request);
    },
    updateExtensionSettings(request: UpdateExtensionSettingsRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions/settings", request);
    },
    updateExtensionSecret(request: UpdateExtensionSecretRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/extensions/secret", request);
    },
    createRule(request: CreateRuleRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/rules", request);
    },
    createSkill(request: CreateSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/skills", request);
    },
    deleteRule(request: DeleteRuleRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/rules/remove", request);
    },
    deleteSkill(request: DeleteSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/skills/remove", request);
    },
    submitSkillSlash(request: SubmitSkillSlashRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/skills/submit", request);
    },
    submitGitChip(request) {
      return post<DesktopSnapshot>(baseUrl, "/api/git/chip", request);
    },
    submitStartImplementing() {
      return post<DesktopSnapshot>(baseUrl, "/api/start-implementing");
    },
    compactHistory() {
      return post<DesktopSnapshot>(baseUrl, "/api/compact");
    },
    submitUserTurn(request) {
      return post<DesktopSnapshot>(baseUrl, "/api/submit", withWebViewingSessionPath(request)).then(
        (snapshot) => {
          rememberWebViewingSessionAfterSubmit(request, snapshot);
          return snapshot;
        },
      );
    },
    setLoopEnabled(enabled: boolean) {
      return post<DesktopSnapshot>(baseUrl, "/api/loop", { enabled });
    },
    setApprovalLevel(approvalLevel: ApprovalLevel) {
      return post<DesktopSnapshot>(baseUrl, "/api/approval", { approvalLevel });
    },
    setPendingGitBranch(branch: string) {
      return post<DesktopSnapshot>(baseUrl, "/api/git/pending-branch", { branch });
    },
    setWorkLocation(workLocation: WorkLocationKind) {
      return post<DesktopSnapshot>(baseUrl, "/api/git/work-location", { workLocation });
    },
    checkoutGitBranch(request: import("../types.js").CheckoutGitBranchRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/git/checkout", request);
    },
    mergeWorktreeToMain() {
      return post<DesktopSnapshot>(baseUrl, "/api/git/merge-worktree");
    },
    pushGitBranch() {
      return post<DesktopSnapshot>(baseUrl, "/api/git/push");
    },
    refreshGitSnapshot() {
      return post<DesktopSnapshot>(baseUrl, "/api/git/refresh-snapshot", {});
    },
    readGitWorkingTree() {
      return post<GitWorkingTreeSnapshot>(baseUrl, "/api/git/working-tree", {});
    },
    readGitHistory(request: ReadGitHistoryRequest = {}) {
      return post<GitHistorySnapshot>(baseUrl, "/api/git/history", request);
    },
    readGitCommitMessage(request: ReadGitCommitMessageRequest) {
      return post<GitCommitMessageSnapshot>(baseUrl, "/api/git/commit-message", request);
    },
    getGitHubAuthStatus() {
      return Promise.resolve({ connected: false });
    },
    beginGitHubDeviceLogin() {
      return Promise.reject(
        new Error("GitHub device login is only available in the Electron desktop app."),
      );
    },
    completeGitHubDeviceLogin() {
      return Promise.reject(
        new Error("GitHub device login is only available in the Electron desktop app."),
      );
    },
    cancelGitHubDeviceLogin() {
      return Promise.resolve();
    },
    disconnectGitHub() {
      return Promise.resolve({ connected: false });
    },
    getGitHubPullRequestForCurrentBranch() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    listGitHubPullRequests() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    listGitHubAutomationRepositories() {
      return Promise.reject(
        new Error("GitHub repositories are only available in the Electron desktop app."),
      );
    },
    searchGitHubAutomationRepositories() {
      return Promise.reject(
        new Error("GitHub repositories are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestTabCounts() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestDetail() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestConversation() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestFiles() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestCommits() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    getGitHubPullRequestChecks() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    mergeGitHubPullRequest() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    markGitHubPullRequestReady() {
      return Promise.reject(
        new Error("GitHub pull requests are only available in the Electron desktop app."),
      );
    },
    abortConversation(request?: AbortConversationRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/abort", request ?? {});
    },
    abortShell(toolCallId: string) {
      return post<DesktopSnapshot>(baseUrl, "/api/abort-shell-command", { toolCallId });
    },
    continueAssistantCompletion(messageId: number) {
      return post<DesktopSnapshot>(baseUrl, "/api/continue", { messageId });
    },
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/rewind-submit", request);
    },
    forkSession(request: ForkSessionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/fork-session", request);
    },
    reorderQueuedUserTurn(request: QueuedUserTurnRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/queue/reorder", request);
    },
    sendQueuedUserTurnNow(request: QueuedUserTurnRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/queue/send-now", request);
    },
    removeQueuedUserTurn(request: QueuedUserTurnRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/queue/remove", request);
    },
    poll(request?: import("../types.js").PollRequest) {
      const body = withWebViewingSessionPath(request ?? {});
      return post<DesktopSnapshot>(baseUrl, "/api/poll", body);
    },
    setSubagentViewerTarget(parentToolCallId: string | null) {
      return post<DesktopSnapshot>(baseUrl, "/api/subagent-viewer-target", { parentToolCallId });
    },
    listDreamsOverview() {
      return get<DesktopDreamOverviewItem[]>(baseUrl, "/api/dreams");
    },
    listAutomations() {
      return get<import("../types.js").DesktopAutomationListItem[]>(baseUrl, "/api/automations");
    },
    getAutomation(automationId: string) {
      return get<import("../types.js").DesktopAutomationDetail | undefined>(
        baseUrl,
        `/api/automations/${encodeURIComponent(automationId)}`,
      );
    },
    createAutomation(request) {
      return post<DesktopSnapshot>(baseUrl, "/api/automations", request);
    },
    updateAutomation(automationId, patch) {
      return post<DesktopSnapshot>(
        baseUrl,
        `/api/automations/${encodeURIComponent(automationId)}`,
        patch,
      );
    },
    deleteAutomation(automationId) {
      return post<DesktopSnapshot>(
        baseUrl,
        `/api/automations/${encodeURIComponent(automationId)}/delete`,
      );
    },
    setAutomationEnabled(automationId, enabled) {
      return post<DesktopSnapshot>(
        baseUrl,
        `/api/automations/${encodeURIComponent(automationId)}/enabled`,
        { enabled },
      );
    },
    subscribeAutomationsUpdates() {
      return () => {};
    },
    subscribeDreamUpdates(callback) {
      const controller = new AbortController();
      void consumeSnapshotStream(
        baseUrl,
        (snapshot) => callback({ kind: "full", snapshot }),
        controller.signal,
      );
      return () => controller.abort();
    },
    replyPendingApproval(request) {
      return post<DesktopSnapshot>(baseUrl, "/api/approval", request);
    },
    replyPendingQuestions(request: import("../types").ReplyPendingQuestionsRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/questions", request);
    },
    replyWorkspaceCapabilityTrust(
      request: import("../types").ReplyWorkspaceCapabilityTrustRequest,
    ) {
      return post<DesktopSnapshot>(baseUrl, "/api/workspace-capability-trust", request);
    },
    openPathInDefaultApp() {
      return Promise.reject(new Error("openPathInDefaultApp is not available on web host"));
    },
    resetSession() {
      return post<DesktopSnapshot>(baseUrl, "/api/reset", withWebClientHost()).then((snapshot) => {
        rememberWebViewingSession(snapshot);
        return snapshot;
      });
    },
    listSessions() {
      return get<SessionListItem[]>(baseUrl, "/api/sessions");
    },
    openSession(path: string) {
      return post<DesktopSnapshot>(
        baseUrl,
        "/api/sessions/open",
        withWebClientHost({ path, activate: false }),
      );
    },
    beginSplitPaneSession(request: BeginSplitPaneSessionRequest) {
      return post<BeginSplitPaneSessionResponse>(baseUrl, "/api/sessions/split/begin", request);
    },
    beginSideChatPaneSession(request: BeginSideChatPaneSessionRequest) {
      return post<BeginSideChatPaneSessionResponse>(
        baseUrl,
        "/api/sessions/side-chat/begin",
        request,
      );
    },
    forkSessionIntoSideChat(request: ForkSessionIntoSideChatRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/side-chat/fork", request);
    },
    setVisiblePaneSessions(request: SetVisiblePaneSessionsRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/visible", request);
    },
    syncSplitPaneSessions(request: SyncSplitPaneSessionsRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/sync", request);
    },
    focusPaneSession(request: FocusPaneSessionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/focus", request);
    },
    closeSplitPaneSession(request: CloseSplitPaneSessionRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/close", request);
    },
    switchPaneWorkspace(request: import("../types").SwitchPaneWorkspaceRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/workspace", request);
    },
    switchPaneModel(request: import("../types").SwitchPaneModelRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/model", request);
    },
    setPanePendingGitBranch(request: import("../types").SetPanePendingGitBranchRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/pending-branch", request);
    },
    setPaneWorkLocation(request: import("../types").SetPaneWorkLocationRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/work-location", request);
    },
    checkoutPaneGitBranch(request: import("../types").CheckoutPaneGitBranchRequest) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/split/checkout-branch", request);
    },
    deleteSession(path: string) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/delete", { path });
    },
    renameSession(path: string, displayName: string) {
      return post<DesktopSnapshot>(baseUrl, "/api/sessions/rename", { path, displayName });
    },
    listWorkspaceFileReferenceSuggestions(request: QueryWorkspaceFileReferenceSuggestionsRequest) {
      return post<WorkspaceFileReferenceSuggestionsResponse>(
        baseUrl,
        "/api/workspace/file-reference-suggestions",
        request,
      );
    },
    requestCodeCompletion(request: import("../types").RequestCodeCompletionRequest) {
      return post<import("../types").CodeCompletionResponse>(
        baseUrl,
        "/api/workspace/code-completion/request",
        request,
      );
    },
    abortCodeCompletion() {
      return post<void>(baseUrl, "/api/workspace/code-completion/abort");
    },
    recordCodeCompletionFileState(
      request: import("../types").RecordCodeCompletionFileStateRequest,
    ) {
      return post<void>(baseUrl, "/api/workspace/code-completion/record-file-state", request);
    },
    resetCodeCompletionJournal() {
      return post<void>(baseUrl, "/api/workspace/code-completion/reset-journal");
    },
    primeWorkspaceFileReferenceIndex() {
      return post<void>(baseUrl, "/api/workspace/file-reference-index/prime");
    },
    getWorkspaceFileReferenceIndex() {
      return post<import("../types").WorkspaceFileReferenceIndexSnapshot>(
        baseUrl,
        "/api/workspace/file-reference-index",
      );
    },
    listWorkspaceExplorerChildren(relativePath: string) {
      return post<WorkspaceExplorerListResult>(baseUrl, "/api/workspace/explorer", {
        relativePath,
      });
    },
    readWorkspaceTextFile(
      relativePath: string,
      options?: import("../types").ReadWorkspaceTextFileOptions,
    ) {
      return post<WorkspaceReadTextFileResult>(baseUrl, "/api/workspace/file", {
        relativePath,
        ...(options?.optional ? { optional: true } : {}),
      });
    },
    searchWorkspaceContent(request: import("../types").WorkspaceContentSearchRequest) {
      return post<import("../types").WorkspaceContentSearchResult>(
        baseUrl,
        "/api/workspace/search",
        request,
      );
    },
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest) {
      return post<void>(baseUrl, "/api/workspace/file/write", request);
    },
    revealWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    renameWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    createWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    moveWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    trashWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    forceDeleteWorkspaceEntry() {
      return Promise.reject(
        new Error("Workspace file shell actions are only available in the Electron desktop app."),
      );
    },
    readHostTextFile(absolutePath: string) {
      return post<WorkspaceReadTextFileResult>(baseUrl, "/api/host/file", { absolutePath });
    },
    writeHostTextFile(request: WriteHostTextFileRequest) {
      return post<void>(baseUrl, "/api/host/file/write", request);
    },
    statHostTextFile(absolutePath: string) {
      return post<HostTextFileStatResult>(baseUrl, "/api/host/file/stat", { absolutePath });
    },
    classifyLocalFileComposerRoute(absolutePath: string) {
      return post<LocalFileComposerRoute>(baseUrl, "/api/host/file/classify-composer-route", {
        absolutePath,
      });
    },
    async readLocalImagePreviewDataUrl() {
      return null;
    },
    async readManagedImagePreviewDataUrl() {
      return null;
    },
    async readLocalVideoPreviewUrl() {
      return null;
    },
    async readManagedVideoPreviewUrl() {
      return null;
    },
    async saveLocalImageAs() {
      return false;
    },
    async pairWebHost(code: string) {
      const result = await post<WebHostPairingResponse>(
        baseUrl,
        "/api/pairing",
        { code },
        {
          auth: false,
        },
      );
      storeWebHostToken(result.token);
    },
  };
}

async function get<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

async function post<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  options?: { auth?: boolean },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.auth === false ? {} : authHeaders()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return (await response.json()) as T;
}

function authHeaders(): Record<string, string> {
  const token = readWebHostToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readWebHostToken(): string | undefined {
  try {
    return localStorage.getItem(WEB_HOST_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function storeWebHostToken(token: string): void {
  try {
    localStorage.setItem(WEB_HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

async function consumeSnapshotStream(
  baseUrl: string,
  callback: (snapshot: DesktopSnapshot) => void,
  signal: AbortSignal,
): Promise<void> {
  let retryDelayMs = 250;
  while (!signal.aborted) {
    try {
      const response = await fetch(`${baseUrl}/api/events`, {
        headers: authHeaders(),
        signal,
      });
      if (!response.ok) {
        throw await responseError(response);
      }
      if (!response.body) {
        throw new Error("Web Host update stream is unavailable.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      retryDelayMs = 250;
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffered += value;
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }
            JSON.parse(trimmed);
            const snapshot = await post<DesktopSnapshot>(
              baseUrl,
              "/api/poll",
              withWebViewingSessionPath({}),
            );
            rememberWebViewingSession(snapshot);
            callback(snapshot);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      console.error("[web-host] update stream failed", error);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, retryDelayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
  }
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    const error = new Error(parsed.error ?? text) as Error & {
      code?: string;
      status?: number;
    };
    error.code = parsed.code;
    error.status = response.status;
    return error;
  } catch {
    const error = new Error(text) as Error & { status?: number };
    error.status = response.status;
    return error;
  }
}
