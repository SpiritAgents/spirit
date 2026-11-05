import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTaskRecord, BackgroundTaskStore } from "../background-tasks.js";
import {
  createToolExecutionTextOutput,
  llmMessageTextContent,
  type ToolAgentRoundCompletion,
  type ToolCallRequest,
  type ToolRequestExecutionMetadata,
} from "../ports.js";
import { AgentRuntime } from "../runtime.js";
import {
  HostExecutor,
  SubagentTransport,
  createScriptedState,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  extractScriptedAssistantText,
  type ScriptedState,
  type ScriptedToolRequest,
} from "../smoke/cases/runtime/parity/harness.js";
import { SessionTaskManager, waitForTaskDelay } from "./session-tasks.js";

function fixture() {
  let nextId = 0;
  const records = new Map<string, BackgroundTaskRecord>();
  const outputs = new Map<string, string>();
  const store: BackgroundTaskStore = {
    async create(input) {
      const id = `task_${(++nextId).toString(16).padStart(12, "0")}`;
      const record: BackgroundTaskRecord = {
        ...input,
        version: 1,
        id,
        owner: { id: "test", pid: 100 },
        status: "starting",
        background: false,
        outputPath: `/tasks/${id}.log`,
        startedAtUnixMs: Date.now(),
        updatedAtUnixMs: Date.now(),
        elapsedMs: 0,
      };
      records.set(id, structuredClone(record));
      outputs.set(id, "");
      return record;
    },
    async save(record) {
      records.set(record.id, structuredClone(record));
    },
    async appendOutput(id, text) {
      outputs.set(id, outputs.get(id) + text);
    },
    async readOutputTail(id, size) {
      return outputs.get(id)!.slice(-size);
    },
    async list() {
      return [...records.values()].map((record) => structuredClone(record));
    },
  };
  const errors = vi.fn();
  const manager = new SessionTaskManager({ sessionKey: "test", store, onError: errors });
  const scope = { runtimeId: "main" };
  const input = {
    runtimeId: "main",
    toolCallId: "call",
    kind: "shell" as const,
    input: "build",
    argumentsJson: "{}",
  };
  const done = { output: createToolExecutionTextOutput("done"), exitCode: 0 };
  return { manager, store, records, outputs, errors, scope, input, done };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
});
afterEach(() => vi.useRealTimers());

