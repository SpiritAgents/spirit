import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseMarketplaceIndexText,
  type MarketplaceExtensionEntry,
  type MarketplaceIndex,
} from "@spiritagent/extension-toolkit";

import {
  buildHostExtensionManifestFromDump,
  composeExtensionId,
  listInstalledExtensions,
  type HostExtensionManager,
  type HostInstalledExtension,
  type HostMarketplaceCatalogItem,
} from "../extensions.js";
import {
  buildExtensionDumpFromEntry,
  installMarketplaceExtensionEntry,
} from "../marketplace/install.js";
import {
  BUILT_IN_MARKETPLACE_SOURCE_ID,
  type MarketplaceRegistryRoot,
  type MarketplaceSourceRecord,
} from "../marketplace/types.js";
import type { ExtensionHostKind } from "../storage.js";
import { loadBuiltInState } from "./state.js";

/**
 * The built-in registry root shipped inside the host-internal package:
 * `built-in/.spirit/marketplace.json` + `built-in/extensions/<name>/`.
 * Same format as any remote registry; only the artifact backend differs
 * (local copy of prebuilt content).
 */
export function resolveBuiltInRegistryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "../../built-in");
}

export function builtInMarketplaceSourceRecord(
  index?: MarketplaceIndex,
  registryRoot?: string,
): MarketplaceSourceRecord {
  return {
    id: BUILT_IN_MARKETPLACE_SOURCE_ID,
    name: index?.name ?? BUILT_IN_MARKETPLACE_SOURCE_ID,
    displayName: index?.displayName ?? "Built-in",
    kind: "local",
    locator: registryRoot ?? resolveBuiltInRegistryRoot(),
    addedAtUnixMs: 0,
  };
}

export async function readBuiltInMarketplaceIndex(
  registryRoot?: string,
): Promise<MarketplaceIndex> {
  const indexPath = path.join(
    registryRoot ?? resolveBuiltInRegistryRoot(),
    MARKETPLACE_SPIRIT_DIR_NAME,
    MARKETPLACE_INDEX_FILE_NAME,
  );
  return parseMarketplaceIndexText(await readFile(indexPath, "utf8"));
}

function builtInRegistryRoot(registryRoot?: string): MarketplaceRegistryRoot {
  return { kind: "path", path: registryRoot ?? resolveBuiltInRegistryRoot() };
}

/** Registry-root-relative content directory of a built-in entry (local source). */
function builtInEntryContentDir(entry: MarketplaceExtensionEntry, registryRoot?: string): string {
  const relative = typeof entry.source === "string" ? entry.source : `extensions/${entry.name}`;
  return path.join(registryRoot ?? resolveBuiltInRegistryRoot(), ...relative.split("/"));
}

export interface EnsureBuiltInExtensionsRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  manager: Pick<HostExtensionManager, "list">;
  /** Test-only override for the built-in registry root. */
  registryRoot?: string;
}

export interface ListMarketplaceCatalogRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  /** Test-only override for the built-in registry root. */
  registryRoot?: string;
}

export interface InstallBuiltInExtensionRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  extensionId: string;
  /** Test-only override for the built-in registry root. */
  registryRoot?: string;
}

/**
 * Serialization for built-in ensures, at two scopes:
 * - In-process (promise queue): Desktop pump ticks and IPC commands that
 *   bypass runSerialized both ensure, and interleaved recopy renames fail
 *   with ENOENT/ENOTEMPTY (observed: three overlapping ensures in one Desktop
 *   main process). The queue also lets each ensure re-list installed state,
 *   so two racing ensures over a not-yet-installed entry take fresh-install
 *   then recopy, rather than the second one failing on "already exists".
 * - Cross-process (mkdir lock): the Desktop host and the daemon share
 *   `<dataDir>/extensions/<host>/` and both seed at startup. mkdir is atomic
 *   across processes; the pid file lets a waiter break the lock when the
 *   holder crashed mid-ensure. On timeout the ensure proceeds anyway: the
 *   recopy is idempotent and a wedged lock must not block host startup.
 */
let ensureBuiltInQueue: Promise<unknown> = Promise.resolve();

export async function ensureBuiltInExtensions(
  request: EnsureBuiltInExtensionsRequest,
): Promise<readonly HostInstalledExtension[]> {
  const run = ensureBuiltInQueue.then(async () => {
    const release = await acquireBuiltInEnsureLock(
      builtInEnsureLockDir(request.spiritDataDir, request.hostKind),
    );
    try {
      return await ensureBuiltInExtensionsInner(request);
    } finally {
      await release();
    }
  });
  ensureBuiltInQueue = run.catch(() => undefined);
  return run;
}

const BUILT_IN_ENSURE_LOCK_RETRY_MS = 25;
const BUILT_IN_ENSURE_LOCK_TIMEOUT_MS = 10_000;

function builtInEnsureLockDir(spiritDataDir: string, hostKind: ExtensionHostKind): string {
  // Outside extensions/: a lock dir inside the install tree would be scanned
  // as a source directory when listing installed extensions.
  return path.join(spiritDataDir, ".locks", `built-in-ensure-${hostKind}`);
}

async function acquireBuiltInEnsureLock(lockDir: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + BUILT_IN_ENSURE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      // Non-recursive mkdir is the atomic acquire: it throws EEXIST while held.
      await mkdir(lockDir);
      await writeFile(path.join(lockDir, "pid"), String(process.pid), "utf8");
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw error;
      }
      const holderPid = await readBuiltInEnsureLockHolder(lockDir);
      if (holderPid !== undefined && !isProcessAlive(holderPid)) {
        // The holder crashed between acquire and release; break the stale lock.
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        return async () => {};
      }
      await new Promise((resolve) => setTimeout(resolve, BUILT_IN_ENSURE_LOCK_RETRY_MS));
    }
  }
}

