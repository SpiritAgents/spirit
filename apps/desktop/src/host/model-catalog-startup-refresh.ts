import {
  findProviderEntry,
  GOOGLE_VERTEX_SDK_PACKAGE_NAME,
  resolveProviderApiKey,
  resolveProviderCredentialSlot,
  resolveProviderTransportKind,
  type ModelEntry,
  type ProviderEntry,
} from "@spiritagent/host-internal";

import type { DesktopModelReasoningEffort, PreviewModelCatalogEntry } from "../types.js";
import {
  loadPreviewModelsForTransport,
  type CatalogFetchInput,
  type LoadedPreviewModelsResult,
} from "./model-config.js";
import {
  catalogParserNameForProvider,
  previewCatalogMapForTransport,
} from "./model-catalog-metadata.js";
import {
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  applyModelsRemovalToConfig,
  type ModelRemovalTarget,
} from "./provider-api-key.js";
import {
  normalizeModelCapabilities,
  normalizeSupportedReasoningEfforts,
  type DesktopConfigFile,
} from "./storage.js";

/** One catalog refresh scope: a provider entry whose materialized preset declares a catalog. */
export function modelCatalogScopeKey(provider: Pick<ProviderEntry, "id" | "apiBase">): string {
  return `${provider.id}::${provider.apiBase}`;
}

export function collectModelCatalogRefreshTargets(
  providers: readonly ProviderEntry[],
): ProviderEntry[] {
  return providers.filter(
    (provider) =>
      catalogParserNameForProvider({
        providerId: provider.id,
        transportKind: resolveProviderTransportKind(provider),
      }) !== undefined,
  );
}

function providerKeyChannels(provider: ProviderEntry) {
  return {
    id: provider.id,
    ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : {}),
    ...(provider.apiKeyEnv !== undefined ? { apiKeyEnv: provider.apiKeyEnv } : {}),
    ...(provider.apiKeyKeyring !== undefined ? { apiKeyKeyring: provider.apiKeyKeyring } : {}),
    ...(provider.credentials !== undefined ? { credentials: provider.credentials } : {}),
  };
}

/** API key for catalog listing: `SPIRIT_API_KEY` process override, then the entry's key channels. */
function resolveEntryApiKey(provider: ProviderEntry): string | undefined {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  return resolveProviderApiKey(providerKeyChannels(provider));
}

/**
 * Credential/option gate before a startup fetch; a provider without resolvable credentials is
 * skipped silently (the user may simply not have connected it yet).
 */
function catalogFetchCredentials(
  provider: ProviderEntry,
):
  | Pick<
      CatalogFetchInput,
      | "apiKey"
      | "options"
      | "accessKeyId"
      | "secretAccessKey"
      | "vertexClientEmail"
      | "vertexPrivateKey"
    >
  | undefined {
  const transportKind = resolveProviderTransportKind(provider);
  const apiKey = resolveEntryApiKey(provider);
  const channels = providerKeyChannels(provider);

  if (transportKind === "bedrock") {
    const accessKeyId = resolveProviderCredentialSlot(channels, "accessKeyId");
    const secretAccessKey = resolveProviderCredentialSlot(channels, "secretAccessKey");
    if (
      !provider.options?.awsRegion?.trim() ||
      !hasBedrockRuntimeCredentials({ apiKey, accessKeyId, secretAccessKey })
    ) {
      return undefined;
    }
    return {
      apiKey: apiKey?.trim() ?? "",
      options: provider.options,
      ...(accessKeyId ? { accessKeyId } : {}),
      ...(secretAccessKey ? { secretAccessKey } : {}),
    };
  }

  if (provider.sdk === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
    const clientEmail = resolveProviderCredentialSlot(channels, "clientEmail");
    const privateKey = resolveProviderCredentialSlot(channels, "privateKey");
    if (
      !hasGoogleVertexRuntimeCredentials({
        apiKey,
        clientEmail,
        privateKey,
        vertexProject: provider.options?.project,
        vertexLocation: provider.options?.location,
      })
    ) {
      return undefined;
    }
    return {
      apiKey: apiKey?.trim() ?? "",
      options: provider.options,
      ...(clientEmail ? { vertexClientEmail: clientEmail } : {}),
      ...(privateKey ? { vertexPrivateKey: privateKey } : {}),
    };
  }

  if (!apiKey?.trim()) {
    return undefined;
  }
  return { apiKey: apiKey.trim(), ...(provider.options ? { options: provider.options } : {}) };
}

