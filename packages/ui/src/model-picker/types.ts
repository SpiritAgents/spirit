/* Minimal structural types for the model picker family. Hosts pass their richer snapshot
 * objects; structural typing bridges them. Enum-shaped types mirror agent-core's wire
 * vocabulary (model-service-tier, model-effort, reasoning-effort) — keep them aligned. */

export type ModelRef = { providerId: string; name: string };

export type ModelServiceTier = "auto" | "default" | "flex" | "fast" | "priority" | "ultrafast";

/** Literal `serviceTiers` map form; the picker reads only `maxInputTokens` per tier. */
export type ModelServiceTierDeclaration = {
  maxInputTokens?: number;
};

/** Declared `serviceTiers` block: either the simple tier-name list or the literal wire map. */
export type ModelServiceTiersDeclaration =
  | readonly ModelServiceTier[]
  | Record<string, ModelServiceTierDeclaration>;

/** Generic picker selection value: reasoning-effort ids are free-form strings from catalogs. */
export type ModelEffortSelection = string;

/** agent-core MODEL_OUTPUT_EFFORT_TOKENS vocabulary ("output" semantics family); keep aligned. */
export type ModelOutputEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type ModelOutputEffortSelection = ModelOutputEffort | "default";

export type ModelReasoningMode = "standard" | "pro";

export type ModelCapability = string;

/** Thinking-switch declaration subset the picker controls read. */
export type ThinkingSwitchControlDeclaration = {
  defaultState?: "on" | "off";
  offBlockedEfforts?: readonly string[];
};

export type ModelCatalogVideoDurationPricing = {
  resolution: string;
  audio?: boolean;
  costPerSecondUsd?: string;
};

export type ModelCatalogPricing = {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  cachedInputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
  imagePerMegapixelUsd?: string;
  imageExamplePricing?: { priceUsd?: string; description?: string };
  videoExamplePricing?: { priceUsd?: string; description?: string };
  videoDurationPricing?: ModelCatalogVideoDurationPricing[];
};

/** Catalog-listing entry subset the picker reads (display + controls + detail fields). */
export type ModelCatalogEntry = {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: ModelCatalogPricing;
  capabilities?: ModelCapability[];
  supportedReasoningEfforts?: string[];
  effortSemantics?: "output";
  supportedEfforts?: ModelOutputEffort[];
  defaultEffort?: ModelOutputEffort;
  contextLength?: number;
  outputLimit?: number;
  maxCompletionTokens?: number;
  supportsThinkingType?: "only";
  supportsThinkingSwitch?: boolean;
  thinkingSwitch?: ThinkingSwitchControlDeclaration;
  serviceTiers?: ModelServiceTiersDeclaration;
  upstreamProvider?: string;
};

export type ModelCatalogHint = {
  providerId: string;
  apiBase: string;
  modelIds: string[];
  modelCatalog?: ModelCatalogEntry[];
  fetchedAtUnixMs?: number;
};

/** Provider entry subset the picker grouping reads. */
export type ProviderEntryMeta = { id: string; label?: string };

/** Picker row data delivered by the host snapshot (`config.providerPickerPresets`). */
export type ProviderPickerPresetRow = {
  id: string;
  label: string;
};

/** Model profile subset the picker reads; host snapshot profiles satisfy this structurally. */
export type ModelPickerModelProfile = {
  providerId: string;
  ref: ModelRef;
  name: string;
  apiBase?: string;
  reasoningEffort?: string;
  reasoningMode?: ModelReasoningMode;
  serviceTier?: ModelServiceTier;
  serviceTiers?: ModelServiceTiersDeclaration;
  supportedReasoningEfforts?: string[];
  effortSemantics?: "output";
  effort?: ModelOutputEffortSelection;
  supportedEfforts?: ModelOutputEffort[];
  defaultEffort?: ModelOutputEffort;
  supportedReasoningModes?: ModelReasoningMode[];
  capabilities?: ModelCapability[];
  supportsThinkingType?: "only";
  supportsThinkingSwitch?: boolean;
  thinkingSwitch?: ThinkingSwitchControlDeclaration;
  thinkingEnabled?: boolean;
  hasProviderTools?: boolean;
  contextLength?: number;
  outputLimit?: number;
};
