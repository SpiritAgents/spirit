import {
  automationTimeScheduleFromTrigger,
  baselineGitHubAutomationWatermark,
  computeGitHubPollMatchesForRepoGroup,
  createHostAutomationStore,
  fetchGitHubAutomationRepoItems,
  githubTriggerNeedsBaseline,
  groupGitHubAutomationsByRepo,
  mergeGitHubPollWatermarkUpdates,
  resolveGitHubPollWatermark,
  shouldFireNow,
  type AutomationRunTriggerContext,
  type GitHubAutomationPollMatch,
  type HostAutomationDefinition,
  type HostAutomationRun,
} from "@spiritagent/host-internal";

import { cloneDesktopConfig } from "./service-utils.js";
import { modelExistsInProvider } from "@spiritagent/host-internal";
import { loadGitHubAccessToken } from "./github-auth-storage.js";
import { spiritDataDir, type DesktopConfigFile } from "./storage.js";
import { runDesktopAutomationOnce } from "./automation-runner.js";

export const AUTOMATION_SCHEDULER_MONITOR_INTERVAL_MS = 60_000;

export interface AutomationSchedulerServiceContext {
  initialized(): boolean;
  config(): DesktopConfigFile | undefined;
  runningAutomationIds(): ReadonlySet<string>;
  markAutomationRunning(automationId: string, running: boolean): void;
  onAutomationUpdated(automationId: string): void;
  notifySessionListUpdated(): void;
  syncSessionFromDisk?(sessionPath: string): void | Promise<void>;
}

export function startAutomationSchedulerMonitorIfNeeded(
  currentTimer: ReturnType<typeof setInterval> | undefined,
  setTimer: (timer: ReturnType<typeof setInterval>) => void,
  ctx: AutomationSchedulerServiceContext,
): void {
  if (currentTimer) {
    return;
  }

  const timer = setInterval(() => {
    void tickAutomationScheduler(ctx);
  }, AUTOMATION_SCHEDULER_MONITOR_INTERVAL_MS);
  timer.unref?.();
  setTimer(timer);
  void (async () => {
    try {
      const affected = await failDanglingAutomationRuns(
        createHostAutomationStore(spiritDataDir()),
        "Run interrupted: application exited before the run completed.",
      );
      for (const automationId of affected) {
        ctx.onAutomationUpdated(automationId);
      }
    } catch {
      /* cleanup failure must not block the first tick */
    }
    await tickAutomationScheduler(ctx);
  })();
}

/**
 * Marks leftover running runs on disk as failed. Run state is only advanced by this process, so a
 * running run on disk at scheduler startup is necessarily a leftover from the last crash; without cleanup,
 * getActiveRun would permanently block later triggers of that automation. Returns the affected automation ids.
 */
export async function failDanglingAutomationRuns(
  store: ReturnType<typeof createHostAutomationStore>,
  error: string,
): Promise<string[]> {
  const summaries = await store.listSummaries();
  const affected: string[] = [];
  for (const summary of summaries) {
    const loaded = await store.get(summary.id);
    if (!loaded) {
      continue;
    }
    const runningRuns = loaded.runs.filter((run) => run.status === "running");
    if (runningRuns.length === 0) {
      continue;
    }
    for (const run of runningRuns) {
      await store.updateRun(summary.id, run.id, {
        status: "failed",
        completedAtUnixMs: Date.now(),
        error,
      });
    }
    affected.push(summary.id);
  }
  return affected;
}

export async function tickAutomationScheduler(
  ctx: AutomationSchedulerServiceContext,
): Promise<void> {
  if (!ctx.initialized()) {
    return;
  }

  const config = ctx.config();
  if (!config) {
    return;
  }

  const store = createHostAutomationStore(spiritDataDir());
  const definitions = await store.listEnabledDefinitions();
  const now = Date.now();

  try {
    await tickGitHubAutomationTriggers(ctx, store, definitions, config);
  } catch {
    /* GitHub poll failures must not block time triggers in the same tick. */
  }
  await tickTimeAutomationTriggers(ctx, store, definitions, config, now);
}

async function tickTimeAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  definitions: HostAutomationDefinition[],
  config: DesktopConfigFile,
  now: number,
): Promise<void> {
  for (const definition of definitions) {
    if (definition.trigger.kind !== "time") {
      continue;
    }
    if (ctx.runningAutomationIds().has(definition.id)) {
      continue;
    }
    const activeRun = await store.getActiveRun(definition.id);
    if (activeRun) {
      continue;
    }
    const schedule = automationTimeScheduleFromTrigger(definition.trigger);
    // Fall back to the creation time as the baseline: a newly created automation does not backfill times before its creation.
    const firedBaseline = definition.lastFiredAtUnixMs ?? definition.createdAtUnixMs;
    if (!schedule || !shouldFireNow(schedule, firedBaseline, now)) {
      continue;
    }

    void launchAutomationRun(ctx, store, {
      definition,
      config,
      context: { kind: "time" },
      markFiredAtUnixMs: now,
    });
  }
}

