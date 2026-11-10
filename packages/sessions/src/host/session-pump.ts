import type { SessionBundle } from "./session-bundle.js";
import { shouldAdvanceWorktreeBootstrap } from "./worktree-bootstrap-orchestrator.js";

/** Pump tick interval: sets the minimum cadence for streaming-event consumption and UI pushes. */
export const SESSION_PUMP_INTERVAL_MS = 25;

/** Throttled push interval for live snapshots (leading+trailing). */
export const LIVE_SNAPSHOT_EMIT_THROTTLE_MS = 33;

/** Heartbeat push interval while busy with no changes (host-state animations like the spinner / timer depend on pushes to refresh). */
export const LIVE_SNAPSHOT_BUSY_HEARTBEAT_MS = 150;

/** Sidebar listSessions refresh interval while background sessions are busy. */
export const SESSION_LIST_NOTIFY_INTERVAL_MS = 1_000;

/** Same tick condition as pollCommand: runtime busy or a worktree bootstrap pending advancement. */
export function sessionBundleNeedsPumpTick(bundle: SessionBundle): boolean {
  return bundle.runtime?.isBusy() === true || shouldAdvanceWorktreeBootstrap(bundle);
}

/** Env var `SPIRIT_DESKTOP_PUMP_DEBUG`: when set to 1/true/on, logs pump start/stop, tick rate, and push rate statistics. */
export function pumpDebugEnabled(): boolean {
  const raw = process.env.SPIRIT_DESKTOP_PUMP_DEBUG?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

const PUMP_DEBUG_STATS_INTERVAL_MS = 5_000;

export interface SessionPumpOptions {
  /** True while any session still needs pump ticks; pump stops when false. */
  hasPumpWork(): boolean;
  /** One serialized pump tick (advance runtimes, integrate events). */
  runTick(): Promise<void>;
  intervalMs?: number;
  onTickError?(error: unknown): void;
}

/**
 * Self-driven main-process pump: turn advancement for busy sessions no longer depends on the renderer poll loop.
 * Any entry command that makes a session busy calls ensureRunning(), and the pump ticks at a fixed interval until everything is idle.
 */
export class SessionPump {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private debugTickCount = 0;
  private debugTickDurationMs = 0;
  private debugWindowStartedAtMs = 0;

  constructor(private readonly options: SessionPumpOptions) {}

  get intervalMs(): number {
    return this.options.intervalMs ?? SESSION_PUMP_INTERVAL_MS;
  }

  isRunning(): boolean {
    return this.running;
  }

  ensureRunning(): void {
    if (this.running) {
      return;
    }
    if (!this.options.hasPumpWork()) {
      return;
    }
    this.running = true;
    if (pumpDebugEnabled()) {
      console.warn("[desktop-host][pump] start");
      this.debugTickCount = 0;
      this.debugTickDurationMs = 0;
      this.debugWindowStartedAtMs = Date.now();
    }
    this.scheduleNext(0);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.running = false;
  }

  private scheduleNext(delayMs: number): void {
    const timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delayMs);
    // The pump must not keep the main process alive (Electron quit / test process exit).
    timer.unref?.();
    this.timer = timer;
  }

  private async tick(): Promise<void> {
    const startedAtMs = Date.now();
    try {
      await this.options.runTick();
    } catch (error) {
      this.options.onTickError?.(error);
    }
    if (pumpDebugEnabled()) {
      this.debugTickCount += 1;
      this.debugTickDurationMs += Date.now() - startedAtMs;
      const windowMs = Date.now() - this.debugWindowStartedAtMs;
      if (windowMs >= PUMP_DEBUG_STATS_INTERVAL_MS) {
        const hz = (this.debugTickCount / windowMs) * 1_000;
        const avgMs = this.debugTickDurationMs / Math.max(1, this.debugTickCount);
        console.warn(
          `[desktop-host][pump] ticks=${this.debugTickCount} rate=${hz.toFixed(1)}/s avgTick=${avgMs.toFixed(1)}ms`,
        );
        this.debugTickCount = 0;
        this.debugTickDurationMs = 0;
        this.debugWindowStartedAtMs = Date.now();
      }
    }
    if (!this.running) {
      return;
    }
    if (!this.options.hasPumpWork()) {
      this.running = false;
      if (pumpDebugEnabled()) {
        console.warn("[desktop-host][pump] idle, stop");
      }
      return;
    }
    this.scheduleNext(this.intervalMs);
  }
}