async function readBuiltInEnsureLockHolder(lockDir: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path.join(lockDir, "pid"), "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    // The holder creates the lock dir first and writes the pid file after; a
    // missing pid file means the holder is mid-acquire, not stale.
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive but owned by another user; ESRCH: gone.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * Install every `defaultInstalled` entry of the built-in registry, and
 * reinstall already-installed built-ins from the bundled registry on every
 * ensure (no version gate: built-in edits often keep the same version).
 * Removal tombstones are honored for seeding.
 */
async function ensureBuiltInExtensionsInner(
  request: EnsureBuiltInExtensionsRequest,
): Promise<readonly HostInstalledExtension[]> {
  const { spiritDataDir, hostKind } = request;
  const state = await loadBuiltInState(spiritDataDir);
  const removed = new Set(state.removedExtensionIds.map((id) => id.toLowerCase()));
  const installed = await request.manager.list();
  const installedById = new Map(installed.map((item) => [item.id, item]));

  const index = await readBuiltInMarketplaceIndex(request.registryRoot);
  const source = builtInMarketplaceSourceRecord(index, request.registryRoot);
  const registryRoot = builtInRegistryRoot(request.registryRoot);
  const seeded: HostInstalledExtension[] = [];

  for (const entry of index.extensions) {
    if (!entry.manifest.supportedHosts.includes(hostKind)) {
      continue;
    }
    const id = composeExtensionId(source.id, entry.name);
    const installedItem = installedById.get(id);
    if (installedItem) {
      // Recopy even when the marketplace version is unchanged. Built-in
      // edits (MCP server stubs, hints, assets) usually keep the same
      // version, so a version gate would leave the installed tree stale.
      seeded.push(
        await installMarketplaceExtensionEntry(
          { spiritDataDir, hostKind },
          { source, registryRoot, entry, replaceExisting: true },
        ),
      );
      continue;
    }
    if (entry.defaultInstalled === false || removed.has(id.toLowerCase())) {
      continue;
    }
    seeded.push(
      await installMarketplaceExtensionEntry(
        { spiritDataDir, hostKind },
        { source, registryRoot, entry },
      ),
    );
  }

  return seeded;
}

export async function listMarketplaceCatalog(
  request: ListMarketplaceCatalogRequest,
): Promise<readonly HostMarketplaceCatalogItem[]> {
  const { spiritDataDir, hostKind } = request;
  const installed = await listInstalledExtensions({ spiritDataDir, hostKind });
  const installedById = new Map(installed.map((item) => [item.id, item]));
  const catalog: HostMarketplaceCatalogItem[] = [];
  const seen = new Set<string>();

  const index = await readBuiltInMarketplaceIndex(request.registryRoot);
  const source = builtInMarketplaceSourceRecord(index, request.registryRoot);

  for (const entry of index.extensions) {
    if (!entry.manifest.supportedHosts.includes(hostKind)) {
      continue;
    }
    const id = composeExtensionId(source.id, entry.name);
    const installedItem = installedById.get(id);
    if (installedItem) {
      catalog.push({ ...installedItem, installed: true });
    } else {
      const contentDir = builtInEntryContentDir(entry, request.registryRoot);
      catalog.push({
        id,
        sourceId: source.id,
        relativePath: `${source.id}/${entry.name}`,
        manifest: await buildHostExtensionManifestFromDump(
          buildExtensionDumpFromEntry(entry, source.id),
          contentDir,
        ),
        directoryPath: contentDir,
        manifestPath: path.join(contentDir, MARKETPLACE_SPIRIT_DIR_NAME, "extension.json"),
        installedAtUnixMs: 0,
        enabled: false,
        installSource: "built-in",
        installed: false,
      });
    }
    seen.add(id);
  }

  // Installed extensions from any other source still surface in the catalog.
  for (const item of installed) {
    if (seen.has(item.id)) {
      continue;
    }
    catalog.push({ ...item, installed: true });
  }

  return catalog.sort((left, right) =>
    left.manifest.displayName.localeCompare(right.manifest.displayName, "en"),
  );
}

export async function installBuiltInExtension(
  request: InstallBuiltInExtensionRequest,
): Promise<HostInstalledExtension> {
  const extensionId = request.extensionId.trim();
  if (!extensionId) {
    throw new Error("The extension id must not be empty.");
  }

  const index = await readBuiltInMarketplaceIndex(request.registryRoot);
  const source = builtInMarketplaceSourceRecord(index, request.registryRoot);
  const entry = index.extensions.find(
    (candidate) =>
      composeExtensionId(source.id, candidate.name) === extensionId ||
      candidate.name === extensionId,
  );
  if (!entry) {
    throw new Error(`Unknown built-in extension: ${extensionId}`);
  }
  if (!entry.manifest.supportedHosts.includes(request.hostKind)) {
    throw new Error(
      `Built-in extension ${entry.name} does not support the ${request.hostKind} host.`,
    );
  }

  return installMarketplaceExtensionEntry(
    { spiritDataDir: request.spiritDataDir, hostKind: request.hostKind },
    { source, registryRoot: builtInRegistryRoot(request.registryRoot), entry },
  );
}
