import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, watchFile } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteKeyringPassword,
  getKeyringPassword,
  setKeyringPassword,
} from "@spiritagent/config/keyring-secret";

export { loadToggleState, saveToggleState } from "@spiritagent/config/toggle-state";

export const EXTENSIONS_DIR_NAME = "extensions";
export const EXTENSIONS_INDEX_FILE_NAME = "extensions.json";
export const EXTENSIONS_STATE_FILE_NAME = "extensions-state.json";
export const EXTENSION_STATE_DIR_NAME = "extension-state";
export const SUPPORTED_EXTENSION_HOST_KINDS = ["desktop", "cli"] as const;

export type ExtensionHostKind = (typeof SUPPORTED_EXTENSION_HOST_KINDS)[number];
export type ExtensionSettingValue = string | number | boolean | null;

export interface ExtensionStateStore {
  loadSettings(extensionId: string): Promise<Record<string, ExtensionSettingValue>>;
  saveSettings(extensionId: string, values: Record<string, ExtensionSettingValue>): Promise<void>;
  loadSecret?(extensionId: string, key: string): Promise<string | undefined>;
  saveSecret?(extensionId: string, key: string, value: string): Promise<void>;
  deleteSecret?(extensionId: string, key: string): Promise<void>;
  updateSecret?(
    extensionId: string,
    key: string,
    updater: (current: string | undefined) => string | undefined | Promise<string | undefined>,
  ): Promise<string | undefined>;
  hasSecret?(extensionId: string, key: string): Promise<boolean>;
}

const KEYRING_SERVICE = "Spirit";

function extensionSecretAccount(extensionId: string, key: string): string {
  return `extension::${extensionId}::secret::${key}`;
}

export interface ExtensionManagementContext {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  stateStore?: ExtensionStateStore;
  /** Current UI locale; a callback keeps long-lived managers reactive to language changes. */
  locale?: string | (() => string);
}

export interface ExtensionPaths {
  extensionsDir: string;
  extensionsIndexFile: string;
  extensionsStateFile: string;
  extensionStateDir: string;
}

export function resolveExtensionPaths(context: ExtensionManagementContext): ExtensionPaths {
  const hostRoot = path.join(context.spiritDataDir, EXTENSIONS_DIR_NAME, context.hostKind);
  return {
    extensionsDir: hostRoot,
    extensionsIndexFile: path.join(hostRoot, EXTENSIONS_INDEX_FILE_NAME),
    extensionsStateFile: path.join(hostRoot, EXTENSIONS_STATE_FILE_NAME),
    extensionStateDir: path.join(hostRoot, EXTENSION_STATE_DIR_NAME),
  };
}

export function createFileExtensionStateStore(
  context: ExtensionManagementContext,
): ExtensionStateStore {
  const paths = resolveExtensionPaths(context);
  return {
    async loadSettings(extensionId) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      if (!existsSync(filePath)) {
        return {};
      }
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, ExtensionSettingValue>;
        return isExtensionSettingsRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    async saveSettings(extensionId, values) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    },
  };
}

export function createKeyringExtensionStateStore(
  context: ExtensionManagementContext,
  onSecretsChanged?: (extensionId: string) => void,
): ExtensionStateStore {
  const fileStore = createFileExtensionStateStore(context);
  const revisions = createExtensionSecretRevisionChannel(context, onSecretsChanged);
  return {
    loadSettings: (extensionId) => fileStore.loadSettings(extensionId),
    saveSettings: (extensionId, values) => fileStore.saveSettings(extensionId, values),
    async loadSecret(extensionId, key) {
      return getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
    },
    async saveSecret(extensionId, key, value) {
      setKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key), value);
      onSecretsChanged?.(extensionId);
      await revisions.publish(extensionId);
    },
    async deleteSecret(extensionId, key) {
      deleteKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      onSecretsChanged?.(extensionId);
      await revisions.publish(extensionId);
    },
    async hasSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      return value !== undefined && value.length > 0;
    },
  };
}