export async function loadModelCatalogForProvider(
  provider: ProviderEntry,
  options?: { forceRefresh?: boolean },
): Promise<LoadedPreviewModelsResult | undefined> {
  const credentials = catalogFetchCredentials(provider);
  if (!credentials) {
    return undefined;
  }
  return loadPreviewModelsForTransport({
    providerId: provider.id,
    transportKind: resolveProviderTransportKind(provider),
    apiBase: provider.apiBase,
    apiKey: credentials.apiKey,
    ...(credentials.options ? { options: credentials.options } : {}),
    ...(credentials.accessKeyId ? { accessKeyId: credentials.accessKeyId } : {}),
    ...(credentials.secretAccessKey ? { secretAccessKey: credentials.secretAccessKey } : {}),
    ...(credentials.vertexClientEmail ? { vertexClientEmail: credentials.vertexClientEmail } : {}),
    ...(credentials.vertexPrivateKey ? { vertexPrivateKey: credentials.vertexPrivateKey } : {}),
    forceRefresh: options?.forceRefresh === true,
  });
}

export async function forceRefreshModelCatalogForProvider(
  provider: ProviderEntry,
): Promise<LoadedPreviewModelsResult | undefined> {
  return loadModelCatalogForProvider(provider, { forceRefresh: true });
}

/**
 * Maps one folded catalog entry onto a config `models[]` entry. Catalog facts are the only
 * source for these fields; user selections (`reasoningEffort`, `reasoningMode`, `serviceTier`)
 * are never written by the refresh — `defaultReasoningEffort` is an upstream wire fact
 * (Kimi Code `think_efforts.default_effort`) and is materialized as the initial selection.
 */
export function catalogEntryToModelEntry(
  name: string,
  catalogEntry: PreviewModelCatalogEntry | undefined,
): ModelEntry {
  const entry: ModelEntry = { name };
  if (!catalogEntry) {
    return entry;
  }
  if (catalogEntry.capabilities !== undefined) {
    const capabilities = normalizeModelCapabilities(catalogEntry.capabilities);
    if (capabilities !== undefined) {
      entry.capabilities = capabilities;
    }
  }
  if (catalogEntry.contextLength !== undefined) {
    entry.contextLength = catalogEntry.contextLength;
  }
  if (catalogEntry.outputLimit !== undefined) {
    entry.outputLimit = catalogEntry.outputLimit;
  }
  if (catalogEntry.supportedReasoningEfforts !== undefined) {
    const efforts = normalizeSupportedReasoningEfforts(catalogEntry.supportedReasoningEfforts);
    if (efforts !== undefined && efforts.length > 0) {
      entry.supportedReasoningEfforts = efforts as ModelEntry["supportedReasoningEfforts"];
    }
  }
  if (catalogEntry.supportedReasoningModes !== undefined) {
    entry.supportedReasoningModes = [...catalogEntry.supportedReasoningModes];
  }
  if (catalogEntry.supportsThinkingType !== undefined) {
    entry.supportsThinkingType = catalogEntry.supportsThinkingType;
  }
  if (catalogEntry.supportsThinkingSwitch === true) {
    entry.supportsThinkingSwitch = true;
  }
  if (catalogEntry.thinkingSwitch !== undefined) {
    entry.thinkingSwitch = structuredClone(catalogEntry.thinkingSwitch);
  }
  if (catalogEntry.serviceTiers !== undefined) {
    entry.serviceTiers = [...catalogEntry.serviceTiers];
  }
  if (catalogEntry.defaultReasoningEffort !== undefined) {
    entry.reasoningEffort = catalogEntry.defaultReasoningEffort as ModelEntry["reasoningEffort"];
  }
  return entry;
}

