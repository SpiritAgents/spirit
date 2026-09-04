import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { x as extractTar } from "tar";

import {
  assertMarketplaceIconSvgContent,
  EXTENSION_DUMP_FILE_NAME,
  EXTENSION_DUMP_SCHEMA_VERSION,
  MARKETPLACE_SPIRIT_DIR_NAME,
  resolveMarketplaceExtensionSource,
  resolveRegistryRelativeUrl,
  type MarketplaceExtensionDump,
  type MarketplaceExtensionEntry,
} from "@spiritagent/marketplace-toolkit";

import { installPreparedExtensionDirectory, type HostInstalledExtension } from "../extensions.js";
import type { ExtensionManagementContext } from "../storage.js";
import type { MarketplaceIndexFetch } from "./http-index-source.js";
import type { MarketplaceRegistryRoot, MarketplaceSourceRecord } from "./types.js";

const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
const SUPPORTED_SRI_HASH_ALGORITHMS = new Set(["sha256", "sha384", "sha512"]);

export interface MarketplaceInstallContext extends ExtensionManagementContext {
  /** Injectable fetch (packument / tarball / registry assets); tests must not touch the network. */
  fetchImpl?: MarketplaceIndexFetch;
}

/** Build the install-dump object for a registry entry (identity + display + declaration + source id). */
export function buildExtensionDumpFromEntry(
  entry: MarketplaceExtensionEntry,
  sourceId: string,
  options?: { icon?: string },
): MarketplaceExtensionDump {
  const icon = options?.icon ?? entry.icon;
  return {
    schemaVersion: EXTENSION_DUMP_SCHEMA_VERSION,
    name: entry.name,
    version: entry.version,
    sourceId,
    displayName: entry.displayName,
    description: entry.description,
    ...(icon ? { icon } : {}),
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.categories?.length ? { categories: [...entry.categories] } : {}),
    manifest: entry.manifest,
  };
}

export interface InstallMarketplaceExtensionEntryRequest {
  /** The source the entry was resolved from (its id becomes the install identity). */
  source: MarketplaceSourceRecord;
  registryRoot: MarketplaceRegistryRoot;
  entry: MarketplaceExtensionEntry;
  replaceExisting?: boolean;
  /** Original ZIP file name for Personal imports, recorded in the install registry. */
  fileName?: string;
}

/**
 * Marketplace install pipeline: stage content from the entry's artifact
 * backend (npm tarball verified against the packument SRI, or a local copy
 * from the registry root), dump the entry's identity + display + declaration
 * plus the owning source id into `.spirit/extension.json`, then move into
 * `extensions/<host>/<sourceId>/<name>/`.
 */
