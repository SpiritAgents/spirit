import { createContext, useContext } from "react";

import type {
  ModelServiceTier,
  ModelServiceTiersDeclaration,
  ThinkingSwitchControlDeclaration,
} from "./types.js";

/**
 * Host-injected model semantics. Desktop wires the agent-core implementations
 * (id-display-title / thinking-switch / model-service-tier); the site preview wires stubs.
 * No default on purpose: these are agent-core-owned semantics, and a silent ui-local copy
 * would drift from the wire behavior.
 */
export interface ModelPickerRuntime {
  resolveModelDisplayTitle(input: {
    modelId: string;
    catalogDisplayName?: string | null;
    preserveRawIdWithoutCatalogDisplayName?: boolean;
  }): string;
  resolveThinkingSwitchState(config: {
    vendorExtendedThinking?: boolean;
    thinkingSwitch?: ThinkingSwitchControlDeclaration;
    effort?: string;
  }): "on" | "off";
  serviceTierMaxInputTokens(
    declaration: ModelServiceTiersDeclaration | undefined,
    tier: ModelServiceTier,
  ): number | undefined;
  isServiceTierAvailableForInputTokens(
    declaration: ModelServiceTiersDeclaration | undefined,
    tier: ModelServiceTier,
    lastInputTokens: number | undefined,
  ): boolean;
  resolveEffectiveServiceTier(input: {
    serviceTier?: ModelServiceTier;
    serviceTiers?: ModelServiceTiersDeclaration;
    lastInputTokens?: number;
  }): ModelServiceTier | undefined;
}

const ModelPickerRuntimeContext = createContext<ModelPickerRuntime | null>(null);

export const ModelPickerRuntimeProvider = ModelPickerRuntimeContext.Provider;

export function useModelPickerRuntime(): ModelPickerRuntime {
  const runtime = useContext(ModelPickerRuntimeContext);
  if (!runtime) {
    throw new Error(
      "ModelPickerRuntimeProvider is missing: the host must inject model semantics (see model-picker/runtime)",
    );
  }
  return runtime;
}
