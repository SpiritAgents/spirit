import { explainGitHubApiError } from "./api-error.js";
import type {
  AutomationTriggerProvider,
  AutomationTriggerMenuItem,
} from "@spiritagent/automations/trigger-provider";
import { matchLocaleTag } from "@spiritagent/i18n";
import { resources } from "./locales.js";
import { getRepositoryPermissions } from "./repository-permissions.js";
import { pollGitHubAutomationTriggerProvider } from "./extension-poller.js";
import type { GitHubService, GitHubCredentialReader } from "./service.js";

function parseConfig(value: Record<string, unknown>) {
  const owner = typeof value.owner === "string" ? value.owner.trim() : "";
  const repo = typeof value.repo === "string" ? value.repo.trim() : "";
  const event = value.event;
  if (
    !owner ||
    !repo ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    (event !== "pull_request_created" && event !== "issue_created")
  )
    throw new Error("Invalid GitHub Automation trigger configuration.");
  return { owner, repo, event };
}
function labels(locale?: string) {
  return resources[matchLocaleTag(locale ?? "en") ?? "en"].translation.automations.trigger;
}

export function createGitHubAutomationProvider(
  service: GitHubService,
  auth: GitHubCredentialReader,
): AutomationTriggerProvider {
  return {
    async validate(input) {
      const config = parseConfig(input.config);
      const token = await auth.token();
      if (!token) throw new Error("Authorize GitHub before creating a repository Automation.");
      try {
        await getRepositoryPermissions(token, config);
      } catch (error) {
        throw await explainGitHubApiError(error, auth.clear);
      }
      const label = labels(input.locale);
      return {
        config,
        label: `GitHub · ${config.owner}/${config.repo} · ${config.event === "pull_request_created" ? label.pullRequestCreated : label.issueCreated}`,
      };
    },
    async menu(input) {
      const label = labels(input.locale);
      if (input.path.length === 1) {
        const parts = input.path[0].split("/");
        if (parts.length !== 2) throw new Error("Invalid repository menu path.");
        const [owner, repo] = parts;
        return {
          items: [
            {
              action: "select",
              id: "pull_request_created",
              label: label.pullRequestCreated,
              config: parseConfig({ owner, repo, event: "pull_request_created" }),
            },
            {
              action: "select",
              id: "issue_created",
              label: label.issueCreated,
              config: parseConfig({ owner, repo, event: "issue_created" }),
            },
          ],
        };
      }
      if (input.path.length) throw new Error("Invalid repository menu path.");
      const query = input.query?.trim();
      const item = (repository: { fullName: string }): AutomationTriggerMenuItem => ({
        action: "submenu",
        id: repository.fullName,
        label: repository.fullName,
      });
      if (query) {
        const snapshot = await service.searchGitHubAutomationRepositories({
          query,
          page: input.page,
        });
        return {
          items: snapshot.items.map(item),
          searchPlaceholder: label.repositorySearchPlaceholder,
          hasMore: input.page * 30 < snapshot.totalCount && snapshot.items.length >= 30,
        };
      }
      const snapshot = await service.listGitHubAutomationRepositories({ page: input.page });
      return {
        items: snapshot.items.map(item),
        searchPlaceholder: label.repositorySearchPlaceholder,
        hasMore: snapshot.hasNextPage,
      };
    },
    poll: (input) =>
      pollGitHubAutomationTriggerProvider({
        triggers: input.triggers,
        signal: input.signal,
        loadAccessToken: auth.token,
        clearAuthorization: auth.clear,
      }),
  };
}