/** Adds catalog-listed models missing from the entry; returns the number added. */
export function mergeNewCatalogModelsIntoConfig(
  config: DesktopConfigFile,
  provider: ProviderEntry,
  result: LoadedPreviewModelsResult,
): number {
  const target = findProviderEntry(config.providers, provider.id);
  if (!target) {
    return 0;
  }
  const catalogEntries = previewCatalogMapForTransport({
    providerId: provider.id,
    transportKind: resolveProviderTransportKind(provider),
    modelCatalog: result.modelCatalog,
  });

  const toAdd: ModelEntry[] = [];
  for (const name of result.modelIds) {
    const trimmed = name.trim();
    if (!trimmed || target.models.some((model) => model.name === trimmed)) {
      continue;
    }
    toAdd.push(catalogEntryToModelEntry(trimmed, catalogEntries.get(trimmed)));
  }

  if (toAdd.length === 0) {
    return 0;
  }

  target.models.push(...toAdd);

  if (!config.imageGenerationModel) {
    const imageModel = toAdd.find((entry) => entry.capabilities?.includes("imageGeneration"));
    if (imageModel) {
      config.imageGenerationModel = { providerId: target.id, name: imageModel.name };
    }
  }
  if (!config.videoGenerationModel) {
    const videoModel = toAdd.find((entry) => entry.capabilities?.includes("videoGeneration"));
    if (videoModel) {
      config.videoGenerationModel = { providerId: target.id, name: videoModel.name };
    }
  }

  return toAdd.length;
}

function normalizedCapabilitiesEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const normalizedLeft = normalizeModelCapabilities(left);
  const normalizedRight = normalizeModelCapabilities(right);
  if (normalizedLeft === undefined && normalizedRight === undefined) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((capability, index) => capability === normalizedRight[index]);
}

function normalizedReasoningEffortsEqual(
  left: readonly DesktopModelReasoningEffort[] | undefined,
  right: readonly DesktopModelReasoningEffort[] | undefined,
): boolean {
  const normalizedLeft = normalizeSupportedReasoningEfforts(left);
  const normalizedRight = normalizeSupportedReasoningEfforts(right);
  if (normalizedLeft === undefined && normalizedRight === undefined) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((effort, index) => effort === normalizedRight[index]);
}

function stringArrayEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

/**
 * Rewrites the catalog-owned fields of one stored model. The reset is silent by design: model
 * facts have the catalog as their single source (a user hand-edit is overwritten next refresh).
 * User selections that stop matching the new declarations are cleared so the file stays valid.
 * Returns whether the stored model changed.
 */
