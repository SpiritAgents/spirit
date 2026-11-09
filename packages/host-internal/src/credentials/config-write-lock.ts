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
      if (await isStaleLock(path)) {
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

async function isStaleLock(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > STALE_LOCK_MS) return true;
    const owner = JSON.parse(await readFile(path, "utf8")) as { pid?: number };
    if (!owner.pid || owner.pid === process.pid) return false;
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}
