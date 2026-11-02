import { createContext, useContext } from "react";

import type { LabelTranslator } from "../composer/labels.js";
import type { ModelServiceTier } from "./types.js";

/** All user-visible copy of the model picker family; hosts localize via their i18n. */
export type ModelPickerLabels = {
  selectModel: string;
  searchModels: string;
  noMatches: string;
  noModelsAvailable: string;
  thinking: string;
  thinkingRequiredForEffort: string;
  effort: string;
  reasoningEffort: string;
  reasoningMode: string;
  reasoningModeStandard: string;
  reasoningModePro: string;
  serviceTier: string;
  /** Label of a tier value (dropdown options, switch labels, trigger suffix). */
  serviceTierValue: (tier: ModelServiceTier) => string;
  /** Availability hint when a tier's maxInputTokens excludes the current conversation size. */
  serviceTierInputLimit: (input: { tierLabel: string; tokensLabel: string }) => string;
  capabilityProviderTools: string;
  capability: (capability: string) => string;
  /** Provider group headers: host i18n key + fallback from the preset manifest. */
  providerGroupLabel: (labelKey: string, fallback: string) => string;
  /** Catalog detail field labels. */
  detailContext: string;
  detailMaxOutput: string;
  detailInput: string;
  detailOutput: string;
  detailCachedInput: string;
  detailImage: string;
  detailRequest: string;
  detailVideo: string;
  /** Catalog detail / pricing line templates (values are pre-formatted). */
  detailPricingInput: (value: string) => string;
  detailPricingOutput: (value: string) => string;
  detailPricingImage: (value: string) => string;
  detailPricingRequest: (value: string) => string;
  detailPricingVideo: (value: string) => string;
  detailPricingImageMegapixel: (value: string) => string;
  detailPricingExample: (value: string, description: string) => string;
  detailVideoPerSecond: (value: string) => string;
  detailVideoResolutionWithAudio: (resolution: string) => string;
};

const ModelPickerLabelsContext = createContext<ModelPickerLabels | null>(null);

export const ModelPickerLabelsProvider = ModelPickerLabelsContext.Provider;

export function useModelPickerLabels(): ModelPickerLabels {
  const labels = useContext(ModelPickerLabelsContext);
  if (!labels) {
    throw new Error("ModelPickerLabelsProvider is missing: the host must localize the picker");
  }
  return labels;
}

/** Capability badges on the model detail panel: capability id → i18n key + English default. */
const CAPABILITY_LABEL_KEYS: Record<string, { key: string; defaultValue: string }> = {
  languageModel: { key: "settings.capabilityLanguageModelLabel", defaultValue: "Language Model" },
  image: { key: "settings.capabilityImageLabel", defaultValue: "Image" },
  video: { key: "settings.capabilityVideoLabel", defaultValue: "Video" },
  imageGeneration: {
    key: "settings.capabilityImageGenerationLabel",
    defaultValue: "Image generation",
  },
  videoGeneration: {
    key: "settings.capabilityVideoGenerationLabel",
    defaultValue: "Video generation",
  },
};

/** Model picker copy mapped to the desktop i18n keys (the site resolves the same keys via the desktop packs). */
export function buildModelPickerLabels(t: LabelTranslator): ModelPickerLabels {
  return {
    selectModel: t("app.selectModel"),
    searchModels: t("app.searchModels"),
    noMatches: t("app.noMatches"),
    noModelsAvailable: t("app.noModelsAvailable"),
    thinking: t("app.modelPickerThinking"),
    thinkingRequiredForEffort: t("app.modelPickerThinkingRequiredForEffort"),
    effort: t("app.modelPickerEffort"),
    reasoningEffort: t("app.modelPickerReasoningEffort"),
    reasoningMode: t("app.modelPickerReasoningMode"),
    reasoningModeStandard: t("app.modelPickerReasoningModeStandard"),
    reasoningModePro: t("app.modelPickerReasoningModePro"),
    serviceTier: t("app.modelPickerServiceTier"),
    serviceTierValue: (tier) => t(`app.modelPickerServiceTierValues.${tier}`),
    serviceTierInputLimit: ({ tierLabel, tokensLabel }) =>
      t("app.modelPickerServiceTierInputLimit", { tier: tierLabel, tokens: tokensLabel }),
    capabilityProviderTools: t("settings.capabilityProviderToolsLabel"),
    capability: (capability) => {
      const entry = CAPABILITY_LABEL_KEYS[capability];
      return entry ? t(entry.key, { defaultValue: entry.defaultValue }) : capability;
    },
    providerGroupLabel: (labelKey, fallback) => t(labelKey, { defaultValue: fallback }),
    detailContext: t("settings.modelDetailLabelContext"),
    detailMaxOutput: t("settings.modelDetailLabelMaxOutput"),
    detailInput: t("settings.modelDetailLabelInput"),
    detailOutput: t("settings.modelDetailLabelOutput"),
    detailCachedInput: t("settings.modelDetailLabelCachedInput"),
    detailImage: t("settings.modelDetailLabelImage"),
    detailRequest: t("settings.modelDetailLabelRequest"),
    detailVideo: t("settings.modelDetailLabelVideo"),
    detailPricingInput: (value) => t("settings.modelDetailPricingInput", { value }),
    detailPricingOutput: (value) => t("settings.modelDetailPricingOutput", { value }),
    detailPricingImage: (value) => t("settings.modelDetailPricingImage", { value }),
    detailPricingRequest: (value) => t("settings.modelDetailPricingRequest", { value }),
    detailPricingVideo: (value) => t("settings.modelDetailPricingVideo", { value }),
    detailPricingImageMegapixel: (value) =>
      t("settings.modelDetailPricingImageMegapixel", { value }),
    detailPricingExample: (value, description) =>
      t("settings.modelDetailPricingExample", { value, description }),
    detailVideoPerSecond: (value) => t("settings.modelDetailPricingVideoPerSecond", { value }),
    detailVideoResolutionWithAudio: (resolution) =>
      t("settings.modelDetailPricingVideoResolutionWithAudio", { resolution }),
  };
}
