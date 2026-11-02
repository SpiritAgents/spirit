import { formatCompactTokenCount } from "./format-compact-token-count.js";
import { parseModelContextLength } from "./model-context-length.js";
import type { ModelPickerRuntime } from "./runtime.js";

import type { ModelPickerLabels } from "./labels.js";
import type {
  ModelCatalogHint,
  ModelPickerModelProfile,
  ModelCatalogEntry,
  ModelCatalogPricing,
  ModelCatalogVideoDurationPricing,
} from "./types.js";

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
  model: Pick<ModelPickerModelProfile, "providerId" | "name">,
): string {
  return catalogEntryIndexKey(modelCatalogHintKey({ providerId: model.providerId }), model.name);
}

export function buildModelCatalogEntryIndex(
  hints: readonly ModelCatalogHint[] | undefined,
): Map<string, ModelCatalogEntry> {
  const index = new Map<string, ModelCatalogEntry>();
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
  model: ModelPickerModelProfile,
  hints: readonly ModelCatalogHint[] | undefined,
  entryIndex?: Map<string, ModelCatalogEntry>,
): ModelCatalogEntry | undefined {
  const index = entryIndex ?? buildModelCatalogEntryIndex(hints);
  const hintKey = modelCatalogHintKey({ providerId: model.providerId });
  return index.get(catalogEntryIndexKey(hintKey, model.name));
}

export function modelHasCatalogDetail(entry: ModelCatalogEntry | undefined): boolean {
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
  models: readonly ModelPickerModelProfile[],
  hints: readonly ModelCatalogHint[] | undefined,
): Map<string, ModelCatalogEntry> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const detailByModelName = new Map<string, ModelCatalogEntry>();
  for (const model of models) {
    const catalogEntry = findModelCatalogEntry(model, hints, entryIndex);
    if (modelHasCatalogDetail(catalogEntry)) {
      detailByModelName.set(modelCatalogScopeEntryKey(model), catalogEntry as ModelCatalogEntry);
    }
  }

  return detailByModelName;
}

/** Gateway/OpenRouter/Moonshot/Kimi Code: catalog display names and details; anything else or a miss falls back to model.name (id) or a formatted id. */
export function buildModelCatalogDisplayTitleMap(
  runtime: ModelPickerRuntime,
  models: readonly ModelPickerModelProfile[],
  hints: readonly ModelCatalogHint[] | undefined,
): Map<string, string> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const titles = new Map<string, string>();
  for (const model of models) {
    const catalogEntry = findModelCatalogEntry(model, hints, entryIndex);
    titles.set(
      modelCatalogScopeEntryKey(model),
      modelCatalogDisplayTitle(runtime, model, catalogEntry),
    );
  }
  return titles;
}

export function modelDisplayTitleFromMap(
  model: Pick<ModelPickerModelProfile, "providerId" | "name">,
  displayTitleByModelName: Map<string, string>,
): string {
  return displayTitleByModelName.get(modelCatalogScopeEntryKey(model)) ?? model.name;
}