export function applyCatalogEntryToStoredModel(
  model: ModelEntry,
  catalogEntry: PreviewModelCatalogEntry,
): boolean {
  let changed = false;

  if (catalogEntry.capabilities !== undefined) {
    const nextCapabilities = normalizeModelCapabilities(catalogEntry.capabilities);
    if (nextCapabilities && !normalizedCapabilitiesEqual(model.capabilities, nextCapabilities)) {
      model.capabilities = nextCapabilities;
      changed = true;
    }
  }

  if (catalogEntry.supportedReasoningEfforts !== undefined) {
    const nextReasoningEfforts = normalizeSupportedReasoningEfforts(
      catalogEntry.supportedReasoningEfforts,
    );
    if (!normalizedReasoningEffortsEqual(model.supportedReasoningEfforts, nextReasoningEfforts)) {
      if (nextReasoningEfforts && nextReasoningEfforts.length > 0) {
        model.supportedReasoningEfforts =
          nextReasoningEfforts as ModelEntry["supportedReasoningEfforts"];
      } else {
        delete model.supportedReasoningEfforts;
      }
      changed = true;
    }
    // A selection outside the fresh declaration resets to "send nothing".
    if (
      model.reasoningEffort !== undefined &&
      model.reasoningEffort !== "default" &&
      nextReasoningEfforts !== undefined &&
      !nextReasoningEfforts.includes(model.reasoningEffort)
    ) {
      delete model.reasoningEffort;
      changed = true;
    }
  }

  if (catalogEntry.supportedReasoningModes !== undefined) {
    if (!stringArrayEqual(model.supportedReasoningModes, catalogEntry.supportedReasoningModes)) {
      model.supportedReasoningModes = [...catalogEntry.supportedReasoningModes];
      changed = true;
    }
    if (
      model.reasoningMode !== undefined &&
      !catalogEntry.supportedReasoningModes.includes(model.reasoningMode)
    ) {
      delete model.reasoningMode;
      changed = true;
    }
  }

  // contextLength / outputLimit only fill gaps: a user-configured context length wins over the catalog.
  if (model.contextLength === undefined && catalogEntry.contextLength !== undefined) {
    model.contextLength = Math.trunc(catalogEntry.contextLength);
    changed = true;
  }
  if (model.outputLimit === undefined && catalogEntry.outputLimit !== undefined) {
    model.outputLimit = Math.trunc(catalogEntry.outputLimit);
    changed = true;
  }

  if (catalogEntry.supportsThinkingType !== undefined) {
    if (model.supportsThinkingType !== catalogEntry.supportsThinkingType) {
      model.supportsThinkingType = catalogEntry.supportsThinkingType;
      changed = true;
    }
  } else if (model.supportsThinkingType !== undefined) {
    delete model.supportsThinkingType;
    changed = true;
  }

  if (catalogEntry.supportsThinkingSwitch === true && model.supportsThinkingSwitch !== true) {
    model.supportsThinkingSwitch = true;
    changed = true;
  }

  // The thinkingSwitch wire encoding is catalog-owned (knowledge-folded): written when declared,
  // cleared when the fresh catalog entry drops it.
  if (catalogEntry.thinkingSwitch !== undefined) {
    if (JSON.stringify(model.thinkingSwitch) !== JSON.stringify(catalogEntry.thinkingSwitch)) {
      model.thinkingSwitch = structuredClone(catalogEntry.thinkingSwitch);
      changed = true;
    }
  } else if (model.thinkingSwitch !== undefined) {
    delete model.thinkingSwitch;
    changed = true;
  }

  if (catalogEntry.serviceTiers !== undefined) {
    if (!stringArrayEqual(model.serviceTiers as string[] | undefined, catalogEntry.serviceTiers)) {
      model.serviceTiers = [...catalogEntry.serviceTiers];
      changed = true;
    }
    if (model.serviceTier !== undefined && !catalogEntry.serviceTiers.includes(model.serviceTier)) {
      delete model.serviceTier;
      changed = true;
    }
  }

  return changed;
}

/** Writes catalog entries back to the entry's persisted models (capabilities / declared efforts, etc.). */
export function syncExistingModelsFromCatalog(
  config: DesktopConfigFile,
  provider: ProviderEntry,
  result: LoadedPreviewModelsResult,
): number {
  const catalogEntries = previewCatalogMapForTransport({
    providerId: provider.id,
    transportKind: resolveProviderTransportKind(provider),
    modelCatalog: result.modelCatalog,
  });
  if (catalogEntries.size === 0) {
    return 0;
  }

  const target = findProviderEntry(config.providers, provider.id);
  if (!target) {
    return 0;
  }

  let updated = 0;
  for (const model of target.models) {
    const catalogEntry = catalogEntries.get(model.name);
    if (!catalogEntry) {
      continue;
    }
    if (applyCatalogEntryToStoredModel(model, catalogEntry)) {
      updated += 1;
    }
  }
  return updated;
}

