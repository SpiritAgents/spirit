import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionHostKind } from "../storage.js";
import {
  installPreparedExtensionDirectory,
  readPreparedExtensionManifestDirectory,
  type HostExtensionManager,
  type HostInstalledExtension,
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

export async function ensureBuiltInExtensions(
  request: EnsureBuiltInExtensionsRequest,
): Promise<readonly HostInstalledExtension[]> {
  const allowedIds = new Set<string>(
    (BUILT_IN_EXTENSION_IDS as readonly string[]).map((id) => id.toLowerCase()),
  );
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
    // removedExtensionIds are legacy tombstones written before built-in extensions became
    // non-removable; they keep historical uninstalls from re-seeding. New removals are refused.
    if (removed.has(extensionId) || installedIds.has(extensionId)) {
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
