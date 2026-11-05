import {
  DEFAULT_BACKGROUND_DELAY_SECONDS,
  isBackgroundTaskTerminal,
  validateWaitSeconds,
  type BackgroundOptions,
  type BackgroundTaskCreateInput,
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
  type DelayRequest,
} from "../background-tasks.js";
import { createToolExecutionTextOutput, type ToolExecutionOutput } from "../ports.js";

export interface TaskScope {
  runtimeId: string;
  parentTaskId?: string;
}

export interface SessionTaskContext {
  taskId: string;
  signal: AbortSignal;
  writeOutput(text: string): Promise<void>;
  update(
    metadata: Partial<
      Pick<
        BackgroundTaskRecord,
        "sessionId" | "sessionTranscript" | "worktreePath" | "worktreeBranch"
      >
    >,
    status?: "running" | "blocked" | "waiting-for-background",
  ): Promise<void>;
}

export interface SessionTaskResult {
  output: ToolExecutionOutput;
  failed?: boolean;
  exitCode?: number;
}

export interface SessionTaskManagerOptions {
  sessionKey: string;
  store: BackgroundTaskStore;
  onChanged?(record: BackgroundTaskRecord): void;
  onOutput?(record: BackgroundTaskRecord, chunk: string): void;
  onError(error: Error, taskId: string): void;
}

interface TaskEntry {
  record: BackgroundTaskRecord;
  startedAt: number;
  checkpointAt: number;
  controller: AbortController;
  mutations: Promise<void>;
  completion: Promise<SessionTaskResult>;
  resolve(result: SessionTaskResult): void;
  reject(error: unknown): void;
  initialDelivered: boolean;
  settled: boolean;
  failure?: Error;
  stopping: boolean;
}

export type SessionTaskInitialResult =
  | { kind: "completed"; record: BackgroundTaskRecord; result: SessionTaskResult }
  | { kind: "background"; record: BackgroundTaskRecord; outputTail: string };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Long waits use bounded timer slices rather than the platform's overflowing timeout coercion. */
export function waitForTaskDelay(seconds: number, signal?: AbortSignal): Promise<void> {
  validateWaitSeconds(seconds);
  signal?.throwIfAborted();
  const deadline = performance.now() + seconds * 1000;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error("Delay cancelled."));
    };
    const tick = (): void => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        cleanup();
        resolve();
      } else {
        timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    tick();
  });
}

export class SessionTaskManager {
  private readonly entries = new Map<string, TaskEntry>();
  private readonly restored = new Map<string, BackgroundTaskRecord>();
  private closing = false;

  constructor(private readonly options: SessionTaskManagerOptions) {}

  async restore(): Promise<void> {
    for (const record of await this.options.store.list()) {
      if (record.sessionKey !== this.options.sessionKey) throw new Error("Task session mismatch.");
      if (!this.entries.has(record.id)) this.restored.set(record.id, record);
    }
  }

  records(): BackgroundTaskRecord[] {
    return [
      ...this.restored.values(),
      ...[...this.entries.values()].map((entry) => entry.record),
    ].map((record) => structuredClone(record));
  }

  private getRecord(taskId: string, scope: TaskScope): BackgroundTaskRecord {
    const record = this.entries.get(taskId)?.record ?? this.restored.get(taskId);
    if (!record) throw new Error(`Unknown background task: ${taskId}`);
    if (!this.isAccessible(record, scope))
      throw new Error(`Task ${taskId} belongs to another agent.`);
    return record;
  }

  private isAccessible(record: BackgroundTaskRecord, scope: TaskScope): boolean {
    if (!scope.parentTaskId || record.runtimeId === scope.runtimeId) return true;
    let parentId = record.parentTaskId;
    while (parentId) {
      if (parentId === scope.parentTaskId) return true;
      const parent = this.entries.get(parentId)?.record ?? this.restored.get(parentId);
      parentId = parent?.parentTaskId;
    }
    return false;
  }

  private mutate(entry: TaskEntry, action: () => Promise<void>): Promise<void> {
    const next = entry.mutations.then(action);
    entry.mutations = next;
    void next.catch((error: unknown) => {
      if (!entry.failure) {
        entry.failure = asError(error);
        entry.controller.abort(entry.failure);
      }
    });
    return next;
  }

  private timedRecord(entry: TaskEntry): BackgroundTaskRecord {
    return {
      ...entry.record,
      elapsedMs: Math.max(entry.record.elapsedMs, performance.now() - entry.startedAt),
      updatedAtUnixMs: Date.now(),
    };
  }

  private releaseResult(entry: TaskEntry): void {
    if (entry.initialDelivered && entry.settled && !entry.failure) {
      this.restored.set(entry.record.id, entry.record);
      this.entries.delete(entry.record.id);
    }
  }