function createExtensionSecretRevisionChannel(
  context: ExtensionManagementContext,
  onSecretsChanged?: (extensionId: string) => void,
) {
  const directory = resolveExtensionPaths(context).extensionStateDir;
  const origin = randomUUID();
  const latestRevisions = new Map<string, string>();
  if (onSecretsChanged) {
    mkdirSync(directory, { recursive: true });
    let scanning = false;
    const scan = async () => {
      if (scanning) return;
      scanning = true;
      try {
        for (const name of await readdir(directory)) {
          if (!name.endsWith(".secrets-revision.json")) continue;
          const revisionPath = path.join(directory, name);
          try {
            const revision = JSON.parse(await readFile(revisionPath, "utf8")) as {
              origin: string;
              revision: string;
              extensionId: string;
            };
            if (
              revision.origin === origin ||
              latestRevisions.get(revisionPath) === revision.revision
            ) {
              continue;
            }
            latestRevisions.set(revisionPath, revision.revision);
            onSecretsChanged(revision.extensionId);
          } catch {
            // A peer may replace the revision file again before this notification is read.
          }
        }
      } catch {
        // The data directory may be removed while the host is shutting down.
      } finally {
        scanning = false;
      }
    };
    watchFile(directory, { persistent: false, interval: 100 }, () => {
      void scan();
    });
  }
  return {
    async publish(extensionId: string) {
      await mkdir(directory, { recursive: true });
      const revisionPath = path.join(
        directory,
        `${encodeExtensionStorageName(extensionId)}.secrets-revision.json`,
      );
      const temporaryPath = `${revisionPath}.${origin}.tmp`;
      await writeFile(
        temporaryPath,
        JSON.stringify({ origin, revision: randomUUID(), extensionId }),
        "utf8",
      );
      await rename(temporaryPath, revisionPath);
    },
  };
}

const EXTENSION_SECRET_LOCK_TIMEOUT_MS = 65_000;
const EXTENSION_SECRET_STALE_LOCK_MS = 120_000;
const activeExtensionSecretLockTokens = new Set<string>();

/**
 * Serializes Secret writers that share a Spirit data directory, including writers in other processes.
 * The lock contains only process metadata; credentials never leave the state store.
 */
export async function withExtensionSecretLock<T>(
  context: ExtensionManagementContext,
  extensionId: string,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const directory = resolveExtensionPaths(context).extensionStateDir;
  await mkdir(directory, { recursive: true });
  const lockName = `${encodeExtensionStorageName(extensionId)}-${Buffer.from(key, "utf8").toString("base64url")}.lock`;
  const lockPath = path.join(directory, lockName);
  const owner = await acquireExtensionSecretLock(lockPath, true);
  try {
    return await work();
  } finally {
    await releaseExtensionSecretLock(owner);
  }
}

interface ExtensionSecretLockOwner {
  path: string;
  token: string;
  handle: Awaited<ReturnType<typeof open>>;
}

async function acquireExtensionSecretLock(
  lockPath: string,
  allowRecovery: boolean,
): Promise<ExtensionSecretLockOwner> {
  const deadline = Date.now() + EXTENSION_SECRET_LOCK_TIMEOUT_MS;
  for (;;) {
    let handle: Awaited<ReturnType<typeof open>>;
    const token = randomUUID();
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStaleExtensionSecretLock(lockPath)) {
        if (!allowRecovery) {
          await rm(lockPath, { force: true });
          continue;
        }
        // Only one recovery owner may remove a stale lock. Normal acquirers still
        // use O_EXCL, so a recovery that loses the race cannot enter the work section.
        const recovery = await acquireExtensionSecretLock(`${lockPath}.recovery`, false);
        try {
          if (
            (await isExtensionSecretLockOwner(recovery)) &&
            (await isStaleExtensionSecretLock(lockPath))
          ) {
            await rm(lockPath, { force: true });
          }
        } finally {
          await releaseExtensionSecretLock(recovery);
        }
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for an extension Secret write lock.");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    const owner = { path: lockPath, token, handle };
    try {
      activeExtensionSecretLockTokens.add(token);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now(), token }));
      if (await isExtensionSecretLockOwner(owner)) return owner;
      await releaseExtensionSecretLock(owner);
    } catch (error) {
      await releaseExtensionSecretLock(owner);
      throw error;
    }
  }
}

