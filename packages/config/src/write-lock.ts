import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const LOCK_FILE_NAME = "config.json.lock";
const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

/** Cross-process lock shared by Node and Rust writers of config.json. */
export async function withSpiritConfigWriteLock<T>(
  spiritDataDir: string,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(spiritDataDir, { recursive: true });
  const path = join(spiritDataDir, LOCK_FILE_NAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        return await work();
      } finally {
        await handle.close();
        await rm(path, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const state = await inspectLockState(path);
      if (state === "missing") {
        // Lock was released between open() and stat()/readFile(); retry without unlinking a
        // lock file that another writer may have already acquired in the meantime.
        continue;
      }
      if (state === "stale") {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the Spirit config write lock.");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

type LockState = "active" | "missing" | "stale";

async function inspectLockState(path: string): Promise<LockState> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "active";
  }
  if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
    return "stale";
  }
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "active";
  }
  let owner: { pid?: number };
  try {
    owner = JSON.parse(raw) as { pid?: number };
  } catch {
    // A freshly created lock file can briefly be empty or partially written between
    // open("wx") and handle.writeFile(); treat it as active until STALE_LOCK_MS expires.
    return "active";
  }
  if (!owner.pid || owner.pid === process.pid) {
    return "active";
  }
  try {
    process.kill(owner.pid, 0);
    return "active";
  } catch (error) {
    // EPERM means the process exists under another user; only ESRCH confirms it is gone.
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "stale" : "active";
  }
}
