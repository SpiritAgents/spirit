import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHostAutomationStore } from "@spiritagent/automations";

import { failDanglingAutomationRuns } from "../../../../packages/workbench/dist/host/automation-scheduler-service.js";

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
