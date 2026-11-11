import { readFileSync } from "node:fs";

import { resolveSpiritDataDir as resolveSharedSpiritDataDir } from "@spiritagent/config/data-paths";

/**
 * Resolves the Spirit data directory (shared with Desktop / CLI /
 * acp-server). The server honors SPIRIT_SERVER_DATA_DIR first, then the
 * shared resolution (SPIRIT_DATA_DIR → platform conventions).
 */
export function resolveSpiritDataDir(): string {
  return process.env["SPIRIT_SERVER_DATA_DIR"]?.trim() || resolveSharedSpiritDataDir();
}

/** Reads the package version at runtime (dist/src → ../../package.json). */
export function resolveServerVersion(): string {
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(pkgUrl, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as Record<string, unknown>)["version"];
      if (typeof version === "string") {
        return version;
      }
    }
  } catch {
    // Fall through to the development placeholder.
  }
  return "0.0.0-dev";
}
