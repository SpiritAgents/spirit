import { createGitHubService } from "./service.js";
import {
  loadGitHubAccessToken,
  getGitHubAuthStatusFromStorage,
  clearGitHubOAuthCredentials,
} from "./auth-storage.js";
import {
  beginGitHubDeviceLogin,
  completeGitHubDeviceLogin,
  cancelGitHubDeviceLogin,
} from "./oauth-bridge.js";
import type { DesktopGitSnapshot } from "./types.js";
const service = createGitHubService({
  token: loadGitHubAccessToken,
  status: getGitHubAuthStatusFromStorage,
  clear: clearGitHubOAuthCredentials,
});
export interface HostGitHubCommandContext {
  workspaceRoot: string;
  git: DesktopGitSnapshot;
}
export const beginGitHubDeviceLoginCommand = beginGitHubDeviceLogin;
export async function completeGitHubDeviceLoginCommand() {
  const result = await completeGitHubDeviceLogin();
  return { connected: true, login: result.login };
}
export const cancelGitHubDeviceLoginCommand = cancelGitHubDeviceLogin;
export async function disconnectGitHubCommand() {
  cancelGitHubDeviceLogin();
  await clearGitHubOAuthCredentials();
  return { connected: false };
}
export function getGitHubPullRequestForCurrentBranchCommand(context: HostGitHubCommandContext) {
  return service.getGitHubPullRequestForCurrentBranch({
    workspaceRoot: context.workspaceRoot,
    branch: context.git.selectedBranch?.trim() || context.git.branch?.trim() || "",
  });
}
export const getGitHubAuthStatusCommand = service.getGitHubAuthStatus;
export const getGitHubPullRequestDetailCommand = service.getGitHubPullRequestDetail;
export const getGitHubPullRequestConversationCommand = service.getGitHubPullRequestConversation;
export const getGitHubPullRequestFilesCommand = service.getGitHubPullRequestFiles;
export const getGitHubPullRequestCommitsCommand = service.getGitHubPullRequestCommits;
export const getGitHubPullRequestChecksCommand = service.getGitHubPullRequestChecks;
export const mergeGitHubPullRequestCommand = service.mergeGitHubPullRequest;
export const markGitHubPullRequestReadyCommand = service.markGitHubPullRequestReady;
export const listGitHubPullRequestsCommand = service.listGitHubPullRequests;
export const getGitHubPullRequestTabCountsCommand = service.getGitHubPullRequestTabCounts;
export const listGitHubAutomationRepositoriesCommand = service.listGitHubAutomationRepositories;
export const searchGitHubAutomationRepositoriesCommand = service.searchGitHubAutomationRepositories;
