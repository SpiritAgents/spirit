import {
  materializeProviderPreset,
  type MaterializedProviderEntry,
} from "@spiritagent/agent-core/provider-presets";

import {
  emptyModelRef,
  GOOGLE_VERTEX_SDK_PACKAGE_NAME,
  providerCredentialSlotNames,
  resolveProviderSdkPackageName,
  resolveProviderTransportKind,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  type ModelEntry,
  type ProviderEntry,
  type ProviderOptions,
  type SpiritConfigFile,
} from "../config.js";

import { keyringStore } from "./keyring-store.js";
import {
  KEYRING_SERVICE,
  providerInternalSlotAccount,
  resolveProviderApiKey,
  resolveProviderCredentialSlot,
  type ProviderKeyChannels,
} from "./provider-key-channels.js";
import {
  loadActiveModelProfile,
  loadModelProfile,
  loadSpiritConfig,
  saveSpiritConfig,
} from "./spirit-config.js";
import type { ProviderSetupResult, SpiritModelProfile } from "./types.js";

export { loadActiveModelProfile, loadModelProfile, loadSpiritConfig, saveSpiritConfig };
export type { ProviderSetupResult, SpiritModelProfile };

/** Credential channel declarations carried by a resolved profile, fed to the channel resolvers. */
export function profileKeyChannels(profile: SpiritModelProfile): ProviderKeyChannels {
  return {
    id: profile.providerId,
    ...(profile.apiKey !== undefined ? { apiKey: profile.apiKey } : {}),
    ...(profile.apiKeyEnv !== undefined ? { apiKeyEnv: profile.apiKeyEnv } : {}),
    ...(profile.apiKeyKeyring !== undefined ? { apiKeyKeyring: profile.apiKeyKeyring } : {}),
    ...(profile.credentials !== undefined ? { credentials: profile.credentials } : {}),
  };
}

export function resolveStoredApiKeyForProfile(profile: SpiritModelProfile): string | undefined {
  return resolveProviderApiKey(profileKeyChannels(profile));
}

export function resolveProfileCredentialSlot(
  profile: SpiritModelProfile,
  slot: string,
): string | undefined {
  return resolveProviderCredentialSlot(profileKeyChannels(profile), slot);
}

function hasSigV4Auth(profile: SpiritModelProfile): boolean {
  return (
    resolveProviderTransportKind(profile) === "open-responses" &&
    profile.options?.auth === "aws-sigv4"
  );
}

/** Bearer key or IAM slots; bedrock and SigV4 (`options.auth`) entries authenticate either way. */
function hasIamRuntimeCredentials(profile: SpiritModelProfile): boolean {
  if (resolveStoredApiKeyForProfile(profile)) {
    return true;
  }
  return Boolean(
    resolveProfileCredentialSlot(profile, "accessKeyId") &&
    resolveProfileCredentialSlot(profile, "secretAccessKey"),
  );
}

function hasGoogleVertexRuntimeCredentials(profile: SpiritModelProfile): boolean {
  if (resolveStoredApiKeyForProfile(profile)) {
    return true;
  }
  // A service account (clientEmail/privateKey slots) still needs project/location; ADC works off
  // the options alone, matching the previous vendor-keyed check.
  return Boolean(profile.options?.project?.trim() && profile.options?.location?.trim());
}

export function hasResolvableCredentials(spiritDataDir: string): boolean {
  const profile = loadActiveModelProfile(spiritDataDir);
  if (!profile) {
    return false;
  }
  const transportKind = resolveProviderTransportKind(profile);
  if (transportKind === "bedrock" || hasSigV4Auth(profile)) {
    return hasIamRuntimeCredentials(profile);
  }
  if (resolveProviderSdkPackageName(profile) === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
    return hasGoogleVertexRuntimeCredentials(profile);
  }
  return resolveStoredApiKeyForProfile(profile) !== undefined;
}

