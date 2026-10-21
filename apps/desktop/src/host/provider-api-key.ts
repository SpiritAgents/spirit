import {
  hasBedrockIamCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from "../lib/provider-runtime-credentials.js";

export {
  hasBedrockIamCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from "../lib/provider-runtime-credentials.js";

import {
  emptyModelRef,
  findModelByRef,
  listAllModelRefs,
  modelRefKey,
  modelRefsEqual,
  type ModelRef,
  type ProviderEntry,
} from "@spiritagent/host-internal";

export interface BedrockProviderCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export function hasBedrockRuntimeCredentials(credentials: BedrockProviderCredentials): boolean {
  if (credentials.apiKey?.trim()) {
    return true;
  }
  return hasBedrockIamCredentials(credentials);
}

export interface GoogleVertexProviderCredentials {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
}

export function hasGoogleVertexRuntimeCredentials(input: {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): boolean {
  if (input.apiKey?.trim()) {
    return true;
  }
  if (hasGoogleVertexServiceAccountCredentials(input)) {
    return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
  }
  return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
}

export interface ModelKeyPresenceProfile {
  providerId: string;
  name: string;
}

export type ExistingModelForProviderAdd = ModelKeyPresenceProfile;

/** True when the same model id is already configured under this provider entry. */
export function modelExistsInProviderScope(
  existingModels: readonly ExistingModelForProviderAdd[],
  providerId: string,
  name: string,
): boolean {
  const normalizedProviderId = providerId.trim();
  const normalizedName = name.trim();
  return existingModels.some(
    (model) => model.providerId === normalizedProviderId && model.name === normalizedName,
  );
}

/** After removing models, keep active if still valid; else first remaining or empty. */
export function resolveActiveModelAfterRemoval(
  currentActive: ModelRef,
  remainingModels: readonly ModelRef[],
  removedRefs: readonly ModelRef[],
): ModelRef {
  if (!removedRefs.some((ref) => modelRefsEqual(ref, currentActive))) {
    return currentActive;
  }
  return remainingModels[0] ? { ...remainingModels[0] } : emptyModelRef();
}

type ModelRemovalConfigTarget = {
  providers: ProviderEntry[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
};

export type ModelRemovalTarget = {
  ref: ModelRef;
};

function modelRefStillExists(
  providers: readonly ProviderEntry[],
  ref: ModelRef | undefined,
): boolean {
  return findModelByRef(providers, ref) !== undefined;
}

function clearDefaultSlotIfNoRemainingModel(
  config: ModelRemovalConfigTarget,
  slot: "imageGenerationModel" | "videoGenerationModel" | "secondaryLanguageModel",
): void {
  const value = config[slot];
  if (value && !modelRefStillExists(config.providers, value)) {
    delete config[slot];
  }
}

/** Remove models from config and clear dependent default slots (same semantics as settings delete). */
export function applyModelsRemovalToConfig(
  config: ModelRemovalConfigTarget,
  targetsToRemove: readonly ModelRemovalTarget[],
): number {
  if (targetsToRemove.length === 0) {
    return 0;
  }
  let removed = 0;
  for (const provider of config.providers) {
    const before = provider.models.length;
    provider.models = provider.models.filter(
      (model) =>
        !targetsToRemove.some(
          (target) => target.ref.providerId === provider.id && target.ref.name === model.name,
        ),
    );
    removed += before - provider.models.length;
  }

  if (!modelRefStillExists(config.providers, config.activeModel)) {
    const remaining = listAllModelRefs(config.providers);
    config.activeModel = remaining[0] ? { ...remaining[0] } : emptyModelRef();
  }
  clearDefaultSlotIfNoRemainingModel(config, "imageGenerationModel");
  clearDefaultSlotIfNoRemainingModel(config, "videoGenerationModel");
  clearDefaultSlotIfNoRemainingModel(config, "secondaryLanguageModel");
  return removed;
}

/** Model ids from `modelIds` that are not already present under the target provider entry. */
export function filterNewProviderModelIds(
  existingModels: readonly ExistingModelForProviderAdd[],
  modelIds: readonly string[],
  providerId: string,
): string[] {
  return modelIds.filter((name) => !modelExistsInProviderScope(existingModels, providerId, name));
}

/**
 * Per-model keyring presence: the provider entry's internal keyring credential
 * (`provider::{id}` or a `credentials` slot account). Excludes env vars and declared
 * external channels (snapshot `keyConfigured` semantics).
 */
export function buildModelSecretKeyPresence(
  profiles: ModelKeyPresenceProfile[],
  hasProviderKey: (providerId: string) => boolean,
): Record<string, boolean> {
  const providerCache = new Map<string, boolean>();
  const out: Record<string, boolean> = {};
  for (const profile of profiles) {
    const ref: ModelRef = { providerId: profile.providerId, name: profile.name };
    let present = providerCache.get(profile.providerId);
    if (present === undefined) {
      present = hasProviderKey(profile.providerId);
      providerCache.set(profile.providerId, present);
    }
    out[modelRefKey(ref)] = present;
  }
  return out;
}
