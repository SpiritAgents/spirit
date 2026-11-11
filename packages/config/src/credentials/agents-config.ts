import type { SpiritConfigFile } from "../config.js";

export interface AgentsProviderToolsExposure {
  providerToolsEnabled: boolean;
}

export interface AgentsWebFetchExposure {
  webFetchEnabled: boolean;
}

/**
 * Reads `agents.providerTools.enabled` from config.json. Opt-out switch for provider-declared
 * tools: only an explicit `false` disables; missing keys, malformed sections, or a missing
 * config file all mean enabled.
 */
export function resolveAgentsProviderToolsExposure(
  config: SpiritConfigFile | undefined,
): AgentsProviderToolsExposure {
  return { providerToolsEnabled: readToggleEnabled(agentsSection(config)?.["providerTools"]) };
}

/**
 * Reads `agents.webFetch.enabled` from config.json. Opt-out switch for the built-in web_fetch
 * tool: only an explicit `false` disables.
 */
export function resolveAgentsWebFetchExposure(
  config: SpiritConfigFile | undefined,
): AgentsWebFetchExposure {
  return { webFetchEnabled: readToggleEnabled(agentsSection(config)?.["webFetch"]) };
}

function agentsSection(config: SpiritConfigFile | undefined): Record<string, unknown> | undefined {
  const agents: unknown = config?.["agents"];
  if (typeof agents !== "object" || agents === null || Array.isArray(agents)) {
    return undefined;
  }
  return agents as Record<string, unknown>;
}

function readToggleEnabled(section: unknown): boolean {
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return true;
  }
  return (section as Record<string, unknown>)["enabled"] !== false;
}
