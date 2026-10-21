import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHostAutomationStore } from "@spiritagent/host-internal";

import {
  failDanglingAutomationRuns,
  groupGitHubPollMatchesByAutomation,
  runGitHubMatchesAndCollectConsumed,
} from "../../dist-electron/src/host/automation-scheduler-service.js";

test("groupGitHubPollMatchesByAutomation groups matches by automation id", () => {
  const definitionA = {
    id: "a",
    title: "A",
    overview: "A",
    trigger: { kind: "github", owner: "o", repo: "r", event: "issue_created" },
    workspaceRoot: "/tmp",
    modelRef: { providerId: "openai", name: "m" },
    approvalLevel: "default",
    enabled: true,
    createdAtUnixMs: 1,
    updatedAtUnixMs: 1,
  };
  const definitionB = { ...definitionA, id: "b", title: "B", overview: "B" };
  const grouped = groupGitHubPollMatchesByAutomation([
    {
      automationId: "a",
      definition: definitionA,
      item: { number: 1, htmlUrl: "https://example/1", isPullRequest: false, createdAt: "" },
      nextLastSeenNumber: 2,
    },
    {
      automationId: "b",
      definition: definitionB,
      item: { number: 3, htmlUrl: "https://example/3", isPullRequest: false, createdAt: "" },
      nextLastSeenNumber: 3,
    },
    {
      automationId: "a",
      definition: definitionA,
      item: { number: 2, htmlUrl: "https://example/2", isPullRequest: false, createdAt: "" },
      nextLastSeenNumber: 2,
    },
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get("a")?.length, 2);
  assert.equal(grouped.get("b")?.length, 1);
});

function fakeMatch(number) {
  return {
    automationId: "a",
    definition: {},
    item: { number, htmlUrl: `https://example/${number}`, isPullRequest: false, createdAt: "" },
    nextLastSeenNumber: number,
  };
}

function fakeRun(status) {
  return {
    id: `run-${status}`,
    automationId: "a",
    sessionPath: "/tmp/session.json",
    status,
    startedAtUnixMs: 0,
  };
}

test("runGitHubMatchesAndCollectConsumed consumes all matches when runs complete", async () => {
  const matches = [fakeMatch(1), fakeMatch(2)];
  const consumed = await runGitHubMatchesAndCollectConsumed(matches, async () =>
    fakeRun("completed"),
  );
  assert.deepEqual(consumed, matches);
});

test("runGitHubMatchesAndCollectConsumed consumes blocked and failed runs to advance watermark", async () => {
  // blocked/failed runs were created (waiting for the user / leaving a failure record): the event is treated as consumed,
  // otherwise every tick would rebuild a run and session file for the same event
  for (const status of ["blocked", "failed"]) {
    const matches = [fakeMatch(1), fakeMatch(2)];
    const consumed = await runGitHubMatchesAndCollectConsumed(matches, async () => fakeRun(status));
    assert.deepEqual(consumed, [matches[0]]);
  }
});

test("runGitHubMatchesAndCollectConsumed does not consume matches when no run was created", async () => {
  const consumed = await runGitHubMatchesAndCollectConsumed(
    [fakeMatch(1), fakeMatch(2)],
    async () => undefined,
  );
  assert.deepEqual(consumed, []);
});

test("failDanglingAutomationRuns marks crash-leftover running runs as failed", async () => {
  const spiritDataDir = await mkdtemp(path.join(os.tmpdir(), "spirit-desktop-dangling-runs-"));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: "Crashy",
      overview: "Crash recovery",
      trigger: { kind: "time", schedule: { kind: "hourly" } },
      workspaceRoot: spiritDataDir,
      modelRef: { providerId: "openai", name: "gpt-test" },
      approvalLevel: "default",
    });
    await store.addRun(created.id, {
      id: "run-running",
      automationId: created.id,
      sessionPath: "/tmp/session.json",
      status: "running",
      startedAtUnixMs: Date.now(),
    });
    await store.addRun(created.id, {
      id: "run-blocked",
      automationId: created.id,
      sessionPath: "/tmp/session-blocked.json",
      status: "blocked",
      startedAtUnixMs: Date.now(),
    });

    const affected = await failDanglingAutomationRuns(store, "interrupted");
    assert.deepEqual(affected, [created.id]);
    assert.equal(await store.getActiveRun(created.id), undefined);

    const loaded = await store.get(created.id);
    const recovered = loaded?.runs.find((run) => run.id === "run-running");
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.error, "interrupted");
    assert.ok(recovered?.completedAtUnixMs);
    // the blocked run is unaffected
    assert.equal(loaded?.runs.find((run) => run.id === "run-blocked")?.status, "blocked");

    // no-op when there is no leftover running run
    assert.deepEqual(await failDanglingAutomationRuns(store, "interrupted"), []);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
