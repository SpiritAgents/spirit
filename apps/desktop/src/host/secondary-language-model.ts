import type { ModelRef } from "../types.js";
import type { DesktopConfigFile } from "./storage.js";
import {
  flattenProviders,
  modelSupportsLanguageModel,
  resolveModelProfile,
  type ResolvedModelProfile,
} from "./model-config-access.js";

export type SecondaryLanguageModelResolveInput = Pick<
  DesktopConfigFile,
  "activeModel" | "secondaryLanguageModel" | "providers"
>;

export { modelSupportsLanguageModel };

export const SECONDARY_LANGUAGE_MODEL_FALLBACK_PATTERNS = ["deepseek-v4-flash"] as const;

export function normalizeSecondaryLanguageModel(
  value: ModelRef | undefined,
  config: Pick<DesktopConfigFile, "providers">,
): ModelRef | undefined {
  const profile = resolveModelProfile(config, value);
  return profile && modelSupportsLanguageModel(profile) ? profile.ref : undefined;
}

export function resolveSecondaryLanguageModelName(
  config: SecondaryLanguageModelResolveInput,
): ModelRef {
  const explicit = normalizeSecondaryLanguageModel(config.secondaryLanguageModel, config);
  if (explicit) {
    return explicit;
  }

  const models = flattenProviders(config);
  for (const pattern of SECONDARY_LANGUAGE_MODEL_FALLBACK_PATTERNS) {
    const lowerPattern = pattern.toLowerCase();
    const match = models.find(
      (model) =>
        modelSupportsLanguageModel(model) && model.name.toLowerCase().includes(lowerPattern),
    );
    if (match) {
      return match.ref;
    }
  }

  return config.activeModel;
}

export function resolveSecondaryLanguageModelProfile(
  config: SecondaryLanguageModelResolveInput,
): { name: string; profile: ResolvedModelProfile } | null {
  const ref = resolveSecondaryLanguageModelName(config);
  const profile = resolveModelProfile(config, ref);
  if (!profile || !modelSupportsLanguageModel(profile)) {
    return null;
  }

  return { name: profile.name, profile };
}
