import type {
  ModelServiceTier,
  ModelServiceTierContext,
} from "@spiritagent/agent-core/model-service-tier";

import type { ModelProfileSnapshot, PreviewModelCatalogEntry } from "@/types";

/**
 * Capability context for the service tier controls: profile facts win, and the catalog entry's
 * upstream identity is the fallback when the profile has not persisted one yet.
 */
export function modelServiceTierContextFromProfile(
  model: ModelProfileSnapshot,
  catalogEntry?: PreviewModelCatalogEntry,
): ModelServiceTierContext {
  const upstreamProvider = model.upstreamProvider ?? catalogEntry?.upstreamProvider;
  return {
    ...(model.provider ? { provider: model.provider } : {}),
    model: model.name,
    ...(model.transportKind ? { transportKind: model.transportKind } : {}),
    ...(upstreamProvider ? { upstreamProvider } : {}),
    ...(model.vertexLocation ? { vertexLocation: model.vertexLocation } : {}),
  };
}

/** i18n key for a service tier value label (dropdown options, switch labels, trigger suffix). */
export function serviceTierValueLabelKey(tier: ModelServiceTier): string {
  return `app.modelPickerServiceTierValues.${tier}`;
}
