import assert from "node:assert/strict";
import { test } from "vitest";

import { patchActiveSessionSnapshotInList } from "../../src/lib/session-list-active-snapshot.ts";

function session(path, overrides = {}) {
  return {
    path,
    displayName: "Session",
    modifiedAtUnixMs: 1,
    workspaceRoot: "",
    transcriptPath: `${path}.transcript.json`,
    ...overrides,
  };
}

function snapshot(isBusy, overrides = {}) {
  return {
    activeSession: { filePath: "/tmp/test.json", displayName: "Updated title" },
    conversation: { isBusy, ...overrides },
  };
}

test("an idle snapshot clears stale active-session spinner state", () => {
  const other = session("/tmp/other.json", { isBusy: true });
  const next = patchActiveSessionSnapshotInList(
    [session("/tmp/test.json", { isBusy: true, isBlocked: true }), other],
    snapshot(false),
  );

  assert.equal(next[0].displayName, "Updated title");
  assert.equal("isBusy" in next[0], false);
  assert.equal("isBlocked" in next[0], false);
  assert.equal(next[1], other);
});

test("busy and blocked snapshots update the active session without a list refresh", () => {
  const busy = patchActiveSessionSnapshotInList([session("/tmp/test.json")], snapshot(true));
  assert.deepEqual(
    { isBusy: busy[0].isBusy, isBlocked: busy[0].isBlocked },
    { isBusy: true, isBlocked: undefined },
  );

  const blocked = patchActiveSessionSnapshotInList(
    [session("/tmp/test.json", { isBusy: true })],
    snapshot(true, { pendingToolApproval: { requestId: "test" } }),
  );
  assert.deepEqual(
    { isBusy: blocked[0].isBusy, isBlocked: blocked[0].isBlocked },
    { isBusy: true, isBlocked: true },
  );
});

test("unchanged snapshots preserve the current list reference", () => {
  const list = [session("/tmp/test.json", { displayName: "Updated title" })];
  assert.equal(patchActiveSessionSnapshotInList(list, snapshot(false)), null);
});
