import { resolveModelDisplayTitle } from "@spiritagent/agent-core/model-catalog/id-display-title";

import { formatCompactTokenCount } from "./format-compact-token-count.js";
import { parseModelContextLength } from "./model-context-length.js";

import type {
  DesktopModelCatalogHint,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
  PreviewModelCatalogPricing,
  PreviewModelCatalogVideoDurationPricing,
} from "../types.js";

/**
 * Whether to keep the raw model id instead of formatting it when the catalog has no displayName:
 * route-prefixed ids (`openai/gpt-5.5`, `publishers/google/models/…`) mangle badly when formatted.
 */
export function modelIdPreservesRawDisplayTitle(modelId: string): boolean {
  return modelId.includes("/");
}

/** Catalog hints are scoped to a provider entry (cache key `provider::{id}::apiBase`). */
export function modelCatalogHintKey(input: { providerId: string }): string {
  return input.providerId;
}

function catalogEntryIndexKey(hintKey: string, modelId: string): string {
  return `${hintKey}::${modelId}`;
}

/** Mapping key for display names / catalog details: the same model id can be independent under different providers. */
export function modelCatalogScopeEntryKey(
  model: Pick<ModelProfileSnapshot, "providerId" | "name">,
): string {
  return catalogEntryIndexKey(modelCatalogHintKey({ providerId: model.providerId }), model.name);
}

