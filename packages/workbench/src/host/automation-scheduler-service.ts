import type { JsonObject } from "@spiritagent/agent-core";

import {
  automationTimeScheduleFromTrigger,
  createHostAutomationStore,
  shouldFireNow,
  type AutomationRunTriggerContext,
  type HostAutomationDefinition,
  type HostAutomationRun,
} from "@spiritagent/automations";
import type {
  AutomationTriggerPollOutput,
  AutomationTriggerPollTarget,
  AutomationTriggerProviderEvent,
  RegisteredAutomationTriggerContribution,
} from "@spiritagent/automations/trigger-provider";
import type { GitHubAutomationPollMatch } from "@spiritagent/github";

import { cloneDesktopConfig } from "@spiritagent/sessions/host/service-utils";
import { modelExistsInProvider } from "@spiritagent/config";
import { spiritDataDir, type DesktopConfigFile } from "@spiritagent/sessions/host/storage";
import { runDesktopAutomationOnce } from "./automation-runner.js";
import { pollGitHubAutomationTriggerProvider } from "./github-automation-trigger-provider.js";

export const AUTOMATION_SCHEDULER_MONITOR_INTERVAL_MS = 60_000;
export const AUTOMATION_TRIGGER_PROVIDER_TIMEOUT_MS = 45_000;

export interface AutomationRunOnceRequest {
  definition: HostAutomationDefinition;
  config: DesktopConfigFile;
  triggerContext?: AutomationRunTriggerContext;
  triggerEvent?: { id: string; checkpoint: JsonObject };
}

export interface AutomationSchedulerServiceContext {
  initialized(): boolean;
  config(): DesktopConfigFile | undefined;
  runningAutomationIds(): ReadonlySet<string>;
  markAutomationRunning(automationId: string, running: boolean): void;
  onAutomationUpdated(automationId: string): void;
  notifySessionListUpdated(): void;
  syncSessionFromDisk?(sessionPath: string): void | Promise<void>;
  listAutomationTriggerContributions(): Promise<RegisteredAutomationTriggerContribution[]>;
  pollAutomationTrigger(request: {
    extensionId: string;
    contributionId: string;
    triggers: AutomationTriggerPollTarget[];
    signal: AbortSignal;
  }): Promise<AutomationTriggerPollOutput>;
  trackAutomationTriggerPoll?(ownerId: string, controller: AbortController): () => void;
  runAutomationOnce?(request: AutomationRunOnceRequest): Promise<HostAutomationRun | undefined>;
  automationTriggerPollTimeoutMs?: number;
}

type SchedulerStore = ReturnType<typeof createHostAutomationStore>;
type RegisteredProvider = RegisteredAutomationTriggerContribution & {
  poll(input: {
    triggers: AutomationTriggerPollTarget[];
    signal: AbortSignal;
  }): Promise<AutomationTriggerPollOutput>;
};

const schedulerTicks = new WeakMap<AutomationSchedulerServiceContext, Promise<void>>();

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

export async function failDanglingAutomationRuns(
  store: SchedulerStore,
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

export function tickAutomationScheduler(ctx: AutomationSchedulerServiceContext): Promise<void> {
  const current = schedulerTicks.get(ctx);
  if (current) {
    return current;
  }
  const tick = runAutomationSchedulerTick(ctx).finally(() => {
    schedulerTicks.delete(ctx);
  });
  schedulerTicks.set(ctx, tick);
  return tick;
}

async function runAutomationSchedulerTick(ctx: AutomationSchedulerServiceContext): Promise<void> {
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
    await tickContributedAutomationTriggers(ctx, store, definitions, config);
  } catch {
    /* A provider or persistence failure must not block time triggers in this tick. */
  }
  await tickTimeAutomationTriggers(ctx, store, definitions, config, now);
}

async function tickTimeAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: SchedulerStore,
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

