import type { HostCommandName } from "./contracts.js";
import type { CommandPayloads } from "./host-command-payloads.js";

export interface HostCommandDelegate {
  bootstrap(request?: CommandPayloads["bootstrap"]["request"]): Promise<unknown>;
  rememberWorkspaceRoot(
    request: CommandPayloads["rememberWorkspaceRoot"]["request"],
  ): Promise<unknown>;
  forgetWorkspace(request: CommandPayloads["forgetWorkspace"]["request"]): Promise<unknown>;
  commitChanges(request: CommandPayloads["commitChanges"]["request"]): Promise<unknown>;
  updateConfig(request: CommandPayloads["updateConfig"]["request"]): Promise<unknown>;
  installLspProvider(request: CommandPayloads["installLspProvider"]["request"]): Promise<unknown>;
  setWebHostAuthTokenHash(authTokenHash: string): Promise<unknown>;
  addModel(request: CommandPayloads["addModel"]["request"]): Promise<unknown>;
  addProviderModels(request: CommandPayloads["addProviderModels"]["request"]): Promise<unknown>;
  previewModels(request: CommandPayloads["previewModels"]["request"]): Promise<unknown>;
  removeModel(request: CommandPayloads["removeModel"]["request"]): Promise<unknown>;
  removeProviderModels(
    request: CommandPayloads["removeProviderModels"]["request"],
  ): Promise<unknown>;
  removeProviderGroup(request: CommandPayloads["removeProviderGroup"]["request"]): Promise<unknown>;
  addMcpServer(request: CommandPayloads["addMcpServer"]["request"]): Promise<unknown>;
  deleteMcpServer(request: CommandPayloads["deleteMcpServer"]["request"]): Promise<unknown>;
  saveHookEntry(request: CommandPayloads["saveHookEntry"]["request"]): Promise<unknown>;
  deleteHookEntry(request: CommandPayloads["deleteHookEntry"]["request"]): Promise<unknown>;
  inspectMcpServer(name: string): Promise<unknown>;
  importExtension(request: CommandPayloads["importExtension"]["request"]): Promise<unknown>;
  deleteExtension(request: CommandPayloads["deleteExtension"]["request"]): Promise<unknown>;
  runExtension(request: CommandPayloads["runExtension"]["request"]): Promise<unknown>;
  updateExtensionSettings(
    request: CommandPayloads["updateExtensionSettings"]["request"],
  ): Promise<unknown>;
  updateExtensionSecret(
    request: CommandPayloads["updateExtensionSecret"]["request"],
  ): Promise<unknown>;
  createRule(request: CommandPayloads["createRule"]["request"]): Promise<unknown>;
  createSkill(request: CommandPayloads["createSkill"]["request"]): Promise<unknown>;
  deleteRule(request: CommandPayloads["deleteRule"]["request"]): Promise<unknown>;
  deleteSkill(request: CommandPayloads["deleteSkill"]["request"]): Promise<unknown>;
  submitSkillSlash(request: CommandPayloads["submitSkillSlash"]["request"]): Promise<unknown>;
  submitGitChip(request: CommandPayloads["submitGitChip"]["request"]): Promise<unknown>;
  submitStartImplementing(): Promise<unknown>;
  exportSession(): Promise<unknown>;
  compactHistory(): Promise<unknown>;
  submitUserTurn(request: CommandPayloads["submitUserTurn"]): Promise<unknown>;
  setLoopEnabled(enabled: boolean): Promise<unknown>;
  setApprovalLevel(
    approvalLevel: CommandPayloads["setApprovalLevel"]["approvalLevel"],
  ): Promise<unknown>;
  setPendingGitBranch(branch: string): Promise<unknown>;
  setWorkLocation(
    workLocation: CommandPayloads["setWorkLocation"]["workLocation"],
  ): Promise<unknown>;
  checkoutGitBranch(request: CommandPayloads["checkoutGitBranch"]): Promise<unknown>;
  mergeWorktreeToMain(): Promise<unknown>;
  pushGitBranch(): Promise<unknown>;
  refreshGitSnapshot(): Promise<unknown>;
  abortConversation(request?: CommandPayloads["abortConversation"]): Promise<unknown>;
  abortShell(toolCallId: string): Promise<unknown>;
  continueAssistantCompletion(messageId: number): Promise<unknown>;
  poll(request?: import("../types.js").PollRequest): Promise<unknown>;
  listDreamsOverview(): Promise<unknown>;
  listAutomations(): Promise<unknown>;
  getAutomation(automationId: string): Promise<unknown>;
  createAutomation(request: CommandPayloads["createAutomation"]["request"]): Promise<unknown>;
  updateAutomation(
    automationId: string,
    patch: CommandPayloads["updateAutomation"]["patch"],
  ): Promise<unknown>;
  deleteAutomation(automationId: string): Promise<unknown>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<unknown>;
  replyPendingApproval(
    request: CommandPayloads["replyPendingApproval"]["request"],
  ): Promise<unknown>;
  replyPendingQuestions(
    request: CommandPayloads["replyPendingQuestions"]["request"],
  ): Promise<unknown>;
  replyWorkspaceCapabilityTrust(
    request: CommandPayloads["replyWorkspaceCapabilityTrust"]["request"],
  ): Promise<unknown>;
  resetSession(payload?: CommandPayloads["resetSession"]): Promise<unknown>;
  listSessions(): Promise<unknown>;
  openSession(
    path: string,
    options?: { activate?: boolean; clientHost?: import("../types.js").DesktopClientHost },
  ): Promise<unknown>;
  beginSplitPaneSession(
    request: CommandPayloads["beginSplitPaneSession"]["request"],
  ): Promise<unknown>;
  beginSideChatPaneSession(
    request: CommandPayloads["beginSideChatPaneSession"]["request"],
  ): Promise<unknown>;
  forkSessionIntoSideChat(
    request: CommandPayloads["forkSessionIntoSideChat"]["request"],
  ): Promise<unknown>;
  setVisiblePaneSessions(
    request: CommandPayloads["setVisiblePaneSessions"]["request"],
  ): Promise<unknown>;
  syncSplitPaneSessions(
    request: CommandPayloads["syncSplitPaneSessions"]["request"],
  ): Promise<unknown>;
  focusPaneSession(request: CommandPayloads["focusPaneSession"]["request"]): Promise<unknown>;
  closeSplitPaneSession(
    request: CommandPayloads["closeSplitPaneSession"]["request"],
  ): Promise<unknown>;
  switchPaneWorkspace(request: CommandPayloads["switchPaneWorkspace"]["request"]): Promise<unknown>;
  switchPaneModel(request: CommandPayloads["switchPaneModel"]["request"]): Promise<unknown>;
  setPanePendingGitBranch(
    request: CommandPayloads["setPanePendingGitBranch"]["request"],
  ): Promise<unknown>;
  setPaneWorkLocation(request: CommandPayloads["setPaneWorkLocation"]["request"]): Promise<unknown>;
  checkoutPaneGitBranch(
    request: CommandPayloads["checkoutPaneGitBranch"]["request"],
  ): Promise<unknown>;
  deleteSession(path: string): Promise<unknown>;
  renameSession(path: string, displayName: string): Promise<unknown>;
  listWorkspaceFileReferenceSuggestions(
    request: CommandPayloads["listWorkspaceFileReferenceSuggestions"]["request"],
  ): Promise<unknown>;
  requestCodeCompletion(
    request: CommandPayloads["requestCodeCompletion"]["request"],
  ): Promise<unknown>;
  abortCodeCompletion(): Promise<unknown>;
  recordCodeCompletionFileState(
    request: CommandPayloads["recordCodeCompletionFileState"]["request"],
  ): Promise<unknown>;
  resetCodeCompletionJournal(): Promise<unknown>;
  primeWorkspaceFileReferenceIndex(): Promise<unknown>;
  getWorkspaceFileReferenceIndex(): Promise<unknown>;
  listWorkspaceExplorerChildren(relativePath: string): Promise<unknown>;
  readGitWorkingTree(): Promise<unknown>;
  readGitHistory(
    request: NonNullable<CommandPayloads["readGitHistory"]["request"]>,
  ): Promise<unknown>;
  readGitCommitMessage(
    request: CommandPayloads["readGitCommitMessage"]["request"],
  ): Promise<unknown>;
  getGitHubAuthStatus(): Promise<unknown>;
  beginGitHubDeviceLogin(): Promise<unknown>;
  completeGitHubDeviceLogin(): Promise<unknown>;
  cancelGitHubDeviceLogin(): Promise<unknown>;
  disconnectGitHub(): Promise<unknown>;
  getGitHubPullRequestForCurrentBranch(): Promise<unknown>;
  listGitHubPullRequests(
    request: CommandPayloads["listGitHubPullRequests"]["request"],
  ): Promise<unknown>;
  listGitHubAutomationRepositories(
    request?: CommandPayloads["listGitHubAutomationRepositories"]["request"],
  ): Promise<unknown>;
  searchGitHubAutomationRepositories(
    request: CommandPayloads["searchGitHubAutomationRepositories"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestTabCounts(
    request: CommandPayloads["getGitHubPullRequestTabCounts"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestDetail(
    request: CommandPayloads["getGitHubPullRequestDetail"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestConversation(
    request: CommandPayloads["getGitHubPullRequestConversation"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestFiles(
    request: CommandPayloads["getGitHubPullRequestFiles"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestCommits(
    request: CommandPayloads["getGitHubPullRequestCommits"]["request"],
  ): Promise<unknown>;
  getGitHubPullRequestChecks(
    request: CommandPayloads["getGitHubPullRequestChecks"]["request"],
  ): Promise<unknown>;
  mergeGitHubPullRequest(
    request: CommandPayloads["mergeGitHubPullRequest"]["request"],
  ): Promise<unknown>;
  markGitHubPullRequestReady(
    request: CommandPayloads["markGitHubPullRequestReady"]["request"],
  ): Promise<unknown>;
  readWorkspaceTextFile(
    relativePath: string,
    options?: import("../types.js").ReadWorkspaceTextFileOptions,
  ): Promise<unknown>;
  searchWorkspaceContent(
    request: import("../types.js").WorkspaceContentSearchRequest,
  ): Promise<unknown>;
  writeWorkspaceTextFile(
    request: CommandPayloads["writeWorkspaceTextFile"]["request"],
  ): Promise<unknown>;
  revealWorkspaceEntry(relativePath: string, workspaceRoot?: string): Promise<unknown>;
  openPathInDefaultApp(absolutePath: string): Promise<unknown>;
  renameWorkspaceEntry(relativePath: string, newName: string): Promise<unknown>;
  createWorkspaceEntry(
    parentDirectoryRel: string,
    name: string,
    kind: "file" | "dir",
  ): Promise<unknown>;
  moveWorkspaceEntry(relativePath: string, targetDirectoryRel: string): Promise<unknown>;
  trashWorkspaceEntry(relativePath: string): Promise<unknown>;
  forceDeleteWorkspaceEntry(relativePath: string): Promise<unknown>;
  readHostTextFile(absolutePath: string): Promise<unknown>;
  writeHostTextFile(request: CommandPayloads["writeHostTextFile"]["request"]): Promise<unknown>;
  statHostTextFile(absolutePath: string): Promise<unknown>;
  classifyLocalFileComposerRoute(absolutePath: string): Promise<unknown>;
  rewindAndSubmitMessage(
    request: CommandPayloads["rewindAndSubmitMessage"]["request"],
  ): Promise<unknown>;
  forkSession(request: CommandPayloads["forkSession"]["request"]): Promise<unknown>;
  reorderQueuedUserTurn(
    request: CommandPayloads["reorderQueuedUserTurn"]["request"],
  ): Promise<unknown>;
  sendQueuedUserTurnNow(
    request: CommandPayloads["sendQueuedUserTurnNow"]["request"],
  ): Promise<unknown>;
  removeQueuedUserTurn(
    request: CommandPayloads["removeQueuedUserTurn"]["request"],
  ): Promise<unknown>;
  setSubagentViewerTarget(parentToolCallId: string | null): Promise<unknown>;
}

type HostCommandHandler<Command extends HostCommandName> = (
  host: HostCommandDelegate,
  payload: CommandPayloads[Command],
) => Promise<unknown>;

const hostCommandDispatch = {
  bootstrap: (host, payload) => host.bootstrap(payload?.request),
  rememberWorkspaceRoot: (host, payload) => host.rememberWorkspaceRoot(payload.request),
  forgetWorkspace: (host, payload) => host.forgetWorkspace(payload.request),
  commitChanges: (host, payload) => host.commitChanges(payload.request),
  updateConfig: (host, payload) => host.updateConfig(payload.request),
  installLspProvider: (host, payload) => host.installLspProvider(payload.request),
  setWebHostAuthTokenHash: (host, payload) => host.setWebHostAuthTokenHash(payload.authTokenHash),
  addModel: (host, payload) => host.addModel(payload.request),
  addProviderModels: (host, payload) => host.addProviderModels(payload.request),
  previewModels: (host, payload) => host.previewModels(payload.request),
  removeModel: (host, payload) => host.removeModel(payload.request),
  removeProviderModels: (host, payload) => host.removeProviderModels(payload.request),
  removeProviderGroup: (host, payload) => host.removeProviderGroup(payload.request),
  addMcpServer: (host, payload) => host.addMcpServer(payload.request),
  deleteMcpServer: (host, payload) => host.deleteMcpServer(payload.request),
  saveHookEntry: (host, payload) => host.saveHookEntry(payload.request),
  deleteHookEntry: (host, payload) => host.deleteHookEntry(payload.request),
  inspectMcpServer: (host, payload) => host.inspectMcpServer(payload.name),
  importExtension: (host, payload) => host.importExtension(payload.request),
  deleteExtension: (host, payload) => host.deleteExtension(payload.request),
  runExtension: (host, payload) => host.runExtension(payload.request),
  updateExtensionSettings: (host, payload) => host.updateExtensionSettings(payload.request),
  updateExtensionSecret: (host, payload) => host.updateExtensionSecret(payload.request),
  createRule: (host, payload) => host.createRule(payload.request),
  createSkill: (host, payload) => host.createSkill(payload.request),
  deleteRule: (host, payload) => host.deleteRule(payload.request),
  deleteSkill: (host, payload) => host.deleteSkill(payload.request),
  submitSkillSlash: (host, payload) => host.submitSkillSlash(payload.request),
  submitGitChip: (host, payload) => host.submitGitChip(payload.request),
  submitStartImplementing: (host) => host.submitStartImplementing(),
  exportSession: (host) => host.exportSession(),
  compactHistory: (host) => host.compactHistory(),
  submitUserTurn: (host, payload) => host.submitUserTurn(payload),
  setLoopEnabled: (host, payload) => host.setLoopEnabled(payload.enabled === true),
  setApprovalLevel: (host, payload) => host.setApprovalLevel(payload.approvalLevel),
  setPendingGitBranch: (host, payload) => host.setPendingGitBranch(payload.branch),
  setWorkLocation: (host, payload) => host.setWorkLocation(payload.workLocation),
  checkoutGitBranch: (host, payload) => host.checkoutGitBranch(payload),
  mergeWorktreeToMain: (host) => host.mergeWorktreeToMain(),
  pushGitBranch: (host) => host.pushGitBranch(),
  refreshGitSnapshot: (host) => host.refreshGitSnapshot(),
  abortConversation: (host, payload) => host.abortConversation(payload ?? {}),
  abortShell: (host, payload) => host.abortShell(payload.toolCallId),
  continueAssistantCompletion: (host, payload) =>
    host.continueAssistantCompletion(payload.messageId),
  poll: (host, payload) => host.poll(payload),
  listDreamsOverview: (host) => host.listDreamsOverview(),
  listAutomations: (host) => host.listAutomations(),
  getAutomation: (host, payload) => host.getAutomation(payload.automationId),
  createAutomation: (host, payload) => host.createAutomation(payload.request),
  updateAutomation: (host, payload) => host.updateAutomation(payload.automationId, payload.patch),
  deleteAutomation: (host, payload) => host.deleteAutomation(payload.automationId),
  setAutomationEnabled: (host, payload) =>
    host.setAutomationEnabled(payload.automationId, payload.enabled),
  replyPendingApproval: (host, payload) => host.replyPendingApproval(payload.request),
  replyPendingQuestions: (host, payload) => host.replyPendingQuestions(payload.request),
  replyWorkspaceCapabilityTrust: (host, payload) =>
    host.replyWorkspaceCapabilityTrust(payload.request),
  resetSession: (host, payload) =>
    host.resetSession(
      payload && typeof payload === "object"
        ? {
            ...(payload.activate === false ? { activate: false as const } : {}),
            ...(payload.clientHost ? { clientHost: payload.clientHost } : {}),
          }
        : undefined,
    ),
  listSessions: (host) => host.listSessions(),
  openSession: (host, payload) =>
    host.openSession(payload.path, {
      ...(payload.activate === false || payload.activate === true
        ? { activate: payload.activate }
        : {}),
      ...(payload.clientHost ? { clientHost: payload.clientHost } : {}),
    }),
  beginSplitPaneSession: (host, payload) => host.beginSplitPaneSession(payload.request),
  beginSideChatPaneSession: (host, payload) => host.beginSideChatPaneSession(payload.request),
  forkSessionIntoSideChat: (host, payload) => host.forkSessionIntoSideChat(payload.request),
  setVisiblePaneSessions: (host, payload) => host.setVisiblePaneSessions(payload.request),
  syncSplitPaneSessions: (host, payload) => host.syncSplitPaneSessions(payload.request),
  focusPaneSession: (host, payload) => host.focusPaneSession(payload.request),
  closeSplitPaneSession: (host, payload) => host.closeSplitPaneSession(payload.request),
  switchPaneWorkspace: (host, payload) => host.switchPaneWorkspace(payload.request),
  switchPaneModel: (host, payload) => host.switchPaneModel(payload.request),
  setPanePendingGitBranch: (host, payload) => host.setPanePendingGitBranch(payload.request),
  setPaneWorkLocation: (host, payload) => host.setPaneWorkLocation(payload.request),
  checkoutPaneGitBranch: (host, payload) => host.checkoutPaneGitBranch(payload.request),
  deleteSession: (host, payload) => host.deleteSession(payload.path),
  renameSession: (host, payload) => host.renameSession(payload.path, payload.displayName),
  listWorkspaceFileReferenceSuggestions: (host, payload) =>
    host.listWorkspaceFileReferenceSuggestions(payload.request),
  requestCodeCompletion: (host, payload) => host.requestCodeCompletion(payload.request),
  abortCodeCompletion: (host) => host.abortCodeCompletion(),
  recordCodeCompletionFileState: (host, payload) =>
    host.recordCodeCompletionFileState(payload.request),
  resetCodeCompletionJournal: (host) => host.resetCodeCompletionJournal(),
  primeWorkspaceFileReferenceIndex: (host) => host.primeWorkspaceFileReferenceIndex(),
  getWorkspaceFileReferenceIndex: (host) => host.getWorkspaceFileReferenceIndex(),
  listWorkspaceExplorerChildren: (host, payload) =>
    host.listWorkspaceExplorerChildren(payload.relativePath),
  readGitWorkingTree: (host) => host.readGitWorkingTree(),
  readGitHistory: (host, payload) => host.readGitHistory(payload.request ?? {}),
  readGitCommitMessage: (host, payload) => host.readGitCommitMessage(payload.request),
  getGitHubAuthStatus: (host) => host.getGitHubAuthStatus(),
  beginGitHubDeviceLogin: (host) => host.beginGitHubDeviceLogin(),
  completeGitHubDeviceLogin: (host) => host.completeGitHubDeviceLogin(),
  cancelGitHubDeviceLogin: (host) => host.cancelGitHubDeviceLogin(),
  disconnectGitHub: (host) => host.disconnectGitHub(),
  getGitHubPullRequestForCurrentBranch: (host) => host.getGitHubPullRequestForCurrentBranch(),
  listGitHubPullRequests: (host, payload) => host.listGitHubPullRequests(payload.request),
  listGitHubAutomationRepositories: (host, payload) =>
    host.listGitHubAutomationRepositories(payload.request),
  searchGitHubAutomationRepositories: (host, payload) =>
    host.searchGitHubAutomationRepositories(payload.request),
  getGitHubPullRequestTabCounts: (host, payload) =>
    host.getGitHubPullRequestTabCounts(payload.request),
  getGitHubPullRequestDetail: (host, payload) => host.getGitHubPullRequestDetail(payload.request),
  getGitHubPullRequestConversation: (host, payload) =>
    host.getGitHubPullRequestConversation(payload.request),
  getGitHubPullRequestFiles: (host, payload) => host.getGitHubPullRequestFiles(payload.request),
  getGitHubPullRequestCommits: (host, payload) => host.getGitHubPullRequestCommits(payload.request),
  getGitHubPullRequestChecks: (host, payload) => host.getGitHubPullRequestChecks(payload.request),
  mergeGitHubPullRequest: (host, payload) => host.mergeGitHubPullRequest(payload.request),
  markGitHubPullRequestReady: (host, payload) => host.markGitHubPullRequestReady(payload.request),
  readWorkspaceTextFile: (host, payload) =>
    host.readWorkspaceTextFile(
      payload.relativePath,
      payload.optional ? { optional: true } : undefined,
    ),
  searchWorkspaceContent: (host, payload) => host.searchWorkspaceContent(payload.request),
  writeWorkspaceTextFile: (host, payload) => host.writeWorkspaceTextFile(payload.request),
  revealWorkspaceEntry: (host, payload) =>
    host.revealWorkspaceEntry(payload.relativePath, payload.workspaceRoot),
  openPathInDefaultApp: (host, payload) => host.openPathInDefaultApp(payload.absolutePath),
  renameWorkspaceEntry: (host, payload) =>
    host.renameWorkspaceEntry(payload.relativePath, payload.newName),
  createWorkspaceEntry: (host, payload) =>
    host.createWorkspaceEntry(payload.parentDirectoryRel, payload.name, payload.kind),
  moveWorkspaceEntry: (host, payload) =>
    host.moveWorkspaceEntry(payload.relativePath, payload.targetDirectoryRel),
  trashWorkspaceEntry: (host, payload) => host.trashWorkspaceEntry(payload.relativePath),
  forceDeleteWorkspaceEntry: (host, payload) =>
    host.forceDeleteWorkspaceEntry(payload.relativePath),
  readHostTextFile: (host, payload) => host.readHostTextFile(payload.absolutePath),
  writeHostTextFile: (host, payload) => host.writeHostTextFile(payload.request),
  statHostTextFile: (host, payload) => host.statHostTextFile(payload.absolutePath),
  classifyLocalFileComposerRoute: (host, payload) =>
    host.classifyLocalFileComposerRoute(payload.absolutePath),
  rewindAndSubmitMessage: (host, payload) => host.rewindAndSubmitMessage(payload.request),
  forkSession: (host, payload) => host.forkSession(payload.request),
  reorderQueuedUserTurn: (host, payload) => host.reorderQueuedUserTurn(payload.request),
  sendQueuedUserTurnNow: (host, payload) => host.sendQueuedUserTurnNow(payload.request),
  removeQueuedUserTurn: (host, payload) => host.removeQueuedUserTurn(payload.request),
  setSubagentViewerTarget: (host, payload) =>
    host.setSubagentViewerTarget(payload.parentToolCallId),
} satisfies { [Command in HostCommandName]: HostCommandHandler<Command> };

export function createHostInvokeDispatch(host: HostCommandDelegate) {
  return (command: HostCommandName, payload?: unknown): Promise<unknown> => {
    const handler = hostCommandDispatch[command] as HostCommandHandler<typeof command>;
    return handler(host, payload as CommandPayloads[typeof command]);
  };
}