  async launch(
    input: Omit<BackgroundTaskCreateInput, "sessionKey">,
    run: (context: SessionTaskContext) => Promise<SessionTaskResult>,
  ): Promise<string> {
    if (this.closing) throw new Error("The task host is shutting down.");
    const record = await this.options.store.create({
      ...input,
      sessionKey: this.options.sessionKey,
    });
    let resolve!: TaskEntry["resolve"];
    let reject!: TaskEntry["reject"];
    const completion = new Promise<SessionTaskResult>((resolveResult, rejectResult) => {
      resolve = resolveResult;
      reject = rejectResult;
    });
    const entry: TaskEntry = {
      record,
      startedAt: performance.now(),
      checkpointAt: performance.now(),
      controller: new AbortController(),
      mutations: Promise.resolve(),
      completion,
      resolve,
      reject,
      stopping: this.closing,
      initialDelivered: false,
      settled: false,
    };
    if (this.closing) entry.controller.abort(new Error("The task host is shutting down."));
    this.entries.set(record.id, entry);
    void entry.completion.catch((error: unknown) =>
      this.options.onError(asError(error), record.id),
    );
    const context: SessionTaskContext = {
      taskId: record.id,
      signal: entry.controller.signal,
      writeOutput: (text) =>
        this.mutate(entry, async () => {
          await this.options.store.appendOutput(record.id, text);
          this.options.onOutput?.(structuredClone(entry.record), text);
        }),
      update: (metadata, status) =>
        this.mutate(entry, async () => {
          if (isBackgroundTaskTerminal(entry.record.status)) throw new Error("Task has finished.");
          const next = { ...this.timedRecord(entry), ...metadata };
          if (status) next.status = status;
          await this.options.store.save(next);
          entry.record = next;
          this.options.onChanged?.(structuredClone(next));
        }),
    };
    void (async () => {
      let result: SessionTaskResult;
      try {
        await context.update({}, "running");
        context.signal.throwIfAborted();
        result = await run(context);
      } catch (error) {
        result = {
          output: createToolExecutionTextOutput(`[task error] ${asError(error).message}`),
          failed: true,
        };
      }
      try {
        if (result.failed || entry.controller.signal.aborted) {
          await this.stopDescendants(record.id, { runtimeId: record.runtimeId });
        }
        await this.mutate(entry, async () => {
          const next = this.timedRecord(entry);
          next.status = entry.stopping ? "stopped" : result.failed ? "failed" : "completed";
          next.endedAtUnixMs = next.updatedAtUnixMs;
          next.terminalEventId = `${next.id}:${next.status}`;
          if (result.exitCode !== undefined) next.exitCode = result.exitCode;
          if (result.failed) next.error = result.output.summaryText;
          await this.options.store.save(next);
          entry.record = next;
          this.options.onChanged?.(structuredClone(next));
        });
        entry.settled = true;
        entry.resolve(result);
        this.releaseResult(entry);
      } catch (error) {
        entry.settled = true;
        entry.record = { ...entry.record, status: "failed", error: asError(error).message };
        delete entry.record.terminalEventId;
        entry.reject(error);
      }
    })();
    return record.id;
  }

  async initialResult(
    taskId: string,
    scope: TaskScope,
    background?: BackgroundOptions,
  ): Promise<SessionTaskInitialResult> {
    this.getRecord(taskId, scope);
    const entry = this.entries.get(taskId);
    if (!entry) throw new Error(`Task ${taskId} is not owned by this host instance.`);
    try {
      return await this.deliverInitialResult(entry, background);
    } finally {
      entry.initialDelivered = true;
      this.releaseResult(entry);
    }
  }

  private async deliverInitialResult(
    entry: TaskEntry,
    background?: BackgroundOptions,
  ): Promise<SessionTaskInitialResult> {
    if (background?.type === false) {
      const result = await entry.completion;
      return { kind: "completed", record: structuredClone(entry.record), result };
    }
    const timer = new AbortController();
    let timedOut = false;
    let handoffRecord: BackgroundTaskRecord | undefined;
    try {
      timedOut = await Promise.race([
        entry.completion.then(() => false),
        waitForTaskDelay(background?.delay ?? DEFAULT_BACKGROUND_DELAY_SECONDS, timer.signal).then(
          () => true,
        ),
      ]);
    } finally {
      timer.abort();
    }
    if (timedOut) {
      await this.mutate(entry, async () => {
        if (isBackgroundTaskTerminal(entry.record.status)) return;
        const next = { ...this.timedRecord(entry), background: true };
        await this.options.store.save(next);
        entry.record = next;
        handoffRecord = structuredClone(next);
        this.options.onChanged?.(structuredClone(next));
      });
    }
    if (!entry.record.background) {
      const result = await entry.completion;
      return { kind: "completed", record: structuredClone(entry.record), result };
    }
    return {
      kind: "background",
      record: handoffRecord ?? structuredClone(entry.record),
      outputTail: await this.options.store.readOutputTail(entry.record.id, 16_384),
    };
  }

