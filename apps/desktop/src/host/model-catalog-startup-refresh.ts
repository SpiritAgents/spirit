import {
  defaultModelReasoningEffort,
  type ModelReasoningEffort,
} from "@spiritagent/agent-core/reasoning-effort";
import { normalizeOpenAiApiBase } from "@spiritagent/host-internal/openai-api-base";

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopProviderConnectSiteId,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from "../types.js";
import {
  providerSupportsModelCatalogListing,
  previewCatalogMapForTransport,
} from "./model-catalog-metadata.js";
import {
  loadPreviewModelsForTransport,
  reasoningProviderForTransport,
  resolveDesktopTransportKind,
  supportsImageGeneration,
  supportsVideoGeneration,
  type LoadedPreviewModelsResult,
} from "./model-config.js";
import {
  findProviderGroup,
  flattenProviderGroups,
  modelExistsInGroup,
  resolveModelProfileFromParts,
} from "./model-config-access.js";
import {
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  modelProviderKeyScope,
  applyModelsRemovalToConfig,
  type ModelRemovalTarget,
} from "./provider-api-key.js";
import {
  DEFAULT_API_BASE,
  normalizeModelCapabilities,
  normalizeSupportedReasoningEfforts,
  readBedrockProviderCredentialsFromKeyring,
  readGoogleVertexProviderCredentialsFromKeyring,
  resolveApiKeyForConfigModel,
  type DesktopConfigFile,
} from "./storage.js";

export function modelCatalogScopeKey(
  model: Pick<ModelProfileSnapshot, "provider" | "transportKind" | "apiBase">,
): string {
  const base = model.apiBase.trim() || DEFAULT_API_BASE;
  const transportKind = resolveDesktopTransportKind(model);
  return `${model.provider ?? "custom"}::${transportKind}::${normalizeOpenAiApiBase(base)}`;
}

export function collectModelCatalogRefreshTargets(
  models: readonly ModelProfileSnapshot[],
): ModelProfileSnapshot[] {
  const seen = new Set<string>();
  const targets: ModelProfileSnapshot[] = [];
  for (const model of models) {
    if (!providerSupportsModelCatalogListing(model)) {
      continue;
    }
    const key = modelCatalogScopeKey(model);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(model);
  }
  return targets;
}

