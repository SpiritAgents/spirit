import type {
  AutomationTriggerPollOutput,
  AutomationTriggerPollTarget,
  AutomationTriggerProviderEvent,
} from "@spiritagent/automations/trigger-provider";
import type { HostAutomationGitHubEvent } from "@spiritagent/github/automation-types";
import {
  fetchRepositoryMaxIssueNumber,
  filterNewGitHubAutomationEvents,
  githubAutomationRepoKey,
  listRepositoryIssuesForAutomation,
} from "@spiritagent/github";
import { loadGitHubAccessToken } from "@spiritagent/github/auth-storage";

type GitHubTarget = AutomationTriggerPollTarget & {
  config: { owner: string; repo: string; event: HostAutomationGitHubEvent };
  lastSeenNumber?: number;
};

function githubTarget(target: AutomationTriggerPollTarget): GitHubTarget {
  const { owner, repo, event } = target.config;
  if (
    typeof owner !== "string" ||
    typeof repo !== "string" ||
    (event !== "pull_request_created" && event !== "issue_created")
  ) {
    throw new Error("Invalid GitHub Automation trigger config.");
  }
  const lastSeenNumber = target.state?.lastSeenNumber;
  if (lastSeenNumber !== undefined && typeof lastSeenNumber !== "number") {
    throw new Error("Invalid GitHub Automation trigger checkpoint.");
  }
  return {
    ...target,
    config: { owner, repo, event },
    ...(lastSeenNumber === undefined ? {} : { lastSeenNumber }),
  };
}

function providerEvent(target: GitHubTarget, item: { number: number; htmlUrl: string }) {
  const label =
    target.config.event === "pull_request_created" ? "Pull request created" : "Issue created";
  return {
    id: item.htmlUrl,
    summary: `${label} (${item.htmlUrl}).`,
    context: {
      owner: target.config.owner,
      repo: target.config.repo,
      event: target.config.event,
      number: item.number,
      url: item.htmlUrl,
    },
    checkpoint: { lastSeenNumber: item.number },
  } satisfies AutomationTriggerProviderEvent;
}

/** Adapts the existing GitHub poller to the shared provider contract without changing its persistence. */
export async function pollGitHubAutomationTriggerProvider(input: {
  triggers: AutomationTriggerPollTarget[];
  signal: AbortSignal;
  loadAccessToken?: () => Promise<string | undefined>;
}): Promise<AutomationTriggerPollOutput> {
  const accessToken = await (input.loadAccessToken ?? loadGitHubAccessToken)();
  if (!accessToken) {
    return {
      results: input.triggers.map((trigger) => ({
        automationId: trigger.automationId,
        error: "Connect GitHub before running this Automation.",
      })),
    };
  }

  const targets = input.triggers.map(githubTarget);
  const results: AutomationTriggerPollOutput["results"] = [];
  const groups = new Map<string, GitHubTarget[]>();
  for (const target of targets) {
    const key = githubAutomationRepoKey(target.config.owner, target.config.repo);
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const first = group[0]!;
    const { owner, repo } = first.config;
    try {
      const uninitialized = group.filter((target) => target.lastSeenNumber === undefined);
      if (uninitialized.length > 0) {
        const lastSeenNumber = await fetchRepositoryMaxIssueNumber(accessToken, owner, repo, {
          signal: input.signal,
        });
        for (const target of uninitialized) {
          results.push({
            automationId: target.automationId,
            checkpoint: { lastSeenNumber },
          });
        }
      }

      const initialized = group.filter((target) => target.lastSeenNumber !== undefined);
      if (initialized.length === 0) {
        continue;
      }
      const sinceNumber = Math.min(
        ...initialized.map((target) => target.lastSeenNumber ?? Number.MAX_SAFE_INTEGER),
      );
      const items = await listRepositoryIssuesForAutomation(accessToken, owner, repo, {
        sinceNumber,
        signal: input.signal,
      });
      for (const target of initialized) {
        const lastSeenNumber = target.lastSeenNumber ?? 0;
        const events = filterNewGitHubAutomationEvents(
          items,
          target.config.event,
          lastSeenNumber,
        ).map((item) => providerEvent(target, item));
        results.push({
          automationId: target.automationId,
          ...(events.length > 0 ? { events } : { checkpoint: { lastSeenNumber } }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const target of group) {
        results.push({ automationId: target.automationId, error: message });
      }
    }
  }
  return { results };
}