  async checkpoint(): Promise<void> {
    const now = performance.now();
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (
          isBackgroundTaskTerminal(entry.record.status) ||
          entry.failure ||
          now - entry.checkpointAt < 1000
        )
          return;
        entry.checkpointAt = now;
        await this.mutate(entry, async () => {
          if (isBackgroundTaskTerminal(entry.record.status)) return;
          const next = this.timedRecord(entry);
          await this.options.store.save(next);
          entry.record = next;
        });
      }),
    );
  }

  hasActive(scope: TaskScope): boolean {
    return this.records().some(
      (record) => this.isAccessible(record, scope) && !isBackgroundTaskTerminal(record.status),
    );
  }

  pendingNotifications(scope: TaskScope): BackgroundTaskRecord[] {
    return this.records().filter(
      (record) =>
        record.runtimeId === scope.runtimeId &&
        record.background &&
        isBackgroundTaskTerminal(record.status) &&
        record.terminalEventId &&
        !record.notificationDelivered,
    );
  }

  async markNotified(taskId: string, scope: TaskScope): Promise<void> {
    const record = this.getRecord(taskId, scope);
    if (!isBackgroundTaskTerminal(record.status)) throw new Error("Task has not finished.");
    const entry = this.entries.get(taskId);
    const mark = async (): Promise<void> => {
      const next = { ...record, notificationDelivered: true };
      await this.options.store.save(next);
      if (entry) entry.record = next;
      else this.restored.set(taskId, next);
    };
    if (entry) await this.mutate(entry, mark);
    else await mark();
  }

  async delay(
    request: DelayRequest,
    scope: TaskScope,
    signal?: AbortSignal,
  ): Promise<{
    elapsedSeconds: number;
    task?: BackgroundTaskRecord;
  }> {
    const startedAt = performance.now();
    let completion: Promise<SessionTaskResult> | undefined;
    if (request.task_id) {
      const record = this.getRecord(request.task_id, scope);
      if (!isBackgroundTaskTerminal(record.status)) {
        const entry = this.entries.get(record.id);
        if (!entry) throw new Error(`Task ${record.id} is owned by another host instance.`);
        completion = entry.completion;
      } else {
        return { elapsedSeconds: 0, task: structuredClone(record) };
      }
    }
    if (request.seconds === undefined && !completion)
      throw new Error("Provide seconds, task_id, or both.");
    const cancelWait = new AbortController();
    const abort = (): void => cancelWait.abort(signal?.reason);
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const wait = waitForTaskDelay(request.seconds ?? Number.MAX_VALUE, cancelWait.signal);
      await (completion ? Promise.race([completion, wait]) : wait);
    } finally {
      cancelWait.abort();
      signal?.removeEventListener("abort", abort);
    }
    return {
      elapsedSeconds: (performance.now() - startedAt) / 1000,
      ...(request.task_id ? { task: structuredClone(this.getRecord(request.task_id, scope)) } : {}),
    };
  }

  async stop(taskId: string, scope: TaskScope): Promise<BackgroundTaskRecord> {
    const record = this.getRecord(taskId, scope);
    if (isBackgroundTaskTerminal(record.status)) return structuredClone(record);
    const entry = this.entries.get(taskId);
    if (!entry) throw new Error(`Task ${taskId} is owned by another host instance.`);
    entry.stopping = true;
    entry.controller.abort(new Error(`Task ${taskId} stopped.`));
    await this.stopDescendants(taskId, scope);
    await entry.completion;
    return structuredClone(entry.record);
  }

  private async stopDescendants(taskId: string, scope: TaskScope): Promise<void> {
    await Promise.all(
      this.records()
        .filter((child) => child.parentTaskId === taskId && !isBackgroundTaskTerminal(child.status))
        .map((child) => this.stop(child.id, scope)),
    );
  }

  async stopForeground(scope: TaskScope): Promise<void> {
    await Promise.all(
      this.records()
        .filter(
          (record) =>
            record.runtimeId === scope.runtimeId &&
            !record.background &&
            !isBackgroundTaskTerminal(record.status),
        )
        .map((record) => this.stop(record.id, scope)),
    );
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    await this.cancelOwnedWork();
  }

  async cancelOwnedWork(): Promise<void> {
    const results = await Promise.allSettled(
      this.records()
        .filter((record) => this.entries.has(record.id) && !isBackgroundTaskTerminal(record.status))
        .map((record) => this.stop(record.id, { runtimeId: record.runtimeId })),
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Background task shutdown failed.");
  }
}

export function formatTaskInitialResult(
  result: Extract<SessionTaskInitialResult, { kind: "background" }>,
): string {
  return [
    `Task ${result.record.status}.`,
    `task_id: ${result.record.id}`,
    `output_path: ${JSON.stringify(result.record.outputPath)}`,
    ...(result.record.sessionId ? [`sessionId: ${result.record.sessionId}`] : []),
    ...(result.record.sessionTranscript
      ? [`sessionTranscript: ${JSON.stringify(result.record.sessionTranscript)}`]
      : []),
    ...(result.record.worktreePath
      ? [`worktree_path: ${JSON.stringify(result.record.worktreePath)}`]
      : []),
    `elapsed_seconds: ${result.record.elapsedMs / 1000}`,
    "Use delay to wait, read_file to inspect the output, or stop_task to stop it.",
    ...(result.outputTail ? ["", "Latest output:", result.outputTail] : []),
  ].join("\n");
}