export async function loadModelCatalogForProfile(
  config: Pick<DesktopConfigFile, "providerGroups">,
  profile: ModelProfileSnapshot,
  options?: { forceRefresh?: boolean },
): Promise<LoadedPreviewModelsResult | undefined> {
  const forceRefresh = options?.forceRefresh === true;
  const provider = profile.provider;
  if (!provider || !providerSupportsModelCatalogListing(profile)) {
    return undefined;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const modelRef =
    profile.ref ?? (profile.groupId ? { groupId: profile.groupId, name: profile.name } : undefined);
  const apiKey = modelRef ? await resolveApiKeyForConfigModel(config, modelRef) : undefined;

  if (transportKind === "bedrock") {
    const bedrockCredentials = readBedrockProviderCredentialsFromKeyring(
      modelProviderKeyScope(provider),
    );
    if (
      !profile.awsRegion?.trim() ||
      !hasBedrockRuntimeCredentials({
        apiKey,
        accessKeyId: bedrockCredentials.accessKeyId,
        secretAccessKey: bedrockCredentials.secretAccessKey,
      })
    ) {
      return undefined;
    }
    return loadPreviewModelsForTransport({
      provider,
      transportKind,
      apiBase,
      apiKey: apiKey?.trim() ?? bedrockCredentials.apiKey?.trim() ?? "",
      awsRegion: profile.awsRegion,
      accessKeyId: bedrockCredentials.accessKeyId,
      secretAccessKey: bedrockCredentials.secretAccessKey,
      forceRefresh,
    });
  }

  if (provider === "google-vertex-ai") {
    const vertexCredentials = readGoogleVertexProviderCredentialsFromKeyring("google-vertex-ai");
    if (
      !hasGoogleVertexRuntimeCredentials({
        apiKey,
        clientEmail: vertexCredentials.clientEmail,
        privateKey: vertexCredentials.privateKey,
        vertexProject: profile.vertexProject,
        vertexLocation: profile.vertexLocation,
      })
    ) {
      return undefined;
    }
    return loadPreviewModelsForTransport({
      provider,
      transportKind,
      apiBase,
      apiKey: apiKey?.trim() ?? vertexCredentials.apiKey?.trim() ?? "",
      ...(profile.vertexProject ? { vertexProject: profile.vertexProject } : {}),
      ...(profile.vertexLocation ? { vertexLocation: profile.vertexLocation } : {}),
      ...(vertexCredentials.clientEmail
        ? { vertexClientEmail: vertexCredentials.clientEmail }
        : {}),
      ...(vertexCredentials.privateKey ? { vertexPrivateKey: vertexCredentials.privateKey } : {}),
      forceRefresh,
    });
  }

  if (!apiKey?.trim()) {
    return undefined;
  }

  return loadPreviewModelsForTransport({
    provider,
    transportKind,
    apiBase,
    apiKey: apiKey.trim(),
    forceRefresh,
  });
}

export async function forceRefreshModelCatalogForProfile(
  config: Pick<DesktopConfigFile, "providerGroups">,
  profile: ModelProfileSnapshot,
): Promise<LoadedPreviewModelsResult | undefined> {
  return loadModelCatalogForProfile(config, profile, { forceRefresh: true });
}

type StartupMergedProfile = {
  name: string;
  apiBase: string;
  reasoningEffort: ModelReasoningEffort;
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  capabilities?: DesktopModelCapability[];
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  awsRegion?: string;
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: import("../types.js").DesktopAlibabaBillingMode;
  stepfunBillingMode?: import("../types.js").DesktopStepfunBillingMode;
  zAiBillingMode?: import("../types.js").DesktopGlmCodingPlanBillingMode;
  zhipuBillingMode?: import("../types.js").DesktopGlmCodingPlanBillingMode;
  vertexProject?: string;
  vertexLocation?: string;
};

export function mergeNewCatalogModelsIntoConfig(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): number {
  const provider = profile.provider;
  const groupId = profile.groupId?.trim();
  if (!provider || !groupId) {
    return 0;
  }
  const group = findProviderGroup(config, groupId);
  if (!group) {
    return 0;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const catalogEntries = previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: result.modelCatalog,
  });

  const toAdd: StartupMergedProfile[] = [];
  for (const name of result.modelIds) {
    const trimmed = name.trim();
    if (!trimmed || modelExistsInGroup(config, groupId, trimmed)) {
      continue;
    }
    const catalogEntry = catalogEntries.get(trimmed);
    const merged: StartupMergedProfile = {
      name: trimmed,
      apiBase,
      reasoningEffort: defaultModelReasoningEffort({
        ...(reasoningProviderForTransport(provider, transportKind)
          ? { provider: reasoningProviderForTransport(provider, transportKind) }
          : {}),
        model: trimmed,
        ...(catalogEntry?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
          : {}),
        ...(catalogEntry?.defaultReasoningEffort
          ? { defaultEffort: catalogEntry.defaultReasoningEffort }
          : {}),
      }),
    };
    if (catalogEntry?.supportedReasoningEfforts !== undefined) {
      merged.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
    }
    if (catalogEntry?.capabilities) {
      merged.capabilities = catalogEntry.capabilities;
    }
    merged.provider = provider;
    if (
      transportKind === "anthropic" ||
      transportKind === "open-responses" ||
      transportKind === "bedrock"
    ) {
      merged.transportKind = transportKind;
    }
    if (provider === "amazon-bedrock" && profile.awsRegion?.trim()) {
      merged.awsRegion = profile.awsRegion.trim();
    }
    if (profile.providerSite) {
      merged.providerSite = profile.providerSite;
    }
    if (provider === "alibaba" && profile.alibabaWorkspaceId?.trim()) {
      merged.alibabaWorkspaceId = profile.alibabaWorkspaceId.trim();
    }
    if (provider === "alibaba" && profile.alibabaBillingMode === "token-plan") {
      merged.alibabaBillingMode = "token-plan";
    }
    if (provider === "stepfun" && profile.stepfunBillingMode === "step-plan") {
      merged.stepfunBillingMode = "step-plan";
    }
    if (provider === "z-ai" && profile.zAiBillingMode === "glm-coding-plan") {
      merged.zAiBillingMode = "glm-coding-plan";
    }
    if (provider === "zhipu-ai" && profile.zhipuBillingMode === "glm-coding-plan") {
      merged.zhipuBillingMode = "glm-coding-plan";
    }
    if (provider === "google-vertex-ai") {
      if (profile.vertexProject?.trim()) {
        merged.vertexProject = profile.vertexProject.trim();
      }
      if (profile.vertexLocation?.trim()) {
        merged.vertexLocation = profile.vertexLocation.trim();
      }
    }
    toAdd.push(merged);
  }

  if (toAdd.length === 0) {
    return 0;
  }

  for (const merged of toAdd) {
    group.models.push({
      name: merged.name,
      reasoningEffort:
        merged.reasoningEffort as import("@spiritagent/host-internal").ModelEntryV2["reasoningEffort"],
      ...(merged.supportedReasoningEfforts !== undefined
        ? {
            supportedReasoningEfforts:
              merged.supportedReasoningEfforts as import("@spiritagent/host-internal").ModelEntryV2["supportedReasoningEfforts"],
          }
        : {}),
      ...(merged.capabilities !== undefined ? { capabilities: merged.capabilities } : {}),
    });
  }

  if (!config.imageGenerationModel) {
    const imageGenerationProfile = toAdd.find((entry) => supportsImageGeneration(entry));
    if (imageGenerationProfile) {
      config.imageGenerationModel = { groupId, name: imageGenerationProfile.name };
    }
  }
  if (!config.videoGenerationModel) {
    const videoGenerationProfile = toAdd.find((entry) => supportsVideoGeneration(entry));
    if (videoGenerationProfile) {
      config.videoGenerationModel = { groupId, name: videoGenerationProfile.name };
    }
  }

  return toAdd.length;
}

