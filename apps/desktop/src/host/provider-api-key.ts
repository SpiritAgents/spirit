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
  type ProviderGroupV2,
} from "@spiritagent/host-internal";

import type { DesktopModelProvider } from "../types.js";

/** Keyring account for a provider-group-scoped API key (`Spirit` / `group::{id}`). */
export function groupKeyAccount(groupId: string): string {
  return `group::${groupId}`;
}

export function groupAccessKeyIdAccount(groupId: string): string {
  return `group::${groupId}::access-key-id`;
}

export function groupSecretAccessKeyAccount(groupId: string): string {
  return `group::${groupId}::secret-access-key`;
}

export function groupVertexClientEmailAccount(groupId: string): string {
  return `group::${groupId}::client-email`;
}

export function groupVertexPrivateKeyAccount(groupId: string): string {
  return `group::${groupId}::private-key`;
}

/** @deprecated Use {@link groupKeyAccount} */
export const providerKeyAccount = groupKeyAccount;

/** @deprecated Use {@link groupAccessKeyIdAccount} */
export const providerAccessKeyIdAccount = groupAccessKeyIdAccount;

/** @deprecated Use {@link groupSecretAccessKeyAccount} */
export const providerSecretAccessKeyAccount = groupSecretAccessKeyAccount;

/** @deprecated Use {@link groupVertexClientEmailAccount} */
export const providerVertexClientEmailAccount = groupVertexClientEmailAccount;

/** @deprecated Use {@link groupVertexPrivateKeyAccount} */
export const providerVertexPrivateKeyAccount = groupVertexPrivateKeyAccount;

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

/** Config profiles without `provider` are treated as custom-scoped keys. */
export function modelProviderKeyScope(provider?: DesktopModelProvider): DesktopModelProvider {
  return provider ?? "custom";
}

export interface ModelKeyPresenceProfile {
  groupId: string;
  name: string;
  provider?: DesktopModelProvider;
  vertexProject?: string;
  vertexLocation?: string;
}

export type ExistingModelForGroupAdd = ModelKeyPresenceProfile;

/** @deprecated Use {@link ExistingModelForGroupAdd} */
export type ExistingModelForProviderAdd = ExistingModelForGroupAdd;

/** True when the same model id is already configured under this provider group. */
export function modelExistsInGroupScope(
  existingModels: readonly ExistingModelForGroupAdd[],
  groupId: string,
  name: string,
): boolean {
  const normalizedGroupId = groupId.trim();
  const normalizedName = name.trim();
  return existingModels.some(
    (model) => model.groupId === normalizedGroupId && model.name === normalizedName,
  );
}

/** @deprecated Use {@link modelExistsInGroupScope} */
export function modelExistsInProviderScope(
  existingModels: readonly ExistingModelForProviderAdd[],
  name: string,
  provider?: DesktopModelProvider,
): boolean {
  const scope = modelProviderKeyScope(provider);
  return existingModels.some(
    (model) => model.name === name && modelProviderKeyScope(model.provider) === scope,
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
  providerGroups: ProviderGroupV2[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
};

export type ModelRemovalTarget = {
  ref: ModelRef;
};

function modelRefStillExists(
  groups: readonly ProviderGroupV2[],
  ref: ModelRef | undefined,
): boolean {
  return findModelByRef(groups, ref) !== undefined;
}

function clearDefaultSlotIfNoRemainingModel(
  config: ModelRemovalConfigTarget,
  slot: "imageGenerationModel" | "videoGenerationModel" | "secondaryLanguageModel",
): void {
  const value = config[slot];
  if (value && !modelRefStillExists(config.providerGroups, value)) {
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
  for (const group of config.providerGroups) {
    const before = group.models.length;
    group.models = group.models.filter(
      (model) =>
        !targetsToRemove.some(
          (target) => target.ref.groupId === group.id && target.ref.name === model.name,
        ),
    );
    removed += before - group.models.length;
  }

  if (!modelRefStillExists(config.providerGroups, config.activeModel)) {
    const remaining = listAllModelRefs(config.providerGroups);
    config.activeModel = remaining[0] ? { ...remaining[0] } : emptyModelRef();
  }
  clearDefaultSlotIfNoRemainingModel(config, "imageGenerationModel");
  clearDefaultSlotIfNoRemainingModel(config, "videoGenerationModel");
  clearDefaultSlotIfNoRemainingModel(config, "secondaryLanguageModel");
  return removed;
}

/** Model ids from `modelIds` that are not already present under the target group. */
export function filterNewGroupModelIds(
  existingModels: readonly ExistingModelForGroupAdd[],
  modelIds: readonly string[],
  groupId: string,
): string[] {
  return modelIds.filter((name) => !modelExistsInGroupScope(existingModels, groupId, name));
}

/** @deprecated Use {@link filterNewGroupModelIds} */
export const filterNewProviderModelIds = filterNewGroupModelIds;

/**
 * Per-model keyring presence: group-level entry OR legacy per-model entry.
 * Does not include env vars or global fallback (snapshot `keyConfigured` semantics).
 */
export function buildModelSecretKeyPresence(
  profiles: ModelKeyPresenceProfile[],
  hasGroupKey: (groupId: string, profile: ModelKeyPresenceProfile) => boolean,
  hasModelKey: (refKey: string) => boolean,
): Record<string, boolean> {
  const groupCache = new Map<string, boolean>();
  const out: Record<string, boolean> = {};
  for (const profile of profiles) {
    const ref: ModelRef = { groupId: profile.groupId, name: profile.name };
    const refKey = modelRefKey(ref);
    const cacheKey =
      profile.provider === "google-vertex-ai"
        ? `${profile.groupId}::${profile.vertexProject?.trim() ?? ""}::${profile.vertexLocation?.trim() ?? ""}`
        : profile.groupId;
    let groupPresent = groupCache.get(cacheKey);
    if (groupPresent === undefined) {
      groupPresent = hasGroupKey(profile.groupId, profile);
      groupCache.set(cacheKey, groupPresent);
    }
    out[refKey] = groupPresent ? true : hasModelKey(refKey);
  }
  return out;
}