export function buildModelCatalogEntryIndex(
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, PreviewModelCatalogEntry> {
  const index = new Map<string, PreviewModelCatalogEntry>();
  for (const hint of hints ?? []) {
    const hintKey = modelCatalogHintKey({ providerId: hint.providerId });
    for (const entry of hint.modelCatalog ?? []) {
      const id = entry.id.trim();
      if (!id) {
        continue;
      }
      index.set(catalogEntryIndexKey(hintKey, id), entry);
    }
  }
  return index;
}

export function findModelCatalogEntry(
  model: ModelProfileSnapshot,
  hints: readonly DesktopModelCatalogHint[] | undefined,
  entryIndex?: Map<string, PreviewModelCatalogEntry>,
): PreviewModelCatalogEntry | undefined {
  const index = entryIndex ?? buildModelCatalogEntryIndex(hints);
  const hintKey = modelCatalogHintKey({ providerId: model.providerId });
  return index.get(catalogEntryIndexKey(hintKey, model.name));
}

export function modelHasCatalogDetail(entry: PreviewModelCatalogEntry | undefined): boolean {
  if (!entry) {
    return false;
  }
  if (entry.displayName?.trim()) {
    return true;
  }
  // The upstream identity fact is display metadata for aggregator routes.
  if (entry.upstreamProvider?.trim()) {
    return true;
  }
  // Declared service tiers feed the picker's tier control even without other display detail.
  if (
    entry.serviceTiers &&
    (Array.isArray(entry.serviceTiers)
      ? entry.serviceTiers.length > 0
      : Object.keys(entry.serviceTiers).length > 0)
  ) {
    return true;
  }
  if (entry.description?.trim()) {
    return true;
  }
  const pricing = entry.pricing;
  if (!pricing) {
    return false;
  }
  if (pricing.videoDurationPricing && pricing.videoDurationPricing.length > 0) {
    return true;
  }
  return Boolean(
    pricing.inputPerTokenUsd?.trim() ||
    pricing.outputPerTokenUsd?.trim() ||
    pricing.imagePerUnitUsd?.trim() ||
    pricing.requestPerCallUsd?.trim() ||
    pricing.imagePerMegapixelUsd?.trim() ||
    pricing.imageExamplePricing?.priceUsd?.trim() ||
    pricing.videoExamplePricing?.priceUsd?.trim(),
  );
}

export function buildModelCatalogDetailMap(
  models: readonly ModelProfileSnapshot[],
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, PreviewModelCatalogEntry> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const detailByModelName = new Map<string, PreviewModelCatalogEntry>();
  for (const model of models) {
    const catalogEntry = findModelCatalogEntry(model, hints, entryIndex);
    if (modelHasCatalogDetail(catalogEntry)) {
      detailByModelName.set(
        modelCatalogScopeEntryKey(model),
        catalogEntry as PreviewModelCatalogEntry,
      );
    }
  }

  return detailByModelName;
}

/** Gateway/OpenRouter/Moonshot/Kimi Code: catalog display names and details; anything else or a miss falls back to model.name (id) or a formatted id. */
export function buildModelCatalogDisplayTitleMap(
  models: readonly ModelProfileSnapshot[],
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, string> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const titles = new Map<string, string>();
  for (const model of models) {
    const catalogEntry = findModelCatalogEntry(model, hints, entryIndex);
    titles.set(modelCatalogScopeEntryKey(model), modelCatalogDisplayTitle(model, catalogEntry));
  }
  return titles;
}

export function modelDisplayTitleFromMap(
  model: Pick<ModelProfileSnapshot, "providerId" | "name">,
  displayTitleByModelName: Map<string, string>,
): string {
  return displayTitleByModelName.get(modelCatalogScopeEntryKey(model)) ?? model.name;
}

export function modelCatalogDisplayTitle(
  model: ModelProfileSnapshot,
  catalogEntry: PreviewModelCatalogEntry | undefined,
): string {
  return resolveModelDisplayTitle({
    modelId: model.name,
    catalogDisplayName: catalogEntry?.displayName,
    preserveRawIdWithoutCatalogDisplayName: modelIdPreservesRawDisplayTitle(model.name),
  });
}

export function modelSettingsRowAriaLabel(
  defaultActionLabel: string,
  modelId: string,
  displayTitle: string,
): string {
  if (displayTitle !== modelId) {
    return `${defaultActionLabel}：${displayTitle}（${modelId}）`;
  }
  return `${defaultActionLabel}：${modelId}`;
}

type PricingLabelKey =
  | "settings.modelDetailPricingInput"
  | "settings.modelDetailPricingOutput"
  | "settings.modelDetailPricingImage"
  | "settings.modelDetailPricingRequest"
  | "settings.modelDetailPricingVideoPerSecond"
  | "settings.modelDetailPricingVideoResolutionWithAudio"
  | "settings.modelDetailPricingImageMegapixel"
  | "settings.modelDetailPricingExample";

type ModelCatalogDetailFieldLabelKey =
  | "settings.modelDetailLabelContext"
  | "settings.modelDetailLabelMaxOutput"
  | "settings.modelDetailLabelInput"
  | "settings.modelDetailLabelOutput"
  | "settings.modelDetailLabelCachedInput"
  | "settings.modelDetailLabelImage"
  | "settings.modelDetailLabelRequest"
  | "settings.modelDetailLabelVideo";

type ModelCatalogDetailFieldValueKey =
  | "settings.modelDetailPricingVideoPerSecond"
  | "settings.modelDetailPricingVideoResolutionWithAudio"
  | "settings.modelDetailPricingImageMegapixel"
  | "settings.modelDetailPricingExample";

export type ModelCatalogDetailField = {
  id: string;
  label: string;
  value: string;
};

export function modelCatalogHasDetailBody(input: {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
}): boolean {
  if (input.catalogEntry?.description?.trim()) {
    return true;
  }
  const contextLength =
    parseModelContextLength(input.model.contextLength) ??
    parseModelContextLength(input.catalogEntry?.contextLength);
  const maxCompletionTokens = input.catalogEntry?.maxCompletionTokens;
  return (
    buildModelCatalogDetailFields({
      ...(contextLength !== undefined ? { contextLength } : {}),
      ...(maxCompletionTokens !== undefined ? { maxCompletionTokens } : {}),
      pricing: input.catalogEntry?.pricing,
      t: (key) => key,
    }).length > 0
  );
}

export function buildModelCatalogDetailFields(input: {
  contextLength?: number;
  maxCompletionTokens?: number;
  pricing?: PreviewModelCatalogPricing;
  t: (
    key: ModelCatalogDetailFieldLabelKey | ModelCatalogDetailFieldValueKey,
    options?: { value?: string; resolution?: string; description?: string },
  ) => string;
}): ModelCatalogDetailField[] {
  const fields: ModelCatalogDetailField[] = [];
  if (input.contextLength !== undefined) {
    fields.push({
      id: "context",
      label: input.t("settings.modelDetailLabelContext"),
      value: `${formatCompactTokenCount(input.contextLength)} tokens`,
    });
  }
  if (input.maxCompletionTokens !== undefined) {
    fields.push({
      id: "max-output",
      label: input.t("settings.modelDetailLabelMaxOutput"),
      value: `${formatCompactTokenCount(input.maxCompletionTokens)} tokens`,
    });
  }
  const pricing = input.pricing;
  if (pricing) {
    const inputPrice = formatUsdPerMillionTokens(pricing.inputPerTokenUsd);
    if (inputPrice) {
      fields.push({
        id: "input",
        label: input.t("settings.modelDetailLabelInput"),
        value: `${inputPrice} / M tokens`,
      });
    }
    const outputPrice = formatUsdPerMillionTokens(pricing.outputPerTokenUsd);
    if (outputPrice) {
      fields.push({
        id: "output",
        label: input.t("settings.modelDetailLabelOutput"),
        value: `${outputPrice} / M tokens`,
      });
    }
    const cachedInputPrice = formatUsdPerMillionTokens(pricing.cachedInputPerTokenUsd);
    if (cachedInputPrice) {
      fields.push({
        id: "cached-input",
        label: input.t("settings.modelDetailLabelCachedInput"),
        value: `${cachedInputPrice} / M tokens`,
      });
    }
    const imagePrice = formatUsdFlatRate(pricing.imagePerUnitUsd);
    if (imagePrice) {
      fields.push({
        id: "image",
        label: input.t("settings.modelDetailLabelImage"),
        value: imagePrice,
      });
    }
    const imageMegapixelPrice = formatUsdFlatRate(pricing.imagePerMegapixelUsd);
    if (imageMegapixelPrice) {
      fields.push({
        id: "image-megapixel",
        label: input.t("settings.modelDetailLabelImage"),
        value: input.t("settings.modelDetailPricingImageMegapixel", { value: imageMegapixelPrice }),
      });
    }
    const imageExample = formatExamplePricing(pricing.imageExamplePricing, input.t);
    if (imageExample) {
      fields.push({
        id: "image-example",
        label: input.t("settings.modelDetailLabelImage"),
        value: imageExample,
      });
    }
    const requestPrice = formatUsdFlatRate(pricing.requestPerCallUsd);
    if (requestPrice) {
      fields.push({
        id: "request",
        label: input.t("settings.modelDetailLabelRequest"),
        value: requestPrice,
      });
    }
    for (const [index, tier] of (pricing.videoDurationPricing ?? []).entries()) {
      const costPerSecond = formatUsdFlatRate(tier.costPerSecondUsd);
      if (!costPerSecond) {
        continue;
      }
      fields.push({
        id: videoDurationPricingFieldId(index, tier),
        label: videoDurationPricingRowLabel(tier, input.t),
        value: input.t("settings.modelDetailPricingVideoPerSecond", { value: costPerSecond }),
      });
    }
    const videoExample = formatExamplePricing(pricing.videoExamplePricing, input.t);
    if (videoExample) {
      fields.push({
        id: "video-example",
        label: input.t("settings.modelDetailLabelVideo"),
        value: videoExample,
      });
    }
  }
  return fields;
}

export function formatModelCatalogPricingLines(
  pricing: PreviewModelCatalogPricing | undefined,
  t: (key: PricingLabelKey, options?: { value?: string; resolution?: string }) => string,
): string[] {
  if (!pricing) {
    return [];
  }

  const lines: string[] = [];
  const input = formatUsdPerMillionTokens(pricing.inputPerTokenUsd);
  if (input) {
    lines.push(t("settings.modelDetailPricingInput", { value: input }));
  }
  const output = formatUsdPerMillionTokens(pricing.outputPerTokenUsd);
  if (output) {
    lines.push(t("settings.modelDetailPricingOutput", { value: output }));
  }
  const image = formatUsdFlatRate(pricing.imagePerUnitUsd);
  if (image) {
    lines.push(t("settings.modelDetailPricingImage", { value: image }));
  }
  const imageMegapixel = formatUsdFlatRate(pricing.imagePerMegapixelUsd);
  if (imageMegapixel) {
    lines.push(
      t("settings.modelDetailPricingImage", {
        value: t("settings.modelDetailPricingImageMegapixel", { value: imageMegapixel }),
      }),
    );
  }
  const imageExample = formatExamplePricing(pricing.imageExamplePricing, t);
  if (imageExample) {
    lines.push(t("settings.modelDetailPricingImage", { value: imageExample }));
  }
  const request = formatUsdFlatRate(pricing.requestPerCallUsd);
  if (request) {
    lines.push(t("settings.modelDetailPricingRequest", { value: request }));
  }
  for (const tier of pricing.videoDurationPricing ?? []) {
    const costPerSecond = formatUsdFlatRate(tier.costPerSecondUsd);
    if (!costPerSecond) {
      continue;
    }
    const label = videoDurationPricingRowLabel(tier, t);
    lines.push(
      `${label}: ${t("settings.modelDetailPricingVideoPerSecond", { value: costPerSecond })}`,
    );
  }
  const videoExample = formatExamplePricing(pricing.videoExamplePricing, t);
  if (videoExample) {
    lines.push(videoExample);
  }
  return lines;
}

function formatExamplePricing(
  example:
    | PreviewModelCatalogPricing["imageExamplePricing"]
    | PreviewModelCatalogPricing["videoExamplePricing"],
  t: (
    key: "settings.modelDetailPricingExample",
    options?: { value?: string; description?: string },
  ) => string,
): string | undefined {
  if (!example) {
    return undefined;
  }
  const price = formatUsdFlatRate(example.priceUsd);
  const description = example.description.trim();
  if (!price || !description) {
    return undefined;
  }
  return t("settings.modelDetailPricingExample", { value: price, description });
}

function videoDurationPricingRowLabel(
  tier: PreviewModelCatalogVideoDurationPricing,
  t: (
    key: "settings.modelDetailPricingVideoResolutionWithAudio",
    options?: { resolution?: string },
  ) => string,
): string {
  if (tier.audio === true) {
    return t("settings.modelDetailPricingVideoResolutionWithAudio", {
      resolution: tier.resolution,
    });
  }
  return tier.resolution;
}

function videoDurationPricingFieldId(
  index: number,
  tier: PreviewModelCatalogVideoDurationPricing,
): string {
  return `video-duration-${index}-${tier.resolution}${tier.audio === true ? "-audio" : ""}`;
}

function formatUsdPerMillionTokens(value: string | undefined): string | undefined {
  const amount = parseUsdAmount(value);
  if (amount === undefined) {
    return undefined;
  }
  const perMillion = amount * 1_000_000;
  return formatUsd(perMillion);
}

function formatUsdFlatRate(value: string | undefined): string | undefined {
  const amount = parseUsdAmount(value);
  if (amount === undefined) {
    return undefined;
  }
  return formatUsd(amount);
}

function parseUsdAmount(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function formatUsd(amount: number): string {
  if (amount === 0) {
    return "$0";
  }
  const abs = Math.abs(amount);
  if (abs >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (abs >= 0.01) {
    return `$${amount.toFixed(2)}`;
  }
  if (abs >= 0.0001) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toExponential(2)}`;
}