async function tickContributedAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: SchedulerStore,
  definitions: HostAutomationDefinition[],
  config: DesktopConfigFile,
): Promise<void> {
  const contributions = await ctx.listAutomationTriggerContributions();
  const providers = new Map<string, RegisteredProvider>();
  for (const contribution of contributions) {
    providers.set(contribution.kind, {
      ...contribution,
      poll: ({ triggers, signal }) =>
        ctx.pollAutomationTrigger({
          extensionId: contribution.extensionId,
          contributionId: contribution.contributionId,
          triggers,
          signal,
        }),
    });
  }
  providers.set("github", {
    kind: "github",
    extensionId: "github",
    contributionId: "github",
    id: "github",
    name: "GitHub",
    description: "GitHub repository events",
    icon: { type: "spirit", name: "globe" },
    inputSchema: { type: "object" },
    poll: pollGitHubAutomationTriggerProvider,
  });

  const groups = new Map<string, HostAutomationDefinition[]>();
  for (const definition of definitions) {
    if (definition.trigger.kind === "time") {
      continue;
    }
    const provider = providers.get(definition.trigger.kind);
    if (!provider) {
      await store.setTriggerError(
        definition.id,
        `Automation trigger provider is unavailable: ${definition.trigger.kind}`,
      );
      ctx.onAutomationUpdated(definition.id);
      continue;
    }
    const group = groups.get(definition.trigger.kind) ?? [];
    group.push(definition);
    groups.set(definition.trigger.kind, group);
  }

  for (const [kind, group] of groups) {
    const provider = providers.get(kind)!;
    const targets: AutomationTriggerPollTarget[] = [];
    const targetDefinitions = new Map<string, HostAutomationDefinition>();
    for (const definition of group) {
      if (ctx.runningAutomationIds().has(definition.id)) {
        continue;
      }
      if (await store.getActiveRun(definition.id)) {
        continue;
      }
      targets.push(automationTriggerPollTarget(definition));
      targetDefinitions.set(definition.id, definition);
    }
    if (targets.length === 0) {
      continue;
    }

    const output = await pollProviderWithTimeout(provider, targets, ctx);
    if (!output) {
      continue;
    }
    const results = new Map(output.results.map((result) => [result.automationId, result]));
    for (const target of targets) {
      const definition = targetDefinitions.get(target.automationId)!;
      const result = results.get(target.automationId);
      if (!result) {
        await store.setTriggerError(definition.id, "The trigger provider returned no result.");
        ctx.onAutomationUpdated(definition.id);
        continue;
      }
      if (result.error?.trim()) {
        await store.setTriggerError(definition.id, result.error.trim());
        ctx.onAutomationUpdated(definition.id);
        continue;
      }

      const initializing = target.state === undefined;
      if (initializing) {
        if (result.checkpoint) {
          await store.updateAutomationTriggerCheckpoint(definition.id, result.checkpoint);
        } else {
          await store.setTriggerError(
            definition.id,
            "The trigger provider did not return a baseline checkpoint.",
          );
        }
        ctx.onAutomationUpdated(definition.id);
        continue;
      }

      const events = result.events ?? [];
      if (events.length === 0) {
        if (result.checkpoint) {
          await store.updateAutomationTriggerCheckpoint(definition.id, result.checkpoint);
        } else {
          await store.setTriggerError(definition.id, undefined);
        }
        ctx.onAutomationUpdated(definition.id);
        continue;
      }
      if (!validProviderEvents(events)) {
        await store.setTriggerError(definition.id, "The trigger provider returned invalid events.");
        ctx.onAutomationUpdated(definition.id);
        continue;
      }

      for (const event of events) {
        const latest = (await store.get(definition.id))?.definition;
        if (
          !latest ||
          latest.trigger.kind === "time" ||
          ctx.runningAutomationIds().has(definition.id)
        ) {
          break;
        }
        if (await store.getActiveRun(definition.id)) {
          break;
        }
        const context = automationRunTriggerContext(latest, event);
        const run = await launchAutomationRun(ctx, store, {
          definition: latest,
          config,
          context,
          triggerEvent: { id: event.id, checkpoint: event.checkpoint },
        });
        if (!run || run.status !== "completed") {
          break;
        }
      }
    }
  }
}

