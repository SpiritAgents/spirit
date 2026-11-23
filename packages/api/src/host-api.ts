import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  BootstrapRequest,
  CheckoutGitBranchRequest,
  CommitChangesRequest,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  HostTextFileStatResult,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteRuleRequest,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopResolveTaskForRunResult,
  DesktopTaskMenuItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  McpAppCallToolRequest,
  McpAppCallToolResponse,
  McpAppReadResourceRequest,
  McpAppReadResourceResponse,
  McpAppUpdateModelContextRequest,
  DesktopLiveUpdate,
  DesktopSnapshot,
  AddMarketplaceSourceRequest,
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  InstallMarketplaceExtensionRequest,
  MarketplaceInstallCommandResult,
  MarketplaceSourceCommandResult,
  MarketplaceUpdateCommandResult,
  RemoveMarketplaceSourceRequest,
  UpdateExtensionRequest,
  InvokeExtensionActionRequest,
  SaveHookEntryRequest,
  SetExtensionEnabledRequest,
  UpdateExtensionSettingsRequest,
  DisconnectProviderRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
  CodeCompletionResponse,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
  SubmitUserTurnRequest,
  AbortConversationRequest,
  ReplyPendingApprovalRequest,
  ReplyPendingQuestionsRequest,
  ReplyWorkspaceCapabilityTrustRequest,
  BeginSplitPaneSessionRequest,
  BeginSplitPaneSessionResponse,
  BeginSideChatPaneSessionRequest,
  BeginSideChatPaneSessionResponse,
  ForkSessionIntoSideChatRequest,
  SetVisiblePaneSessionsRequest,
  SyncSplitPaneSessionsRequest,
  CloseSplitPaneSessionRequest,
  FocusPaneSessionRequest,
  SwitchPaneWorkspaceRequest,
  SwitchPaneModelRequest,
  SetPanePendingGitBranchRequest,
  SetPaneWorkLocationRequest,
  CheckoutPaneGitBranchRequest,
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WorkspaceContentSearchRequest,
  WorkspaceContentSearchResult,
  ReadWorkspaceTextFileOptions,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  ApprovalLevel,
  LocalFileComposerRoute,
  WorkLocationKind,
} from "./types.js";

import type { RemoteControlEnrollment, RemoteControlState } from "@spiritagent/remote-control";