async function tickGitHubAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  definitions: HostAutomationDefinition[],
  config: DesktopConfigFile,
): Promise<void> {
  const githubDefinitions = definitions.filter(
    (definition) => definition.trigger.kind === "github",
  );
  if (githubDefinitions.length === 0) {
    return;
  }

  const accessToken = await loadGitHubAccessToken();
  if (!accessToken) {
    return;
  }

  for (const definition of githubDefinitions) {
    if (!githubTriggerNeedsBaseline(definition.trigger)) {
      continue;
    }
    if (definition.trigger.kind !== "github") {
      continue;
    }
    try {
      const lastSeenNumber = await baselineGitHubAutomationWatermark(
        accessToken,
        definition.trigger.owner,
        definition.trigger.repo,
      );
      await store.ensureGitHubTriggerBaseline(definition.id, lastSeenNumber);
    } catch {
      /* Skip baseline for this automation; do not abort the rest of the tick. */
    }
  }

  const refreshed = await store.listEnabledDefinitions();
  const groups = groupGitHubAutomationsByRepo(
    refreshed.filter((definition) => definition.trigger.kind === "github"),
  );

  for (const group of groups) {
    const minWatermark = Math.min(
      ...group.automations.map((definition) =>
        definition.trigger.kind === "github"
          ? resolveGitHubPollWatermark(definition.trigger)
          : Number.MAX_SAFE_INTEGER,
      ),
    );
    let items;
    try {
      items = await fetchGitHubAutomationRepoItems(accessToken, group.owner, group.repo, {
        sinceNumber: Number.isFinite(minWatermark) ? minWatermark : 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const definition of group.automations) {
        try {
          await store.setGitHubPollError(definition.id, message);
        } catch {
          /* ignore per-automation persistence errors */
        }
      }
      continue;
    }

    for (const definition of group.automations) {
      try {
        await store.setGitHubPollError(definition.id, undefined);
      } catch {
        /* ignore per-automation persistence errors */
      }
    }

    const matches = computeGitHubPollMatchesForRepoGroup(group, items);
    const matchesByAutomation = groupGitHubPollMatchesByAutomation(matches);
    for (const [automationId, automationMatches] of matchesByAutomation) {
      if (ctx.runningAutomationIds().has(automationId)) {
        continue;
      }
      const activeRun = await store.getActiveRun(automationId);
      if (activeRun) {
        continue;
      }

      const consumedMatches = await runGitHubMatchesAndCollectConsumed(
        automationMatches,
        async (match) => {
          if (ctx.runningAutomationIds().has(automationId)) {
            return undefined;
          }
          const latestDefinition = refreshed.find(
            (definition) => definition.id === match.automationId,
          );
          if (!latestDefinition || latestDefinition.trigger.kind !== "github") {
            return undefined;
          }
          return launchAutomationRun(ctx, store, {
            definition: latestDefinition,
            config,
            context: {
              kind: "github",
              event: latestDefinition.trigger.event,
              eventUrl: match.item.htmlUrl,
            },
          });
        },
      );

      const watermarkUpdates = mergeGitHubPollWatermarkUpdates(consumedMatches);
      const nextWatermark = watermarkUpdates.get(automationId);
      if (nextWatermark !== undefined) {
        await store.updateGitHubPollState(automationId, nextWatermark);
      }
    }
  }
}

/**
 * Launches a run for each matched event in order, returning the "consumed" matches (used to advance the watermark).
 * Semantics: once a run is created for an event (completed / blocked / failed), the event counts
 * as consumed and is not retried — blocked waits for user takeover, failed leaves a failure record;
 * without advancing the watermark, every tick would endlessly recreate runs and session files. launch returning
 * undefined means no run could be created at all (concurrent race or stale definition); stop then without consuming.
 * Also stop processing later events when a run is not completed, to avoid piling up runs in an abnormal state.
 */
export async function runGitHubMatchesAndCollectConsumed(
  matches: GitHubAutomationPollMatch[],
  launch: (match: GitHubAutomationPollMatch) => Promise<HostAutomationRun | undefined>,
): Promise<GitHubAutomationPollMatch[]> {
  const consumed: GitHubAutomationPollMatch[] = [];
  for (const match of matches) {
    const run = await launch(match);
    if (!run) {
      break;
    }
    consumed.push(match);
    if (run.status !== "completed") {
      break;
    }
  }
  return consumed;
}

export function groupGitHubPollMatchesByAutomation(
  matches: GitHubAutomationPollMatch[],
): Map<string, GitHubAutomationPollMatch[]> {
  const grouped = new Map<string, GitHubAutomationPollMatch[]>();
  for (const match of matches) {
    const existing = grouped.get(match.automationId);
    if (existing) {
      existing.push(match);
      continue;
    }
    grouped.set(match.automationId, [match]);
  }
  return grouped;
}

async function launchAutomationRun(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  input: {
    definition: HostAutomationDefinition;
    config: DesktopConfigFile;
    context: AutomationRunTriggerContext;
    markFiredAtUnixMs?: number;
  },
): Promise<HostAutomationRun | undefined> {
  ctx.markAutomationRunning(input.definition.id, true);
  try {
    const run = await runDesktopAutomationOnce(
      {
        definition: input.definition,
        config: cloneDesktopConfig(input.config),
        triggerContext: input.context,
      },
      {
        onRunUpdated: (automationId) => ctx.onAutomationUpdated(automationId),
        notifySessionListUpdated: () => ctx.notifySessionListUpdated(),
        syncSessionFromDisk: (sessionPath) => ctx.syncSessionFromDisk?.(sessionPath),
      },
    );
    if (run && input.markFiredAtUnixMs !== undefined) {
      await store.markFired(input.definition.id, input.markFiredAtUnixMs);
    }
    return run;
  } catch {
    return undefined;
  } finally {
    ctx.markAutomationRunning(input.definition.id, false);
    ctx.onAutomationUpdated(input.definition.id);
  }
}

export function automationDefinitionNeedsApiKey(
  definition: HostAutomationDefinition,
  config: DesktopConfigFile,
): boolean {
  return modelExistsInProvider(
    config.providers,
    definition.modelRef.providerId,
    definition.modelRef.name,
  );
}
