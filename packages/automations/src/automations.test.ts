import assert from "node:assert/strict";
import { test } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeNextRunAt,
  createHostAutomationStore,
  formatScheduleLabel,
  formatTriggerLabel,
  mostRecentDueAt,
  normalizeAutomationTrigger,
  reconcileGitHubTriggerPollState,
  shouldFireNow,
} from "./automations.js";

test("automation store create list get update delete", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-host-automations-"));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "GitHub daily digest",
      overview: "Collect GitHub news",
      trigger: { kind: "time", schedule: { kind: "daily", hour: 20, minute: 0 } },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "openai", name: "gpt-test" },
      approvalLevel: "default",
    });
    assert.equal(created.enabled, true);
    assert.equal(created.trigger.kind, "time");

    const summaries = await store.listSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.title, "GitHub daily digest");
    assert.equal(summaries[0]?.scheduleLabel, "Daily 20:00");

    const loaded = await store.get(created.id);
    assert.ok(loaded);
    assert.equal(loaded!.runs.length, 0);

    const updated = await store.update(created.id, { enabled: false, title: "Renamed" });
    assert.equal(updated.enabled, false);
    assert.equal(updated.title, "Renamed");

    await store.delete(created.id);
    assert.equal((await store.listSummaries()).length, 0);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("automation store tracks runs and active run", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-host-automations-runs-"));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Hourly task",
      overview: "Do work",
      trigger: { kind: "time", schedule: { kind: "hourly" } },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "openai", name: "gpt-test" },
      approvalLevel: "bypass-approval",
    });

    const run = await store.addRun(created.id, {
      id: "run-1",
      automationId: created.id,
      sessionPath: "/tmp/session.json",
      status: "running",
      startedAtUnixMs: Date.now(),
    });
    assert.equal(run.status, "running");
    assert.ok(await store.getActiveRun(created.id));

    await store.updateRun(created.id, run.id, {
      status: "completed",
      completedAtUnixMs: Date.now(),
    });
    assert.equal(await store.getActiveRun(created.id), undefined);

    const blockedRun = await store.addRun(created.id, {
      id: "run-2",
      automationId: created.id,
      sessionPath: "/tmp/session-2.json",
      status: "blocked",
      startedAtUnixMs: Date.now(),
    });
    assert.equal(blockedRun.status, "blocked");
    assert.equal(await store.getActiveRun(created.id), undefined);

    const loaded = await store.get(created.id);
    assert.equal(loaded?.runs[0]?.status, "completed");
    assert.equal(loaded?.runs[1]?.status, "blocked");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("shouldFireNow respects schedule and last fired bucket", () => {
  const dailyAtEight = { kind: "daily" as const, hour: 8, minute: 30 };
  const eightThirty = Date.parse("2026-06-08T08:30:00");
  assert.equal(shouldFireNow(dailyAtEight, undefined, eightThirty), true);
  assert.equal(shouldFireNow(dailyAtEight, eightThirty, eightThirty), false);
  // Already fired within the due minute: do not fire again even if now is 1 minute past it
  assert.equal(shouldFireNow(dailyAtEight, eightThirty + 20_000, eightThirty + 60_000), false);

  const hourly = { kind: "hourly" as const };
  const topOfHour = Date.parse("2026-06-08T09:00:00");
  assert.equal(shouldFireNow(hourly, undefined, topOfHour), true);
  assert.equal(shouldFireNow(hourly, topOfHour, topOfHour + 5 * 60_000), false);
});

