import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

const newSessionSubscribers = new Set<() => void>();
let pendingNewSessionFromMain = false;

function dispatchNewSessionToSubscribers(): void {
  for (const callback of newSessionSubscribers) {
    callback();
  }
}

ipcRenderer.on("desktop:new-session", () => {
  if (newSessionSubscribers.size > 0) {
    dispatchNewSessionToSubscribers();
    return;
  }
  pendingNewSessionFromMain = true;
});

const openSettingsSubscribers = new Set<() => void>();
let pendingOpenSettingsFromMain = false;

function dispatchOpenSettingsToSubscribers(): void {
  for (const callback of openSettingsSubscribers) {
    callback();
  }
}

ipcRenderer.on("desktop:open-settings", () => {
  if (openSettingsSubscribers.size > 0) {
    dispatchOpenSettingsToSubscribers();
    return;
  }
  pendingOpenSettingsFromMain = true;
});

type UiLayoutZoomAction = "in" | "out" | "reset";

const uiLayoutZoomSubscribers = new Set<(action: UiLayoutZoomAction) => void>();
let pendingUiLayoutZoomFromMain: UiLayoutZoomAction | null = null;

function isUiLayoutZoomAction(value: unknown): value is UiLayoutZoomAction {
  return value === "in" || value === "out" || value === "reset";
}

function dispatchUiLayoutZoomToSubscribers(action: UiLayoutZoomAction): void {
  for (const callback of uiLayoutZoomSubscribers) {
    callback(action);
  }
}

ipcRenderer.on("desktop:ui-layout-zoom", (_event, action: unknown) => {
  if (!isUiLayoutZoomAction(action)) {
    return;
  }
  if (uiLayoutZoomSubscribers.size > 0) {
    dispatchUiLayoutZoomToSubscribers(action);
    return;
  }
  pendingUiLayoutZoomFromMain = action;
});

