import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

import type { JsonObject } from "@spiritagent/agent-core";
import { createHostAutomationStore, type HostAutomationDefinition } from "@spiritagent/automations";
import type { RegisteredAutomationTriggerContribution } from "@spiritagent/automations/trigger-provider";
import { runWithSpiritDataDir, type DesktopConfigFile } from "@spiritagent/sessions/host/storage";

import {
  tickAutomationScheduler,
  type AutomationSchedulerServiceContext,
} from "./automation-scheduler-service.js";

const KIND = "extension:personal/demo/activity";
const CONTRIBUTION: RegisteredAutomationTriggerContribution = {
  kind: KIND,
  extensionId: "personal/demo",
  contributionId: "activity",
  id: "activity",
  name: "Activity",
  description: "Demo activity",
  icon: { type: "spirit", name: "globe" },
  inputSchema: { type: "object" },
};

async function definition(dataDir: string, state?: JsonObject): Promise<HostAutomationDefinition> {
  return createHostAutomationStore(dataDir).create({
    title: "Demo",
    overview: "Run demo",
    trigger: { kind: KIND, config: {}, label: "Demo activity", ...(state ? { state } : {}) },
    workspaceRoot: dataDir,
    modelRef: { providerId: "test", name: "local" },
    approvalLevel: "default",
  });
}

function context(
  dataDir: string,
  overrides: Partial<AutomationSchedulerServiceContext> = {},
): AutomationSchedulerServiceContext {
  const running = new Set<string>();
  const store = createHostAutomationStore(dataDir);
  return {
    initialized: () => true,
    config: () => ({}) as DesktopConfigFile,
    runningAutomationIds: () => running,
    markAutomationRunning(id, value) {
      if (value) running.add(id);
      else running.delete(id);
    },
    onAutomationUpdated() {},
    notifySessionListUpdated() {},
    listAutomationTriggerContributions: async () => [CONTRIBUTION],
    pollAutomationTrigger: async () => ({ results: [] }),
    runAutomationOnce: async ({ definition, triggerEvent }) => {
      const run = {
        id: `run-${Date.now()}-${Math.random()}`,
        automationId: definition.id,
        sessionPath: `/tmp/${definition.id}.json`,
        status: "completed" as const,
        startedAtUnixMs: Date.now(),
      };
      if (!triggerEvent) {
        return store.addRun(definition.id, run);
      }
      const consumed = await store.consumeAutomationTriggerEvent(definition.id, run, {
        eventId: triggerEvent.id,
        checkpoint: triggerEvent.checkpoint,
      });
      return consumed.created ? consumed.run : undefined;
    },
    ...overrides,
  };
}

