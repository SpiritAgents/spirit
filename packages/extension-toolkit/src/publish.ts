/**
 * `extension-toolkit publish <extension-dir> <marketplace-dir>`: upsert the
 * extension's self-declared dump into a marketplace registry index and copy
 * the content the entry's source needs — the full package for local sources,
 * just the self-hosted icon for npm sources. Every check runs before any
 * write; the index is never partially written.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { checkExtensionPackage } from "./check-package.js";
import { buildMarketplaceEntryFromDump } from "./entry-from-dump.js";
import { EXCLUDED_DIR_NAMES } from "./pack.js";
import {
  EXTENSION_DUMP_FILE_NAME,
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseExtensionDumpText,
  parseMarketplaceIndex,
  parseNpmPackageSpecifier,
  type MarketplaceExtensionEntry,
  type MarketplaceExtensionSource,
  type MarketplaceReviewStatus,
} from "./schema.js";

export type PublishSourceKind = "local" | "npm";

export interface PublishExtensionOptions {
  /** Entry source backend; defaults to "local". */
  source?: PublishSourceKind;
  /** Validate and report the plan without writing anything. */
  dryRun?: boolean;
}

export interface PublishExtensionResult {
  /** The entry as merged (or that would be merged) into the index. */
  entry: MarketplaceExtensionEntry;
  /** True when a same-name entry existed and was replaced in place. */
  replacedExisting: boolean;
  sourceKind: PublishSourceKind;
  /**
   * Package-relative files copied into the registry content directory — in a
   * dry run, the files that would be copied.
   */
  copiedFiles: string[];
  /** Registry-root-relative content directory, when the entry needs one. */
  contentDirRelative?: string;
  /** The extension already lives at `extensions/<name>/`; no copy happened. */
  contentAlreadyInPlace: boolean;
  dryRun: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** npm sources pin `name@version` from the package's own pure-npm package.json. */
async function readNpmSpecifierFromPackageJson(extensionDir: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(path.join(extensionDir, "package.json"), "utf8");
  } catch {
    throw new Error(`--source npm needs a package.json in ${extensionDir}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The extension package.json is not valid JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`--source npm needs package.json "name" and "version" strings.`);
  }
  const specifier = `${parsed.name}@${parsed.version}`;
  parseNpmPackageSpecifier(specifier, "package.json name@version");
  return specifier;
}

/** Files a local-source copy brings over, package-relative, exclusions applied. */
async function listCopyableFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(currentDir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await walk(dir, "");
  return files;
}

export async function publishExtension(
  extensionDir: string,
  marketplaceDir: string,
  options: PublishExtensionOptions = {},
): Promise<PublishExtensionResult> {
  const sourceKind = options.source ?? "local";
  const dryRun = options.dryRun ?? false;

  const dumpRelativePath = `${MARKETPLACE_SPIRIT_DIR_NAME}/${EXTENSION_DUMP_FILE_NAME}`;
  let dumpRaw: string;
  try {
    dumpRaw = await readFile(path.join(extensionDir, dumpRelativePath), "utf8");
  } catch {
    throw new Error(
      `No ${dumpRelativePath} in ${extensionDir}. Scaffold the self-declared manifest first: extension-toolkit init`,
    );
  }
  const dump = parseExtensionDumpText(dumpRaw);

  const findings = await checkExtensionPackage(extensionDir);
  if (findings.length > 0) {
    throw new Error(
      `check failed for ${extensionDir}:\n${findings.map((finding) => `${finding.path}: ${finding.message}`).join("\n")}`,
    );
  }

  const indexPath = path.join(
    marketplaceDir,
    MARKETPLACE_SPIRIT_DIR_NAME,
    MARKETPLACE_INDEX_FILE_NAME,
  );
  let indexRawText: string;
  try {
    indexRawText = await readFile(indexPath, "utf8");
  } catch {
    throw new Error(
      `No ${MARKETPLACE_SPIRIT_DIR_NAME}/${MARKETPLACE_INDEX_FILE_NAME} in ${marketplaceDir}: not a marketplace root.`,
    );
  }
  let rawIndex: unknown;
  try {
    rawIndex = JSON.parse(indexRawText);
  } catch {
    throw new Error("marketplace.json is not valid JSON.");
  }
  if (!isRecord(rawIndex) || !Array.isArray(rawIndex.extensions)) {
    throw new Error("marketplace.json must be an object with an extensions array.");
  }
  const index = parseMarketplaceIndex(rawIndex);

  const existingIndex = index.extensions.findIndex((entry) => entry.name === dump.name);
  const existing = existingIndex >= 0 ? index.extensions[existingIndex] : undefined;
  // Review discipline: a version change falls back to unverified, while
  // republishing the same version keeps the entry's review state. Curation
  // fields (featured / defaultInstalled) belong to the registry operator and
  // carry over from the existing entry.
  const reviewStatus: MarketplaceReviewStatus =
    existing !== undefined && existing.version === dump.version
      ? existing.reviewStatus
      : "unverified";

  const source: MarketplaceExtensionSource =
    sourceKind === "npm"
      ? { source: "npm", package: await readNpmSpecifierFromPackageJson(extensionDir) }
      : `./extensions/${dump.name}`;

  const entry: MarketplaceExtensionEntry = {
    ...buildMarketplaceEntryFromDump(dump, { source, reviewStatus }),
    ...(existing?.featured !== undefined ? { featured: existing.featured } : {}),
    ...(existing?.defaultInstalled !== undefined
      ? { defaultInstalled: existing.defaultInstalled }
      : {}),
  };

  // Merge on the raw document so untouched entries keep their exact shape;
  // the merged result is validated in full before anything hits disk.
  const rawExtensions = [...rawIndex.extensions];
  if (existingIndex >= 0) {
    rawExtensions[existingIndex] = entry;
  } else {
    rawExtensions.push(entry);
  }
  const mergedRaw = { ...rawIndex, extensions: rawExtensions };
  parseMarketplaceIndex(mergedRaw);

  const contentDirRelative = `extensions/${dump.name}`;
  const contentDir = path.join(marketplaceDir, "extensions", dump.name);
  const needsContentDir = sourceKind === "local" || dump.icon !== undefined;
  const copiedFiles =
    sourceKind === "local" ? await listCopyableFiles(extensionDir) : dump.icon ? [dump.icon] : [];
  // Publishing the content directory onto itself (the extension already lives
  // at extensions/<name>/) needs no copy.
  const contentAlreadyInPlace = path.resolve(extensionDir) === contentDir;

  if (!dryRun) {
    if (!contentAlreadyInPlace) {
      if (needsContentDir) {
        // Rebuild the content directory from scratch so switching source
        // kinds never leaves stale files behind.
        await rm(contentDir, { recursive: true, force: true });
        if (sourceKind === "local") {
          await cp(extensionDir, contentDir, {
            recursive: true,
            filter: (sourcePath) => !EXCLUDED_DIR_NAMES.has(path.basename(sourcePath)),
          });
        } else if (dump.icon) {
          const iconTarget = path.join(contentDir, ...dump.icon.split("/"));
          await mkdir(path.dirname(iconTarget), { recursive: true });
          await cp(path.join(extensionDir, ...dump.icon.split("/")), iconTarget);
        }
      } else {
        // npm without an icon has no content directory — clear a stale one.
        await rm(contentDir, { recursive: true, force: true });
      }
    }
    await writeFile(indexPath, `${JSON.stringify(mergedRaw, null, 2)}\n`, "utf8");
  }

  return {
    entry,
    replacedExisting: existingIndex >= 0,
    sourceKind,
    copiedFiles,
    ...(needsContentDir ? { contentDirRelative } : {}),
    contentAlreadyInPlace,
    dryRun,
  };
}
