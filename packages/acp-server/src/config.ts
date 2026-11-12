import { resolveSpiritDataDir as resolveSharedSpiritDataDir } from "@spiritagent/config/data-paths";

import type { AcpServerConfig } from "./types.js";

/**
 * Resolves the Spirit data directory (shared with Desktop / CLI).
 * ACP honors SPIRIT_ACP_DATA_DIR first, then the shared resolution
 * (SPIRIT_DATA_DIR → platform conventions).
 */
export function resolveSpiritDataDir(): string {
  return process.env["SPIRIT_ACP_DATA_DIR"]?.trim() || resolveSharedSpiritDataDir();
}

/**
 * Loads ACP server runtime paths. LLM credentials and models come from shared
 * Spirit config + keyring (Terminal Auth / `--setup`), not environment variables.
 */
export function loadBaseConfig(): AcpServerConfig {
  const workspaceRoot = process.env["SPIRIT_ACP_WORKSPACE"]?.trim() || process.cwd();
  const spiritDataDir = resolveSpiritDataDir();

  return {
    workspaceRoot,
    spiritDataDir,
  };
}
