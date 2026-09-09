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
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopModelProvider,
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
  RunExtensionRequest,
  SaveHookEntryRequest,
  SetExtensionEnabledRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  RemoveProviderGroupRequest,
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
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubAutomationRepositoriesRequest,
  ListGitHubPullRequestsRequest,
  SearchGitHubAutomationRepositoriesRequest,
  MergeGitHubPullRequestRequest,
  GitHubAuthStatus,
  GitHubAutomationRepositoriesSnapshot,
  GitHubDeviceAuthChallenge,
  GitHubPullRequestDetail,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestMergeResult,
  GitHubPullRequestTabCounts,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestForBranchResult,
  SearchGitHubAutomationRepositoriesSnapshot,
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
  InstallLspProviderRequest,
  ApprovalLevel,
  LocalFileComposerRoute,
  WorkLocationKind,
} from "./types";

import { createElectronHostApi } from "./adapters/electron";
import { createWebHostApi } from "./adapters/web";

export interface HostApi {
  kind: "electron" | "web";
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  rememberWorkspaceRoot?(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
  forgetWorkspace?(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot>;
  commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  installLspProvider(request: InstallLspProviderRequest): Promise<DesktopSnapshot>;
  addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
  addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
  previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
  removeModel(name: string): Promise<DesktopSnapshot>;
  removeProviderModels(provider: DesktopModelProvider): Promise<DesktopSnapshot>;
  removeProviderGroup(request: RemoveProviderGroupRequest): Promise<DesktopSnapshot>;
  addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot>;
  deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot>;
  saveHookEntry(request: SaveHookEntryRequest): Promise<DesktopSnapshot>;
  deleteHookEntry(request: DeleteHookEntryRequest): Promise<DesktopSnapshot>;
  inspectMcpServer(name: string): Promise<DesktopMcpServerInspection>;
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
  getGitHubAuthStatus(): Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin(): Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin(): Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin(): Promise<void>;
  disconnectGitHub(): Promise<GitHubAuthStatus>;
  getGitHubPullRequestForCurrentBranch(): Promise<GitHubPullRequestForBranchResult>;
  listGitHubPullRequests(
    request: ListGitHubPullRequestsRequest,
  ): Promise<GitHubPullRequestListSnapshot>;
  listGitHubAutomationRepositories(
    request?: ListGitHubAutomationRepositoriesRequest,
  ): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubAutomationRepositories(
    request: SearchGitHubAutomationRepositoriesRequest,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
  getGitHubPullRequestTabCounts(
    request: GetGitHubPullRequestTabCountsRequest,
  ): Promise<GitHubPullRequestTabCounts>;
  getGitHubPullRequestDetail(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestDetail>;
  getGitHubPullRequestConversation(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestConversationSnapshot>;
  getGitHubPullRequestFiles(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestFilesSnapshot>;
  getGitHubPullRequestCommits(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestCommitsSnapshot>;
  getGitHubPullRequestChecks(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestChecksSnapshot>;
  mergeGitHubPullRequest(
    request: MergeGitHubPullRequestRequest,
  ): Promise<GitHubPullRequestMergeResult>;
  markGitHubPullRequestReady(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestDetail>;
  abortConversation(request?: AbortConversationRequest): Promise<DesktopSnapshot>;
  abortShell(toolCallId: string): Promise<DesktopSnapshot>;
  continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
  rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
  forkSession(request: ForkSessionRequest): Promise<DesktopSnapshot>;
  reorderQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  sendQueuedUserTurnNow(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  removeQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  poll(request?: import("./types").PollRequest): Promise<DesktopSnapshot>;
  setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot>;
  listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
  listAutomations(): Promise<DesktopAutomationListItem[]>;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
  createAutomation(request: DesktopCreateAutomationRequest): Promise<DesktopSnapshot>;
  updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): Promise<DesktopSnapshot>;
  deleteAutomation(automationId: string): Promise<DesktopSnapshot>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot>;
  subscribeDreamUpdates?(callback: (update: DesktopLiveUpdate) => void): () => void;
  subscribeAutomationsUpdates?(callback: (snapshot: DesktopSnapshot) => void): () => void;
  subscribeSessionListUpdates?(callback: () => void): () => void;
  replyPendingApproval(request: ReplyPendingApprovalRequest): Promise<DesktopSnapshot>;
  replyPendingQuestions(request: ReplyPendingQuestionsRequest): Promise<DesktopSnapshot>;
  replyWorkspaceCapabilityTrust(
    request: ReplyWorkspaceCapabilityTrustRequest,
  ): Promise<DesktopSnapshot>;
  resolveExtensionUi(
    request: import("./types").ResolveExtensionUiRequest,
  ): Promise<DesktopSnapshot>;
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
  listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
  requestCodeCompletion(request: RequestCodeCompletionRequest): Promise<CodeCompletionResponse>;
  abortCodeCompletion(): Promise<void>;
  recordCodeCompletionFileState(request: RecordCodeCompletionFileStateRequest): Promise<void>;
  resetCodeCompletionJournal(): Promise<void>;
  primeWorkspaceFileReferenceIndex(): Promise<void>;
  getWorkspaceFileReferenceIndex(): Promise<import("./types").WorkspaceFileReferenceIndexSnapshot>;
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

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== "undefined" && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
