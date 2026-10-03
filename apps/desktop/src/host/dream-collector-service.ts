import i18n from "../lib/i18n-host.js";
import type { DesktopDreamCollectorSnapshot, DesktopGitSnapshot } from "../types.js";
import type { DesktopConfigFile, HostMetadataSummary } from "./storage.js";
import {
  buildDreamCollectorPlanMetadata,
  DREAM_COLLECTOR_BACKOFF_MS,
  DREAM_COLLECTOR_MONITOR_INTERVAL_MS,
  DREAM_COLLECTOR_TICK_INTERVAL_MS,
  emptyDreamCollectorSnapshot,
  runDesktopDreamCollectorOnce,
} from "./dreams.js";
import { resolveSecondaryLanguageModelProfile } from "./secondary-language-model.js";
import { cloneDesktopConfig } from "./service-utils.js";

interface DreamCollectorState {
  workspaceRoot: string;
  git: DesktopGitSnapshot;
  config: DesktopConfigFile;
  metadata: HostMetadataSummary;
}

export interface DreamCollectorServiceContext {
  state(): DreamCollectorState | undefined;
  initialized(): boolean;
  runtimeBusy(): boolean;
  running(): boolean;
  setRunning(running: boolean): void;
  lastTickUnixMs(): number;
  setLastTickUnixMs(value: number): void;
  status(): DesktopDreamCollectorSnapshot;
  setStatus(next: DesktopDreamCollectorSnapshot): void;
  runSerialized<T>(work: () => Promise<T>, label?: string): Promise<T>;
  activeBundle(): { deferredRuntimeRefreshWhileBusy: boolean };
  refreshRuntime(): Promise<void>;
  clearLastRuntimeError(): void;
}

export function startDreamCollectorIfNeeded(ctx: DreamCollectorServiceContext): void {
  const state = ctx.state();
  if (!state) {
    return;
  }

  const settings = state.config.dreams;
  const now = Date.now();
  if (!settings.enabled) {
    ctx.setStatus(emptyDreamCollectorSnapshot("disabled"));
    return;
  }
  const secondaryModel = resolveSecondaryLanguageModelProfile(state.config);
  if (!secondaryModel) {
    ctx.setStatus({
      ...emptyDreamCollectorSnapshot("missing-model"),
      lastError: i18n.t("error.lightweightChatModelNotConfigured"),
    });
    return;
  }
  if (!state.git.isRepository || !state.git.branch) {
    ctx.setStatus(emptyDreamCollectorSnapshot("idle"));
    return;
  }
  if (ctx.runtimeBusy() || ctx.running()) {
    return;
  }
  const backoffUntilUnixMs = ctx.status().backoffUntilUnixMs;
  if (backoffUntilUnixMs !== undefined && now < backoffUntilUnixMs) {
    ctx.setStatus({
      ...ctx.status(),
      state: "backoff",
    });
    return;
  }
  if (now - ctx.lastTickUnixMs() < DREAM_COLLECTOR_TICK_INTERVAL_MS) {
    return;
  }

  ctx.setLastTickUnixMs(now);
  ctx.setRunning(true);
  ctx.setStatus({
    ...ctx.status(),
    state: "running",
    lastRunAtUnixMs: now,
    pendingCount: ctx.status().pendingCount,
    processedCount: ctx.status().processedCount,
  });

  const collectorInput = {
    workspaceRoot: state.workspaceRoot,
    gitBranch: state.git.branch,
    collectorModel: secondaryModel.profile.ref,
    config: cloneDesktopConfig(state.config),
    planMetadata: buildDreamCollectorPlanMetadata(state.metadata.planMetadata),
  };

  void runDesktopDreamCollectorOnce(collectorInput, {
    getStatus: () => ctx.status(),
    setStatus: (next) => ctx.setStatus(next),
  })
    .catch((error) => {
      const backoffUntilUnixMs = Date.now() + DREAM_COLLECTOR_BACKOFF_MS;
      ctx.setStatus({
        ...ctx.status(),
        state: "backoff",
        lastError: error instanceof Error ? error.message : String(error),
        backoffUntilUnixMs,
      });
    })
    .finally(() => {
      ctx.setRunning(false);
      void ctx.runSerialized(async () => {
        if (!ctx.initialized() || !ctx.state()) {
          return;
        }
        if (ctx.runtimeBusy()) {
          ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
          return;
        }
        ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
        await ctx.refreshRuntime();
        ctx.clearLastRuntimeError();
      });
    });
}

export function startDreamCollectorMonitorIfNeeded(
  currentTimer: ReturnType<typeof setInterval> | undefined,
  setTimer: (timer: ReturnType<typeof setInterval>) => void,
  ctx: DreamCollectorServiceContext,
): void {
  if (currentTimer) {
    return;
  }

  const timer = setInterval(() => {
    void ctx.runSerialized(async () => {
      if (!ctx.initialized() || !ctx.state() || ctx.runtimeBusy()) {
        return;
      }
      startDreamCollectorIfNeeded(ctx);
    });
  }, DREAM_COLLECTOR_MONITOR_INTERVAL_MS);
  timer.unref?.();
  setTimer(timer);
}
