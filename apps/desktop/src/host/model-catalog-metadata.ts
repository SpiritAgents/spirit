import type { ProviderListedModelEntry } from "@spiritagent/agent-core/model-catalog";
import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";
import { lookupModelKnowledge } from "@spiritagent/agent-core/model-knowledge";
import { findProviderPreset } from "@spiritagent/agent-core/provider-presets";

import type {
  DesktopModelCapability,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
} from "../types.js";
import type { ThinkingSwitchDeclaration } from "@spiritagent/host-internal/config";

/**
 * The catalog parser (API shape) driving a provider entry's listing: the materialized preset's
 * `catalog` descriptor names it; entries without a preset (custom connections) list via the
 * generic parser of their transport. `undefined` = the provider has no model listing API.
 */
export function catalogParserNameForProvider(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
}): string | undefined {
  const preset = input.providerId ? findProviderPreset(input.providerId) : undefined;
  if (preset) {
    return preset.catalog?.parser;
  }
  const transportKind = input.transportKind ?? "openai-compatible";
  if (transportKind === "bedrock") {
    return undefined;
  }
  return transportKind === "anthropic" ? "anthropic-models" : "openai-models";
}

/** Whether the upstream `GET /models` (or equivalent) can be called to list models for this scope. */
export function providerSupportsModelCatalogListing(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
}): boolean {
  return catalogParserNameForProvider(input) !== undefined;
}

export function usesAnthropicModelCatalogMetadata(input: {
  transportKind?: DesktopTransportKind;
}): boolean {
  return input.transportKind === "anthropic";
}

export function usesProviderListedModelCatalogMetadata(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
}): boolean {
  return providerSupportsModelCatalogListing(input);
}

/** Aggregator listing shapes keep the upstream display name (ids carry a route prefix). */
const AGGREGATOR_CATALOG_PARSERS: ReadonlySet<string> = new Set([
  "vercel-gateway-models",
  "openrouter-models",
]);

/**
 * Model-knowledge lookup for a catalog id. The loader strips a single aggregator prefix
 * (`openai/gpt-5.5`); multi-slash path ids (Vertex `publishers/google/models/…`) are looked up
 * by their trailing segment — the canonical model id — as a fallback.
 */
export function lookupCatalogModelKnowledge(modelId: string): Record<string, unknown> | undefined {
  const direct = lookupModelKnowledge(modelId);
  if (direct !== undefined) {
    return direct;
  }
  const trimmed = modelId.trim();
  const segments = trimmed.split("/");
  if (segments.length > 2) {
    const trailing = segments[segments.length - 1]!.trim();
    if (trailing && trailing !== trimmed) {
      return lookupModelKnowledge(trailing);
    }
  }
  return undefined;
}

/** Reasoning/thinking/tier declaration keys the knowledge module may fold into a catalog entry. */
function knowledgeDeclaredReasoningEfforts(
  declaration: Record<string, unknown>,
): DesktopModelReasoningEffort[] | undefined {
  const value = declaration["supportedReasoningEfforts"];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const efforts = value.filter((item): item is string => typeof item === "string");
  return efforts.length > 0 ? normalizePreviewSupportedReasoningEfforts(efforts) : undefined;
}

function knowledgeDeclaredReasoningModes(
  declaration: Record<string, unknown>,
): DesktopModelReasoningMode[] | undefined {
  const value = declaration["supportedReasoningModes"];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const modes = value.filter(
    (item): item is DesktopModelReasoningMode => item === "standard" || item === "pro",
  );
  return modes.length > 0 ? [...new Set(modes)] : undefined;
}

function knowledgeDeclaredServiceTiers(
  declaration: Record<string, unknown>,
): PreviewModelCatalogEntry["serviceTiers"] {
  const value = declaration["serviceTiers"];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tiers = value.filter(
    (item): item is NonNullable<PreviewModelCatalogEntry["serviceTiers"]>[number] =>
      typeof item === "string",
  );
  return tiers.length > 0 ? [...new Set(tiers)] : undefined;
}

/**
 * The thinkingSwitch wire-encoding companion block folded from knowledge; the declaration is a
 * literal config shape (validated by the knowledge module's own tests and again at config load).
 */