test("baseline, event consumption, and duplicate delivery are idempotent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-baseline-"));
  try {
    const created = await definition(dataDir);
    const store = createHostAutomationStore(dataDir);
    const poll = vi
      .fn()
      .mockResolvedValueOnce({
        results: [{ automationId: created.id, checkpoint: { cursor: 0 } }],
      })
      .mockResolvedValue({
        results: [
          {
            automationId: created.id,
            events: [{ id: "event-1", summary: "Event created", checkpoint: { cursor: 1 } }],
          },
        ],
      });
    const runAutomationOnce = vi.fn(context(dataDir).runAutomationOnce!);
    const ctx = context(dataDir, { pollAutomationTrigger: poll, runAutomationOnce });

    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    assert.equal(runAutomationOnce.mock.calls.length, 0);
    const baselineRecord = await store.get(created.id);
    assert.ok(baselineRecord);
    assert.deepEqual((baselineRecord.definition.trigger as { state?: JsonObject }).state, {
      cursor: 0,
    });

    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    assert.equal(runAutomationOnce.mock.calls.length, 1);
    assert.equal((await store.get(created.id))?.runs.length, 1);

    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    assert.equal(runAutomationOnce.mock.calls.length, 2);
    assert.equal((await store.get(created.id))?.runs.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a blocked run consumes only its own event and stops the batch", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-blocked-"));
  try {
    const created = await definition(dataDir, { cursor: 0 });
    const store = createHostAutomationStore(dataDir);
    await store.updateAutomationTriggerState(created.id, { cursor: 0 });
    const ctx = context(dataDir, {
      pollAutomationTrigger: async () => ({
        results: [
          {
            automationId: created.id,
            events: [
              { id: "event-1", summary: "First", checkpoint: { cursor: 1 } },
              { id: "event-2", summary: "Second", checkpoint: { cursor: 2 } },
            ],
          },
        ],
      }),
      runAutomationOnce: async ({ definition, triggerEvent }) => {
        const run = {
          id: "run-blocked",
          automationId: definition.id,
          sessionPath: "/tmp/blocked.json",
          status: "blocked" as const,
          startedAtUnixMs: 1,
        };
        const consumed = await store.consumeAutomationTriggerEvent(definition.id, run, {
          eventId: triggerEvent!.id,
          checkpoint: triggerEvent!.checkpoint,
        });
        return consumed.run;
      },
    });
    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    const record = await store.get(created.id);
    assert.ok(record);
    assert.equal(record.runs.length, 1);
    assert.equal(record.runs[0]?.triggerEventId, "event-1");
    assert.deepEqual((record.definition.trigger as { state?: JsonObject }).state, { cursor: 1 });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("missing providers pause with a generic error instead of deleting the automation", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-missing-"));
  try {
    const created = await definition(dataDir);
    const ctx = context(dataDir, { listAutomationTriggerContributions: async () => [] });
    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    const record = await createHostAutomationStore(dataDir).get(created.id);
    assert.match(record?.definition.triggerError ?? "", /provider is unavailable/);
    assert.equal(record?.definition.enabled, true);
    assert.equal(record?.runs.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("provider timeout aborts the poll and records one generic error", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-timeout-"));
  try {
    const created = await definition(dataDir, { cursor: 0 });
    const ctx = context(dataDir, {
      pollAutomationTrigger: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }) as never,
    });
    const timeoutContext = { ...ctx, automationTriggerPollTimeoutMs: 5 };
    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(timeoutContext));
    assert.match(
      (await createHostAutomationStore(dataDir).get(created.id))?.definition.triggerError ?? "",
      /timed out/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("provider timeout reports an error even when the provider resolves after abort", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-timeout-resolution-"));
  try {
    const created = await definition(dataDir, { cursor: 0 });
    const ctx = context(dataDir, {
      pollAutomationTrigger: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                results: [{ automationId: created.id, error: "provider aborted" }],
              }),
            { once: true },
          );
        }),
    });
    const timeoutContext = { ...ctx, automationTriggerPollTimeoutMs: 5 };
    await runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(timeoutContext));
    assert.match(
      (await createHostAutomationStore(dataDir).get(created.id))?.definition.triggerError ?? "",
      /timed out/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("concurrent ticks share the same single-flight run", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-single-flight-"));
  try {
    const created = await definition(dataDir, { cursor: 0 });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const poll = vi.fn(async () => {
      await pending;
      return { results: [{ automationId: created.id, checkpoint: { cursor: 0 } }] };
    });
    const ctx = context(dataDir, { pollAutomationTrigger: poll });
    const first = runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    const second = runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    assert.equal(first, second);
    release();
    await Promise.all([first, second]);
    assert.equal(poll.mock.calls.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("aborting an in-flight provider stops without recording a failure", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "spirit-scheduler-abort-"));
  try {
    const created = await definition(dataDir, { cursor: 0 });
    const store = createHostAutomationStore(dataDir);
    await store.updateAutomationTriggerState(created.id, { cursor: 0 });
    let active!: AbortController;
    let started!: () => void;
    const pollStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const ctx = context(dataDir, {
      trackAutomationTriggerPoll: (_ownerId, controller) => {
        active = controller;
        return () => {};
      },
      pollAutomationTrigger: ({ signal }) => {
        started();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }) as never;
      },
    });
    const tick = runWithSpiritDataDir(dataDir, () => tickAutomationScheduler(ctx));
    await pollStarted;
    active.abort();
    await tick;
    assert.equal((await store.get(created.id))?.definition.triggerError, undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
