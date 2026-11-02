import { resolveModelDisplayTitle } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { resolveThinkingSwitchState } from "@spiritagent/agent-core/thinking-switch";
import {
  isServiceTierAvailableForInputTokens,
  resolveEffectiveServiceTier,
  serviceTierMaxInputTokens,
} from "@spiritagent/agent-core/model-service-tier";
import type { ModelPickerRuntime } from "@spiritagent/ui/model-picker";

/** Desktop's model-semantics runtime: agent-core implementations injected into @spiritagent/ui. */
export const desktopModelPickerRuntime: ModelPickerRuntime = {
  resolveModelDisplayTitle,
  resolveThinkingSwitchState,
  serviceTierMaxInputTokens,
  isServiceTierAvailableForInputTokens,
  resolveEffectiveServiceTier,
};
