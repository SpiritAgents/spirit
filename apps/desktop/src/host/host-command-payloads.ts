import type { ApprovalLevel, WorkLocationKind } from "@spiritagent/host-internal";

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
  ImportExtensionRequest,
  InstallBuiltInExtensionRequest,
  InstallLspProviderRequest,
  PreviewModelsRequest,
  RemoveProviderGroupRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
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
  RunExtensionRequest,
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
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "../types.js";

export type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  rememberWorkspaceRoot: { request: RememberWorkspaceRequest };
  forgetWorkspace: { request: ForgetWorkspaceRequest };
  commitChanges: { request: CommitChangesRequest };
  updateConfig: { request: UpdateConfigRequest };
  installLspProvider: { request: InstallLspProviderRequest };
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
  setWebHostAuthTokenHash: { authTokenHash: string };
  addModel: { request: AddModelRequest };
  addProviderModels: { request: AddProviderModelsRequest };
  previewModels: { request: PreviewModelsRequest };
  removeModel: { request: RemoveModelRequest };
  removeProviderModels: { request: RemoveProviderModelsRequest };
  removeProviderGroup: { request: RemoveProviderGroupRequest };
  addMcpServer: { request: AddMcpServerRequest };
  deleteMcpServer: { request: DeleteMcpServerRequest };
  saveHookEntry: { request: SaveHookEntryRequest };
  deleteHookEntry: { request: DeleteHookEntryRequest };
  inspectMcpServer: { name: string };
  importExtension: { request: ImportExtensionRequest };
  installBuiltInExtension: { request: InstallBuiltInExtensionRequest };
  deleteExtension: { request: DeleteExtensionRequest };
  setExtensionEnabled: { request: SetExtensionEnabledRequest };
  runExtension: { request: RunExtensionRequest };
  updateExtensionSettings: { request: UpdateExtensionSettingsRequest };
  updateExtensionSecret: { request: UpdateExtensionSecretRequest };
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
  abortConversation: import("../types.js").AbortConversationRequest | undefined;
  abortShell: { toolCallId: string };
  continueAssistantCompletion: { messageId: number };
  poll: { sessionPath?: string } | undefined;
  listDreamsOverview: undefined;
  listAutomations: undefined;
  getAutomation: { automationId: string };
  createAutomation: { request: DesktopCreateAutomationRequest };
  updateAutomation: { automationId: string; patch: DesktopUpdateAutomationRequest };
  deleteAutomation: { automationId: string };
  setAutomationEnabled: { automationId: string; enabled: boolean };
  replyPendingApproval: { request: ReplyPendingApprovalRequest };
  replyPendingQuestions: { request: ReplyPendingQuestionsRequest };
  replyWorkspaceCapabilityTrust: { request: ReplyWorkspaceCapabilityTrustRequest };
  resetSession:
    | { activate?: boolean; clientHost?: import("../types.js").DesktopClientHost }
    | undefined;
  listSessions: undefined;
  openSession: {
    path: string;
    activate?: boolean;
    clientHost?: import("../types.js").DesktopClientHost;
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
  listWorkspaceFileReferenceSuggestions: { request: QueryWorkspaceFileReferenceSuggestionsRequest };
  requestCodeCompletion: { request: RequestCodeCompletionRequest };
  abortCodeCompletion: undefined;
  recordCodeCompletionFileState: { request: RecordCodeCompletionFileStateRequest };
  resetCodeCompletionJournal: undefined;
  primeWorkspaceFileReferenceIndex: undefined;
  getWorkspaceFileReferenceIndex: undefined;
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string; optional?: boolean };
  searchWorkspaceContent: { request: import("../types.js").WorkspaceContentSearchRequest };
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