test("shouldFireNow catches up missed slots after sleep or clock jump", () => {
  const dailyAtEight = { kind: "daily" as const, hour: 8, minute: 30 };
  const eightThirty = Date.parse("2026-06-08T08:30:00");
  const yesterdayFired = Date.parse("2026-06-07T08:30:10");
  // Machine asleep at 08:30, wakes at 09:12: last due time (08:30) > lastFired, so catch up
  assert.equal(
    shouldFireNow(dailyAtEight, yesterdayFired, Date.parse("2026-06-08T09:12:00")),
    true,
  );
  // After catch-up lastFired=09:12, no repeat on the same day
  assert.equal(
    shouldFireNow(
      dailyAtEight,
      Date.parse("2026-06-08T09:12:00"),
      Date.parse("2026-06-08T18:00:00"),
    ),
    false,
  );
  // Today's due time not reached yet: do not fire
  assert.equal(shouldFireNow(dailyAtEight, yesterdayFired, eightThirty - 60_000), false);

  const hourly = { kind: "hourly" as const };
  assert.equal(
    shouldFireNow(hourly, Date.parse("2026-06-08T09:00:20"), Date.parse("2026-06-08T10:07:00")),
    true,
  );

  const weekly = { kind: "weekly" as const, weekday: 1 as const, hour: 9, minute: 0 };
  // Missed Monday 09:00, catch up Monday 11:00; last fired on the previous Monday
  assert.equal(
    shouldFireNow(weekly, Date.parse("2026-06-01T09:00:30"), Date.parse("2026-06-08T11:00:00")),
    true,
  );
  // No repeat on Tuesday
  assert.equal(
    shouldFireNow(weekly, Date.parse("2026-06-08T11:00:00"), Date.parse("2026-06-09T09:00:00")),
    false,
  );
});

test("mostRecentDueAt returns latest due time at or before now", () => {
  const dailyAtEight = { kind: "daily" as const, hour: 8, minute: 30 };
  assert.equal(
    mostRecentDueAt(dailyAtEight, Date.parse("2026-06-08T09:12:00")),
    Date.parse("2026-06-08T08:30:00"),
  );
  assert.equal(
    mostRecentDueAt(dailyAtEight, Date.parse("2026-06-08T08:00:00")),
    Date.parse("2026-06-07T08:30:00"),
  );
  assert.equal(
    mostRecentDueAt({ kind: "hourly" }, Date.parse("2026-06-08T10:07:00")),
    Date.parse("2026-06-08T10:00:00"),
  );
  const weekly = { kind: "weekly" as const, weekday: 1 as const, hour: 9, minute: 0 };
  assert.equal(
    mostRecentDueAt(weekly, Date.parse("2026-06-10T12:00:00")),
    Date.parse("2026-06-08T09:00:00"),
  );
  assert.equal(
    mostRecentDueAt(weekly, Date.parse("2026-06-08T08:00:00")),
    Date.parse("2026-06-01T09:00:00"),
  );
});

test("automation store serializes concurrent mutations and writes atomically", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-host-automations-atomic-"));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Concurrent",
      overview: "Concurrent writes",
      trigger: { kind: "time", schedule: { kind: "hourly" } },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "openai", name: "gpt-test" },
      approvalLevel: "default",
    });

    // Concurrent load-modify-save: after serialization none of the 10 runs is lost
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        store.addRun(created.id, {
          id: `run-${index}`,
          automationId: created.id,
          sessionPath: `/tmp/session-${index}.json`,
          status: "completed",
          startedAtUnixMs: Date.now(),
        }),
      ),
    );
    const loaded = await store.get(created.id);
    assert.equal(loaded?.runs.length, 10);

    // Atomic write: no tmp files left in the directory, and the final file is complete JSON
    const entries = await readdir(join(spiritDataDir, "automations"));
    assert.deepEqual(entries, [`${created.id}.json`]);
    const raw = await readFile(join(spiritDataDir, "automations", `${created.id}.json`), "utf8");
    assert.equal(JSON.parse(raw).runs.length, 10);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("computeNextRunAt advances schedule", () => {
  const after = Date.parse("2026-06-08T08:31:00");
  const daily = { kind: "daily" as const, hour: 8, minute: 30 };
  assert.equal(computeNextRunAt(daily, after), Date.parse("2026-06-09T08:30:00"));

  const weekly = { kind: "weekly" as const, weekday: 1 as const, hour: 9, minute: 0 };
  const mondayNine = Date.parse("2026-06-08T09:00:00");
  assert.equal(computeNextRunAt(weekly, mondayNine), Date.parse("2026-06-15T09:00:00"));
});

