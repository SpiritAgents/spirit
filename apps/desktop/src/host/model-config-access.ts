import {
  findProviderEntry,
  resolveModelEntry,
  type ModelEntry,
  type ModelRef,
  type ProviderEntry,
} from "@spiritagent/host-internal";

import type { ModelProfileSnapshot } from "../types.js";
import type { DesktopConfigFile } from "./storage.js";

export type ResolvedModelProfile = ModelProfileSnapshot;

export function flattenProviders(
  config: Pick<DesktopConfigFile, "providers">,
): ResolvedModelProfile[] {
  const resolved: ResolvedModelProfile[] = [];
  for (const provider of config.providers) {
    for (const model of provider.models) {
      const profile = resolveModelProfileFromParts(provider, model);
      if (profile) {
        resolved.push(profile);
      }
    }
  }
  return resolved;
}

/**
 * Snapshot projection of one config model entry: connection facts come from the provider entry;
 * model-level fields are the effective (post-inheritance) values per host-internal
 * `resolveModelEntry`. Vendor-free by construction.
 */
export function resolveModelProfileFromParts(
  provider: ProviderEntry,
  model: ModelEntry,
): ResolvedModelProfile | null {
  if (!provider.id.trim() || !model.name.trim()) {
    return null;
  }
  const effective = resolveModelEntry(provider, model.name);
  if (!effective) {
    return null;
  }
  const ref: ModelRef = { providerId: provider.id, name: model.name };
  return {
    ref,
    providerId: provider.id,
    name: model.name,
    apiBase: provider.apiBase,
    ...(provider.transportKind ? { transportKind: provider.transportKind } : {}),
    ...(effective.reasoningEffort !== undefined
      ? { reasoningEffort: effective.reasoningEffort }
      : {}),
    ...(effective.reasoningMode !== undefined ? { reasoningMode: effective.reasoningMode } : {}),
    ...(effective.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: [...effective.supportedReasoningEfforts] }
      : {}),
    ...(effective.supportedReasoningModes !== undefined
      ? { supportedReasoningModes: [...effective.supportedReasoningModes] }
      : {}),
    ...(effective.capabilities !== undefined ? { capabilities: [...effective.capabilities] } : {}),
    ...(effective.contextLength !== undefined ? { contextLength: effective.contextLength } : {}),
    ...(effective.outputLimit !== undefined ? { outputLimit: effective.outputLimit } : {}),
    ...(effective.supportsThinkingType !== undefined
      ? { supportsThinkingType: effective.supportsThinkingType }
      : {}),
    ...(effective.supportsThinkingSwitch !== undefined
      ? { supportsThinkingSwitch: effective.supportsThinkingSwitch }
      : {}),
    ...(effective.thinkingEnabled !== undefined
      ? { thinkingEnabled: effective.thinkingEnabled }
      : {}),
    ...(provider.providerTools !== undefined && provider.providerTools.length > 0
      ? { hasProviderTools: true }
      : {}),
    ...(provider.imageApi !== undefined ? { imageApi: provider.imageApi } : {}),
    ...(provider.videoApi !== undefined ? { videoApi: provider.videoApi } : {}),
    ...(effective.serviceTiers !== undefined ? { serviceTiers: effective.serviceTiers } : {}),
    ...(effective.serviceTier !== undefined ? { serviceTier: effective.serviceTier } : {}),
  };
}

export function resolveModelProfile(
  config: Pick<DesktopConfigFile, "providers">,
  ref: ModelRef | undefined,
): ResolvedModelProfile | null {
  if (!ref?.providerId?.trim() || !ref?.name?.trim()) {
    return null;
  }
  const provider = findProviderEntry(config.providers, ref.providerId);
  if (!provider) {
    return null;
  }
  const model = provider.models.find((entry) => entry.name === ref.name.trim());
  if (!model) {
    return null;
  }
  return resolveModelProfileFromParts(provider, model);
}

export function firstModelRef(config: Pick<DesktopConfigFile, "providers">): ModelRef {
  const firstProvider = config.providers[0];
  const firstModel = firstProvider?.models[0];
  if (!firstProvider || !firstModel) {
    return { providerId: "", name: "" };
  }
  return { providerId: firstProvider.id, name: firstModel.name };
}

export function modelRefExists(
  config: Pick<DesktopConfigFile, "providers">,
  ref: ModelRef | undefined,
): boolean {
  return resolveModelProfile(config, ref) !== null;
}

export function resolveActiveModelProfile(config: DesktopConfigFile): ResolvedModelProfile | null {
  return resolveModelProfile(config, config.activeModel);
}

export function modelSupportsImageGeneration(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities?.includes("imageGeneration") === true;
}

export function modelSupportsVideoGeneration(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities?.includes("videoGeneration") === true;
}

export function modelSupportsLanguageModel(
  model: Pick<ModelProfileSnapshot, "capabilities">,
): boolean {
  return model.capabilities === undefined || model.capabilities.includes("languageModel");
}

export function findModelRefByName(
  config: Pick<DesktopConfigFile, "providers">,
  name: string,
): ModelRef | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return undefined;
  }
  for (const provider of config.providers) {
    const model = provider.models.find((entry) => entry.name === trimmed);
    if (model) {
      return { providerId: provider.id, name: model.name };
    }
  }
  return undefined;
}

export function resolvePaneModelRef(
  config: Pick<DesktopConfigFile, "providers">,
  ref: ModelRef | undefined,
): ModelRef | undefined {
  if (!ref?.name?.trim()) {
    return undefined;
  }
  const profile = resolveModelProfile(config, ref);
  if (profile) {
    return profile.ref;
  }
  if (!ref.providerId?.trim()) {
    return findModelRefByName(config, ref.name);
  }
  return undefined;
}

export function normalizeSlotModelRef(
  value: unknown,
  config: Pick<DesktopConfigFile, "providers">,
  predicate: (profile: ResolvedModelProfile) => boolean,
): ModelRef | undefined {
  const ref =
    typeof value === "object" && value !== null
      ? {
          providerId:
            typeof (value as ModelRef).providerId === "string"
              ? (value as ModelRef).providerId.trim()
              : "",
          name: typeof (value as ModelRef).name === "string" ? (value as ModelRef).name.trim() : "",
        }
      : undefined;
  if (!ref?.providerId || !ref?.name) {
    return undefined;
  }
  const profile = resolveModelProfile(config, ref);
  return profile && predicate(profile) ? ref : undefined;
}