contextBridge.exposeInMainWorld("spiritDesktop", {
  platform: process.platform,
  /** Fire-and-forget uncaught error report (installed by the renderer itself, main world). */
  reportRendererError(report: unknown) {
    ipcRenderer.send("desktop:renderer-error", report);
  },
  readTranslucency() {
    return ipcRenderer.sendSync("desktop:read-translucency") as "off" | "sidebar" | "all";
  },
  readOnboardingCompleted() {
    return ipcRenderer.sendSync("desktop:read-onboarding-completed") as boolean;
  },
  readOsPrefersDark() {
    return ipcRenderer.sendSync("desktop:read-os-prefers-dark") as boolean;
  },
  flushRendererStorage() {
    ipcRenderer.sendSync("desktop:flush-renderer-storage");
  },
  bootstrap(request?: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "bootstrap", { request });
  },
  rememberWorkspaceRoot(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "rememberWorkspaceRoot", { request });
  },
  forgetWorkspace(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "forgetWorkspace", { request });
  },
  commitChanges(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "commitChanges", { request });
  },
  updateConfig(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "updateConfig", { request });
  },
  installLspProvider(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "installLspProvider", { request });
  },
  addModel(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "addModel", { request });
  },
  addProviderModels(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "addProviderModels", { request });
  },
  previewModels(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "previewModels", { request });
  },
  removeModel(name: string) {
    return ipcRenderer.invoke("desktop:invoke", "removeModel", { request: { name } });
  },
  removeProviderModels(provider: string) {
    return ipcRenderer.invoke("desktop:invoke", "removeProviderModels", { request: { provider } });
  },
  removeProviderGroup(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "removeProviderGroup", { request });
  },
  addMcpServer(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "addMcpServer", { request });
  },
  deleteMcpServer(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "deleteMcpServer", { request });
  },
  saveHookEntry(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "saveHookEntry", { request });
  },
  deleteHookEntry(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "deleteHookEntry", { request });
  },
  inspectMcpServer(name: string) {
    return ipcRenderer.invoke("desktop:invoke", "inspectMcpServer", { name });
  },
  importExtension(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "importExtension", { request });
  },
  deleteExtension(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "deleteExtension", { request });
  },
  runExtension(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "runExtension", { request });
  },
  updateExtensionSettings(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "updateExtensionSettings", { request });
  },
  updateExtensionSecret(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "updateExtensionSecret", { request });
  },
  createRule(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "createRule", { request });
  },
  createSkill(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "createSkill", { request });
  },
  deleteRule(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "deleteRule", { request });
  },
  deleteSkill(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "deleteSkill", { request });
  },
  submitSkillSlash(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "submitSkillSlash", { request });
  },
  submitGitChip(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "submitGitChip", { request });
  },
  submitStartImplementing() {
    return ipcRenderer.invoke("desktop:invoke", "submitStartImplementing");
  },
  exportSession() {
    return ipcRenderer.invoke("desktop:export-session");
  },
  compactHistory() {
    return ipcRenderer.invoke("desktop:invoke", "compactHistory");
  },
  submitUserTurn(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "submitUserTurn", request);
  },
  setLoopEnabled(enabled: boolean) {
    return ipcRenderer.invoke("desktop:invoke", "setLoopEnabled", { enabled });
  },
  setApprovalLevel(approvalLevel: string) {
    return ipcRenderer.invoke("desktop:invoke", "setApprovalLevel", { approvalLevel });
  },
  setPendingGitBranch(branch: string) {
    return ipcRenderer.invoke("desktop:invoke", "setPendingGitBranch", { branch });
  },
  setWorkLocation(workLocation: string) {
    return ipcRenderer.invoke("desktop:invoke", "setWorkLocation", { workLocation });
  },
  checkoutGitBranch(request: { branch: string; discardLocalChanges?: boolean }) {
    return ipcRenderer.invoke("desktop:invoke", "checkoutGitBranch", request);
  },
  mergeWorktreeToMain() {
    return ipcRenderer.invoke("desktop:invoke", "mergeWorktreeToMain");
  },
  pushGitBranch() {
    return ipcRenderer.invoke("desktop:invoke", "pushGitBranch");
  },
  refreshGitSnapshot() {
    return ipcRenderer.invoke("desktop:invoke", "refreshGitSnapshot");
  },
  abortConversation(request?: { sessionPath?: string }) {
    return ipcRenderer.invoke("desktop:invoke", "abortConversation", request ?? {});
  },
  abortShell(toolCallId: string) {
    return ipcRenderer.invoke("desktop:invoke", "abortShell", { toolCallId });
  },
  continueAssistantCompletion(messageId: number) {
    return ipcRenderer.invoke("desktop:invoke", "continueAssistantCompletion", { messageId });
  },
  rewindAndSubmitMessage(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "rewindAndSubmitMessage", { request });
  },
  forkSession(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "forkSession", { request });
  },
  reorderQueuedUserTurn(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "reorderQueuedUserTurn", { request });
  },
  sendQueuedUserTurnNow(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "sendQueuedUserTurnNow", { request });
  },
  removeQueuedUserTurn(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "removeQueuedUserTurn", { request });
  },
  poll(request?: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "poll", request);
  },
  setSubagentViewerTarget(parentToolCallId: string | null) {
    return ipcRenderer.invoke("desktop:invoke", "setSubagentViewerTarget", { parentToolCallId });
  },
  listDreamsOverview() {
    return ipcRenderer.invoke("desktop:invoke", "listDreamsOverview");
  },
  listAutomations() {
    return ipcRenderer.invoke("desktop:invoke", "listAutomations");
  },
  getAutomation(automationId: string) {
    return ipcRenderer.invoke("desktop:invoke", "getAutomation", { automationId });
  },
  createAutomation(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "createAutomation", { request });
  },
  updateAutomation(automationId: string, patch: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "updateAutomation", { automationId, patch });
  },
  deleteAutomation(automationId: string) {
    return ipcRenderer.invoke("desktop:invoke", "deleteAutomation", { automationId });
  },
  setAutomationEnabled(automationId: string, enabled: boolean) {
    return ipcRenderer.invoke("desktop:invoke", "setAutomationEnabled", { automationId, enabled });
  },
  dreamSubscribe(callback: (snapshot: unknown) => void) {
    const onDreamUpdate = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      callback(snapshot);
    };
    ipcRenderer.on("desktop:dream-updated", onDreamUpdate);
    return () => {
      ipcRenderer.removeListener("desktop:dream-updated", onDreamUpdate);
    };
  },
  automationsSubscribe(callback: (snapshot: unknown) => void) {
    const onAutomationsUpdate = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      callback(snapshot);
    };
    ipcRenderer.on("desktop:automations-updated", onAutomationsUpdate);
    return () => {
      ipcRenderer.removeListener("desktop:automations-updated", onAutomationsUpdate);
    };
  },
  sessionListSubscribe(callback: () => void) {
    const onSessionListUpdate = () => {
      callback();
    };
    ipcRenderer.on("desktop:session-list-updated", onSessionListUpdate);
    return () => {
      ipcRenderer.removeListener("desktop:session-list-updated", onSessionListUpdate);
    };
  },
  replyPendingApproval(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "replyPendingApproval", { request });
  },
  replyPendingQuestions(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "replyPendingQuestions", { request });
  },
  replyWorkspaceCapabilityTrust(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "replyWorkspaceCapabilityTrust", { request });
  },
  openPathInDefaultApp(absolutePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "openPathInDefaultApp", { absolutePath });
  },
  resetSession() {
    return ipcRenderer.invoke("desktop:invoke", "resetSession");
  },
  listSessions() {
    return ipcRenderer.invoke("desktop:invoke", "listSessions");
  },
  openSession(path: string) {
    return ipcRenderer.invoke("desktop:invoke", "openSession", { path });
  },
  beginSplitPaneSession(request: { paneId: string }) {
    return ipcRenderer.invoke("desktop:invoke", "beginSplitPaneSession", { request });
  },
  beginSideChatPaneSession(request: { paneId: string }) {
    return ipcRenderer.invoke("desktop:invoke", "beginSideChatPaneSession", { request });
  },
  forkSessionIntoSideChat(request: {
    sourceSessionPath: string;
    targetPaneId: string;
    messageId: number;
    listIndex?: number;
  }) {
    return ipcRenderer.invoke("desktop:invoke", "forkSessionIntoSideChat", { request });
  },
  setVisiblePaneSessions(request: { sessionPaths: string[] }) {
    return ipcRenderer.invoke("desktop:invoke", "setVisiblePaneSessions", { request });
  },
  syncSplitPaneSessions(request: { sessionPaths: string[]; focusSessionPath?: string }) {
    return ipcRenderer.invoke("desktop:invoke", "syncSplitPaneSessions", { request });
  },
  focusPaneSession(request: { sessionPath: string }) {
    return ipcRenderer.invoke("desktop:invoke", "focusPaneSession", { request });
  },
  closeSplitPaneSession(request: { sessionPath: string }) {
    return ipcRenderer.invoke("desktop:invoke", "closeSplitPaneSession", { request });
  },
  switchPaneWorkspace(request: {
    sessionPath: string;
    workspaceRoot?: string;
    workspaceBinding: "project" | "none";
  }) {
    return ipcRenderer.invoke("desktop:invoke", "switchPaneWorkspace", { request });
  },
  switchPaneModel(request: { sessionPath: string; modelRef: { groupId: string; name: string } }) {
    return ipcRenderer.invoke("desktop:invoke", "switchPaneModel", { request });
  },
  setPanePendingGitBranch(request: { sessionPath: string; branch: string }) {
    return ipcRenderer.invoke("desktop:invoke", "setPanePendingGitBranch", { request });
  },
  setPaneWorkLocation(request: {
    sessionPath: string;
    workLocation: import("@spiritagent/host-internal").WorkLocationKind;
  }) {
    return ipcRenderer.invoke("desktop:invoke", "setPaneWorkLocation", { request });
  },
  checkoutPaneGitBranch(request: {
    sessionPath: string;
    branch: string;
    discardLocalChanges?: boolean;
  }) {
    return ipcRenderer.invoke("desktop:invoke", "checkoutPaneGitBranch", { request });
  },
  deleteSession(path: string) {
    return ipcRenderer.invoke("desktop:invoke", "deleteSession", { path });
  },
  renameSession(path: string, displayName: string) {
    return ipcRenderer.invoke("desktop:invoke", "renameSession", { path, displayName });
  },
  listWorkspaceFileReferenceSuggestions(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "listWorkspaceFileReferenceSuggestions", {
      request,
    });
  },
  requestCodeCompletion(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "requestCodeCompletion", { request });
  },
  abortCodeCompletion() {
    return ipcRenderer.invoke("desktop:invoke", "abortCodeCompletion");
  },
  recordCodeCompletionFileState(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "recordCodeCompletionFileState", { request });
  },
  resetCodeCompletionJournal() {
    return ipcRenderer.invoke("desktop:invoke", "resetCodeCompletionJournal");
  },
  primeWorkspaceFileReferenceIndex() {
    return ipcRenderer.invoke("desktop:invoke", "primeWorkspaceFileReferenceIndex");
  },
  getWorkspaceFileReferenceIndex() {
    return ipcRenderer.invoke("desktop:invoke", "getWorkspaceFileReferenceIndex");
  },
  listWorkspaceExplorerChildren(relativePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "listWorkspaceExplorerChildren", {
      relativePath,
    });
  },
  readGitWorkingTree() {
    return ipcRenderer.invoke("desktop:invoke", "readGitWorkingTree");
  },
  readGitHistory(request?: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "readGitHistory", { request });
  },
  readGitCommitMessage(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "readGitCommitMessage", { request });
  },
  getGitHubAuthStatus() {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubAuthStatus");
  },
  beginGitHubDeviceLogin() {
    return ipcRenderer.invoke("desktop:invoke", "beginGitHubDeviceLogin");
  },
  completeGitHubDeviceLogin() {
    return ipcRenderer.invoke("desktop:invoke", "completeGitHubDeviceLogin");
  },
  cancelGitHubDeviceLogin() {
    return ipcRenderer.invoke("desktop:invoke", "cancelGitHubDeviceLogin");
  },
  disconnectGitHub() {
    return ipcRenderer.invoke("desktop:invoke", "disconnectGitHub");
  },
  getGitHubPullRequestForCurrentBranch() {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestForCurrentBranch");
  },
  listGitHubPullRequests(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "listGitHubPullRequests", { request });
  },
  listGitHubAutomationRepositories(request: unknown = {}) {
    return ipcRenderer.invoke("desktop:invoke", "listGitHubAutomationRepositories", { request });
  },
  searchGitHubAutomationRepositories(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "searchGitHubAutomationRepositories", { request });
  },
  getGitHubPullRequestTabCounts(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestTabCounts", { request });
  },
  getGitHubPullRequestDetail(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestDetail", { request });
  },
  getGitHubPullRequestConversation(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestConversation", { request });
  },
  getGitHubPullRequestFiles(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestFiles", { request });
  },
  getGitHubPullRequestCommits(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestCommits", { request });
  },
  getGitHubPullRequestChecks(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "getGitHubPullRequestChecks", { request });
  },
  mergeGitHubPullRequest(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "mergeGitHubPullRequest", { request });
  },
  markGitHubPullRequestReady(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "markGitHubPullRequestReady", { request });
  },
  readWorkspaceTextFile(relativePath: string, options?: { optional?: boolean }) {
    return ipcRenderer.invoke("desktop:invoke", "readWorkspaceTextFile", {
      relativePath,
      ...(options?.optional ? { optional: true } : {}),
    });
  },
  searchWorkspaceContent(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "searchWorkspaceContent", { request });
  },
  writeWorkspaceTextFile(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "writeWorkspaceTextFile", { request });
  },
  revealWorkspaceEntry(relativePath: string, workspaceRoot?: string) {
    return ipcRenderer.invoke("desktop:invoke", "revealWorkspaceEntry", {
      relativePath,
      workspaceRoot,
    });
  },
  renameWorkspaceEntry(relativePath: string, newName: string) {
    return ipcRenderer.invoke("desktop:invoke", "renameWorkspaceEntry", { relativePath, newName });
  },
  createWorkspaceEntry(parentDirectoryRel: string, name: string, kind: "file" | "dir") {
    return ipcRenderer.invoke("desktop:invoke", "createWorkspaceEntry", {
      parentDirectoryRel,
      name,
      kind,
    });
  },
  moveWorkspaceEntry(relativePath: string, targetDirectoryRel: string) {
    return ipcRenderer.invoke("desktop:invoke", "moveWorkspaceEntry", {
      relativePath,
      targetDirectoryRel,
    });
  },
  trashWorkspaceEntry(relativePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "trashWorkspaceEntry", { relativePath });
  },
  forceDeleteWorkspaceEntry(relativePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "forceDeleteWorkspaceEntry", { relativePath });
  },
  readHostTextFile(absolutePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "readHostTextFile", { absolutePath });
  },
  writeHostTextFile(request: unknown) {
    return ipcRenderer.invoke("desktop:invoke", "writeHostTextFile", { request });
  },
  statHostTextFile(absolutePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "statHostTextFile", { absolutePath });
  },
  classifyLocalFileComposerRoute(absolutePath: string) {
    return ipcRenderer.invoke("desktop:invoke", "classifyLocalFileComposerRoute", { absolutePath });
  },
  pickWorkspaceDirectory() {
    return ipcRenderer.invoke("desktop:pick-workspace-directory");
  },
  pickLocalFile() {
    return ipcRenderer.invoke("desktop:pick-local-file");
  },
  getPathForDroppedFile(file: File) {
    return webUtils.getPathForFile(file);
  },
  ingestClipboardImage() {
    return ipcRenderer.invoke("desktop:ingest-clipboard-image");
  },
  listSystemFonts() {
    return ipcRenderer.invoke("desktop:list-system-fonts");
  },
  readLocalImagePreviewDataUrl(filePath: string) {
    return ipcRenderer.invoke("desktop:read-local-image-preview", { filePath });
  },
  readManagedImagePreviewDataUrl(reference: string) {
    return ipcRenderer.invoke("desktop:read-managed-image-preview", { reference });
  },
  readLocalVideoPreviewUrl(filePath: string) {
    return ipcRenderer.invoke("desktop:read-local-video-preview", { filePath });
  },
  readManagedVideoPreviewUrl(reference: string) {
    return ipcRenderer.invoke("desktop:read-managed-video-preview", { reference });
  },
  saveLocalImageAs(filePath: string) {
    return ipcRenderer.invoke("desktop:save-local-image-as", { filePath });
  },
  syncWindowFrame(request: {
    dark: boolean;
    nativeTheme: "system" | "light" | "dark";
    translucency?: boolean;
  }) {
    return ipcRenderer.invoke("desktop:sync-window-frame", request) as Promise<boolean>;
  },
  notifyLaunchSplashReady() {
    ipcRenderer.send("desktop:launch-splash-ready");
  },
  syncLanguage(lang: string) {
    return ipcRenderer.invoke("desktop:sync-language", lang);
  },
  syncTrafficLightPosition(position: { x: number; y: number }) {
    return ipcRenderer.invoke("desktop:sync-traffic-light-position", position);
  },
  popupApplicationMenu(
    section: "file" | "edit" | "view" | "window" | "help",
    clientX: number,
    clientY: number,
  ) {
    return ipcRenderer.invoke("desktop:application-menu-popup", { section, clientX, clientY });
  },
  executeWindowAction(action: string) {
    return ipcRenderer.invoke("desktop:execute-window-action", action);
  },
  ptyCreate(request: { cwd: string; cols: number; rows: number }) {
    return ipcRenderer.invoke("desktop:pty-create", request);
  },
  ptyWrite(id: string, data: string) {
    ipcRenderer.send("desktop:pty-write", { id, data });
  },
  ptyResize(id: string, cols: number, rows: number) {
    ipcRenderer.send("desktop:pty-resize", { id, cols, rows });
  },
  ptyKill(id: string) {
    return ipcRenderer.invoke("desktop:pty-kill", id);
  },
  openSystemTerminal(cwd: string) {
    return ipcRenderer.invoke("desktop:open-system-terminal", cwd);
  },
  openExternalUrl(url: string) {
    return ipcRenderer.invoke("desktop:open-external-url", { url });
  },
  subscribeBrowserOpenUrl(callback: (url: string) => void) {
    const onOpen = (_event: Electron.IpcRendererEvent, payload: { url?: string }) => {
      const url = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (url) {
        callback(url);
      }
    };
    ipcRenderer.on("desktop:browser-open-url", onOpen);
    return () => {
      ipcRenderer.removeListener("desktop:browser-open-url", onOpen);
    };
  },
  listLocalListeningEndpoints() {
    return ipcRenderer.invoke("desktop:list-local-listeners");
  },
  scanLocalListeners() {
    ipcRenderer.send("desktop:scan-local-listeners");
  },
  subscribeLocalListeners(callbacks: {
    onFound: (item: {
      port: number;
      address?: string;
      processName?: string;
      url?: string;
      title?: string;
    }) => void;
    onDone: () => void;
  }) {
    const onFound = (
      _event: Electron.IpcRendererEvent,
      item: { port: number; address?: string; processName?: string; url?: string; title?: string },
    ) => {
      callbacks.onFound(item);
    };
    const onDone = () => {
      callbacks.onDone();
    };
    ipcRenderer.on("desktop:local-listener-found", onFound);
    ipcRenderer.on("desktop:local-listeners-done", onDone);
    return () => {
      ipcRenderer.removeListener("desktop:local-listener-found", onFound);
      ipcRenderer.removeListener("desktop:local-listeners-done", onDone);
    };
  },
  ingestBrowserElementScreenshot(base64: string): Promise<string | null> {
    return ipcRenderer.invoke("desktop:ingest-browser-element-screenshot", { base64 });
  },
  registerBrowserGuestF12(tabId: string, guestWebContentsId: number): Promise<void> {
    return ipcRenderer.invoke("desktop:browser-guest-register-f12", { tabId, guestWebContentsId });
  },
  unregisterBrowserGuestF12(guestWebContentsId: number): Promise<void> {
    return ipcRenderer.invoke("desktop:browser-guest-unregister-f12", { guestWebContentsId });
  },
  bindBrowserGuestDevtools(
    pageWebContentsId: number,
    devtoolsWebContentsId: number,
  ): Promise<void> {
    return ipcRenderer.invoke("desktop:browser-guest-bind-devtools", {
      pageWebContentsId,
      devtoolsWebContentsId,
    });
  },
  openBrowserGuestDevtools(pageWebContentsId: number): Promise<boolean> {
    return ipcRenderer.invoke("desktop:browser-guest-open-devtools", { pageWebContentsId });
  },
  closeBrowserGuestDevtools(pageWebContentsId: number): Promise<void> {
    return ipcRenderer.invoke("desktop:browser-guest-close-devtools", { pageWebContentsId });
  },
  subscribeBrowserGuestF12(callback: (payload: { tabId: string }) => void): () => void {
    const onEvent = (_event: Electron.IpcRendererEvent, payload: { tabId?: string }) => {
      if (typeof payload?.tabId === "string" && payload.tabId) {
        callback({ tabId: payload.tabId });
      }
    };
    ipcRenderer.on("desktop:browser-guest-f12", onEvent);
    return () => {
      ipcRenderer.removeListener("desktop:browser-guest-f12", onEvent);
    };
  },
  readClipboardText() {
    return clipboard.readText();
  },
  writeClipboardText(text: string) {
    clipboard.writeText(text);
  },
  ptySubscribe(callbacks: {
    onData: (payload: { id: string; data: string }) => void;
    onExit: (payload: { id: string; exitCode: number; signal?: number }) => void;
    onProcessTitle?: (payload: { id: string; title: string }) => void;
  }) {
    const onData = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
      callbacks.onData(payload);
    };
    const onExit = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; exitCode: number; signal?: number },
    ) => {
      callbacks.onExit(payload);
    };
    const onProcessTitle = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; title: string },
    ) => {
      callbacks.onProcessTitle?.(payload);
    };
    ipcRenderer.on("desktop:pty-data", onData);
    ipcRenderer.on("desktop:pty-exit", onExit);
    ipcRenderer.on("desktop:pty-process-title", onProcessTitle);
    return () => {
      ipcRenderer.removeListener("desktop:pty-data", onData);
      ipcRenderer.removeListener("desktop:pty-exit", onExit);
      ipcRenderer.removeListener("desktop:pty-process-title", onProcessTitle);
    };
  },
  showNotification(request: {
    title: string;
    body?: string;
    tag?: string;
    silent?: boolean;
    actions?: Array<
      | { type: "button"; text: string; action?: "allow" | "deny" | "focus" }
      | { type: "text"; text: string; placeholder?: string; action: "reply" }
    >;
    kind?: "task-complete" | "approval" | "ask-questions" | "generic";
    context?: {
      approvalId?: string;
      questionToolCallId?: string;
      questionId?: string;
    };
  }) {
    return ipcRenderer.invoke("desktop:show-notification", request);
  },
  getAppAwayFromUser() {
    return ipcRenderer.invoke("desktop:get-app-away") as Promise<boolean>;
  },
  reportRendererVisibility(hidden: boolean) {
    return ipcRenderer.invoke("desktop:report-renderer-visibility", { hidden }) as Promise<boolean>;
  },
  syncAttentionPending(flags: {
    needsApproval: boolean;
    needsQuestions: boolean;
    needsTaskComplete: boolean;
    attentionBlockKey?: string;
  }) {
    return ipcRenderer.invoke("desktop:sync-attention-pending", flags) as Promise<void>;
  },
  getWindowFullScreen() {
    return ipcRenderer.invoke("desktop:get-window-fullscreen") as Promise<boolean>;
  },
  subscribeWindowFullScreen(callback: (fullScreen: boolean) => void) {
    const onChange = (_event: Electron.IpcRendererEvent, fullScreen: boolean) => {
      callback(fullScreen === true);
    };
    ipcRenderer.on("desktop:window-fullscreen-changed", onChange);
    return () => {
      ipcRenderer.removeListener("desktop:window-fullscreen-changed", onChange);
    };
  },
  subscribeAppAwayChanged(callback: (away: boolean) => void) {
    const onAway = (_event: Electron.IpcRendererEvent, payload: { away?: boolean }) => {
      callback(payload?.away === true);
    };
    ipcRenderer.on("desktop:app-away-changed", onAway);
    return () => {
      ipcRenderer.removeListener("desktop:app-away-changed", onAway);
    };
  },
  subscribeNotifyRefresh(callback: () => void) {
    const onRefresh = () => {
      callback();
    };
    ipcRenderer.on("desktop:notify-refresh", onRefresh);
    return () => {
      ipcRenderer.removeListener("desktop:notify-refresh", onRefresh);
    };
  },
  subscribeApprovalFromNotification(callback: (payload: { decision: "allow" | "deny" }) => void) {
    const onApproval = (_event: Electron.IpcRendererEvent, payload: { decision?: string }) => {
      if (payload?.decision === "allow" || payload?.decision === "deny") {
        callback({ decision: payload.decision });
      }
    };
    ipcRenderer.on("desktop:approval-from-notification", onApproval);
    return () => {
      ipcRenderer.removeListener("desktop:approval-from-notification", onApproval);
    };
  },
  subscribeNotificationReply(
    callback: (payload: {
      kind: "approval" | "ask-questions";
      text: string;
      context?: {
        approvalId?: string;
        questionToolCallId?: string;
        questionId?: string;
      };
    }) => void,
  ) {
    const onReply = (
      _event: Electron.IpcRendererEvent,
      payload: {
        kind?: string;
        text?: string;
        context?: {
          approvalId?: string;
          questionToolCallId?: string;
          questionId?: string;
        };
      },
    ) => {
      if (
        (payload?.kind === "approval" || payload?.kind === "ask-questions") &&
        typeof payload.text === "string"
      ) {
        callback({
          kind: payload.kind,
          text: payload.text,
          context: payload.context,
        });
      }
    };
    ipcRenderer.on("desktop:notification-reply", onReply);
    return () => {
      ipcRenderer.removeListener("desktop:notification-reply", onReply);
    };
  },
  subscribeNewSession(callback: () => void) {
    newSessionSubscribers.add(callback);
    if (pendingNewSessionFromMain) {
      pendingNewSessionFromMain = false;
      callback();
    }
    return () => {
      newSessionSubscribers.delete(callback);
    };
  },
  subscribeOpenSettings(callback: () => void) {
    openSettingsSubscribers.add(callback);
    if (pendingOpenSettingsFromMain) {
      pendingOpenSettingsFromMain = false;
      callback();
    }
    return () => {
      openSettingsSubscribers.delete(callback);
    };
  },
  subscribeUiLayoutZoom(callback: (action: UiLayoutZoomAction) => void) {
    uiLayoutZoomSubscribers.add(callback);
    if (pendingUiLayoutZoomFromMain) {
      const pending = pendingUiLayoutZoomFromMain;
      pendingUiLayoutZoomFromMain = null;
      callback(pending);
    }
    return () => {
      uiLayoutZoomSubscribers.delete(callback);
    };
  },
});