function mergeModelsByName(
  existing: readonly ModelEntry[],
  upserts: readonly ModelEntry[],
): ModelEntry[] {
  const models = [...existing];
  for (const upsert of upserts) {
    const at = models.findIndex((model) => model.name === upsert.name);
    if (at >= 0) {
      models[at] = upsert;
    } else {
      models.push(upsert);
    }
  }
  return models;
}

/**
 * Reconnect = key-level merge with ownership: the wizard rewrites exactly the keys it
 * materializes; everything else (label, credential channels, headers/body, the flat model-level
 * defaults, user-added models) survives. A user edit to an owned key is reset on reconnect.
 */
function resetWizardOwnedKeys(
  entry: ProviderEntry,
  materialized: MaterializedProviderEntry,
  options: ProviderOptions | undefined,
): void {
  entry.apiBase = materialized.apiBase;
  // `options` merges the preset's mechanism template (e.g. `echoServerToolCalls`) with the
  // wizard-collected values (e.g. `awsRegion`); on a key conflict the explicit wizard input wins.
  const mergedOptions = { ...materialized.options, ...options };
  const owned: Record<string, unknown> = {
    transportKind: materialized.transportKind,
    sdk: materialized.sdk,
    providerTools: materialized.providerTools,
    fileUpload: materialized.fileUpload,
    imageApi: materialized.imageApi,
    videoApi: materialized.videoApi,
    options: Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined,
  };
  const record = entry as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(owned)) {
    if (value === undefined) {
      delete record[key];
    } else {
      record[key] = value;
    }
  }
}

function writeSetupCredentials(
  materialized: MaterializedProviderEntry,
  setup: ProviderSetupResult,
): void {
  const credentials = setup.credentials ?? {};
  const entries = Object.entries(credentials);
  if (entries.length === 0) {
    return;
  }
  const slots = providerCredentialSlotNames(
    resolveProviderTransportKind(materialized),
    resolveProviderSdkPackageName(materialized),
    setup.options,
  );
  const store = keyringStore();
  for (const [slot, secret] of entries) {
    if (!slots.includes(slot)) {
      throw new Error(
        `Provider setup: unknown credentials slot ${JSON.stringify(slot)} for provider ${JSON.stringify(materialized.id)} (allowed: ${slots.join(", ")}).`,
      );
    }
    const account = providerInternalSlotAccount(materialized.id, slot);
    const trimmed = secret.trim();
    if (trimmed) {
      store.setPassword(KEYRING_SERVICE, account, trimmed);
    } else {
      store.deletePassword(KEYRING_SERVICE, account);
    }
  }
}

export async function saveProviderSetup(
  spiritDataDir: string,
  setup: ProviderSetupResult,
): Promise<void> {
  const materialized = materializeProviderPreset(setup.materialize);
  writeSetupCredentials(materialized, setup);

  const existing = loadSpiritConfig(spiritDataDir);
  const providers = [...(existing?.providers ?? [])];
  const index = providers.findIndex((provider) => provider.id === materialized.id);
  const upsertModels = setup.models ?? [];

  if (index >= 0) {
    const current = providers[index]!;
    const merged: ProviderEntry = {
      ...current,
      models: mergeModelsByName(current.models, upsertModels),
    };
    resetWizardOwnedKeys(merged, materialized, setup.options);
    providers[index] = merged;
  } else {
    const entry: ProviderEntry = {
      id: materialized.id,
      apiBase: materialized.apiBase,
      models: [...upsertModels],
    };
    if (materialized.label !== undefined) {
      entry.label = materialized.label;
    }
    resetWizardOwnedKeys(entry, materialized, setup.options);
    providers.push(entry);
  }

  const activeModel =
    setup.activeModel ??
    (upsertModels[0] !== undefined
      ? { providerId: materialized.id, name: upsertModels[0].name }
      : (existing?.activeModel ?? emptyModelRef()));

  const config: SpiritConfigFile = {
    ...existing,
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers,
    activeModel,
  };
  await saveSpiritConfig(spiritDataDir, config);
}
