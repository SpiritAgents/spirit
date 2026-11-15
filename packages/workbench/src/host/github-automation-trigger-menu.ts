import type {
  AutomationTriggerMenuItem,
  AutomationTriggerMenuPage,
} from "@spiritagent/automations/trigger-provider";
import {
  listGitHubAutomationRepositoriesCommand,
  searchGitHubAutomationRepositoriesCommand,
} from "@spiritagent/github/commands";

const GITHUB_PAGE_SIZE = 30;

export async function resolveGitHubAutomationTriggerMenu(input: {
  path: string[];
  query?: string;
  page: number;
}): Promise<AutomationTriggerMenuPage> {
  if (input.path.length === 1) {
    const repository = input.path[0]!;
    const [owner, repo] = repository.split("/", 2);
    if (!owner || !repo) {
      throw new Error("Invalid GitHub repository menu path.");
    }
    return {
      items: [
        {
          action: "select",
          id: "pull_request_created",
          label: "PR created",
          config: { owner, repo, event: "pull_request_created" },
        },
        {
          action: "select",
          id: "issue_created",
          label: "Issue created",
          config: { owner, repo, event: "issue_created" },
        },
      ],
    };
  }
  if (input.path.length > 0) {
    throw new Error("Invalid GitHub Automation trigger menu path.");
  }

  const query = input.query?.trim() ?? "";
  const page = input.page;
  if (query) {
    const snapshot = await searchGitHubAutomationRepositoriesCommand({ query, page });
    return {
      items: snapshot.items.map(repositoryMenuItem),
      searchPlaceholder: "Search repositories",
      hasMore:
        snapshot.items.length >= GITHUB_PAGE_SIZE && page * GITHUB_PAGE_SIZE < snapshot.totalCount,
    };
  }
  const snapshot = await listGitHubAutomationRepositoriesCommand({ page });
  return {
    items: snapshot.items.map(repositoryMenuItem),
    searchPlaceholder: "Search repositories",
    hasMore: snapshot.hasNextPage,
  };
}

function repositoryMenuItem(repository: { fullName: string }): AutomationTriggerMenuItem {
  return {
    action: "submenu",
    id: repository.fullName,
    label: repository.fullName,
  };
}