describe("session task lifecycle", () => {
  it("returns final output without a duplicate notification when work finishes in the initial wait", async () => {
    const { manager, input, done, scope } = fixture();
    const id = await manager.launch(input, async () => {
      await waitForTaskDelay(2);
      return done;
    });
    const initial = manager.initialResult(id, scope);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await initial).toMatchObject({ kind: "completed", result: done });
    expect(manager.pendingNotifications(scope)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("detaches after the default 30 seconds and keeps one terminal notification", async () => {
    const { manager, input, done, scope } = fixture();
    const id = await manager.launch(input, async (context) => {
      await context.writeOutput("before detach");
      await waitForTaskDelay(35, context.signal);
      await context.writeOutput("\nafter detach");
      return done;
    });
    const initial = manager.initialResult(id, scope);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await initial).toMatchObject({ kind: "background", outputTail: "before detach" });
    await manager.stopForeground(scope);
    expect(manager.hasActive(scope)).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(manager.pendingNotifications(scope)).toHaveLength(1);
    expect(manager.pendingNotifications(scope)[0]).toMatchObject({
      status: "completed",
      elapsedMs: 35000,
      exitCode: 0,
    });
    await manager.markNotified(id, scope);
    expect(manager.pendingNotifications(scope)).toEqual([]);
  });

  it("keeps explicitly foreground tasks in the foreground regardless of delay", async () => {
    const { manager, input, done, scope } = fixture();
    const id = await manager.launch(input, async (context) => {
      await waitForTaskDelay(60, context.signal);
      return done;
    });
    const initial = manager.initialResult(id, scope, { type: false, delay: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(manager.records()[0]!.background).toBe(false);
    await manager.stopForeground(scope);
    expect(await initial).toMatchObject({ kind: "completed", record: { status: "stopped" } });
    expect(manager.pendingNotifications(scope)).toEqual([]);
  });

  it("waits indefinitely for a task or returns early from a bounded wait with actual elapsed time", async () => {
    const { manager, input, done, scope } = fixture();
    const id = await manager.launch(input, async () => {
      await waitForTaskDelay(5);
      return done;
    });
    await manager.initialResult(id, scope, { delay: 0 });
    const indefinite = manager.delay({ task_id: id }, scope);
    const bounded = manager.delay({ task_id: id, seconds: 100 }, scope);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await indefinite).toMatchObject({ elapsedSeconds: 5, task: { status: "completed" } });
    expect(await bounded).toMatchObject({ elapsedSeconds: 5, task: { status: "completed" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a bounded task wait without cancelling the task", async () => {
    const { manager, input, done, scope } = fixture();
    const id = await manager.launch(input, async (context) => {
      await waitForTaskDelay(10, context.signal);
      return done;
    });
    await manager.initialResult(id, scope, { delay: 0 });
    const delay = manager.delay({ task_id: id, seconds: 2 }, scope);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await delay).toMatchObject({ elapsedSeconds: 2, task: { status: "running" } });
    expect(manager.hasActive(scope)).toBe(true);
    await manager.shutdown();
  });

  it("stops owned descendants and rejects sibling task access", async () => {
    const { manager, input, done, scope } = fixture();
    const run = async ({ signal }: { signal: AbortSignal }) => {
      await waitForTaskDelay(100, signal);
      return done;
    };
    const parent = await manager.launch({ ...input, kind: "subagent" }, run);
    const child = await manager.launch({ ...input, runtimeId: "child", parentTaskId: parent }, run);
    await Promise.all([
      manager.initialResult(parent, scope, { delay: 0 }),
      manager.initialResult(child, scope, { delay: 0 }),
    ]);
    await expect(
      manager.stop(child, { runtimeId: "sibling", parentTaskId: "another-task" }),
    ).rejects.toThrow("another agent");
    expect((await manager.stop(parent, scope)).status).toBe("stopped");
    expect(manager.records().every((record) => record.status === "stopped")).toBe(true);
    expect(manager.pendingNotifications({ runtimeId: "child", parentTaskId: parent })).toHaveLength(
      1,
    );
    expect(manager.pendingNotifications(scope)).toHaveLength(1);
  });

  it("checkpoints monotonic time rather than wall-clock jumps", async () => {
    const { manager, input, done, scope, records } = fixture();
    const id = await manager.launch(input, async (context) => {
      await waitForTaskDelay(10, context.signal);
      return done;
    });
    await manager.initialResult(id, scope, { delay: 0 });
    await vi.advanceTimersByTimeAsync(2500);
    vi.setSystemTime(Date.now() + 86_400_000);
    await manager.checkpoint();
    expect(records.get(id)!.elapsedMs).toBe(2500);
    await manager.shutdown();
  });

  it("aborts on output IO failure and does not advertise a persisted terminal result", async () => {
    const { manager, input, scope, store, errors, done } = fixture();
    store.appendOutput = async () => {
      throw new Error("output storage full");
    };
    const id = await manager.launch(input, async (context) => {
      await context.writeOutput("result");
      return done;
    });
    await expect(manager.initialResult(id, scope, { type: false })).rejects.toThrow(
      "output storage full",
    );
    expect(errors).toHaveBeenCalledTimes(1);
    expect(manager.pendingNotifications(scope)).toEqual([]);
    expect(manager.hasActive(scope)).toBe(false);
  });

  it("restores notifications without executing work, and marks delivery only after persistence", async () => {
    const { manager, input, done, scope, store } = fixture();
    const id = await manager.launch(input, async () => {
      await waitForTaskDelay(1);
      return done;
    });
    await manager.initialResult(id, scope, { delay: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    const restored = new SessionTaskManager({ sessionKey: "test", store, onError: vi.fn() });
    await restored.restore();
    expect(restored.hasActive(scope)).toBe(false);
    expect(restored.pendingNotifications(scope)).toHaveLength(1);
    const save = store.save;
    store.save = async () => {
      throw new Error("cannot persist acknowledgement");
    };
    await expect(restored.markNotified(id, scope)).rejects.toThrow("cannot persist");
    expect(restored.pendingNotifications(scope)).toHaveLength(1);
    store.save = save;
    await restored.markNotified(id, scope);
    expect(restored.pendingNotifications(scope)).toEqual([]);
  });

  it("cancels waits and slices waits longer than the platform timer limit", async () => {
    const { manager, scope } = fixture();
    const cancel = new AbortController();
    const waiting = manager.delay({ seconds: 3_000_000 }, scope, cancel.signal);
    const rejected = expect(waiting).rejects.toThrow("stop waiting");
    await vi.advanceTimersByTimeAsync(1000);
    cancel.abort(new Error("stop waiting"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

function finalResponse(
  state: ScriptedState,
  text: string,
): ToolAgentRoundCompletion<ScriptedState> {
  return {
    kind: "success",
    result: {
      state: {
        messages: [...state.messages, { role: "assistant", content: text }],
        steps: state.steps + 1,
      },
      step: { kind: "final-response-ready" },
      requestTrace: [],
    },
  };
}

function toolCalls(
  state: ScriptedState,
  calls: ToolCallRequest[],
): ToolAgentRoundCompletion<ScriptedState> {
  return {
    kind: "success",
    result: {
      state: {
        messages: [
          ...state.messages,
          {
            role: "assistant",
            content: "",
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.argumentsJson },
            })),
          },
        ],
        steps: state.steps + 1,
      },
      step: { kind: "tool-calls", calls },
      requestTrace: [],
    },
  };
}

function runtimeFixture(script: (state: ScriptedState) => ToolAgentRoundCompletion<ScriptedState>) {
  const tasks = fixture();
  class Executor extends HostExecutor {
    metadata = new WeakMap<ScriptedToolRequest, ToolRequestExecutionMetadata>();
    attachRequestMetadata(request: ScriptedToolRequest, metadata: ToolRequestExecutionMetadata) {
      this.metadata.set(request, { ...this.metadata.get(request), ...metadata });
      return request;
    }
    override async execute(request: ScriptedToolRequest) {
      if (request.name !== "shell") return super.execute(request);
      const metadata = this.metadata.get(request);
      await metadata?.onOutputChunk?.("running\n");
      await waitForTaskDelay(2, metadata?.signal);
      await metadata?.onOutputChunk?.("complete\n");
      return { ...createToolExecutionTextOutput("shell complete"), execution: { exitCode: 0 } };
    }
  }
  class Transport extends SubagentTransport {
    override async startToolAgentRound(_config: undefined, state: ScriptedState) {
      return script(state);
    }
  }
  const persisted = vi.fn(async () => {});
  const runtime = new AgentRuntime({
    config: undefined,
    llmTransport: new Transport(),
    toolExecutor: new Executor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    backgroundTasks: { manager: tasks.manager, scope: tasks.scope, persistHistory: persisted },
  });
  return { ...tasks, runtime, persisted };
}

async function advanceRuntime(
  runtime: AgentRuntime<undefined, ScriptedState, ScriptedToolRequest>,
  milliseconds: number,
) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 25) {
    await runtime.poll();
    await vi.advanceTimersByTimeAsync(25);
  }
}

describe("managed tasks in AgentRuntime", () => {
  it("steers only after every tool result in a batch has been paired", async () => {
    let rounds = 0;
    const { runtime } = runtimeFixture((state) => {
      if (++rounds === 1)
        return toolCalls(state, [
          {
            id: "shell-batch",
            name: "shell",
            argumentsJson: '{"command":"build","background":{"delay":0}}',
          },
          { id: "delay-batch", name: "delay", argumentsJson: '{"seconds":3}' },
        ]);
      return finalResponse(state, "Finished.");
    });
    await runtime.startUserTurnStreaming("Build and wait.");
    await advanceRuntime(runtime, 2500);
    expect(
      runtime
        .history()
        .some((message) => llmMessageTextContent(message.content).includes("\ntask_event_id: ")),
    ).toBe(false);
    await advanceRuntime(runtime, 1000);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({ assistantText: "Finished." });
    const history = runtime.history();
    const notice = history.findIndex((message) =>
      llmMessageTextContent(message.content).includes("\ntask_event_id: "),
    );
    expect(notice).toBeGreaterThan(
      history.findIndex(
        (message) => message.role === "tool" && message.toolCallId === "delay-batch",
      ),
    );
    expect(rounds).toBe(2);
    await runtime.shutdown();
  });

  it("aborts a foreground wait without killing an already detached task", async () => {
    let rounds = 0;
    const { runtime, manager } = runtimeFixture((state) => {
      if (++rounds === 1)
        return toolCalls(state, [
          {
            id: "shell-abort",
            name: "shell",
            argumentsJson: '{"command":"build","background":{"delay":0}}',
          },
          { id: "delay-abort", name: "delay", argumentsJson: '{"seconds":100}' },
        ]);
      return finalResponse(state, "Background output reviewed.");
    });
    await runtime.startUserTurnStreaming("Keep the build running.");
    await advanceRuntime(runtime, 250);
    expect(runtime.isBusy()).toBe(true);
    runtime.abort();
    expect(manager.records()[0]).toMatchObject({ status: "running", background: true });
    await advanceRuntime(runtime, 2400);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({
      assistantText: "Background output reviewed.",
    });
    expect(manager.records()[0]!.status).toBe("completed");
    expect(rounds).toBe(2);
    await runtime.shutdown();
  });

  it("finishes the foreground turn and wakes once with a file-only completion notice", async () => {
    let rounds = 0;
    const seen: ScriptedState[] = [];
    const { runtime, manager, persisted } = runtimeFixture((state) => {
      seen.push(state);
      if (++rounds === 1)
        return toolCalls(state, [
          {
            id: "shell-one",
            name: "shell",
            argumentsJson: '{"command":"build","background":{"delay":0}}',
          },
        ]);
      return finalResponse(state, rounds === 2 ? "Dispatched." : "Reviewed output.");
    });
    await runtime.startUserTurnStreaming("Build the workspace.");
    await advanceRuntime(runtime, 200);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({
      kind: "completed",
      assistantText: "Dispatched.",
    });
    expect(runtime.isBusy()).toBe(false);
    expect(manager.records()[0]).toMatchObject({ status: "running", background: true });
    await advanceRuntime(runtime, 2200);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({
      kind: "completed",
      assistantText: "Reviewed output.",
    });
    expect(rounds).toBe(3);
    const notices = runtime
      .history()
      .filter((message) => llmMessageTextContent(message.content).includes("\ntask_event_id: "));
    expect(notices).toHaveLength(1);
    expect(llmMessageTextContent(notices[0]!.content)).not.toContain("running\ncomplete");
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(seen[2])).toContain("Build the workspace.");
    await runtime.shutdown();
  });

  it("keeps a subagent alive until its own background shell has completed and been reviewed", async () => {
    let parentRounds = 0;
    let childRounds = 0;
    const { runtime, manager, outputs } = runtimeFixture((state) => {
      const firstUser = state.messages.find(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          !Array.isArray(message) &&
          message.role === "user",
      );
      const isChild =
        firstUser &&
        typeof firstUser === "object" &&
        !Array.isArray(firstUser) &&
        typeof firstUser.content === "string" &&
        firstUser.content.includes("child-task");
      if (isChild) {
        if (++childRounds === 1)
          return toolCalls(state, [
            {
              id: "child-shell",
              name: "shell",
              argumentsJson: '{"command":"check","background":{"delay":0}}',
            },
          ]);
        return finalResponse(
          state,
          childRounds === 2 ? "Waiting for checks." : "Checks completed.",
        );
      }
      if (++parentRounds === 1)
        return toolCalls(state, [
          {
            id: "child-one",
            name: "subagent",
            argumentsJson: '{"prompt":"child-task","background":{"delay":0}}',
          },
        ]);
      return finalResponse(state, parentRounds === 2 ? "Dispatched." : "Child finished.");
    });
    await runtime.startUserTurnStreaming("Delegate the work.");
    await advanceRuntime(runtime, 500);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({ assistantText: "Dispatched." });
    expect(manager.records().find((record) => record.kind === "subagent")).toMatchObject({
      status: "waiting-for-background",
    });
    expect(parentRounds).toBe(2);
    await advanceRuntime(runtime, 2400);
    expect(childRounds).toBe(3);
    expect(runtime.takeCompletedTurnResult()).toMatchObject({ assistantText: "Child finished." });
    const task = manager.records().find((record) => record.kind === "subagent")!;
    expect(task.status).toBe("completed");
    expect(outputs.get(task.id)).toContain("Checks completed.");
    expect(
      runtime
        .history()
        .some(
          (message) =>
            message.role === "assistant" &&
            llmMessageTextContent(message.content) === "Checks completed.",
        ),
    ).toBe(false);
    await runtime.shutdown();
  });

  it("restores a terminal notice idempotently without starting the model", async () => {
    const invoke = vi.fn((state: ScriptedState) => finalResponse(state, "unexpected"));
    const { runtime, manager, input, done, scope } = runtimeFixture(invoke);
    const id = await manager.launch(input, async () => {
      await waitForTaskDelay(1);
      return done;
    });
    await manager.initialResult(id, scope, { delay: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    await runtime.restoreBackgroundTaskNotifications();
    await runtime.restoreBackgroundTaskNotifications();
    runtime.replaceHistory([]);
    await runtime.poll();
    expect(invoke).not.toHaveBeenCalled();
    expect(
      runtime
        .history()
        .filter((message) => llmMessageTextContent(message.content).includes("\ntask_event_id: ")),
    ).toHaveLength(1);
    await runtime.shutdown();
  });
});