function knowledgeDeclaredThinkingSwitch(
  declaration: Record<string, unknown>,
): ThinkingSwitchDeclaration | undefined {
  const value = declaration["thinkingSwitch"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as ThinkingSwitchDeclaration;
}

/**
 * One catalog write entry = the listing's API facts with model-knowledge declarations folded in
 * (knowledge wins on the keys it declares; it is the curated source — data bugs get fixed in the
 * knowledge module, never in a runtime patch).
 */
function previewEntryFromListedEntry(
  parserName: string | undefined,
  entry: ProviderListedModelEntry,
): PreviewModelCatalogEntry {
  const knowledge = lookupCatalogModelKnowledge(entry.id);
  const knowledgeEfforts = knowledge ? knowledgeDeclaredReasoningEfforts(knowledge) : undefined;
  const knowledgeModes = knowledge ? knowledgeDeclaredReasoningModes(knowledge) : undefined;
  const knowledgeTiers = knowledge ? knowledgeDeclaredServiceTiers(knowledge) : undefined;
  const knowledgeThinkingSwitch = knowledge?.["supportsThinkingSwitch"] === true ? true : undefined;
  const knowledgeThinkingType =
    knowledge?.["supportsThinkingType"] === "only" ? ("only" as const) : undefined;
  const knowledgeThinkingSwitchEncoding = knowledge
    ? knowledgeDeclaredThinkingSwitch(knowledge)
    : undefined;

  return {
    id: entry.id,
    capabilities: previewCapabilitiesFromListedEntry(entry),
    ...resolvePreviewCatalogDisplayName(parserName, entry),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
    ...(knowledgeEfforts !== undefined
      ? { supportedReasoningEfforts: knowledgeEfforts }
      : entry.supportedReasoningEfforts !== undefined
        ? {
            supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(
              entry.supportedReasoningEfforts,
            ),
          }
        : {}),
    ...(knowledgeModes !== undefined ? { supportedReasoningModes: knowledgeModes } : {}),
    ...(knowledgeTiers !== undefined ? { serviceTiers: knowledgeTiers } : {}),
    ...resolvePreviewDefaultReasoningEffortForEntry(entry),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.outputLimit !== undefined ? { outputLimit: entry.outputLimit } : {}),
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(knowledgeThinkingType !== undefined
      ? { supportsThinkingType: knowledgeThinkingType }
      : entry.supportsThinkingType !== undefined
        ? { supportsThinkingType: entry.supportsThinkingType }
        : {}),
    ...(knowledgeThinkingSwitch === true || entry.supportsThinkingSwitch === true
      ? { supportsThinkingSwitch: true }
      : {}),
    ...(knowledgeThinkingSwitchEncoding !== undefined
      ? { thinkingSwitch: knowledgeThinkingSwitchEncoding }
      : {}),
    ...(entry.inferenceProvider !== undefined
      ? { inferenceProvider: entry.inferenceProvider }
      : {}),
    ...(entry.upstreamProvider !== undefined ? { upstreamProvider: entry.upstreamProvider } : {}),
    ...(entry.isPartner !== undefined ? { isPartner: entry.isPartner } : {}),
  };
}

export function previewModelCatalogForTransport(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
  listedModels: readonly ProviderListedModelEntry[];
}): PreviewModelCatalogEntry[] | undefined {
  const parserName = catalogParserNameForProvider(input);
  if (parserName === undefined) {
    return undefined;
  }

  return input.listedModels.map((entry) => previewEntryFromListedEntry(parserName, entry));
}

export function previewCatalogMapForTransport(input: {
  providerId?: string;
  transportKind?: DesktopTransportKind;
  modelCatalog?: readonly PreviewModelCatalogEntry[];
}): Map<string, PreviewModelCatalogEntry> {
  const parserName = catalogParserNameForProvider(input);
  if (parserName === undefined || !Array.isArray(input.modelCatalog)) {
    return new Map();
  }

  const normalized: Array<[string, PreviewModelCatalogEntry]> = [];
  for (const entry of input.modelCatalog) {
    const id = entry.id.trim();
    if (!id) {
      continue;
    }
    // The wizard's preview entries already carry folded declarations; still fold knowledge here so
    // hand-written preview payloads get the same treatment.
    const folded = previewEntryFromListedEntry(parserName, {
      ...entry,
      // PreviewModelCatalogEntry carries resolved capabilities; re-derive the listed flags.
      supportsImageInput: entry.capabilities?.includes("image") === true,
      supportsVideoInput: entry.capabilities?.includes("video") === true,
      supportsImageGeneration: entry.capabilities?.includes("imageGeneration") === true,
      supportsVideoGeneration: entry.capabilities?.includes("videoGeneration") === true,
    });
    normalized.push([
      id,
      {
        ...folded,
        // Keep the wizard-provided display metadata verbatim (displayName already resolved).
        ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
      },
    ]);
  }

  return new Map(normalized);
}

function resolvePreviewCatalogDisplayName(
  parserName: string | undefined,
  entry: Pick<ProviderListedModelEntry, "id" | "displayName">,
): { displayName?: string } {
  const upstreamDisplayName = entry.displayName?.trim();
  if (upstreamDisplayName) {
    return { displayName: upstreamDisplayName };
  }
  if (parserName !== undefined && AGGREGATOR_CATALOG_PARSERS.has(parserName)) {
    return {};
  }
  return {
    displayName: formatTitleFromId(entry.id, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }),
  };
}

function previewCapabilitiesFromListedEntry(
  entry: ProviderListedModelEntry,
): DesktopModelCapability[] {
  if (entry.supportsImageGeneration === true) {
    return ["imageGeneration"];
  }

  if (entry.supportsVideoGeneration === true) {
    return ["videoGeneration"];
  }

  const capabilities: DesktopModelCapability[] = ["languageModel"];
  if (entry.supportsImageInput === true) {
    capabilities.push("image");
  }
  if (entry.supportsVideoInput === true) {
    capabilities.push("video");
  }
  return capabilities;
}

function normalizePreviewSupportedReasoningEfforts(
  values: readonly string[],
): DesktopModelReasoningEffort[] {
  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const value of values) {
    const effort = value.trim().toLowerCase();
    if (!effort || effort === "default" || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
}

function resolvePreviewDefaultReasoningEffortForEntry(
  entry: Pick<ProviderListedModelEntry, "defaultReasoningEffort">,
): { defaultReasoningEffort?: DesktopModelReasoningEffort } {
  const effort = normalizePreviewDefaultReasoningEffort(entry.defaultReasoningEffort);
  return effort !== undefined ? { defaultReasoningEffort: effort } : {};
}

function normalizePreviewDefaultReasoningEffort(
  value: string | undefined,
): DesktopModelReasoningEffort | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const effort = value.trim().toLowerCase();
  if (!effort || effort === "default") {
    return undefined;
  }
  return effort;
}
