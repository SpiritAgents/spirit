import type { ChatArchive } from "@spiritagent/agent-core";
import type { HostToolRequest, ApprovalLevel } from "@spiritagent/host-internal";
import type { PersistedDesktopTimelineTurnSnapshot } from "./chat-schema.js";
import type { StoredDesktopRewindMetadata } from "./rewind.js";

import type {
  CommitChangesRequest,
  AskQuestionsQuestionSpec,
  ConversationContextUsageSnapshot,
} from "../types.js";

export type HostCommandName =
  | "bootstrap"
  | "rememberWorkspaceRoot"
  | "forgetWorkspace"
  | "commitChanges"
  | "updateConfig"
  | "installLspProvider"
  | "setWebHostAuthTokenHash"
  | "addModel"
  | "addProviderModels"
  | "previewModels"
  | "removeModel"
  | "removeProviderModels"
  | "removeProviderGroup"
  | "addMcpServer"
  | "deleteMcpServer"
  | "saveHookEntry"
  | "deleteHookEntry"
  | "inspectMcpServer"
  | "importExtension"
  | "installBuiltInExtension"
  | "addMarketplaceSource"
  | "removeMarketplaceSource"
  | "installMarketplaceExtension"
  | "updateExtension"
  | "deleteExtension"
  | "setExtensionEnabled"
  | "runExtension"
  | "updateExtensionSettings"
  | "updateExtensionSecret"
  | "createRule"
  | "createSkill"
  | "deleteRule"
  | "deleteSkill"
  | "submitSkillSlash"
  | "submitGitChip"
  | "submitStartImplementing"
  | "exportSession"
  | "compactHistory"
  | "submitUserTurn"
  | "setLoopEnabled"
  | "setApprovalLevel"
  | "setPendingGitBranch"
  | "setWorkLocation"
  | "checkoutGitBranch"
  | "mergeWorktreeToMain"
  | "pushGitBranch"
  | "refreshGitSnapshot"
  | "readGitWorkingTree"
  | "readGitHistory"
  | "readGitCommitMessage"
  | "getGitHubAuthStatus"
  | "beginGitHubDeviceLogin"
  | "completeGitHubDeviceLogin"
  | "cancelGitHubDeviceLogin"
  | "disconnectGitHub"
  | "getGitHubPullRequestForCurrentBranch"
  | "listGitHubPullRequests"
  | "listGitHubAutomationRepositories"
  | "searchGitHubAutomationRepositories"
  | "getGitHubPullRequestTabCounts"
  | "getGitHubPullRequestDetail"
  | "getGitHubPullRequestConversation"
  | "getGitHubPullRequestFiles"
  | "getGitHubPullRequestCommits"
  | "getGitHubPullRequestChecks"
  | "mergeGitHubPullRequest"
  | "markGitHubPullRequestReady"
  | "abortConversation"
  | "abortShell"
  | "continueAssistantCompletion"
  | "poll"
  | "listDreamsOverview"
  | "listAutomations"
  | "getAutomation"
  | "createAutomation"
  | "updateAutomation"
  | "deleteAutomation"
  | "setAutomationEnabled"
  | "replyPendingApproval"
  | "replyPendingQuestions"
  | "replyWorkspaceCapabilityTrust"
  | "resetSession"
  | "listSessions"
  | "openSession"
  | "beginSplitPaneSession"
  | "beginSideChatPaneSession"
  | "forkSessionIntoSideChat"
  | "setVisiblePaneSessions"
  | "syncSplitPaneSessions"
  | "focusPaneSession"
  | "closeSplitPaneSession"
  | "switchPaneWorkspace"
  | "switchPaneModel"
  | "setPanePendingGitBranch"
  | "setPaneWorkLocation"
  | "checkoutPaneGitBranch"
  | "deleteSession"
  | "renameSession"
  | "listWorkspaceFileReferenceSuggestions"
  | "requestCodeCompletion"
  | "abortCodeCompletion"
  | "recordCodeCompletionFileState"
  | "resetCodeCompletionJournal"
  | "primeWorkspaceFileReferenceIndex"
  | "getWorkspaceFileReferenceIndex"
  | "listWorkspaceExplorerChildren"
  | "readWorkspaceTextFile"
  | "searchWorkspaceContent"
  | "writeWorkspaceTextFile"
  | "revealWorkspaceEntry"
  | "openPathInDefaultApp"
  | "renameWorkspaceEntry"
  | "createWorkspaceEntry"
  | "moveWorkspaceEntry"
  | "trashWorkspaceEntry"
  | "forceDeleteWorkspaceEntry"
  | "readHostTextFile"
  | "writeHostTextFile"
  | "statHostTextFile"
  | "classifyLocalFileComposerRoute"
  | "rewindAndSubmitMessage"
  | "forkSession"
  | "reorderQueuedUserTurn"
  | "sendQueuedUserTurnNow"
  | "removeQueuedUserTurn"
  | "setSubagentViewerTarget";

/** Host tool request aligned with `ToolRequest` in `apps/cli/src/tool_runtime.rs`. */
export type DesktopToolRequest = HostToolRequest<AskQuestionsQuestionSpec>;

export type SessionTitleSource = "seed" | "llm" | "manual";

export interface StoredDesktopSession {
  chatSchemaVersion: 2;
  llmHistory: ChatArchive["llmHistory"];
  subagentSessions?: ChatArchive["subagentSessions"];
  loopEnabled?: boolean;
  approvalLevel?: ApprovalLevel;
  activeModel?: string;
  desktopMessageTimeline: PersistedDesktopTimelineTurnSnapshot[];
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  sessionTitleSource?: SessionTitleSource;
  workspaceRoot?: string;
  gitBranch?: string;
  activePlanPath?: string;
  rewind?: StoredDesktopRewindMetadata;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopTimelines?: Record<string, PersistedDesktopTimelineTurnSnapshot[]>;
  queuedUserTurns?: import("./message-queue.js").QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}

export type DesktopHostCommitRequest = CommitChangesRequest;