async function isExtensionSecretLockOwner(owner: ExtensionSecretLockOwner): Promise<boolean> {
  try {
    const current = JSON.parse(await readFile(owner.path, "utf8")) as { token?: string };
    return current.token === owner.token;
  } catch {
    return false;
  }
}

async function releaseExtensionSecretLock(owner: ExtensionSecretLockOwner): Promise<void> {
  await owner.handle.close().finally(() => {
    activeExtensionSecretLockTokens.delete(owner.token);
  });
  if (await isExtensionSecretLockOwner(owner)) {
    await rm(owner.path, { force: true });
  }
}

/** Adds the same cross-process write boundary to file, keyring, and host-provided state stores. */
export function createAtomicExtensionStateStore(
  context: ExtensionManagementContext,
  store: ExtensionStateStore,
): ExtensionStateStore {
  const lock = <T>(extensionId: string, key: string, work: () => Promise<T>): Promise<T> =>
    withExtensionSecretLock(context, extensionId, key, work);
  const requireReader = () => {
    if (!store.loadSecret) {
      throw new Error("The current host does not implement extension Secret storage.");
    }
    return store.loadSecret.bind(store);
  };
  return {
    loadSettings: (extensionId) => store.loadSettings(extensionId),
    saveSettings: (extensionId, values) => store.saveSettings(extensionId, values),
    ...(store.loadSecret
      ? { loadSecret: (extensionId: string, key: string) => store.loadSecret!(extensionId, key) }
      : {}),
    ...(store.saveSecret
      ? {
          saveSecret: async (extensionId: string, key: string, value: string) => {
            await lock(extensionId, key, async () => {
              const current = await requireReader()(extensionId, key);
              if (current === value) return;
              await store.saveSecret!(extensionId, key, value);
            });
          },
        }
      : {}),
    ...(store.deleteSecret
      ? {
          deleteSecret: async (extensionId: string, key: string) => {
            await lock(extensionId, key, async () => {
              const current = await requireReader()(extensionId, key);
              if (current === undefined) return;
              await store.deleteSecret!(extensionId, key);
            });
          },
        }
      : {}),
    async updateSecret(extensionId, key, updater) {
      return lock(extensionId, key, async () => {
        const read = requireReader();
        const current = await read(extensionId, key);
        const next = await updater(current);
        if (next === current) return current;
        if (next === undefined) {
          if (current !== undefined) {
            if (!store.deleteSecret) {
              throw new Error("The current host does not implement extension Secret deletion.");
            }
            await store.deleteSecret(extensionId, key);
          }
          return undefined;
        }
        if (!store.saveSecret) {
          throw new Error("The current host does not implement extension Secret storage.");
        }
        await store.saveSecret(extensionId, key, next);
        return next;
      });
    },
    ...(store.hasSecret
      ? { hasSecret: (extensionId: string, key: string) => store.hasSecret!(extensionId, key) }
      : {}),
  };
}

async function isStaleExtensionSecretLock(lockPath: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(lockPath);
  } catch {
    return true;
  }
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number; token?: string };
    if (owner.pid) {
      if (owner.pid === process.pid) {
        return !owner.token || !activeExtensionSecretLockTokens.has(owner.token);
      }
      try {
        process.kill(owner.pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
        return true;
      }
    }
    return Date.now() - info.mtimeMs > EXTENSION_SECRET_STALE_LOCK_MS;
  } catch {
    // A writer can be observed between creating the lock and writing its owner metadata.
    return Date.now() - info.mtimeMs > EXTENSION_SECRET_STALE_LOCK_MS;
  }
}

function extensionSettingsFilePath(paths: ExtensionPaths, extensionId: string): string {
  return path.join(paths.extensionStateDir, `${encodeExtensionStorageName(extensionId)}.json`);
}

function encodeExtensionStorageName(extensionId: string): string {
  return `ext-${Buffer.from(extensionId, "utf8").toString("base64url")}`;
}

function isExtensionSettingsRecord(
  value: Record<string, ExtensionSettingValue> | unknown,
): value is Record<string, ExtensionSettingValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );
}
