import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, mkdir, open, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

export const SESSION_STORAGE_INDEX_DIR = "session-storage-index";
const INTERNAL_KEY = /^storage_([a-f0-9]{32})$/u;

export function sessionLookupHash(key: string): string {
  const trimmed = key.trim();
  const normalized = path.isAbsolute(trimmed) ? path.resolve(trimmed) : trimmed;
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 32);
}

function referencePath(spiritDataDir: string, key: string): string {
  return path.join(spiritDataDir, SESSION_STORAGE_INDEX_DIR, `${sessionLookupHash(key)}.json`);
}

export function readSessionStorageKey(
  spiritDataDir: string,
  lookupKey: string,
): string | undefined {
  if (INTERNAL_KEY.test(lookupKey)) return lookupKey;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(referencePath(spiritDataDir, lookupKey), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("storageKey" in value) ||
    typeof value.storageKey !== "string" ||
    !INTERNAL_KEY.test(value.storageKey) ||
    !("lookupHash" in value) ||
    value.lookupHash !== sessionLookupHash(lookupKey)
  ) {
    throw new Error("Invalid session storage identity.");
  }
  return value.storageKey;
}

export function sessionStorageDirectoryName(key: string): string {
  return INTERNAL_KEY.exec(key)?.[1] ?? sessionLookupHash(key);
}

/** Register a lookup alias without moving transcripts or changing their internal identity. */
export async function bindSessionStorageKey(
  spiritDataDir: string,
  lookupKey: string,
  storageKey: string,
): Promise<void> {
  if (!lookupKey.trim() || !INTERNAL_KEY.test(storageKey))
    throw new Error("Invalid session storage key.");
  const existing = readSessionStorageKey(spiritDataDir, lookupKey);
  if (existing) {
    if (existing !== storageKey)
      throw new Error("The conversation already belongs to another session.");
    return;
  }
  const lookupHash = sessionLookupHash(lookupKey);
  if (lookupHash !== sessionStorageDirectoryName(storageKey)) {
    const previousDirectory = path.join(spiritDataDir, "transcripts", lookupHash);
    try {
      if ((await readdir(previousDirectory)).length > 0) {
        throw new Error("The destination conversation already has transcript data.");
      }
      await rmdir(previousDirectory);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  const target = referencePath(spiritDataDir, lookupKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(
        JSON.stringify({ version: 1, lookupHash: sessionLookupHash(lookupKey), storageKey }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      if (readSessionStorageKey(spiritDataDir, lookupKey) !== storageKey) {
        throw new Error("The conversation was concurrently assigned to another session.");
      }
    }
  } finally {
    await unlink(temporary);
  }
}

export async function ensureSessionStorageKey(
  spiritDataDir: string,
  lookupKey: string,
): Promise<string> {
  if (!lookupKey.trim()) throw new Error("A session lookup key is required.");
  const existing = readSessionStorageKey(spiritDataDir, lookupKey);
  if (existing) return existing;
  // Adopting the existing directory preserves every previously issued transcript path.
  const storageKey = `storage_${sessionLookupHash(lookupKey)}`;
  await bindSessionStorageKey(spiritDataDir, lookupKey, storageKey);
  return storageKey;
}

export async function deleteSessionStorageReferences(
  spiritDataDir: string,
  storageKey: string,
): Promise<void> {
  const directory = path.join(spiritDataDir, SESSION_STORAGE_INDEX_DIR);
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const file of files) {
    if (!/^[a-f0-9]{32}\.json$/u.test(file)) continue;
    const target = path.join(directory, file);
    const value: unknown = JSON.parse(readFileSync(target, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "storageKey" in value &&
      value.storageKey === storageKey
    ) {
      await unlink(target);
    }
  }
}
