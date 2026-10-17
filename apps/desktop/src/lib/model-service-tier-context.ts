import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

/** i18n key for a service tier value label (dropdown options, switch labels, trigger suffix). */
export function serviceTierValueLabelKey(tier: ModelServiceTier): string {
  return `app.modelPickerServiceTierValues.${tier}`;
}
