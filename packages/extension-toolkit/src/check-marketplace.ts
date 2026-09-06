/**
 * `extension-toolkit marketplace check <dir>`: validate a marketplace registry
 * for registry CI. The full marketplace.json schema validation runs first;
 * then every entry's icon and — for local-path sources — the declared
 * contribution files are checked against the registry content. npm-sourced
 * entries skip content checks (offline by principle).
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { checkDeclaredContributions, type CheckFinding } from "./check-package.js";
import { assertMarketplaceIconSvgContent } from "./icon.js";
import {
  MARKETPLACE_INDEX_FILE_NAME,
  MARKETPLACE_SPIRIT_DIR_NAME,
  parseMarketplaceIndexText,
  resolveMarketplaceExtensionSource,
  type MarketplaceExtensionEntry,
} from "./schema.js";

async function checkEntryIcon(
  root: string,
  entry: MarketplaceExtensionEntry,
): Promise<CheckFinding[]> {
  if (!entry.icon) {
    return [];
  }
  const fieldPath = `extensions[${entry.name}].icon`;
  let raw: string;
  try {
    raw = await readFile(path.join(root, ...entry.icon.split("/")), "utf8");
  } catch {
    return [{ path: fieldPath, message: `The icon file does not exist: ${entry.icon}` }];
  }
  try {
    assertMarketplaceIconSvgContent(raw, fieldPath);
    return [];
  } catch (error) {
    return [{ path: fieldPath, message: error instanceof Error ? error.message : String(error) }];
  }
}

async function checkEntryContent(
  root: string,
  entry: MarketplaceExtensionEntry,
): Promise<CheckFinding[]> {
  const resolved = resolveMarketplaceExtensionSource(
    entry.source,
    `extensions[${entry.name}].source`,
  );
  if (resolved.kind === "npm") {
    return [];
  }
  const contentDir = path.join(root, ...resolved.path.split("/"));
  try {
    if (!(await stat(contentDir)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    return [
      {
        path: `extensions[${entry.name}].source`,
        message: `The entry content directory does not exist in the registry: ${resolved.path}`,
      },
    ];
  }
  return checkDeclaredContributions(
    contentDir,
    entry.manifest.contributes,
    `extensions[${entry.name}].manifest.contributes`,
  );
}

export async function checkMarketplaceRegistry(root: string): Promise<CheckFinding[]> {
  const indexRelativePath = `${MARKETPLACE_SPIRIT_DIR_NAME}/${MARKETPLACE_INDEX_FILE_NAME}`;
  let raw: string;
  try {
    raw = await readFile(
      path.join(root, MARKETPLACE_SPIRIT_DIR_NAME, MARKETPLACE_INDEX_FILE_NAME),
      "utf8",
    );
  } catch {
    return [{ path: indexRelativePath, message: "The marketplace index does not exist." }];
  }

  let index;
  try {
    index = parseMarketplaceIndexText(raw);
  } catch (error) {
    return [
      {
        path: indexRelativePath,
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const findings: CheckFinding[] = [];
  for (const entry of index.extensions) {
    findings.push(...(await checkEntryIcon(root, entry)));
    findings.push(...(await checkEntryContent(root, entry)));
  }
  return findings;
}
