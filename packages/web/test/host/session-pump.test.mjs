import assert from "node:assert/strict";
import { test } from "vitest";
import { setTimeout as delay } from "node:timers/promises";

import {
  SessionPump,
  sessionBundleNeedsPumpTick,
} from "../../../../packages/sessions/dist/host/session-pump.js";
import { pumpSessionsCommand } from "../../../../packages/sessions/dist/host/session-turn-orchestrator.js";

function createFakeRuntime({ pollsUntilIdle, chunkPerPoll = false }) {
  const runtime = {
    pollCount: 0,
    busy: true,
    pendingEvents: [],
    isBusy: () => runtime.busy,
    poll: async () => {
      runtime.pollCount += 1;
      if (chunkPerPoll) {
        runtime.pendingEvents.push({ kind: "assistant-chunk", text: `chunk-${runtime.pollCount}` });
      }
      if (runtime.pollCount >= pollsUntilIdle) {
        runtime.busy = false;
      }
    },
    tickThinkingSpinner: () => {},
    drainEvents: () => runtime.pendingEvents.splice(0, runtime.pendingEvents.length),
    drainActiveChildSessionEvents: () => [],
    childSessionArchives: () => [],
    currentPendingApproval: () => undefined,
    currentPendingQuestions: () => undefined,
  };
  return runtime;
}

function createFakeBundle(runtime) {
  return {
    id: "session-pump-test",
    workspaceRoot: "/tmp/workspace",
    runtime,
    messages: [],
    messageTimeline: { toMessages: () => [] },
    deferredRuntimeHostEvents: [],
    responsesBuiltInPreviewSeenCallIds: new Set(),
    conversationRevision: 0,
    queuedUserTurns: [],
    subagentDesktopMessagesBySessionId: new Map(),
    subagentConversationProjections: new Map(),
  };
}

function createFakeOrchestratorContext(bundle, calls) {
  const runtimeEvents = {
    applyRuntimeHostEvents: () => {},
    consumeCompletedTurnResult: () => {},
    syncPendingToolStates: () => {},
    syncAssistantPrefixFromHistoryBeforeToolRow: () => {},
  };
  return {
    runSerialized: async (work) => work(),
    ensureInitialized: async () => {
      calls.push("ensureInitialized");
    },
    allBundles: () => [bundle],
    getActiveBundle: () => bundle,
    activeSessionId: () => "other-session",
    orchestrationFor: () => ({ runtimeEvents }),
    syncSubagentToolStreamingOutput: () => {},
    persistSessionBundle: async () => {
      calls.push("persist");
    },
    flushDeferredRuntimeRefreshIfIdle: async () => {},
    refreshTodoSnapshotForBundle: async () => {},
    syncActiveRuntimePointer: () => {},
    startDreamCollectorIfNeeded: () => {},
    emitLiveSnapshotUpdate: () => {},
    requestLiveSnapshotEmit: () => {
      calls.push("request-emit");
    },
    persistCurrentSessionIfNeeded: async () => {},
  };
}

async function waitUntil(predicate, { timeoutMs = 2_000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(stepMs);
  }
  throw new Error("waitUntil timed out");
}

test("sessionBundleNeedsPumpTick tracks runtime busy state", () => {
  const runtime = createFakeRuntime({ pollsUntilIdle: 1 });
  const bundle = createFakeBundle(runtime);
  assert.equal(sessionBundleNeedsPumpTick(bundle), true);
  runtime.busy = false;
  assert.equal(sessionBundleNeedsPumpTick(bundle), false);
  assert.equal(sessionBundleNeedsPumpTick(createFakeBundle(undefined)), false);
});

test("pump drives a busy streaming round to completion without external poll", async () => {
  const runtime = createFakeRuntime({ pollsUntilIdle: 3, chunkPerPoll: true });
  const bundle = createFakeBundle(runtime);
  const calls = [];
  const ctx = createFakeOrchestratorContext(bundle, calls);

  const pump = new SessionPump({
    hasPumpWork: () => sessionBundleNeedsPumpTick(bundle),
    runTick: () => pumpSessionsCommand(ctx),
    intervalMs: 5,
  });

  pump.ensureRunning();
  assert.equal(pump.isRunning(), true);
  // Repeated ensureRunning while the pump is running must be idempotent, never stacking a second loop.
  pump.ensureRunning();

  await waitUntil(() => !pump.isRunning());
  assert.equal(runtime.busy, false);
  assert.equal(runtime.pollCount, 3);
  // Persist throttling: first tick (past the time slice) + forced at turn end = 2 total; intermediate ticks do not persist.
  assert.equal(calls.filter((entry) => entry === "persist").length, 2);
  // Every tick applied an assistant-chunk event → a throttled push should be requested, and revision increments.
  assert.ok(calls.filter((entry) => entry === "request-emit").length >= 3);
  assert.equal(bundle.conversationRevision, 3);

  // ensureRunning must not restart the pump once everything is idle.
  pump.ensureRunning();
  assert.equal(pump.isRunning(), false);
  assert.equal(runtime.pollCount, 3);
});