function modelMatchesCatalogRefreshScope(
  model: ModelProfileSnapshot,
  provider: DesktopModelProvider,
  transportKind: DesktopTransportKind,
  apiBase: string,
): boolean {
  if (model.provider !== provider) {
    return false;
  }
  if (resolveDesktopTransportKind(model) !== transportKind) {
    return false;
  }
  const modelBase = model.apiBase.trim() || DEFAULT_API_BASE;
  return normalizeOpenAiApiBase(modelBase) === normalizeOpenAiApiBase(apiBase);
}

function normalizedCapabilitiesEqual(
  left: readonly DesktopModelCapability[] | undefined,
  right: readonly DesktopModelCapability[] | undefined,
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

function parseCatalogContextLength(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

/** Apply catalog-derived profile fields; returns whether the stored model changed. */
export function applyCatalogEntryToStoredModel(
  model: ModelProfileSnapshot,
  catalogEntry: PreviewModelCatalogEntry,
): boolean {
  let changed = false;

  if (catalogEntry.capabilities?.length) {
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
        model.supportedReasoningEfforts = nextReasoningEfforts;
      } else {
        delete model.supportedReasoningEfforts;
      }
      changed = true;
    }
  }

  if (model.contextLength === undefined) {
    const nextContextLength = parseCatalogContextLength(catalogEntry.contextLength);
    if (nextContextLength !== undefined) {
      model.contextLength = nextContextLength;
      changed = true;
    }
  }

  if (
    catalogEntry.supportsThinkingType !== undefined &&
    model.supportsThinkingType !== catalogEntry.supportsThinkingType
  ) {
    model.supportsThinkingType = catalogEntry.supportsThinkingType;
    changed = true;
  }

  if (catalogEntry.supportsThinkingSwitch === true && model.supportsThinkingSwitch !== true) {
    model.supportsThinkingSwitch = true;
    changed = true;
  }

  return changed;
}

