/// <reference types="vite/client" />

import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DesktopApprovalDecision,
  DesktopDreamOverviewItem,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopModelProvider,
  DesktopLiveUpdate,
  DesktopSnapshot,
  ImportExtensionRequest,
  RunExtensionRequest,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
  SubmitUserTurnRequest,
  SessionListItem,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  InstallLspProviderRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  HostTextFileStatResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  ApprovalLevel,
  LocalFileComposerRoute,
  WorkLocationKind,
} from "./types";

declare global {
  interface SpiritDesktopApi {
    platform: NodeJS.Platform;
    /** Reports an uncaught renderer error/rejection for the crash page log (fire-and-forget). */
    reportRendererError(report: {
      kind: "error" | "unhandledrejection";
      message: string;
      stack?: string;
    }): void;
    /** Synchronously reads on-disk `translucency` (`off` / `sidebar` / `all`); aligns with the Electron window material before the first snapshot is ready. */
    readTranslucency(): import("./lib/translucency").TranslucencyPreference;
    /** Synchronously reads on-disk `onboardingCompleted`; used to skip LaunchSplash on first-run OOBE before the snapshot is ready. */
    readOnboardingCompleted(): boolean;
    /** Synchronously reads the OS dark preference tracked by the main process; matchMedia misreports while themeSource is overridden, so this is authoritative. */
    readOsPrefersDark(): boolean;
    /** Synchronously flushes Chromium DOM storage (localStorage) to disk after persist-intent writes. */
    flushRendererStorage(): void;
    bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
    rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
    forgetWorkspace(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot>;
    commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
    updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
    installLspProvider(request: InstallLspProviderRequest): Promise<DesktopSnapshot>;
    addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
    addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
    previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
    removeModel(name: string): Promise<DesktopSnapshot>;
    removeProviderModels(provider: DesktopModelProvider): Promise<DesktopSnapshot>;
    removeProviderGroup(
      request: import("./types").RemoveProviderGroupRequest,
    ): Promise<DesktopSnapshot>;
    addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot>;
    deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot>;
    saveHookEntry(request: SaveHookEntryRequest): Promise<DesktopSnapshot>;
    deleteHookEntry(request: DeleteHookEntryRequest): Promise<DesktopSnapshot>;
    inspectMcpServer(name: string): Promise<DesktopMcpServerInspection>;
    importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot>;
    deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot>;
    runExtension(request: RunExtensionRequest): Promise<DesktopSnapshot>;
    updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot>;
    updateExtensionSecret(request: UpdateExtensionSecretRequest): Promise<DesktopSnapshot>;
    createRule(request: CreateRuleRequest): Promise<DesktopSnapshot>;
    createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
    deleteRule(request: DeleteRuleRequest): Promise<DesktopSnapshot>;
    deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
    submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
    submitGitChip(request: SubmitGitChipRequest): Promise<DesktopSnapshot>;
    submitStartImplementing(): Promise<DesktopSnapshot>;
    exportSession(): Promise<DesktopSnapshot>;
    compactHistory(): Promise<DesktopSnapshot>;
    submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot>;
    setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot>;
    setApprovalLevel(approvalLevel: ApprovalLevel): Promise<DesktopSnapshot>;
    setPendingGitBranch(branch: string): Promise<DesktopSnapshot>;
    setWorkLocation(workLocation: WorkLocationKind): Promise<DesktopSnapshot>;
    checkoutGitBranch(
      request: import("./types.js").CheckoutGitBranchRequest,
    ): Promise<DesktopSnapshot>;
    mergeWorktreeToMain(): Promise<DesktopSnapshot>;
    pushGitBranch(): Promise<DesktopSnapshot>;
    refreshGitSnapshot(): Promise<DesktopSnapshot>;
    abortConversation(
      request?: import("./types.js").AbortConversationRequest,
    ): Promise<DesktopSnapshot>;
    abortShell(toolCallId: string): Promise<DesktopSnapshot>;
    continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
    forkSession(request: ForkSessionRequest): Promise<DesktopSnapshot>;
    reorderQueuedUserTurn(
      request: import("./types.js").QueuedUserTurnRequest,
    ): Promise<DesktopSnapshot>;
    sendQueuedUserTurnNow(
      request: import("./types.js").QueuedUserTurnRequest,
    ): Promise<DesktopSnapshot>;
    removeQueuedUserTurn(
      request: import("./types.js").QueuedUserTurnRequest,
    ): Promise<DesktopSnapshot>;
    poll(request?: import("./types").PollRequest): Promise<DesktopSnapshot>;
    setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot>;
    listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
    listAutomations(): Promise<import("./types.js").DesktopAutomationListItem[]>;
    getAutomation(
      automationId: string,
    ): Promise<import("./types.js").DesktopAutomationDetail | undefined>;
    createAutomation(
      request: import("./types.js").DesktopCreateAutomationRequest,
    ): Promise<DesktopSnapshot>;
    updateAutomation(
      automationId: string,
      patch: import("./types.js").DesktopUpdateAutomationRequest,
    ): Promise<DesktopSnapshot>;
    deleteAutomation(automationId: string): Promise<DesktopSnapshot>;
    setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot>;
    dreamSubscribe(callback: (update: DesktopLiveUpdate) => void): () => void;
    automationsSubscribe(callback: (snapshot: DesktopSnapshot) => void): () => void;
    sessionListSubscribe(callback: () => void): () => void;
    replyPendingApproval(
      request: import("./types").ReplyPendingApprovalRequest,
    ): Promise<DesktopSnapshot>;
    replyPendingQuestions(
      request: import("./types").ReplyPendingQuestionsRequest,
    ): Promise<DesktopSnapshot>;
    replyWorkspaceCapabilityTrust(
      request: import("./types").ReplyWorkspaceCapabilityTrustRequest,
    ): Promise<DesktopSnapshot>;
    openPathInDefaultApp(absolutePath: string): Promise<void>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    beginSplitPaneSession(
      request: import("./types").BeginSplitPaneSessionRequest,
    ): Promise<import("./types").BeginSplitPaneSessionResponse>;
    beginSideChatPaneSession(
      request: import("./types").BeginSideChatPaneSessionRequest,
    ): Promise<import("./types").BeginSideChatPaneSessionResponse>;
    forkSessionIntoSideChat(
      request: import("./types").ForkSessionIntoSideChatRequest,
    ): Promise<DesktopSnapshot>;
    setVisiblePaneSessions(
      request: import("./types").SetVisiblePaneSessionsRequest,
    ): Promise<DesktopSnapshot>;
    syncSplitPaneSessions(
      request: import("./types").SyncSplitPaneSessionsRequest,
    ): Promise<DesktopSnapshot>;
    focusPaneSession(request: import("./types").FocusPaneSessionRequest): Promise<DesktopSnapshot>;
    closeSplitPaneSession(
      request: import("./types").CloseSplitPaneSessionRequest,
    ): Promise<DesktopSnapshot>;
    switchPaneWorkspace(
      request: import("./types").SwitchPaneWorkspaceRequest,
    ): Promise<DesktopSnapshot>;
    switchPaneModel(request: import("./types").SwitchPaneModelRequest): Promise<DesktopSnapshot>;
    setPanePendingGitBranch(
      request: import("./types").SetPanePendingGitBranchRequest,
    ): Promise<DesktopSnapshot>;
    setPaneWorkLocation(
      request: import("./types").SetPaneWorkLocationRequest,
    ): Promise<DesktopSnapshot>;
    checkoutPaneGitBranch(
      request: import("./types").CheckoutPaneGitBranchRequest,
    ): Promise<DesktopSnapshot>;
    deleteSession(path: string): Promise<DesktopSnapshot>;
    renameSession(path: string, displayName: string): Promise<DesktopSnapshot>;
    listWorkspaceFileReferenceSuggestions(
      request: QueryWorkspaceFileReferenceSuggestionsRequest,
    ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
    requestCodeCompletion(
      request: import("./types").RequestCodeCompletionRequest,
    ): Promise<import("./types").CodeCompletionResponse>;
    abortCodeCompletion(): Promise<void>;
    recordCodeCompletionFileState(
      request: import("./types").RecordCodeCompletionFileStateRequest,
    ): Promise<void>;
    resetCodeCompletionJournal(): Promise<void>;
    primeWorkspaceFileReferenceIndex(): Promise<void>;
    getWorkspaceFileReferenceIndex(): Promise<
      import("./types").WorkspaceFileReferenceIndexSnapshot
    >;
    listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
    readGitWorkingTree(): Promise<import("./types").GitWorkingTreeSnapshot>;
    readGitHistory(
      request?: import("./types").ReadGitHistoryRequest,
    ): Promise<import("./types").GitHistorySnapshot>;
    readGitCommitMessage(
      request: import("./types").ReadGitCommitMessageRequest,
    ): Promise<import("./types").GitCommitMessageSnapshot>;
    getGitHubAuthStatus(): Promise<import("./types").GitHubAuthStatus>;
    beginGitHubDeviceLogin(): Promise<import("./types").GitHubDeviceAuthChallenge>;
    completeGitHubDeviceLogin(): Promise<import("./types").GitHubAuthStatus>;
    cancelGitHubDeviceLogin(): Promise<void>;
    disconnectGitHub(): Promise<import("./types").GitHubAuthStatus>;
    getGitHubPullRequestForCurrentBranch(): Promise<
      import("./types").GitHubPullRequestForBranchResult
    >;
    listGitHubPullRequests(
      request: import("./types").ListGitHubPullRequestsRequest,
    ): Promise<import("./types").GitHubPullRequestListSnapshot>;
    listGitHubAutomationRepositories(
      request?: import("./types").ListGitHubAutomationRepositoriesRequest,
    ): Promise<import("./types").GitHubAutomationRepositoriesSnapshot>;
    searchGitHubAutomationRepositories(
      request: import("./types").SearchGitHubAutomationRepositoriesRequest,
    ): Promise<import("./types").SearchGitHubAutomationRepositoriesSnapshot>;
    getGitHubPullRequestTabCounts(
      request: import("./types").GetGitHubPullRequestTabCountsRequest,
    ): Promise<import("./types").GitHubPullRequestTabCounts>;
    getGitHubPullRequestDetail(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestDetail>;
    getGitHubPullRequestConversation(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestConversationSnapshot>;
    getGitHubPullRequestFiles(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestFilesSnapshot>;
    getGitHubPullRequestCommits(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestCommitsSnapshot>;
    getGitHubPullRequestChecks(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestChecksSnapshot>;
    mergeGitHubPullRequest(
      request: import("./types").MergeGitHubPullRequestRequest,
    ): Promise<import("./types").GitHubPullRequestMergeResult>;
    markGitHubPullRequestReady(
      request: import("./types").GetGitHubPullRequestDetailRequest,
    ): Promise<import("./types").GitHubPullRequestDetail>;
    readWorkspaceTextFile(
      relativePath: string,
      options?: import("@/types").ReadWorkspaceTextFileOptions,
    ): Promise<WorkspaceReadTextFileResult>;
    searchWorkspaceContent(
      request: import("@/types").WorkspaceContentSearchRequest,
    ): Promise<import("@/types").WorkspaceContentSearchResult>;
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
    revealWorkspaceEntry(relativePath: string, workspaceRoot?: string): Promise<void>;
    renameWorkspaceEntry(relativePath: string, newName: string): Promise<{ relativePath: string }>;
    createWorkspaceEntry(
      parentDirectoryRel: string,
      name: string,
      kind: "file" | "dir",
    ): Promise<{ relativePath: string }>;
    moveWorkspaceEntry(
      relativePath: string,
      targetDirectoryRel: string,
    ): Promise<{ relativePath: string }>;
    trashWorkspaceEntry(relativePath: string): Promise<void>;
    forceDeleteWorkspaceEntry(relativePath: string): Promise<void>;
    readHostTextFile(absolutePath: string): Promise<WorkspaceReadTextFileResult>;
    writeHostTextFile(request: WriteHostTextFileRequest): Promise<void>;
    statHostTextFile(absolutePath: string): Promise<HostTextFileStatResult>;
    classifyLocalFileComposerRoute(absolutePath: string): Promise<LocalFileComposerRoute>;
    pickWorkspaceDirectory(): Promise<string | null>;
    pickLocalFile(): Promise<string[] | null>;
    getPathForDroppedFile(file: File): string;
    ingestClipboardImage(): Promise<string | null>;
    listSystemFonts(): Promise<string[]>;
    readLocalImagePreviewDataUrl(filePath: string): Promise<string | null>;
    readManagedImagePreviewDataUrl(reference: string): Promise<string | null>;
    readLocalVideoPreviewUrl(filePath: string): Promise<string | null>;
    readManagedVideoPreviewUrl(reference: string): Promise<string | null>;
    saveLocalImageAs(filePath: string): Promise<boolean>;
    /** Resolves to the true dark value from the main process perspective after themeSource takes effect (may differ from the requested value for system). */
    syncWindowFrame(request: {
      dark: boolean;
      nativeTheme: "system" | "light" | "dark";
      translucency?: boolean;
    }): Promise<boolean>;
    /** First-launch LaunchSplash has painted and is ready; tells the main process to reveal the window. */
    notifyLaunchSplashReady(): void;
    syncLanguage(lang: string): Promise<void>;
    /** macOS: syncs the native traffic-light position after UI scaling so it stays aligned with the toggle button. */
    syncTrafficLightPosition(position: { x: number; y: number }): Promise<void>;
    popupApplicationMenu(
      section: "file" | "edit" | "view" | "window" | "help",
      clientX: number,
      clientY: number,
    ): Promise<void>;
    executeWindowAction(action: string): Promise<void>;
    ptyCreate(request: {
      cwd: string;
      cols: number;
      rows: number;
    }): Promise<{ ok: true; id: string; shellDisplayName: string } | { ok: false; error: string }>;
    ptyWrite(id: string, data: string): void;
    ptyResize(id: string, cols: number, rows: number): void;
    ptyKill(id: string): Promise<void>;
    openSystemTerminal(cwd: string): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
    subscribeBrowserOpenUrl(callback: (url: string) => void): () => void;
    listLocalListeningEndpoints(): Promise<
      Array<{ port: number; address?: string; processName?: string; url?: string; title?: string }>
    >;
    scanLocalListeners(): void;
    subscribeLocalListeners(callbacks: {
      onFound: (item: {
        port: number;
        address?: string;
        processName?: string;
        url?: string;
        title?: string;
      }) => void;
      onDone: () => void;
    }): () => void;
    ptySubscribe(callbacks: {
      onData: (payload: { id: string; data: string }) => void;
      onExit: (payload: { id: string; exitCode: number; signal?: number }) => void;
      onProcessTitle?: (payload: { id: string; title: string }) => void;
    }): () => void;
    ingestBrowserElementScreenshot(base64: string): Promise<string | null>;
    registerBrowserGuestF12(tabId: string, guestWebContentsId: number): Promise<void>;
    unregisterBrowserGuestF12(guestWebContentsId: number): Promise<void>;
    bindBrowserGuestDevtools(
      pageWebContentsId: number,
      devtoolsWebContentsId: number,
    ): Promise<void>;
    openBrowserGuestDevtools(pageWebContentsId: number): Promise<boolean>;
    closeBrowserGuestDevtools(pageWebContentsId: number): Promise<void>;
    subscribeBrowserGuestF12(callback: (payload: { tabId: string }) => void): () => void;
    readClipboardText(): string;
    writeClipboardText(text: string): void;
    showNotification(
      request: import("./lib/desktop-notification-types.js").DesktopShowNotificationRequest,
    ): Promise<boolean>;
    getAppAwayFromUser(): Promise<boolean>;
    reportRendererVisibility(hidden: boolean): Promise<boolean>;
    syncAttentionPending(flags: {
      needsApproval: boolean;
      needsQuestions: boolean;
      needsTaskComplete: boolean;
      attentionBlockKey?: string;
    }): Promise<void>;
    getWindowFullScreen(): Promise<boolean>;
    subscribeWindowFullScreen(callback: (fullScreen: boolean) => void): () => void;
    subscribeAppAwayChanged(callback: (away: boolean) => void): () => void;
    subscribeNotifyRefresh(callback: () => void): () => void;
    subscribeApprovalFromNotification(
      callback: (payload: { decision: "allow" | "deny" }) => void,
    ): () => void;
    subscribeNotificationReply(
      callback: (payload: {
        kind: "approval" | "ask-questions";
        text: string;
        context?: import("./lib/desktop-notification-types.js").DesktopNotificationContext;
      }) => void,
    ): () => void;
    subscribeNewSession(callback: () => void): () => void;
    subscribeOpenSettings(callback: () => void): () => void;
    subscribeUiLayoutZoom(callback: (action: "in" | "out" | "reset") => void): () => void;
  }

  interface Window {
    spiritDesktop?: SpiritDesktopApi;
  }

  interface SpiritWebviewGuestWebContents {
    setDevToolsWebContents(devToolsWebContents: SpiritWebviewGuestWebContents): void;
    openDevTools(options?: { mode?: string; activate?: boolean }): void;
    closeDevTools(): void;
    isDevToolsOpened(): boolean;
    on(
      event: "before-input-event",
      listener: (
        event: { preventDefault: () => void },
        input: { type: string; key: string },
      ) => void,
    ): void;
    removeListener(
      event: "before-input-event",
      listener: (
        event: { preventDefault: () => void },
        input: { type: string; key: string },
      ) => void,
    ): void;
  }

  interface SpiritWebviewCaptureImage {
    toDataURL(): string;
  }

  interface SpiritWebviewWillNavigateEvent extends Event {
    url: string;
    preventDefault(): void;
  }

  interface SpiritWebviewNewWindowEvent extends Event {
    url: string;
    preventDefault(): void;
  }

  interface SpiritWebviewTag extends HTMLElement {
    src: string;
    partition: string;
    webpreferences: string;
    getURL(): string;
    loadURL(url: string): void;
    goBack(): void;
    goForward(): void;
    reload(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    getWebContentsId(): number;
    executeJavaScript(code: string): Promise<unknown>;
    insertCSS(css: string): Promise<string>;
    removeInsertedCSS(key: string): Promise<void>;
    capturePage(rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): Promise<SpiritWebviewCaptureImage>;
    addEventListener(type: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(type: string, listener: (...args: unknown[]) => void): void;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<SpiritWebviewTag>, SpiritWebviewTag> & {
        src?: string;
        partition?: string;
        webpreferences?: string;
        allowpopups?: string;
      };
    }
  }
}