function automationTriggerPollTarget(
  definition: HostAutomationDefinition,
): AutomationTriggerPollTarget {
  if (definition.trigger.kind === "github") {
    return {
      automationId: definition.id,
      config: {
        owner: definition.trigger.owner,
        repo: definition.trigger.repo,
        event: definition.trigger.event,
      },
      ...(definition.trigger.poll
        ? { state: { lastSeenNumber: definition.trigger.poll.lastSeenNumber } }
        : {}),
    };
  }
  if (definition.trigger.kind === "time") {
    throw new Error("Time triggers do not have a provider poll target.");
  }
  return {
    automationId: definition.id,
    config: definition.trigger.config,
    ...(definition.trigger.state ? { state: definition.trigger.state } : {}),
  };
}

function automationRunTriggerContext(
  definition: HostAutomationDefinition,
  event: AutomationTriggerProviderEvent,
): AutomationRunTriggerContext {
  if (definition.trigger.kind === "github") {
    const url = typeof event.context?.url === "string" ? event.context.url : event.id;
    return { kind: "github", event: definition.trigger.event, eventUrl: url };
  }
  if (definition.trigger.kind === "time") {
    return { kind: "time" };
  }
  return {
    kind: "extension",
    summary: event.summary,
    ...(event.context ? { context: event.context } : {}),
  };
}

function validProviderEvents(events: readonly AutomationTriggerProviderEvent[]): boolean {
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.id.trim() || !event.summary.trim() || ids.has(event.id)) {
      return false;
    }
    if (
      event.checkpoint === null ||
      typeof event.checkpoint !== "object" ||
      Array.isArray(event.checkpoint)
    ) {
      return false;
    }
    ids.add(event.id);
  }
  return true;
}

async function pollProviderWithTimeout(
  provider: RegisteredProvider,
  triggers: AutomationTriggerPollTarget[],
  ctx: AutomationSchedulerServiceContext,
): Promise<AutomationTriggerPollOutput | undefined> {
  const controller = new AbortController();
  const ownerId = provider.extensionId;
  const untrack = ctx.trackAutomationTriggerPoll?.(ownerId, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ctx.automationTriggerPollTimeoutMs ?? AUTOMATION_TRIGGER_PROVIDER_TIMEOUT_MS);
  timer.unref?.();
  try {
    const output = await provider.poll({ triggers, signal: controller.signal });
    if (timedOut) {
      return {
        results: triggers.map((trigger) => ({
          automationId: trigger.automationId,
          error: "Automation trigger poll timed out.",
        })),
      };
    }
    return controller.signal.aborted ? undefined : output;
  } catch (error) {
    if (controller.signal.aborted && !timedOut) {
      return undefined;
    }
    const message = timedOut
      ? "Automation trigger poll timed out."
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      results: triggers.map((trigger) => ({ automationId: trigger.automationId, error: message })),
    };
  } finally {
    clearTimeout(timer);
    untrack?.();
  }
}

async function launchAutomationRun(
  ctx: AutomationSchedulerServiceContext,
  store: SchedulerStore,
  input: {
    definition: HostAutomationDefinition;
    config: DesktopConfigFile;
    context: AutomationRunTriggerContext;
    triggerEvent?: { id: string; checkpoint: JsonObject };
    markFiredAtUnixMs?: number;
  },
): Promise<HostAutomationRun | undefined> {
  ctx.markAutomationRunning(input.definition.id, true);
  try {
    const request: AutomationRunOnceRequest = {
      definition: input.definition,
      config: cloneDesktopConfig(input.config),
      triggerContext: input.context,
      ...(input.triggerEvent ? { triggerEvent: input.triggerEvent } : {}),
    };
    const run = ctx.runAutomationOnce
      ? await ctx.runAutomationOnce(request)
      : await runDesktopAutomationOnce(request, {
          onRunUpdated: (automationId) => ctx.onAutomationUpdated(automationId),
          notifySessionListUpdated: () => ctx.notifySessionListUpdated(),
          syncSessionFromDisk: (sessionPath) => ctx.syncSessionFromDisk?.(sessionPath),
        });
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

export function runGitHubMatchesAndCollectConsumed(
  matches: GitHubAutomationPollMatch[],
  launch: (match: GitHubAutomationPollMatch) => Promise<HostAutomationRun | undefined>,
): Promise<GitHubAutomationPollMatch[]> {
  return (async () => {
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
  })();
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
