import { join } from "node:path";

import {
  loadSpiritConfig,
  resolveModelByRef,
  SpiritConfigSchemaError,
  type ModelEntry,
  type ModelRef,
  type ProviderEntry,
} from "../config.js";

import type { SpiritModelProfile } from "./types.js";

export { SpiritConfigSchemaError };

export { loadSpiritConfig, saveSpiritConfig } from "../config.js";

export { resolveSpiritDataDir } from "../data-paths.js";

const CONFIG_FILE_NAME = "config.json";

export function configFilePath(spiritDataDir: string): string {
  return join(spiritDataDir, CONFIG_FILE_NAME);
}

const PROFILE_PROVIDER_KEYS = [
  "transportKind",
  "sdk",
  "headers",
  "body",
  "options",
  "providerTools",
  "fileUpload",
  "imageApi",
  "videoApi",
  "apiKey",
  "apiKeyEnv",
  "apiKeyKeyring",
  "credentials",
] as const;

const PROFILE_MODEL_KEYS = [
  "capabilities",
  "contextLength",
  "outputLimit",
  "reasoningEffort",
  "supportedReasoningEfforts",
  "reasoningMode",
  "supportedReasoningModes",
  "supportsThinkingType",
  "supportsThinkingSwitch",
  "thinkingSwitch",
  "serviceTiers",
  "serviceTier",
] as const;

/**
 * Builds the runtime profile for one model. `model` must be the effective entry produced by
 * `resolveModelEntry` / `resolveModelByRef` (provider-level flat declarations already applied);
 * connection-level fields come from the provider entry and never inherit.
 */
export function resolveSpiritModelProfile(
  provider: ProviderEntry,
  model: ModelEntry,
): SpiritModelProfile {
  const profile: SpiritModelProfile = {
    providerId: provider.id,
    ref: { providerId: provider.id, name: model.name },
    name: model.name,
    apiBase: provider.apiBase,
  };
  const writable = profile as unknown as Record<string, unknown>;
  for (const key of PROFILE_PROVIDER_KEYS) {
    const value = provider[key];
    if (value !== undefined) {
      writable[key] = value;
    }
  }
  for (const key of PROFILE_MODEL_KEYS) {
    const value = model[key];
    if (value !== undefined) {
      writable[key] = value;
    }
  }
  return profile;
}

export function loadActiveModelProfile(spiritDataDir: string): SpiritModelProfile | undefined {
  const config = loadSpiritConfig(spiritDataDir);
  if (!config) {
    return undefined;
  }
  const resolved = resolveModelByRef(config.providers, config.activeModel);
  return resolved ? resolveSpiritModelProfile(resolved.provider, resolved.model) : undefined;
}

export function loadModelProfile(
  spiritDataDir: string,
  modelRef: ModelRef,
): SpiritModelProfile | undefined {
  const config = loadSpiritConfig(spiritDataDir);
  if (!config) {
    return undefined;
  }
  const resolved = resolveModelByRef(config.providers, modelRef);
  return resolved ? resolveSpiritModelProfile(resolved.provider, resolved.model) : undefined;
}
