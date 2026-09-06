import { cp, rm } from "node:fs/promises";
import path from "node:path";

import {
  EXTENSION_DUMP_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseExtensionDumpText,
  type MarketplaceExtensionEntry,
} from "@spiritagent/extension-toolkit";
import { readFile } from "node:fs/promises";

import type { HostInstalledExtension } from "../extensions.js";
import { installMarketplaceExtensionEntry } from "./install.js";
import {
  personalRegistryRoot,
  personalSourceRecord,
  upsertPersonalRegistryEntry,
} from "./personal.js";
import type { MarketplaceHostContext } from "./resolve.js";

export interface ImportPreparedDirectoryToPersonalRequest {
  /** Staged directory in install layout: content plus `.spirit/extension.json`. */
  preparedDirectoryPath: string;
  /** Original ZIP file name, recorded in the install registry. */
  fileName?: string;
}

/**
 * ZIP import reroute: write the self-declared content into the Personal
 * registry (`marketplaces/personal/extensions/<name>/`), append the entry to
 * its marketplace.json (reviewStatus fixed to unverified), then install from
 * the Personal source through the normal pipeline. Re-importing the same name
 * overwrites and refreshes the index entry.
 */
export async function importPreparedDirectoryToPersonal(
  context: MarketplaceHostContext,
  request: ImportPreparedDirectoryToPersonalRequest,
): Promise<HostInstalledExtension> {
  const preparedDirectoryPath = request.preparedDirectoryPath.trim();
  const dumpPath = path.join(
    preparedDirectoryPath,
    MARKETPLACE_SPIRIT_DIR_NAME,
    EXTENSION_DUMP_FILE_NAME,
  );
  const dump = parseExtensionDumpText(await readFile(dumpPath, "utf8"));

  const registryRoot = personalRegistryRoot(context.spiritDataDir);
  const contentDir = path.join(registryRoot, "extensions", dump.name);
  await rm(contentDir, { recursive: true, force: true });
  await cp(preparedDirectoryPath, contentDir, { recursive: true });

  const entry: MarketplaceExtensionEntry = {
    name: dump.name,
    version: dump.version,
    source: `./extensions/${dump.name}`,
    // The dump icon is install-dir-relative; the registry entry re-points it
    // at the content directory inside the Personal registry root.
    ...(dump.icon ? { icon: `extensions/${dump.name}/${dump.icon}` } : {}),
    displayName: dump.displayName,
    description: dump.description,
    ...(dump.author ? { author: dump.author } : {}),
    ...(dump.category ? { category: dump.category } : {}),
    reviewStatus: "unverified",
    manifest: dump.manifest,
  };
  await upsertPersonalRegistryEntry(context.spiritDataDir, entry);

  return installMarketplaceExtensionEntry(context, {
    source: personalSourceRecord(context.spiritDataDir),
    registryRoot: { kind: "path", path: registryRoot },
    entry,
    replaceExisting: true,
    ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
  });
}
