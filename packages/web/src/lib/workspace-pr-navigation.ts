import {
  addWorkspaceToolTab,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  type WorkspaceToolTab,
} from "@/lib/workspace-tool-tabs";

export type GitHubPullRequestRevealRequest = {
  owner: string;
  repo: string;
  number: number;
};

export type ResolveWorkspacePrTabResult = {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  prTabId: string;
};

/** Pick active PR tab, else first PR tab, else create one. */
export function resolveWorkspacePrTab(
  tabs: readonly WorkspaceToolTab[],
  activeTabId: string,
): ResolveWorkspacePrTabResult {
  const activeTab = findWorkspaceToolTab(tabs, activeTabId);
  if (activeTab?.kind === "pr") {
    return { tabs: [...tabs], activeTabId, prTabId: activeTabId };
  }

  const firstPrId = focusFirstTabOfKind(tabs, "pr");
  if (firstPrId) {
    return { tabs: [...tabs], activeTabId: firstPrId, prTabId: firstPrId };
  }

  const added = addWorkspaceToolTab(tabs, "pr");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    prTabId: added.activeId,
  };
}

export type OpenPullRequestNavigationInput = {
  tabs: readonly WorkspaceToolTab[];
  activeTabId: string;
  request: GitHubPullRequestRevealRequest;
};

export type OpenPullRequestNavigationResult = ResolveWorkspacePrTabResult & {
  request: GitHubPullRequestRevealRequest;
};

export function buildOpenPullRequestNavigation(
  input: OpenPullRequestNavigationInput,
): OpenPullRequestNavigationResult {
  const resolved = resolveWorkspacePrTab(input.tabs, input.activeTabId);
  return {
    ...resolved,
    request: input.request,
  };
}