export interface HostApi {
  kind: "electron" | "web";
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  rememberWorkspaceRoot?(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
  forgetWorkspace?(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot>;
  commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  pairRemoteControl?(request: {
    name?: string;
    origin: string;
    output?: "svg" | "terminal";
  }): Promise<RemoteControlEnrollment>;
  approveRemoteControlPairing?(pairingId: string): Promise<RemoteControlState>;
  rejectRemoteControlPairing?(pairingId: string): Promise<RemoteControlEnrollment>;
  cancelRemoteControlPairing?(pairingId: string): Promise<void>;
  revokeRemoteControlDevice?(deviceId: string): Promise<RemoteControlState>;
  addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
  addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
  previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
  removeModel(name: string): Promise<DesktopSnapshot>;
  disconnectProvider(request: DisconnectProviderRequest): Promise<DesktopSnapshot>;
  addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot>;
  deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot>;
  saveHookEntry(request: SaveHookEntryRequest): Promise<DesktopSnapshot>;
  deleteHookEntry(request: DeleteHookEntryRequest): Promise<DesktopSnapshot>;
  inspectMcpServer(name: string): Promise<DesktopMcpServerInspection>;
  mcpAppReadResource(request: McpAppReadResourceRequest): Promise<McpAppReadResourceResponse>;
  mcpAppCallTool(request: McpAppCallToolRequest): Promise<McpAppCallToolResponse>;
  mcpAppUpdateModelContext(request: McpAppUpdateModelContextRequest): Promise<{ ok: true }>;
  importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot>;
  installBuiltInExtension(request: InstallBuiltInExtensionRequest): Promise<DesktopSnapshot>;
  addMarketplaceSource(
    request: AddMarketplaceSourceRequest,
  ): Promise<MarketplaceSourceCommandResult>;
  removeMarketplaceSource(request: RemoveMarketplaceSourceRequest): Promise<DesktopSnapshot>;
  installMarketplaceExtension(
    request: InstallMarketplaceExtensionRequest,
  ): Promise<MarketplaceInstallCommandResult>;
  updateExtension(request: UpdateExtensionRequest): Promise<MarketplaceUpdateCommandResult>;
  deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot>;
  setExtensionEnabled(request: SetExtensionEnabledRequest): Promise<DesktopSnapshot>;
  invokeExtensionAction(request: InvokeExtensionActionRequest): Promise<unknown>;
  updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot>;
  createRule(request: CreateRuleRequest): Promise<DesktopSnapshot>;
  createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
  deleteRule(request: DeleteRuleRequest): Promise<DesktopSnapshot>;
  deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
  submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
  submitGitChip(request: SubmitGitChipRequest): Promise<DesktopSnapshot>;
  submitStartImplementing(): Promise<DesktopSnapshot>;
  exportSession?(): Promise<DesktopSnapshot>;
  compactHistory(): Promise<DesktopSnapshot>;
  submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot>;
  setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot>;
  setApprovalLevel(approvalLevel: ApprovalLevel): Promise<DesktopSnapshot>;
  setPendingGitBranch(branch: string): Promise<DesktopSnapshot>;
  setWorkLocation(workLocation: WorkLocationKind): Promise<DesktopSnapshot>;
  checkoutGitBranch(request: CheckoutGitBranchRequest): Promise<DesktopSnapshot>;
  mergeWorktreeToMain(): Promise<DesktopSnapshot>;
  pushGitBranch(): Promise<DesktopSnapshot>;
  refreshGitSnapshot(): Promise<DesktopSnapshot>;
  readGitWorkingTree(): Promise<GitWorkingTreeSnapshot>;
  readGitHistory(request?: ReadGitHistoryRequest): Promise<GitHistorySnapshot>;
  readGitCommitMessage(request: ReadGitCommitMessageRequest): Promise<GitCommitMessageSnapshot>;

  abortConversation(request?: AbortConversationRequest): Promise<DesktopSnapshot>;
  abortShell(toolCallId: string): Promise<DesktopSnapshot>;
  moveToBackground(toolCallId: string): Promise<DesktopSnapshot>;
  continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
  rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
  forkSession(request: ForkSessionRequest): Promise<DesktopSnapshot>;
  reorderQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  sendQueuedUserTurnNow(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  removeQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  poll(request?: import("./types.js").PollRequest): Promise<DesktopSnapshot>;
  setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot>;
  listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
  resolveAutomationTriggerMenu(
    request: import("./types.js").ResolveAutomationTriggerMenuRequest,
  ): Promise<import("./types.js").DesktopAutomationTriggerMenuPage>;
  cancelAutomationTriggerMenu(
    request: import("./types.js").CancelAutomationTriggerMenuRequest,
  ): Promise<void>;
  validateAutomationTrigger(
    request: import("./types.js").ValidateAutomationTriggerRequest,
  ): Promise<import("./lib/automation-trigger.js").DesktopAutomationTrigger>;
  listAutomations(): Promise<DesktopAutomationListItem[]>;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
  createAutomation(request: DesktopCreateAutomationRequest): Promise<DesktopSnapshot>;
  updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): Promise<DesktopSnapshot>;
  deleteAutomation(automationId: string): Promise<DesktopSnapshot>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot>;
  subscribeDreamUpdates?(
    callback: (update: DesktopLiveUpdate) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  subscribeAutomationsUpdates?(callback: (snapshot: DesktopSnapshot) => void): () => void;
  listTaskMenuItems(): Promise<DesktopTaskMenuItem[]>;
  resolveTaskForRun(key: string): Promise<DesktopResolveTaskForRunResult>;
  resolveTaskByLabel(label: string): Promise<DesktopResolveTaskForRunResult>;
  consumeFolderOpenTaskTriggers(): Promise<string[]>;
  subscribeTasksUpdates?(callback: (items: DesktopTaskMenuItem[]) => void): () => void;
  replyPendingApproval(request: ReplyPendingApprovalRequest): Promise<DesktopSnapshot>;
  replyPendingQuestions(request: ReplyPendingQuestionsRequest): Promise<DesktopSnapshot>;
  replyWorkspaceCapabilityTrust(
    request: ReplyWorkspaceCapabilityTrustRequest,
  ): Promise<DesktopSnapshot>;
  resolveExtensionUi(
    request: import("./types.js").ResolveExtensionUiRequest,
  ): Promise<DesktopSnapshot>;
  getWorkspaceToolTabs(): Promise<import("./types.js").DesktopWorkspaceToolsSnapshot>;
  syncWorkspaceToolTabs(request: {
    expectedRevision: number;
    tabs: import("./types.js").DesktopWorkspaceToolTab[];
    activeTabId: string;
  }): Promise<import("./types.js").DesktopWorkspaceToolsSnapshot>;
  subscribeWorkspaceToolTabsUpdates?(
    callback: (snapshot: import("./types.js").DesktopWorkspaceToolsSnapshot) => void,
  ): () => void;
  invokeExtensionViewRequest(
    request: import("./types.js").DesktopExtensionViewRequest,
  ): Promise<unknown>;
  openExtensionLink(
    request: import("./types.js").DesktopExtensionOpenLinkRequest,
  ): Promise<boolean>;
  invokeExtensionTabRequest(request: {
    extensionId: string;
    contributionId: string;
    instanceId: string;
    method: string;
    params?: unknown;
  }): Promise<unknown>;
  setExtensionTabChrome(request: {
    extensionId: string;
    instanceId: string;
    patch: import("./types.js").DesktopExtensionTabChromePatch;
  }): Promise<void>;
  subscribeExtensionTabEvents?(
    callback: (event: import("./types.js").DesktopExtensionTabEvent) => void,
  ): () => void;
  invokeExtensionWebView(
    request: import("./types.js").DesktopExtensionWebViewRequest,
  ): Promise<unknown>;
  subscribeExtensionWebViewEvents?(
    callback: (event: import("./types.js").DesktopExtensionWebViewEvent) => void,
  ): () => void;
  openPathInDefaultApp(absolutePath: string): Promise<void>;
  resetSession(): Promise<DesktopSnapshot>;
  listSessions(): Promise<SessionListItem[]>;
  openSession(path: string): Promise<DesktopSnapshot>;
  beginSplitPaneSession(
    request: BeginSplitPaneSessionRequest,
  ): Promise<BeginSplitPaneSessionResponse>;
  beginSideChatPaneSession(
    request: BeginSideChatPaneSessionRequest,
  ): Promise<BeginSideChatPaneSessionResponse>;
  forkSessionIntoSideChat(request: ForkSessionIntoSideChatRequest): Promise<DesktopSnapshot>;
  setVisiblePaneSessions(request: SetVisiblePaneSessionsRequest): Promise<DesktopSnapshot>;
  syncSplitPaneSessions(request: SyncSplitPaneSessionsRequest): Promise<DesktopSnapshot>;
  focusPaneSession(request: FocusPaneSessionRequest): Promise<DesktopSnapshot>;
  closeSplitPaneSession(request: CloseSplitPaneSessionRequest): Promise<DesktopSnapshot>;
  switchPaneWorkspace(request: SwitchPaneWorkspaceRequest): Promise<DesktopSnapshot>;
  switchPaneModel(request: SwitchPaneModelRequest): Promise<DesktopSnapshot>;
  setPanePendingGitBranch(request: SetPanePendingGitBranchRequest): Promise<DesktopSnapshot>;
  setPaneWorkLocation(request: SetPaneWorkLocationRequest): Promise<DesktopSnapshot>;
  checkoutPaneGitBranch(request: CheckoutPaneGitBranchRequest): Promise<DesktopSnapshot>;
  deleteSession(path: string): Promise<DesktopSnapshot>;
  renameSession(path: string, displayName: string): Promise<DesktopSnapshot>;
  setSessionPinned(path: string, pinned: boolean): Promise<DesktopSnapshot>;
  listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
  requestCodeCompletion(request: RequestCodeCompletionRequest): Promise<CodeCompletionResponse>;
  abortCodeCompletion(): Promise<void>;
  recordCodeCompletionFileState(request: RecordCodeCompletionFileStateRequest): Promise<void>;
  resetCodeCompletionJournal(): Promise<void>;
  primeWorkspaceFileReferenceIndex(): Promise<void>;
  getWorkspaceFileReferenceIndex(): Promise<
    import("./types.js").WorkspaceFileReferenceIndexSnapshot
  >;
  listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile(
    relativePath: string,
    options?: ReadWorkspaceTextFileOptions,
  ): Promise<WorkspaceReadTextFileResult>;
  searchWorkspaceContent(
    request: WorkspaceContentSearchRequest,
  ): Promise<WorkspaceContentSearchResult>;
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
  pickWorkspaceDirectory?(): Promise<string | null>;
  pickLocalFile?(): Promise<string[] | null>;
  getPathForDroppedFile?(file: File): string;
  ingestClipboardImage?(): Promise<string | null>;
  readLocalImagePreviewDataUrl?(filePath: string): Promise<string | null>;
  readManagedImagePreviewDataUrl?(reference: string): Promise<string | null>;
  readLocalVideoPreviewUrl?(filePath: string): Promise<string | null>;
  readManagedVideoPreviewUrl?(reference: string): Promise<string | null>;
  saveLocalImageAs?(filePath: string): Promise<boolean>;
  pairWebHost?(code: string): Promise<void>;
}