/** Writes catalog entries back to persisted models in the same scope (capabilities / supportedReasoningEfforts, etc.). */
export function syncExistingModelsFromCatalog(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): number {
  const provider = profile.provider;
  if (!provider) {
    return 0;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const catalogEntries = previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: result.modelCatalog,
  });
  if (catalogEntries.size === 0) {
    return 0;
  }

  let updated = 0;
  for (const group of config.providerGroups) {
    for (const model of group.models) {
      const resolved = resolveModelProfileFromParts(group, model);
      if (
        !resolved ||
        !modelMatchesCatalogRefreshScope(resolved, provider, transportKind, apiBase)
      ) {
        continue;
      }
      const catalogEntry = catalogEntries.get(model.name);
      if (!catalogEntry) {
        continue;
      }
      if (applyCatalogEntryToStoredModel(resolved, catalogEntry)) {
        if (resolved.capabilities !== undefined) {
          model.capabilities = resolved.capabilities;
        }
        if (resolved.supportedReasoningEfforts !== undefined) {
          model.supportedReasoningEfforts =
            resolved.supportedReasoningEfforts as import("@spiritagent/host-internal").ModelEntryV2["supportedReasoningEfforts"];
        } else {
          delete model.supportedReasoningEfforts;
        }
        if (resolved.contextLength !== undefined) {
          model.contextLength = resolved.contextLength;
        }
        if (resolved.supportsThinkingType !== undefined) {
          model.supportsThinkingType = resolved.supportsThinkingType;
        }
        if (resolved.supportsThinkingSwitch === true) {
          model.supportsThinkingSwitch = true;
        }
        updated += 1;
      }
    }
  }
  return updated;
}

/** Removes persisted models in the same scope that are no longer in the upstream catalog. */
export function removeDelistedModelsFromCatalog(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): readonly string[] {
  const provider = profile.provider;
  if (!provider) {
    return [];
  }
  const catalogIds = new Set(result.modelIds.map((id) => id.trim()).filter((id) => id.length > 0));
  if (catalogIds.size === 0) {
    return [];
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const targetsToRemove: ModelRemovalTarget[] = [];
  for (const group of config.providerGroups) {
    for (const model of group.models) {
      const resolved = resolveModelProfileFromParts(group, model);
      if (
        !resolved ||
        !modelMatchesCatalogRefreshScope(resolved, provider, transportKind, apiBase)
      ) {
        continue;
      }
      if (!catalogIds.has(model.name)) {
        targetsToRemove.push({ ref: { groupId: group.id, name: model.name } });
      }
    }
  }
  if (targetsToRemove.length === 0) {
    return [];
  }
  applyModelsRemovalToConfig(config, targetsToRemove);
  return targetsToRemove.map((target) => target.ref.name);
}

export type ModelCatalogRefreshFetchResult = {
  profile: ModelProfileSnapshot;
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
  const targets = collectModelCatalogRefreshTargets(flattenProviderGroups(config));
  const forceRefresh = options?.forceRefresh === true;
  const fetched: ModelCatalogRefreshFetchResult[] = [];
  let skipped = 0;
  let fromCache = 0;
  let fromNetwork = 0;

  const results = await Promise.all(
    targets.map(async (profile) => {
      try {
        const result = await loadModelCatalogForProfile(config, profile, { forceRefresh });
        return { profile, result };
      } catch {
        return { profile, result: undefined };
      }
    }),
  );

  for (const { profile, result } of results) {
    if (!result) {
      skipped += 1;
      continue;
    }
    fetched.push({ profile, result });
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

  for (const { profile, result } of fetched) {
    merged += mergeNewCatalogModelsIntoConfig(config, profile, result);
    prunedModelNames.push(...removeDelistedModelsFromCatalog(config, profile, result));
    synced += syncExistingModelsFromCatalog(config, profile, result);
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