export async function installMarketplaceExtensionEntry(
  context: MarketplaceInstallContext,
  request: InstallMarketplaceExtensionEntryRequest,
): Promise<HostInstalledExtension> {
  const { source, registryRoot, entry } = request;
  const fieldName = `extensions[${entry.name}].source`;
  const resolved = resolveMarketplaceExtensionSource(entry.source, fieldName);

  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "spirit-marketplace-install-"));
  const stagingDirectory = path.join(stagingRoot, "content");
  try {
    await mkdir(stagingDirectory, { recursive: true });

    if (resolved.kind === "local") {
      await stageLocalSourceContent(registryRoot, resolved.path, entry.name, stagingDirectory);
    } else {
      await stageNpmSourceContent(context, entry.name, resolved, stagingDirectory);
    }

    const dumpDir = path.join(stagingDirectory, MARKETPLACE_SPIRIT_DIR_NAME);
    await mkdir(dumpDir, { recursive: true });

    let dumpIcon: string | undefined;
    if (entry.icon) {
      const iconBytes = await readRegistryAsset(context, registryRoot, entry.icon);
      assertMarketplaceIconSvgContent(iconBytes.toString("utf8"), `extensions[${entry.name}].icon`);
      dumpIcon = `${MARKETPLACE_SPIRIT_DIR_NAME}/icon.svg`;
      await writeFile(path.join(stagingDirectory, dumpIcon), iconBytes);
    }

    const dump = buildExtensionDumpFromEntry(entry, source.id, {
      ...(dumpIcon ? { icon: dumpIcon } : {}),
    });
    await writeFile(
      path.join(dumpDir, EXTENSION_DUMP_FILE_NAME),
      `${JSON.stringify(dump, null, 2)}\n`,
      "utf8",
    );

    return await installPreparedExtensionDirectory(context, {
      preparedDirectoryPath: stagingDirectory,
      replaceExisting: request.replaceExisting === true,
      ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
    });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function stageLocalSourceContent(
  registryRoot: MarketplaceRegistryRoot,
  relativePath: string,
  extensionName: string,
  stagingDirectory: string,
): Promise<void> {
  if (registryRoot.kind !== "path") {
    // A local source's content is a directory; plain HTTP registries cannot
    // list directories, so local sources require a local or git registry.
    throw new Error(
      `Extension ${extensionName} uses a local source, which requires a local or git marketplace registry.`,
    );
  }
  const contentDir = path.join(registryRoot.path, ...relativePath.split("/"));
  if (!existsSync(contentDir)) {
    throw new Error(
      `Extension ${extensionName} content directory does not exist in the registry: ${relativePath}`,
    );
  }
  await cp(contentDir, stagingDirectory, { recursive: true });
}

async function stageNpmSourceContent(
  context: MarketplaceInstallContext,
  extensionName: string,
  resolved: { packageName: string; version: string },
  stagingDirectory: string,
): Promise<void> {
  const fetchImpl = context.fetchImpl ?? ((url: string) => fetch(url));
  const specifier = `${resolved.packageName}@${resolved.version}`;

  const packumentUrl = `${NPM_REGISTRY_BASE_URL}/${resolved.packageName.replace("/", "%2F")}`;
  const packumentResponse = await fetchImpl(packumentUrl);
  if (!packumentResponse.ok) {
    throw new Error(
      `Failed to fetch the npm packument for ${resolved.packageName} (extension ${extensionName}): HTTP ${packumentResponse.status}`,
    );
  }
  const packument: unknown = JSON.parse(await packumentResponse.text());
  const versions = isRecord(packument) ? packument["versions"] : undefined;
  const versionEntry = isRecord(versions) ? versions[resolved.version] : undefined;
  const dist = isRecord(versionEntry) ? versionEntry["dist"] : undefined;
  const tarballUrl = isRecord(dist) ? dist["tarball"] : undefined;
  const integrity = isRecord(dist) ? dist["integrity"] : undefined;
  if (typeof tarballUrl !== "string" || !tarballUrl) {
    throw new Error(`The npm packument for ${specifier} is missing dist.tarball.`);
  }
  if (typeof integrity !== "string" || !integrity) {
    throw new Error(`The npm packument for ${specifier} is missing dist.integrity (SRI).`);
  }

  const tarballResponse = await fetchImpl(tarballUrl);
  if (!tarballResponse.ok) {
    throw new Error(
      `Failed to download the npm tarball for ${specifier}: HTTP ${tarballResponse.status}`,
    );
  }
  const tarballBuffer = Buffer.from(await tarballResponse.arrayBuffer());
  assertTarballIntegrity(tarballBuffer, integrity, specifier);

  const tarballPath = path.join(path.dirname(stagingDirectory), "package.tgz");
  const extractDir = path.join(path.dirname(stagingDirectory), "tarball");
  await mkdir(extractDir, { recursive: true });
  await writeFile(tarballPath, tarballBuffer);
  await extractTar({ file: tarballPath, cwd: extractDir });
  const packageRoot = path.join(extractDir, "package");
  if (!existsSync(packageRoot)) {
    throw new Error(`The npm tarball for ${specifier} is missing the package/ root directory.`);
  }
  await cp(packageRoot, stagingDirectory, { recursive: true });
}

function assertTarballIntegrity(buffer: Buffer, integrity: string, specifier: string): void {
  const matched = integrity
    .split(/\s+/u)
    .filter(Boolean)
    .some((entry) => verifySriEntry(buffer, entry));
  if (!matched) {
    throw new Error(`Extension tarball integrity verification failed: ${specifier}`);
  }
}

function verifySriEntry(buffer: Buffer, entry: string): boolean {
  const separatorIndex = entry.indexOf("-");
  if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
    return false;
  }
  const algorithm = entry.slice(0, separatorIndex).toLowerCase();
  if (!SUPPORTED_SRI_HASH_ALGORITHMS.has(algorithm)) {
    return false;
  }
  const expected = entry.slice(separatorIndex + 1);
  try {
    const actual = createHash(algorithm).update(buffer).digest("base64");
    return actual === expected;
  } catch {
    return false;
  }
}

/** Read a registry-root-relative asset (icon) from a local/git path root or an HTTP index root. */
async function readRegistryAsset(
  context: MarketplaceInstallContext,
  registryRoot: MarketplaceRegistryRoot,
  relativePath: string,
): Promise<Buffer> {
  if (registryRoot.kind === "path") {
    return readFile(path.join(registryRoot.path, ...relativePath.split("/")));
  }
  const fetchImpl = context.fetchImpl ?? ((url: string) => fetch(url));
  const url = resolveRegistryRelativeUrl(registryRoot.url, relativePath);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch registry asset ${relativePath}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
