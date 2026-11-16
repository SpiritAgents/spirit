import { explainGitHubApiError } from "./api-error.js";
import type {
  AutomationTriggerPollOutput,
  AutomationTriggerPollTarget,
  AutomationTriggerProviderEvent,
} from "@spiritagent/automations/trigger-provider";
import type { HostAutomationGitHubEvent } from "./automation-types.js";
import {
  fetchRepositoryMaxIssueNumber,
  filterNewHostAutomationGitHubEvents,
  githubAutomationRepoKey,
  listRepositoryIssuesForAutomation,
} from "./automation-events.js";

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
  if (
    lastSeenNumber !== undefined &&
    (typeof lastSeenNumber !== "number" ||
      !Number.isSafeInteger(lastSeenNumber) ||
      lastSeenNumber < 0)
  ) {
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

/** Poll once per repository and checkpoint only events consumed by the scheduler. */
export async function pollGitHubAutomationTriggerProvider(input: {
  triggers: AutomationTriggerPollTarget[];
  signal: AbortSignal;
  loadAccessToken: () => Promise<string | undefined>;
  clearAuthorization: () => Promise<void>;
}): Promise<AutomationTriggerPollOutput> {
  const accessToken = await input.loadAccessToken();
  if (!accessToken) {
    return {
      results: input.triggers.map((trigger) => ({
        automationId: trigger.automationId,
        error: "Connect GitHub before running this Automation.",
      })),
    };
  }

  const targets: GitHubTarget[] = [];
  const results: AutomationTriggerPollOutput["results"] = [];
  for (const trigger of input.triggers) {
    try {
      targets.push(githubTarget(trigger));
    } catch (error) {
      results.push({
        automationId: trigger.automationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
    let pending = group;
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
      pending = initialized;
      if (initialized.length === 0) {
        continue;
      }
      const sinceNumber = Math.min(
        ...initialized.map((target) => target.lastSeenNumber ?? Number.MAX_SAFE_INTEGER),
      );
      const fetchedItems = await listRepositoryIssuesForAutomation(accessToken, owner, repo, {
        sinceNumber,
        signal: input.signal,
      });
      // Concurrent repository activity can shift REST page boundaries between requests.
      const items = [...new Map(fetchedItems.map((item) => [item.number, item])).values()];
      for (const target of initialized) {
        const lastSeenNumber = target.lastSeenNumber ?? 0;
        const events = filterNewHostAutomationGitHubEvents(
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
      input.signal.throwIfAborted();
      const message = (await explainGitHubApiError(error, input.clearAuthorization)).message;
      for (const target of pending) {
        results.push({ automationId: target.automationId, error: message });
      }
    }
  }
  return { results };
}
