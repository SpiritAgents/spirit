import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createBackgroundTaskOwner, type BackgroundTaskOwner } from "./background-task-owner.js";
import { acquireRuntimeSessionLease } from "./runtime-session-lease.js";

const owners = new Set<BackgroundTaskOwner>();
const roots: string[] = [];
afterEach(async () => {
  for (const owner of owners) await owner.close();
  owners.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lease-"));
  roots.push(root);
  const owner = async () => {
    const result = await createBackgroundTaskOwner(root);
    owners.add(result);
    return result;
  };
  return { root, owner };
}

it("excludes another runtime even when the session has no tasks", async () => {
  const { root, owner } = await fixture();
  const first = await owner();
  const second = await owner();
  const lease = await acquireRuntimeSessionLease(root, "session", first.owner);
  await expect(acquireRuntimeSessionLease(root, "session", second.owner)).rejects.toThrow(
    "active in another runtime",
  );
  await expect(acquireRuntimeSessionLease(root, "session", first.owner)).rejects.toThrow(
    "active in another runtime",
  );
  await lease.release();
  const next = await acquireRuntimeSessionLease(root, "session", second.owner);
  await next.release();
});

it("allows only one claimant to replace a dead owner and rejects stale releases", async () => {
  const { root, owner } = await fixture();
  const previous = await owner();
  const oldLease = await acquireRuntimeSessionLease(root, "session", previous.owner);
  await previous.close();
  owners.delete(previous);
  const first = await owner();
  const second = await owner();
  const attempts = await Promise.allSettled([
    acquireRuntimeSessionLease(root, "session", first.owner),
    acquireRuntimeSessionLease(root, "session", second.owner),
  ]);
  const winners = attempts.filter((result) => result.status === "fulfilled");
  expect(winners).toHaveLength(1);
  await oldLease.release();
  const observer = await owner();
  await expect(acquireRuntimeSessionLease(root, "session", observer.owner)).rejects.toThrow(
    "active in another runtime",
  );
  await winners[0]!.value.release();
  const next = await acquireRuntimeSessionLease(root, "session", observer.owner);
  await next.release();
});