test("formatScheduleLabel renders weekly label", () => {
  assert.equal(
    formatScheduleLabel({ kind: "weekly", weekday: 1, hour: 9, minute: 0 }),
    "Weekly Mon 09:00",
  );
  assert.equal(formatScheduleLabel({ kind: "hourly" }), "Hourly");
});

test("formatTriggerLabel renders GitHub trigger", () => {
  assert.equal(
    formatTriggerLabel({
      kind: "github",
      owner: "spirit",
      repo: "agent",
      event: "pull_request_created",
    }),
    "GitHub · spirit/agent · PR created",
  );
});

test("normalizeAutomationTrigger accepts time and github triggers", () => {
  assert.deepEqual(
    normalizeAutomationTrigger({ kind: "time", schedule: { kind: "daily", hour: 9, minute: 0 } }),
    {
      kind: "time",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    },
  );
});

test("reconcileGitHubTriggerPollState clears poll when repo identity changes", () => {
  const previous = {
    kind: "github" as const,
    owner: "a",
    repo: "b",
    event: "issue_created" as const,
    poll: { lastSeenNumber: 42 },
  };
  const next = {
    kind: "github" as const,
    owner: "c",
    repo: "d",
    event: "issue_created" as const,
    poll: { lastSeenNumber: 99 },
  };
  assert.deepEqual(reconcileGitHubTriggerPollState(previous, next), {
    kind: "github",
    owner: "c",
    repo: "d",
    event: "issue_created",
  });
});