export function modelCatalogDisplayTitle(
  runtime: ModelPickerRuntime,
  model: ModelPickerModelProfile,
  catalogEntry: ModelCatalogEntry | undefined,
): string {
  return runtime.resolveModelDisplayTitle({
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

export type ModelCatalogDetailField = {
  id: string;
  label: string;
  value: string;
};

export function modelCatalogHasDetailBody(input: {
  model: ModelPickerModelProfile;
  catalogEntry?: ModelCatalogEntry;
}): boolean {
  if (input.catalogEntry?.description?.trim()) {
    return true;
  }
  const contextLength =
    parseModelContextLength(input.model.contextLength) ??
    parseModelContextLength(input.catalogEntry?.contextLength);
  const maxCompletionTokens =
    input.catalogEntry?.outputLimit ?? input.catalogEntry?.maxCompletionTokens;
  return (
    contextLength !== undefined ||
    maxCompletionTokens !== undefined ||
    pricingHasAnyValue(input.catalogEntry?.pricing)
  );
}

function pricingHasAnyValue(pricing: ModelCatalogPricing | undefined): boolean {
  if (!pricing) {
    return false;
  }
  if (pricing.videoDurationPricing && pricing.videoDurationPricing.length > 0) {
    return true;
  }
  return Boolean(
    pricing.inputPerTokenUsd?.trim() ||
    pricing.outputPerTokenUsd?.trim() ||
    pricing.cachedInputPerTokenUsd?.trim() ||
    pricing.imagePerUnitUsd?.trim() ||
    pricing.requestPerCallUsd?.trim() ||
    pricing.imagePerMegapixelUsd?.trim() ||
    pricing.imageExamplePricing?.priceUsd?.trim() ||
    pricing.videoExamplePricing?.priceUsd?.trim(),
  );
}

export function buildModelCatalogDetailFields(input: {
  contextLength?: number;
  maxCompletionTokens?: number;
  pricing?: ModelCatalogPricing;
  labels: ModelPickerLabels;
}): ModelCatalogDetailField[] {
  const labels = input.labels;
  const fields: ModelCatalogDetailField[] = [];
  if (input.contextLength !== undefined) {
    fields.push({
      id: "context",
      label: labels.detailContext,
      value: `${formatCompactTokenCount(input.contextLength)} tokens`,
    });
  }
  if (input.maxCompletionTokens !== undefined) {
    fields.push({
      id: "max-output",
      label: labels.detailMaxOutput,
      value: `${formatCompactTokenCount(input.maxCompletionTokens)} tokens`,
    });
  }
  const pricing = input.pricing;
  if (pricing) {
    const inputPrice = formatUsdPerMillionTokens(pricing.inputPerTokenUsd);
    if (inputPrice) {
      fields.push({
        id: "input",
        label: labels.detailInput,
        value: `${inputPrice} / M tokens`,
      });
    }
    const outputPrice = formatUsdPerMillionTokens(pricing.outputPerTokenUsd);
    if (outputPrice) {
      fields.push({
        id: "output",
        label: labels.detailOutput,
        value: `${outputPrice} / M tokens`,
      });
    }
    const cachedInputPrice = formatUsdPerMillionTokens(pricing.cachedInputPerTokenUsd);
    if (cachedInputPrice) {
      fields.push({
        id: "cached-input",
        label: labels.detailCachedInput,
        value: `${cachedInputPrice} / M tokens`,
      });
    }
    const imagePrice = formatUsdFlatRate(pricing.imagePerUnitUsd);
    if (imagePrice) {
      fields.push({
        id: "image",
        label: labels.detailImage,
        value: imagePrice,
      });
    }
    const imageMegapixelPrice = formatUsdFlatRate(pricing.imagePerMegapixelUsd);
    if (imageMegapixelPrice) {
      fields.push({
        id: "image-megapixel",
        label: labels.detailImage,
        value: labels.detailPricingImageMegapixel(imageMegapixelPrice),
      });
    }
    const imageExample = formatExamplePricing(pricing.imageExamplePricing, labels);
    if (imageExample) {
      fields.push({
        id: "image-example",
        label: labels.detailImage,
        value: imageExample,
      });
    }
    const requestPrice = formatUsdFlatRate(pricing.requestPerCallUsd);
    if (requestPrice) {
      fields.push({
        id: "request",
        label: labels.detailRequest,
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
        label: videoDurationPricingRowLabel(tier, labels),
        value: labels.detailVideoPerSecond(costPerSecond),
      });
    }
    const videoExample = formatExamplePricing(pricing.videoExamplePricing, labels);
    if (videoExample) {
      fields.push({
        id: "video-example",
        label: labels.detailVideo,
        value: videoExample,
      });
    }
  }
  return fields;
}

export function formatModelCatalogPricingLines(
  pricing: ModelCatalogPricing | undefined,
  labels: ModelPickerLabels,
): string[] {
  if (!pricing) {
    return [];
  }

  const lines: string[] = [];
  const input = formatUsdPerMillionTokens(pricing.inputPerTokenUsd);
  if (input) {
    lines.push(labels.detailPricingInput(input));
  }
  const output = formatUsdPerMillionTokens(pricing.outputPerTokenUsd);
  if (output) {
    lines.push(labels.detailPricingOutput(output));
  }
  const image = formatUsdFlatRate(pricing.imagePerUnitUsd);
  if (image) {
    lines.push(labels.detailPricingImage(image));
  }
  const imageMegapixel = formatUsdFlatRate(pricing.imagePerMegapixelUsd);
  if (imageMegapixel) {
    lines.push(labels.detailPricingImage(labels.detailPricingImageMegapixel(imageMegapixel)));
  }
  const imageExample = formatExamplePricing(pricing.imageExamplePricing, labels);
  if (imageExample) {
    lines.push(labels.detailPricingImage(imageExample));
  }
  const request = formatUsdFlatRate(pricing.requestPerCallUsd);
  if (request) {
    lines.push(labels.detailPricingRequest(request));
  }
  for (const tier of pricing.videoDurationPricing ?? []) {
    const costPerSecond = formatUsdFlatRate(tier.costPerSecondUsd);
    if (!costPerSecond) {
      continue;
    }
    const label = videoDurationPricingRowLabel(tier, labels);
    lines.push(`${label}: ${labels.detailVideoPerSecond(costPerSecond)}`);
  }
  const videoExample = formatExamplePricing(pricing.videoExamplePricing, labels);
  if (videoExample) {
    lines.push(videoExample);
  }
  return lines;
}

function formatExamplePricing(
  example: ModelCatalogPricing["imageExamplePricing"] | ModelCatalogPricing["videoExamplePricing"],
  labels: ModelPickerLabels,
): string | undefined {
  if (!example) {
    return undefined;
  }
  const price = formatUsdFlatRate(example.priceUsd);
  const description = example.description?.trim() ?? "";
  if (!price || !description) {
    return undefined;
  }
  return labels.detailPricingExample(price, description);
}

function videoDurationPricingRowLabel(
  tier: ModelCatalogVideoDurationPricing,
  labels: ModelPickerLabels,
): string {
  if (tier.audio === true) {
    return labels.detailVideoResolutionWithAudio(tier.resolution);
  }
  return tier.resolution;
}

function videoDurationPricingFieldId(
  index: number,
  tier: ModelCatalogVideoDurationPricing,
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
