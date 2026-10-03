import type { SpiritConfigFile } from "./types.js";

export interface AgentsWebToolExposure {
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
}

/**
 * Reads `agents.webSearch.enabled` / `agents.webFetch.enabled` from config.json.
 * Both are opt-out switches for the built-in web tools: only an explicit `false` disables;
 * missing keys, malformed sections, or a missing config file all mean enabled.
 */
export function resolveAgentsWebToolExposure(
  config: SpiritConfigFile | undefined,
): AgentsWebToolExposure {
  const agents = config?.["agents"];
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) {
    return { webSearchEnabled: true, webFetchEnabled: true };
  }
  const record = agents as Record<string, unknown>;
  return {
    webSearchEnabled: readToggleEnabled(record["webSearch"]),
    webFetchEnabled: readToggleEnabled(record["webFetch"]),
  };
}

function readToggleEnabled(section: unknown): boolean {
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return true;
  }
  return (section as Record<string, unknown>)["enabled"] !== false;
}