/** Removes the entry's persisted models that are no longer in the upstream catalog. */
export function removeDelistedModelsFromCatalog(
  config: DesktopConfigFile,
  provider: ProviderEntry,
  result: LoadedPreviewModelsResult,
): readonly string[] {
  const catalogIds = new Set(result.modelIds.map((id) => id.trim()).filter((id) => id.length > 0));
  if (catalogIds.size === 0) {
    return [];
  }

  const target = findProviderEntry(config.providers, provider.id);
  if (!target) {
    return [];
  }
  const targetsToRemove: ModelRemovalTarget[] = [];
  for (const model of target.models) {
    if (!catalogIds.has(model.name)) {
      targetsToRemove.push({ ref: { providerId: target.id, name: model.name } });
    }
  }
  if (targetsToRemove.length === 0) {
    return [];
  }
  applyModelsRemovalToConfig(config, targetsToRemove);
  return targetsToRemove.map((target) => target.ref.name);
}

export type ModelCatalogRefreshFetchResult = {
  provider: ProviderEntry;
  result: LoadedPreviewModelsResult;
};

export type ModelCatalogStartupFetchSummary = {
  attempted: number;
  fetched: ModelCatalogRefreshFetchResult[];
  skipped: number;
  fromCache: number;
  fromNetwork: number;
};

export type ModelCatalogStartupApplySummary = {
  refreshed: number;
  merged: number;
  synced: number;
  pruned: number;
  prunedModelNames: readonly string[];
};

/** Starts the background refresh: prefer the local cache and only make network requests for expired/missing scopes; does not modify config. */
export async function fetchConfiguredModelCatalogsOnStartup(
  config: DesktopConfigFile,
  options?: { forceRefresh?: boolean },
): Promise<ModelCatalogStartupFetchSummary> {
  const targets = collectModelCatalogRefreshTargets(config.providers);
  const forceRefresh = options?.forceRefresh === true;
  const fetched: ModelCatalogRefreshFetchResult[] = [];
  let skipped = 0;
  let fromCache = 0;
  let fromNetwork = 0;

  const results = await Promise.all(
    targets.map(async (provider) => {
      try {
        const result = await loadModelCatalogForProvider(provider, { forceRefresh });
        return { provider, result };
      } catch {
        return { provider, result: undefined };
      }
    }),
  );

  for (const { provider, result } of results) {
    if (!result) {
      skipped += 1;
      continue;
    }
    fetched.push({ provider, result });
    if (result.fromCache) {
      fromCache += 1;
    } else {
      fromNetwork += 1;
    }
  }

  return {
    attempted: targets.length,
    fetched,
    skipped,
    fromCache,
    fromNetwork,
  };
}

export function applyConfiguredModelCatalogRefreshResults(
  config: DesktopConfigFile,
  fetched: readonly ModelCatalogRefreshFetchResult[],
): ModelCatalogStartupApplySummary {
  let merged = 0;
  let synced = 0;
  const prunedModelNames: string[] = [];

  for (const { provider, result } of fetched) {
    merged += mergeNewCatalogModelsIntoConfig(config, provider, result);
    prunedModelNames.push(...removeDelistedModelsFromCatalog(config, provider, result));
    synced += syncExistingModelsFromCatalog(config, provider, result);
  }

  return {
    refreshed: fetched.length,
    merged,
    synced,
    pruned: prunedModelNames.length,
    prunedModelNames,
  };
}

export async function refreshConfiguredModelCatalogsOnStartup(
  config: DesktopConfigFile,
  options?: { forceRefresh?: boolean },
): Promise<{
  attempted: number;
  refreshed: number;
  skipped: number;
  merged: number;
  synced: number;
  pruned: number;
  prunedModelNames: readonly string[];
  fromCache: number;
  fromNetwork: number;
}> {
  const fetchSummary = await fetchConfiguredModelCatalogsOnStartup(config, options);
  const applySummary = applyConfiguredModelCatalogRefreshResults(config, fetchSummary.fetched);

  return {
    attempted: fetchSummary.attempted,
    refreshed: applySummary.refreshed,
    skipped: fetchSummary.skipped,
    merged: applySummary.merged,
    synced: applySummary.synced,
    pruned: applySummary.pruned,
    prunedModelNames: applySummary.prunedModelNames,
    fromCache: fetchSummary.fromCache,
    fromNetwork: fetchSummary.fromNetwork,
  };
}