test("tick persist is throttled while busy and forced at turn end", async () => {
  const runtime = createFakeRuntime({ pollsUntilIdle: 4 });
  const bundle = createFakeBundle(runtime);
  // Simulate a persist right before the turn starts: busy ticks within the 1s time slice must not write again.
  bundle.lastTickPersistAtMs = Date.now();
  const calls = [];
  const ctx = createFakeOrchestratorContext(bundle, calls);

  const pump = new SessionPump({
    hasPumpWork: () => sessionBundleNeedsPumpTick(bundle),
    runTick: () => pumpSessionsCommand(ctx),
    intervalMs: 5,
  });

  pump.ensureRunning();
  await waitUntil(() => !pump.isRunning());
  assert.equal(runtime.pollCount, 4);
  // Only the turn-final (busy→idle) tick forces a persist.
  assert.equal(calls.filter((entry) => entry === "persist").length, 1);
});

test("entering pending approval forces persist", async () => {
  const runtime = createFakeRuntime({ pollsUntilIdle: 1_000 });
  let approval;
  runtime.currentPendingApproval = () => approval;
  const basePoll = runtime.poll;
  runtime.poll = async () => {
    await basePoll();
    if (runtime.pollCount === 2) {
      approval = { toolName: "shell" };
    }
  };
  const bundle = createFakeBundle(runtime);
  bundle.lastTickPersistAtMs = Date.now();
  const calls = [];
  const ctx = createFakeOrchestratorContext(bundle, calls);

  const pump = new SessionPump({
    hasPumpWork: () => sessionBundleNeedsPumpTick(bundle),
    runTick: () => pumpSessionsCommand(ctx),
    intervalMs: 5,
  });

  pump.ensureRunning();
  await waitUntil(() => runtime.pollCount >= 4);
  pump.stop();
  // The tick entering pending approval forces a persist; subsequent blocked ticks within the time slice do not write.
  assert.equal(calls.filter((entry) => entry === "persist").length, 1);
});

test("long streaming round: pump completes with bounded persist and steady emits", async () => {
  const totalPolls = 500;
  const runtime = createFakeRuntime({ pollsUntilIdle: totalPolls, chunkPerPoll: true });
  const bundle = createFakeBundle(runtime);
  bundle.lastTickPersistAtMs = Date.now();
  const calls = [];
  const ctx = createFakeOrchestratorContext(bundle, calls);

  const pump = new SessionPump({
    hasPumpWork: () => sessionBundleNeedsPumpTick(bundle),
    runTick: () => pumpSessionsCommand(ctx),
    intervalMs: 0,
  });

  pump.ensureRunning();
  await waitUntil(() => !pump.isRunning(), { timeoutMs: 30_000 });

  assert.equal(runtime.pollCount, totalPolls);
  assert.equal(bundle.conversationRevision, totalPolls);
  // Every tick has events → one throttled push requested per tick (actual IPC push rate is constrained separately by the host throttler).
  assert.equal(calls.filter((entry) => entry === "request-emit").length, totalPolls);
  // Persist follows the 1s time slice + forced at final state: far fewer than the tick count.
  const persistCount = calls.filter((entry) => entry === "persist").length;
  assert.ok(persistCount < 10, `persist ${persistCount} should be time-sliced`);
});

test("pump stop cancels pending tick", async () => {
  const runtime = createFakeRuntime({ pollsUntilIdle: 1_000 });
  const bundle = createFakeBundle(runtime);
  const ctx = createFakeOrchestratorContext(bundle, []);

  const pump = new SessionPump({
    hasPumpWork: () => sessionBundleNeedsPumpTick(bundle),
    runTick: () => pumpSessionsCommand(ctx),
    intervalMs: 5,
  });

  pump.ensureRunning();
  await waitUntil(() => runtime.pollCount >= 1);
  pump.stop();
  const countAtStop = runtime.pollCount;
  await delay(50);
  // No new tick may appear after stop (tolerating one already in flight at stop time).
  assert.ok(runtime.pollCount <= countAtStop + 1);
  assert.equal(pump.isRunning(), false);
});
