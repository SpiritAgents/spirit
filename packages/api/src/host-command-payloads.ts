import type { ApprovalLevel } from "./approval-level.js";
import type { WorkLocationKind } from "./work-location.js";

import type {
  AddMcpServerRequest,
  AddModelRequest,
  AddProviderModelsRequest,
  BootstrapRequest,
  CheckoutGitBranchRequest,
  CommitChangesRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopCreateAutomationRequest,
  DesktopUpdateAutomationRequest,
  AddMarketplaceSourceRequest,
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  InstallMarketplaceExtensionRequest,
  RemoveMarketplaceSourceRequest,
  UpdateExtensionRequest,
  PreviewModelsRequest,
  DisconnectProviderRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RemoveModelRequest,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  ReplyPendingApprovalRequest,
  ReplyPendingQuestionsRequest,
  ReplyWorkspaceCapabilityTrustRequest,
  ForkSessionRequest,
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubAutomationRepositoriesRequest,
  ListGitHubPullRequestsRequest,
  SearchGitHubAutomationRepositoriesRequest,
  MergeGitHubPullRequestRequest,
  InvokeExtensionActionRequest,
  SaveHookEntryRequest,
  SetExtensionEnabledRequest,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  SubmitUserTurnRequest,
  BeginSplitPaneSessionRequest,
  ForkSessionIntoSideChatRequest,
  BeginSideChatPaneSessionRequest,
  SetVisiblePaneSessionsRequest,
  SyncSplitPaneSessionsRequest,
  CloseSplitPaneSessionRequest,
  FocusPaneSessionRequest,
  SwitchPaneWorkspaceRequest,
  SwitchPaneModelRequest,
  SetPanePendingGitBranchRequest,
  SetPaneWorkLocationRequest,
  CheckoutPaneGitBranchRequest,
  UpdateConfigRequest,
  UpdateExtensionSettingsRequest,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "./types.js";

export type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  rememberWorkspaceRoot: { request: RememberWorkspaceRequest };
  forgetWorkspace: { request: ForgetWorkspaceRequest };
  commitChanges: { request: CommitChangesRequest };
  updateConfig: { request: UpdateConfigRequest };
  setLoopEnabled: { enabled: boolean };
  setApprovalLevel: { approvalLevel: ApprovalLevel };
  setPendingGitBranch: { branch: string };
  setWorkLocation: { workLocation: WorkLocationKind };
  checkoutGitBranch: CheckoutGitBranchRequest;
  mergeWorktreeToMain: undefined;
  pushGitBranch: undefined;
  refreshGitSnapshot: undefined;
  readGitWorkingTree: undefined;
  readGitHistory: { request?: ReadGitHistoryRequest };
  readGitCommitMessage: { request: ReadGitCommitMessageRequest };
  getGitHubAuthStatus: undefined;
  beginGitHubDeviceLogin: undefined;
  completeGitHubDeviceLogin: undefined;
  cancelGitHubDeviceLogin: undefined;
  disconnectGitHub: undefined;
  getGitHubPullRequestForCurrentBranch: undefined;
  listGitHubPullRequests: { request: ListGitHubPullRequestsRequest };
  listGitHubAutomationRepositories: { request?: ListGitHubAutomationRepositoriesRequest };
  searchGitHubAutomationRepositories: { request: SearchGitHubAutomationRepositoriesRequest };
  getGitHubPullRequestTabCounts: { request: GetGitHubPullRequestTabCountsRequest };
  getGitHubPullRequestDetail: { request: GetGitHubPullRequestDetailRequest };
  getGitHubPullRequestConversation: { request: GetGitHubPullRequestDetailRequest };
  getGitHubPullRequestFiles: { request: GetGitHubPullRequestDetailRequest };
  getGitHubPullRequestCommits: { request: GetGitHubPullRequestDetailRequest };
  getGitHubPullRequestChecks: { request: GetGitHubPullRequestDetailRequest };
  mergeGitHubPullRequest: { request: MergeGitHubPullRequestRequest };
  markGitHubPullRequestReady: { request: GetGitHubPullRequestDetailRequest };
  addModel: { request: AddModelRequest };
  addProviderModels: { request: AddProviderModelsRequest };
  previewModels: { request: PreviewModelsRequest };
  removeModel: { request: RemoveModelRequest };
  disconnectProvider: { request: DisconnectProviderRequest };
  addMcpServer: { request: AddMcpServerRequest };
  deleteMcpServer: { request: DeleteMcpServerRequest };
  saveHookEntry: { request: SaveHookEntryRequest };
  deleteHookEntry: { request: DeleteHookEntryRequest };
  inspectMcpServer: { name: string };
  importExtension: { request: ImportExtensionRequest };
  installBuiltInExtension: { request: InstallBuiltInExtensionRequest };
  addMarketplaceSource: { request: AddMarketplaceSourceRequest };
  removeMarketplaceSource: { request: RemoveMarketplaceSourceRequest };
  installMarketplaceExtension: { request: InstallMarketplaceExtensionRequest };
  updateExtension: { request: UpdateExtensionRequest };
  deleteExtension: { request: DeleteExtensionRequest };
  setExtensionEnabled: { request: SetExtensionEnabledRequest };
  invokeExtensionAction: { request: InvokeExtensionActionRequest };
  updateExtensionSettings: { request: UpdateExtensionSettingsRequest };
  createRule: { request: CreateRuleRequest };
  createSkill: { request: CreateSkillRequest };
  deleteRule: { request: DeleteRuleRequest };
  deleteSkill: { request: DeleteSkillRequest };
  submitSkillSlash: { request: SubmitSkillSlashRequest };
  submitGitChip: { request: SubmitGitChipRequest };
  submitStartImplementing: undefined;
  exportSession: undefined;
  compactHistory: undefined;
  submitUserTurn: SubmitUserTurnRequest;
  abortConversation: import("./types.js").AbortConversationRequest | undefined;
  abortShell: { toolCallId: string };
  moveToBackground: { toolCallId: string };
  continueAssistantCompletion: { messageId: number };
  poll: { sessionPath?: string } | undefined;
  listDreamsOverview: undefined;
  resolveAutomationTriggerMenu: {
    request: import("./types.js").ResolveAutomationTriggerMenuRequest;
  };
  cancelAutomationTriggerMenu: { request: import("./types.js").CancelAutomationTriggerMenuRequest };
  validateAutomationTrigger: { request: import("./types.js").ValidateAutomationTriggerRequest };
  listAutomations: undefined;
  getAutomation: { automationId: string };
  createAutomation: { request: DesktopCreateAutomationRequest };
  updateAutomation: { automationId: string; patch: DesktopUpdateAutomationRequest };
  deleteAutomation: { automationId: string };
  setAutomationEnabled: { automationId: string; enabled: boolean };
  listTaskMenuItems: undefined;
  resolveTaskForRun: { key: string };
  resolveTaskByLabel: { label: string };
  consumeFolderOpenTaskTriggers: undefined;
  replyPendingApproval: { request: ReplyPendingApprovalRequest };
  replyPendingQuestions: { request: ReplyPendingQuestionsRequest };
  replyWorkspaceCapabilityTrust: { request: ReplyWorkspaceCapabilityTrustRequest };
  resolveExtensionUi: { request: import("./types.js").ResolveExtensionUiRequest };
  getWorkspaceToolTabs: { windowId: string };
  syncWorkspaceToolTabs: {
    windowId: string;
    expectedRevision: number;
    tabs: import("./types.js").DesktopWorkspaceToolTab[];
    activeTabId: string;
  };
  invokeExtensionViewRequest: import("./types.js").DesktopExtensionViewRequest & {
    windowId: string;
  };
  openExtensionLink: import("./types.js").DesktopExtensionOpenLinkRequest & { windowId: string };
  invokeExtensionTabRequest: {
    windowId: string;
    extensionId: string;
    contributionId: string;
    instanceId: string;
    method: string;
    params?: unknown;
  };
  setExtensionTabChrome: {
    windowId: string;
    extensionId: string;
    instanceId: string;
    patch: import("./types.js").DesktopExtensionTabChromePatch;
  };
  resetSession:
    | { activate?: boolean; clientHost?: import("./types.js").DesktopClientHost }
    | undefined;
  listSessions: undefined;
  openSession: {
    path: string;
    activate?: boolean;
    clientHost?: import("./types.js").DesktopClientHost;
  };
  beginSplitPaneSession: { request: BeginSplitPaneSessionRequest };
  beginSideChatPaneSession: { request: BeginSideChatPaneSessionRequest };
  forkSessionIntoSideChat: { request: ForkSessionIntoSideChatRequest };
  setVisiblePaneSessions: { request: SetVisiblePaneSessionsRequest };
  syncSplitPaneSessions: { request: SyncSplitPaneSessionsRequest };
  focusPaneSession: { request: FocusPaneSessionRequest };
  closeSplitPaneSession: { request: CloseSplitPaneSessionRequest };
  switchPaneWorkspace: { request: SwitchPaneWorkspaceRequest };
  switchPaneModel: { request: SwitchPaneModelRequest };
  setPanePendingGitBranch: { request: SetPanePendingGitBranchRequest };
  setPaneWorkLocation: { request: SetPaneWorkLocationRequest };
  checkoutPaneGitBranch: { request: CheckoutPaneGitBranchRequest };
  deleteSession: { path: string };
  renameSession: { path: string; displayName: string };
  setSessionPinned: { path: string; pinned: boolean };
  listWorkspaceFileReferenceSuggestions: { request: QueryWorkspaceFileReferenceSuggestionsRequest };
  requestCodeCompletion: { request: RequestCodeCompletionRequest };
  abortCodeCompletion: undefined;
  recordCodeCompletionFileState: { request: RecordCodeCompletionFileStateRequest };
  resetCodeCompletionJournal: undefined;
  primeWorkspaceFileReferenceIndex: undefined;
  getWorkspaceFileReferenceIndex: undefined;
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string; optional?: boolean };
  searchWorkspaceContent: { request: import("./types.js").WorkspaceContentSearchRequest };
  writeWorkspaceTextFile: { request: WriteWorkspaceTextFileRequest };
  revealWorkspaceEntry: { relativePath: string; workspaceRoot?: string };
  openPathInDefaultApp: { absolutePath: string };
  renameWorkspaceEntry: { relativePath: string; newName: string };
  createWorkspaceEntry: {
    parentDirectoryRel: string;
    name: string;
    kind: "file" | "dir";
  };
  moveWorkspaceEntry: { relativePath: string; targetDirectoryRel: string };
  trashWorkspaceEntry: { relativePath: string };
  forceDeleteWorkspaceEntry: { relativePath: string };
  readHostTextFile: { absolutePath: string };
  writeHostTextFile: { request: WriteHostTextFileRequest };
  statHostTextFile: { absolutePath: string };
  classifyLocalFileComposerRoute: { absolutePath: string };
  rewindAndSubmitMessage: { request: RewindAndSubmitMessageRequest };
  forkSession: { request: ForkSessionRequest };
  reorderQueuedUserTurn: { request: QueuedUserTurnRequest };
  sendQueuedUserTurnNow: { request: QueuedUserTurnRequest };
  removeQueuedUserTurn: { request: QueuedUserTurnRequest };
  setSubagentViewerTarget: { parentToolCallId: string | null };
};
