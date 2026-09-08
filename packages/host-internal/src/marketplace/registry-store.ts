import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MarketplaceSourceKind, MarketplaceSourceRecord } from "./types.js";

export const MARKETPLACES_REGISTRY_FILE_NAME = "marketplaces.json";
export const MARKETPLACES_DIR_NAME = "marketplaces";

const REGISTRY_SCHEMA_VERSION = 1;

export function marketplacesDirPath(spiritDataDir: string): string {
  return path.join(spiritDataDir, MARKETPLACES_DIR_NAME);
}

export function marketplaceSourceDirPath(spiritDataDir: string, sourceId: string): string {
  return path.join(marketplacesDirPath(spiritDataDir), sourceId);
}

/** Source id = base64url of the normalized locator (same style as pkg- directories). */
export function marketplaceSourceIdForLocator(locator: string): string {
  return Buffer.from(locator, "utf8").toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSourceRecord(value: unknown, index: number): MarketplaceSourceRecord {
  const fieldName = `sources[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  const id = value.id;
  const name = value.name;
  const displayName = value.displayName;
  const kind = value.kind;
  const locator = value.locator;
  const ref = value.ref;
  const addedAtUnixMs = value.addedAtUnixMs;
  if (typeof id !== "string" || !id) {
    throw new Error(`${fieldName}.id must be a non-empty string.`);
  }
  if (typeof name !== "string" || !name) {
    throw new Error(`${fieldName}.name must be a non-empty string.`);
  }
  if (typeof displayName !== "string" || !displayName) {
    throw new Error(`${fieldName}.displayName must be a non-empty string.`);
  }
  if (kind !== "local" && kind !== "git" && kind !== "http-index") {
    throw new Error(`${fieldName}.kind must be one of: local, git, http-index.`);
  }
  if (typeof locator !== "string" || !locator) {
    throw new Error(`${fieldName}.locator must be a non-empty string.`);
  }
  if (ref !== undefined && (typeof ref !== "string" || !ref)) {
    throw new Error(`${fieldName}.ref must be a non-empty string when present.`);
  }
  if (typeof addedAtUnixMs !== "number" || !Number.isFinite(addedAtUnixMs)) {
    throw new Error(`${fieldName}.addedAtUnixMs must be a finite number.`);
  }
  return {
    id,
    name,
    displayName,
    kind: kind as MarketplaceSourceKind,
    locator,
    ...(ref !== undefined ? { ref } : {}),
    addedAtUnixMs,
  };
}

/** Read user-added sources; a missing registry file means no sources. */
export async function readMarketplaceSourceRegistry(
  spiritDataDir: string,
): Promise<MarketplaceSourceRecord[]> {
  const filePath = path.join(spiritDataDir, MARKETPLACES_REGISTRY_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${MARKETPLACES_REGISTRY_FILE_NAME} is not valid JSON: ${filePath}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `${MARKETPLACES_REGISTRY_FILE_NAME} schemaVersion must be ${REGISTRY_SCHEMA_VERSION}: ${filePath}`,
    );
  }
  if (!Array.isArray(parsed.sources)) {
    throw new Error(`${MARKETPLACES_REGISTRY_FILE_NAME} sources must be an array: ${filePath}`);
  }
  return parsed.sources.map((entry, index) => parseSourceRecord(entry, index));
}

export async function writeMarketplaceSourceRegistry(
  spiritDataDir: string,
  sources: readonly MarketplaceSourceRecord[],
): Promise<void> {
  await mkdir(spiritDataDir, { recursive: true });
  const filePath = path.join(spiritDataDir, MARKETPLACES_REGISTRY_FILE_NAME);
  const document = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    sources,
  };
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
