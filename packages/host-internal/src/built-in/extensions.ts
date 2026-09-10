import { readFile } from "node:fs/promises";
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
 * In-process serialization for built-in ensures. The recopy swap
 * (rename target→backup, then staged→target) is not safe against a concurrent
 * ensure in the same process: Desktop pump ticks and IPC commands that bypass
 * runSerialized both ensure, and interleaved renames fail with
 * ENOENT/ENOTEMPTY (observed: three overlapping ensures in one Desktop main
 * process). Serializing here — instead of relying on every caller to hold a
 * lock — also lets each ensure re-list installed state, so two racing ensures
 * over a not-yet-installed entry take fresh-install then recopy, rather than
 * the second one failing on "already exists". Cross-process ensures (daemon
 * session create vs Desktop) are not covered; that window is rare and short.
 */
let ensureBuiltInQueue: Promise<unknown> = Promise.resolve();

export async function ensureBuiltInExtensions(
  request: EnsureBuiltInExtensionsRequest,
): Promise<readonly HostInstalledExtension[]> {
  const run = ensureBuiltInQueue.then(() => ensureBuiltInExtensionsInner(request));
  ensureBuiltInQueue = run.catch(() => undefined);
  return run;
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
