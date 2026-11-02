import type { ModelPickerRuntime } from "@spiritagent/ui/model-picker";

/**
 * Preview stub for the picker's model semantics. Preview models declare no tiers/thinking
 * switches, so these paths are inert; the implementations mirror the agent-core contracts.
 */
export const previewModelPickerRuntime: ModelPickerRuntime = {
  resolveModelDisplayTitle: ({ modelId, catalogDisplayName }) =>
    catalogDisplayName?.trim() || modelId,
  resolveThinkingSwitchState: (config) => {
    if (
      config.effort !== undefined &&
      config.thinkingSwitch?.offBlockedEfforts?.includes(config.effort)
    ) {
      return "on";
    }
    if (config.vendorExtendedThinking !== undefined) {
      return config.vendorExtendedThinking ? "on" : "off";
    }
    return config.thinkingSwitch?.defaultState ?? "on";
  },
  serviceTierMaxInputTokens: (declaration, tier) => {
    if (declaration === undefined || Array.isArray(declaration)) {
      return undefined;
    }
    const record = declaration as Record<string, { maxInputTokens?: number }>;
    return record[tier]?.maxInputTokens;
  },
  isServiceTierAvailableForInputTokens: (declaration, tier, lastInputTokens) => {
    const max = previewModelPickerRuntime.serviceTierMaxInputTokens(declaration, tier);
    return max === undefined || lastInputTokens === undefined || lastInputTokens <= max;
  },
  resolveEffectiveServiceTier: (input) => {
    const tier = input.serviceTier;
    if (
      tier === undefined ||
      previewModelPickerRuntime.isServiceTierAvailableForInputTokens(
        input.serviceTiers,
        tier,
        input.lastInputTokens,
      )
    ) {
      return tier;
    }
    if (
      input.serviceTiers !== undefined &&
      (Array.isArray(input.serviceTiers)
        ? input.serviceTiers.includes("default")
        : Object.keys(input.serviceTiers).includes("default"))
    ) {
      return "default";
    }
    return undefined;
  },
};
