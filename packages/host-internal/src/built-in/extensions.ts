import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionHostKind } from "../storage.js";
import {
  installPreparedExtensionDirectory,
  listInstalledExtensions,
  readPreparedExtensionManifestDirectory,
  type HostExtensionManager,
  type HostInstalledExtension,
  type HostMarketplaceCatalogItem,
} from "../extensions.js";
import { BUILT_IN_EXTENSION_IDS } from "./extension-ids.js";
import { loadBuiltInState } from "./state.js";

export { BUILT_IN_EXTENSION_IDS, isBuiltInExtensionId } from "./extension-ids.js";
export type { BuiltInExtensionId } from "./extension-ids.js";

export function resolveBuiltInExtensionsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "../../built-in/extensions");
}

export interface EnsureBuiltInExtensionsRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  manager: Pick<HostExtensionManager, "list" | "installPreparedDirectory">;
}

export interface ListMarketplaceCatalogRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
}

export interface InstallBuiltInExtensionRequest {
  spiritDataDir: string;
  hostKind: ExtensionHostKind;
  extensionId: string;
}

async function listBuiltInExtensionTemplateDirs(): Promise<string[]> {
  const root = resolveBuiltInExtensionsRoot();
  if (!existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directoryPath = path.join(root, entry.name);
    if (!existsSync(path.join(directoryPath, "package.json"))) {
      continue;
    }
    directories.push(directoryPath);
  }
  return directories.sort((left, right) => left.localeCompare(right, "en"));
}

function allowedBuiltInIds(): Set<string> {
  return new Set((BUILT_IN_EXTENSION_IDS as readonly string[]).map((id) => id.toLowerCase()));
}

export function shouldSkipBuiltInExtensionSeed(input: {
  extensionId: string;
  defaultInstalled?: boolean;
  removedIds: ReadonlySet<string>;
  installedIds: ReadonlySet<string>;
}): boolean {
  const extensionId = input.extensionId.trim().toLowerCase();
  if (!extensionId) {
    return true;
  }
  if (input.defaultInstalled === false) {
    return true;
  }
  return input.removedIds.has(extensionId) || input.installedIds.has(extensionId);
}

export async function ensureBuiltInExtensions(
  request: EnsureBuiltInExtensionsRequest,
): Promise<readonly HostInstalledExtension[]> {
  const allowedIds = allowedBuiltInIds();
  const { spiritDataDir, hostKind } = request;
  const state = await loadBuiltInState(spiritDataDir);
  const removed = new Set(state.removedExtensionIds.map((id) => id.toLowerCase()));
  const installed = await request.manager.list();
  const installedIds = new Set(installed.map((item) => item.id.toLowerCase()));
  const seeded: HostInstalledExtension[] = [];

  for (const templateDir of await listBuiltInExtensionTemplateDirs()) {
    let manifest;
    try {
      manifest = await readPreparedExtensionManifestDirectory(templateDir);
    } catch {
      continue;
    }

    const extensionId = manifest.id.trim().toLowerCase();
    if (!allowedIds.has(extensionId)) {
      continue;
    }
    if (!manifest.supportedHosts.includes(hostKind)) {
      continue;
    }
    if (
      shouldSkipBuiltInExtensionSeed({
        extensionId,
        defaultInstalled: manifest.defaultInstalled,
        removedIds: removed,
        installedIds,
      })
    ) {
      continue;
    }

    const next = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind },
      {
        preparedDirectoryPath: templateDir,
        installSource: "built-in",
        replaceExisting: false,
      },
    );
    installedIds.add(next.id.trim().toLowerCase());
    seeded.push(next);
  }

  return seeded;
}

export async function listMarketplaceCatalog(
  request: ListMarketplaceCatalogRequest,
): Promise<readonly HostMarketplaceCatalogItem[]> {
  const allowedIds = allowedBuiltInIds();
  const { spiritDataDir, hostKind } = request;
  const installed = await listInstalledExtensions({ spiritDataDir, hostKind });
  const installedById = new Map(installed.map((item) => [item.id.trim().toLowerCase(), item]));
  const catalog: HostMarketplaceCatalogItem[] = [];
  const seen = new Set<string>();

  for (const templateDir of await listBuiltInExtensionTemplateDirs()) {
    let manifest;
    try {
      manifest = await readPreparedExtensionManifestDirectory(templateDir);
    } catch {
      continue;
    }

    const extensionId = manifest.id.trim().toLowerCase();
    if (!allowedIds.has(extensionId)) {
      continue;
    }
    if (!manifest.supportedHosts.includes(hostKind)) {
      continue;
    }

    const installedItem = installedById.get(extensionId);
    catalog.push(
      installedItem
        ? { ...installedItem, installed: true }
        : {
            id: manifest.id,
            directoryName: path.basename(templateDir),
            manifest,
            directoryPath: templateDir,
            manifestPath: path.join(templateDir, "package.json"),
            installedAtUnixMs: 0,
            enabled: false,
            installSource: "built-in",
            installed: false,
          },
    );
    seen.add(extensionId);
  }

  for (const item of installed) {
    const extensionId = item.id.trim().toLowerCase();
    if (seen.has(extensionId)) {
      continue;
    }
    catalog.push({ ...item, installed: true });
  }

  return catalog.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

export async function installBuiltInExtension(
  request: InstallBuiltInExtensionRequest,
): Promise<HostInstalledExtension> {
  const extensionId = request.extensionId.trim().toLowerCase();
  if (!extensionId) {
    throw new Error("The extension id must not be empty.");
  }
  if (!allowedBuiltInIds().has(extensionId)) {
    throw new Error(`Unknown built-in extension: ${request.extensionId.trim()}`);
  }

  for (const templateDir of await listBuiltInExtensionTemplateDirs()) {
    let manifest;
    try {
      manifest = await readPreparedExtensionManifestDirectory(templateDir);
    } catch {
      continue;
    }

    if (manifest.id.trim().toLowerCase() !== extensionId) {
      continue;
    }
    if (!manifest.supportedHosts.includes(request.hostKind)) {
      throw new Error(
        `Built-in extension ${manifest.id} does not support the ${request.hostKind} host.`,
      );
    }

    return installPreparedExtensionDirectory(
      { spiritDataDir: request.spiritDataDir, hostKind: request.hostKind },
      {
        preparedDirectoryPath: templateDir,
        installSource: "built-in",
        replaceExisting: false,
      },
    );
  }

  throw new Error(`Built-in extension template not found: ${request.extensionId.trim()}`);
}