test("automation store persists modelRef and rejects legacy modelName-only files", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-host-automations-modelref-"));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Model ref task",
      overview: "Uses group-scoped model",
      trigger: { kind: "time", schedule: { kind: "hourly" } },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "custom-openai", name: "gpt-test" },
      approvalLevel: "default",
    });
    assert.deepEqual(created.modelRef, { providerId: "custom-openai", name: "gpt-test" });

    const raw = await readFile(join(spiritDataDir, "automations", `${created.id}.json`), "utf8");
    const parsed = JSON.parse(raw) as {
      definition: { modelRef?: { providerId: string; name: string }; modelName?: string };
    };
    assert.deepEqual(parsed.definition.modelRef, { providerId: "custom-openai", name: "gpt-test" });
    assert.equal(parsed.definition.modelName, undefined);

    const legacyId = "legacy-automation-id";
    await mkdir(join(spiritDataDir, "automations"), { recursive: true });
    await writeFile(
      join(spiritDataDir, "automations", `${legacyId}.json`),
      `${JSON.stringify(
        {
          version: 1,
          definition: {
            id: legacyId,
            title: "Legacy",
            overview: "Old format",
            trigger: { kind: "time", schedule: { kind: "hourly" } },
            workspaceRoot: spiritDataDir,
            modelName: "gpt-test",
            approvalLevel: "default",
            enabled: true,
            createdAtUnixMs: 1,
            updatedAtUnixMs: 1,
          },
          runs: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    assert.equal(await store.get(legacyId), undefined);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("extension triggers retain labels and provider state only through supported paths", async () => {
  const kind = "extension:personal/demo/activity" as const;
  assert.deepEqual(
    normalizeAutomationTrigger({
      kind,
      config: { repository: "spirit" },
      label: "Spirit activity",
      state: { cursor: 4 },
    }),
    {
      kind,
      config: { repository: "spirit" },
      label: "Spirit activity",
      state: { cursor: 4 },
    },
  );
  assert.equal(
    formatTriggerLabel({
      kind,
      config: { repository: "spirit" },
      label: "Spirit activity",
    }),
    "Spirit activity",
  );
  assert.equal(normalizeAutomationTrigger({ kind, config: {}, label: "" }), undefined);

  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-extension-trigger-store-"));
  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Extension trigger",
      overview: "React to activity",
      trigger: {
        kind,
        config: {
          repository: "spirit",
          options: { events: ["created"], nested: { first: 1, second: 2 } },
        },
        label: "Spirit activity",
        state: { injected: true },
      },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "custom-openai", name: "gpt-test" },
      approvalLevel: "default",
    });
    assert.equal(created.trigger.kind === kind && "state" in created.trigger, false);

    await store.updateAutomationTriggerState(created.id, { cursor: 4 });
    await store.setTriggerError(created.id, "temporary failure");
    const updatedTitle = await store.update(created.id, { title: "Renamed" });
    assert.deepEqual(updatedTitle.trigger.kind === kind ? updatedTitle.trigger.state : undefined, {
      cursor: 4,
    });
    assert.equal(updatedTitle.triggerError, "temporary failure");

    const reorderedConfig = await store.update(created.id, {
      trigger: {
        kind,
        config: {
          options: { nested: { second: 2, first: 1 }, events: ["created"] },
          repository: "spirit",
        },
        label: "Spirit activity",
        state: { injected: true },
      },
    });
    assert.deepEqual(
      reorderedConfig.trigger.kind === kind ? reorderedConfig.trigger.state : undefined,
      { cursor: 4 },
    );

    const updatedConfig = await store.update(created.id, {
      trigger: {
        kind,
        config: { cursor: 5 },
        label: "Spirit activity",
        state: { injected: true },
      },
    });
    assert.equal(updatedConfig.trigger.kind === kind && "state" in updatedConfig.trigger, false);
    assert.equal(updatedConfig.triggerError, undefined);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("event consumption atomically stores the run and checkpoint and dedupes after reload", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-trigger-consumption-"));
  const kind = "extension:personal/demo/activity" as const;
  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Extension trigger",
      overview: "React to activity",
      trigger: { kind, config: {}, label: "Spirit activity" },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "custom-openai", name: "gpt-test" },
      approvalLevel: "default",
    });
    const input = {
      id: "run-1",
      automationId: created.id,
      sessionPath: "/tmp/run-1.json",
      status: "running" as const,
      startedAtUnixMs: 1,
    };
    const first = await store.consumeAutomationTriggerEvent(created.id, input, {
      eventId: "event-1",
      checkpoint: { cursor: 1 },
    });
    assert.equal(first.created, true);
    assert.equal(first.run.triggerEventId, "event-1");
    assert.deepEqual(first.run, (await store.get(created.id))?.runs[0]);
    const afterFirst = await store.get(created.id);
    assert.equal(afterFirst?.definition.trigger.kind, kind);
    if (afterFirst?.definition.trigger.kind === kind) {
      assert.deepEqual(afterFirst.definition.trigger.state, { cursor: 1 });
    }

    const duplicate = await store.consumeAutomationTriggerEvent(
      created.id,
      { ...input, id: "run-duplicate" },
      { eventId: "event-1", checkpoint: { cursor: 1 } },
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.run.id, "run-1");

    const second = await store.consumeAutomationTriggerEvent(
      created.id,
      { ...input, id: "run-2" },
      { eventId: "event-2", checkpoint: { cursor: 2 } },
    );
    assert.equal(second.created, true);

    const reloaded = createHostAutomationStore(spiritDataDir);
    const duplicateAfterReload = await reloaded.consumeAutomationTriggerEvent(
      created.id,
      { ...input, id: "run-3" },
      { eventId: "event-2", checkpoint: { cursor: 2 } },
    );
    assert.equal(duplicateAfterReload.created, false);
    assert.equal(duplicateAfterReload.run.id, "run-2");
    assert.equal((await reloaded.get(created.id))?.runs.length, 2);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
