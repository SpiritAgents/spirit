import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BackgroundTaskRecord } from "@spiritagent/agent-core";
import { isBackgroundTaskOwnerAlive } from "./background-task-owner.js";

export interface RuntimeSessionLease {
  release(): Promise<void>;
}

/** SQLite's compare-and-swap keeps stale-owner recovery atomic across independent hosts. */
export async function acquireRuntimeSessionLease(
  spiritDataDir: string,
  sessionKey: string,
  owner: BackgroundTaskRecord["owner"],
): Promise<RuntimeSessionLease> {
  const directory = path.join(spiritDataDir, "session-storage-index");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "runtime-leases.sqlite");
  const open = () => {
    const database = new DatabaseSync(file);
    database.exec("PRAGMA busy_timeout = 5000");
    return database;
  };
  const database = open();
  const token = randomUUID();
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS runtime_leases (
      session_key TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_pid INTEGER NOT NULL
    )`);
    const inserted = database
      .prepare("INSERT OR IGNORE INTO runtime_leases VALUES (?, ?, ?, ?)")
      .run(sessionKey, token, owner.id, owner.pid);
    if (inserted.changes === 0) {
      const previous = database
        .prepare("SELECT token, owner_id, owner_pid FROM runtime_leases WHERE session_key = ?")
        .get(sessionKey);
      if (
        !previous ||
        typeof previous.token !== "string" ||
        typeof previous.owner_id !== "string" ||
        typeof previous.owner_pid !== "number"
      ) {
        throw new Error("Session ownership changed while opening. Retry the operation.");
      }
      if (
        await isBackgroundTaskOwnerAlive(spiritDataDir, {
          id: previous.owner_id,
          pid: previous.owner_pid,
        })
      ) {
        throw new Error("This session is active in another runtime. Reconnect to that host.");
      }
      const replaced = database
        .prepare(
          "UPDATE runtime_leases SET token = ?, owner_id = ?, owner_pid = ? WHERE session_key = ? AND token = ?",
        )
        .run(token, owner.id, owner.pid, sessionKey, previous.token);
      if (replaced.changes !== 1) {
        throw new Error("Session ownership changed while opening. Retry the operation.");
      }
    }
  } finally {
    database.close();
  }
  return {
    async release() {
      const database = open();
      try {
        database
          .prepare("DELETE FROM runtime_leases WHERE session_key = ? AND token = ?")
          .run(sessionKey, token);
      } finally {
        database.close();
      }
    },
  };
}
