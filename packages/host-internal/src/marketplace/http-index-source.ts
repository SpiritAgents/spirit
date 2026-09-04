import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { marketplaceSourceDirPath } from "./registry-store.js";
import type { MarketplaceSourceRecord } from "./types.js";

/** Minimal fetch surface so tests never touch the network. */
export interface MarketplaceIndexFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type MarketplaceIndexFetch = (url: string) => Promise<MarketplaceIndexFetchResponse>;

const defaultFetch: MarketplaceIndexFetch = (url) => fetch(url);

export function httpIndexSnapshotPath(spiritDataDir: string, sourceId: string): string {
  return path.join(marketplaceSourceDirPath(spiritDataDir, sourceId), "snapshot.json");
}

/**
 * Read an http-index source: fetch the marketplace.json URL on every access
 * (no TTL cache). A successful fetch is persisted as the offline snapshot; on
 * failure the most recent snapshot is used with a warning, and when no
 * snapshot exists the read fails.
 */
export async function readHttpIndexSource(
  spiritDataDir: string,
  record: MarketplaceSourceRecord,
  options?: { fetchImpl?: MarketplaceIndexFetch },
): Promise<{ raw: string; warning?: string }> {
  const fetchImpl = options?.fetchImpl ?? defaultFetch;
  const snapshotPath = httpIndexSnapshotPath(spiritDataDir, record.id);

  try {
    const response = await fetchImpl(record.locator);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const raw = await response.text();
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, raw, "utf8");
    return { raw };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      const raw = await readFile(snapshotPath, "utf8");
      return {
        raw,
        warning: `Failed to refresh marketplace "${record.name}" (${record.locator}); using the last successful snapshot. ${detail}`,
      };
    } catch {
      throw new Error(
        `Failed to fetch marketplace index for "${record.name}" (${record.locator}) and no snapshot is available: ${detail}`,
      );
    }
  }
}
