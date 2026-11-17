import { explainGitHubApiError } from "./api-error.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { assertGitHubPullRequestMergeMethod, mergePullRequest } from "./pull-request-merge.js";
import { findOpenPullRequestForHead, getPullRequestDetail } from "./pull-request.js";
import { getPullRequestConversation } from "./conversation.js";
import { getPullRequestFiles } from "./pull-request-files.js";
import { getPullRequestCommits } from "./pull-request-commits.js";
import { getPullRequestChecks } from "./pull-request-checks.js";
import { markPullRequestReadyForReview } from "./pull-request-ready.js";
import { listPullRequests, getPullRequestTabCounts } from "./pull-request-list.js";
import { listUserGitHubRepositories, searchGitHubRepositories } from "./automation-repositories.js";
import { GitHubOAuthError } from "./oauth.js";
import { parseGitHubRemoteUrl } from "./remote.js";
import type {
  GitHubAuthStatus,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestDetail,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestForBranchResult,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestMergeResult,
  GitHubPullRequestTabCounts,
  GitHubRepositoryRef,
} from "./types.js";

import type {
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  GitHubAutomationRepositoriesSnapshot,
  ListGitHubAutomationRepositoriesRequest,
  ListGitHubPullRequestsRequest,
  MergeGitHubPullRequestRequest,
  SearchGitHubAutomationRepositoriesRequest,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "./types.js";
const execFileAsync = promisify(execFile);

export interface GitHubWorkspaceContext {
  workspaceRoot: string;
  branch: string;
}
export interface GitHubCredentialReader {
  token(): Promise<string | undefined>;
  status(): Promise<GitHubAuthStatus>;
  clear(): Promise<void>;
}

export function createGitHubService(
  auth: GitHubCredentialReader,
  options: { readOrigin?: (root: string) => Promise<string | null> } = {},
) {
  const loadGitHubAccessToken = () => auth.token();
  const getGitHubAuthStatusFromStorage = () => auth.status();
  const clearGitHubOAuthCredentials = () => auth.clear();
  async function getGitHubAuthStatusCommand(): Promise<GitHubAuthStatus> {
    return getGitHubAuthStatusFromStorage();
  }

  async function readGitOriginRemoteUrl(workspaceRoot: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: workspaceRoot,
        windowsHide: true,
      });
      const trimmed = stdout.trim();
      return trimmed || null;
    } catch {
      return null;
    }
  }

  const handleGitHubApiError = (error: unknown) =>
    explainGitHubApiError(error, clearGitHubOAuthCredentials);

  async function requireGitHubAccessToken(): Promise<string> {
    const accessToken = await loadGitHubAccessToken();
    if (!accessToken) {
      throw new Error("Connect GitHub before querying pull requests.");
    }
    return accessToken;
  }

  function parsePullRequestRepositoryRequest(
    request: GetGitHubPullRequestDetailRequest,
  ): GitHubRepositoryRef & { number: number } {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    const number = request.number;
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Pull request owner, repository, and number are required.");
    }
    return { owner, repo, number };
  }

  async function getGitHubPullRequestForCurrentBranchCommand(
    ctx: GitHubWorkspaceContext,
  ): Promise<GitHubPullRequestForBranchResult> {
    const branch = ctx.branch.trim() || null;
    if (!ctx.workspaceRoot) {
      return {
        repository: null,
        branch,
        pullRequest: null,
      };
    }

    const remoteUrl = await (options.readOrigin ?? readGitOriginRemoteUrl)(ctx.workspaceRoot);
    const repository = remoteUrl ? parseGitHubRemoteUrl(remoteUrl) : null;
    if (!repository) {
      return {
        repository: null,
        branch,
        pullRequest: null,
      };
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      const pullRequest = branch
        ? await findOpenPullRequestForHead(accessToken, repository, branch)
        : null;
      return {
        repository,
        branch,
        pullRequest,
      };
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestDetailCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestDetail> {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    const number = request.number;
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Pull request owner, repository, and number are required.");
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestDetail(accessToken, { owner, repo }, number);
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestConversationCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestConversationSnapshot> {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    const number = request.number;
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Pull request owner, repository, and number are required.");
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestConversation(accessToken, { owner, repo }, number, {
        timelinePage: request.conversationTimelinePage,
        reviewCommentsPage: request.conversationReviewCommentsPage,
        commitsPage: request.conversationCommitsPage,
        knownCommits: request.conversationKnownCommits,
        previousNextTimelinePage: request.conversationPreviousNextTimelinePage,
        previousNextReviewCommentsPage: request.conversationPreviousNextReviewCommentsPage,
        previousNextCommitsPage: request.conversationPreviousNextCommitsPage,
      });
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestFilesCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestFilesSnapshot> {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    const number = request.number;
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Pull request owner, repository, and number are required.");
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestFiles(accessToken, { owner, repo }, number);
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestCommitsCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestCommitsSnapshot> {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    const number = request.number;
    if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
      throw new Error("Pull request owner, repository, and number are required.");
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestCommits(accessToken, { owner, repo }, number);
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestChecksCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestChecksSnapshot> {
    const { owner, repo, number } = parsePullRequestRepositoryRequest(request);
    const checksAfter = request.checksAfter?.trim() || undefined;

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestChecks(
        accessToken,
        { owner, repo },
        number,
        checksAfter ? { after: checksAfter } : {},
      );
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function mergeGitHubPullRequestCommand(
    request: MergeGitHubPullRequestRequest,
  ): Promise<GitHubPullRequestMergeResult> {
    const { owner, repo, number } = parsePullRequestRepositoryRequest(request);
    const mergeMethod = assertGitHubPullRequestMergeMethod(request.mergeMethod);

    try {
      const accessToken = await requireGitHubAccessToken();
      return await mergePullRequest(accessToken, { owner, repo }, number, { mergeMethod });
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function markGitHubPullRequestReadyCommand(
    request: GetGitHubPullRequestDetailRequest,
  ): Promise<GitHubPullRequestDetail> {
    const { owner, repo, number } = parsePullRequestRepositoryRequest(request);

    try {
      const accessToken = await requireGitHubAccessToken();
      const nodeId =
        request.nodeId?.trim() ||
        (await getPullRequestDetail(accessToken, { owner, repo }, number)).nodeId;
      if (!nodeId) {
        throw new Error("Pull request node ID is unavailable.");
      }
      await markPullRequestReadyForReview(accessToken, nodeId);
      return await getPullRequestDetail(accessToken, { owner, repo }, number);
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  function parseGitHubRepositoryRequest(
    request: GetGitHubPullRequestTabCountsRequest | ListGitHubPullRequestsRequest,
  ): GitHubRepositoryRef {
    const owner = request.owner.trim();
    const repo = request.repo.trim();
    if (!owner || !repo) {
      throw new Error("Pull request owner and repository are required.");
    }
    return { owner, repo };
  }

  async function listGitHubPullRequestsCommand(
    request: ListGitHubPullRequestsRequest,
  ): Promise<GitHubPullRequestListSnapshot> {
    const repository = parseGitHubRepositoryRequest(request);
    if (request.state !== "open" && request.state !== "closed") {
      throw new Error("Pull request list state must be open or closed.");
    }

    try {
      const accessToken = await requireGitHubAccessToken();
      return await listPullRequests(accessToken, {
        ...repository,
        state: request.state,
        ...(request.page && request.page > 0 ? { page: request.page } : {}),
        ...(request.query?.trim() ? { query: request.query.trim() } : {}),
      });
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function getGitHubPullRequestTabCountsCommand(
    request: GetGitHubPullRequestTabCountsRequest,
  ): Promise<GitHubPullRequestTabCounts> {
    const repository = parseGitHubRepositoryRequest(request);

    try {
      const accessToken = await requireGitHubAccessToken();
      return await getPullRequestTabCounts(accessToken, repository);
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function listGitHubAutomationRepositoriesCommand(
    request: ListGitHubAutomationRepositoriesRequest = {},
  ): Promise<GitHubAutomationRepositoriesSnapshot> {
    try {
      const accessToken = await requireGitHubAccessToken();
      const page = request.page && request.page > 0 ? request.page : 1;
      const result = await listUserGitHubRepositories(accessToken, { page });
      return {
        items: result.items,
        hasNextPage: result.hasNextPage,
      };
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  async function searchGitHubAutomationRepositoriesCommand(
    request: SearchGitHubAutomationRepositoriesRequest,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot> {
    try {
      const accessToken = await requireGitHubAccessToken();
      const status = await getGitHubAuthStatusFromStorage();
      const login = status.login?.trim();
      if (!login) {
        throw new GitHubOAuthError("GitHub login is unavailable.", 401);
      }
      const page = request.page && request.page > 0 ? request.page : 1;
      const result = await searchGitHubRepositories(accessToken, request.query ?? "", login, {
        page,
      });
      return {
        items: result.items,
        totalCount: result.totalCount,
      };
    } catch (error) {
      throw await handleGitHubApiError(error);
    }
  }

  return {
    getGitHubAuthStatus: getGitHubAuthStatusCommand,
    getGitHubPullRequestForCurrentBranch: getGitHubPullRequestForCurrentBranchCommand,
    getGitHubPullRequestDetail: getGitHubPullRequestDetailCommand,
    getGitHubPullRequestConversation: getGitHubPullRequestConversationCommand,
    getGitHubPullRequestFiles: getGitHubPullRequestFilesCommand,
    getGitHubPullRequestCommits: getGitHubPullRequestCommitsCommand,
    getGitHubPullRequestChecks: getGitHubPullRequestChecksCommand,
    mergeGitHubPullRequest: mergeGitHubPullRequestCommand,
    markGitHubPullRequestReady: markGitHubPullRequestReadyCommand,
    listGitHubPullRequests: listGitHubPullRequestsCommand,
    getGitHubPullRequestTabCounts: getGitHubPullRequestTabCountsCommand,
    listGitHubAutomationRepositories: listGitHubAutomationRepositoriesCommand,
    searchGitHubAutomationRepositories: searchGitHubAutomationRepositoriesCommand,
  };
}

export type GitHubService = ReturnType<typeof createGitHubService>;
