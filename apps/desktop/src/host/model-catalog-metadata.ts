import type { ProviderListedModelEntry } from "@spiritagent/agent-core/model-catalog";
import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";
import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";
import type { ThinkingCapabilities, ThinkingSwitchWirePatch } from "@spiritagent/agent-core";
import { MODEL_OUTPUT_EFFORT_TOKENS } from "@spiritagent/agent-core/model-effort";
import { lookupModelKnowledge } from "@spiritagent/agent-core/model-knowledge";
import { findProviderPreset } from "@spiritagent/agent-core/provider-presets";

import type {
  DesktopModelCapability,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
} from "../types.js";
import type {
  SpiritServiceTiersDeclaration,
  ThinkingSwitchDeclaration,
} from "@spiritagent/host-internal/config";

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
  if (Array.isArray(value)) {
    const tiers = value.filter((item): item is ModelServiceTier => typeof item === "string");
    return tiers.length > 0 ? [...new Set(tiers)] : undefined;
  }
  if (typeof value === "object" && value !== null) {
    // Literal map form: a wire-declaration shape validated by the knowledge module's own tests
    // and again at config load (same loose-fold contract as `thinkingSwitch`).
    return value as SpiritServiceTiersDeclaration;
  }
  return undefined;
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

function knowledgeDeclaredOutputEfforts(
  declaration: Record<string, unknown>,
): PreviewModelCatalogEntry["supportedEfforts"] | undefined {
  const value = declaration["supportedEfforts"];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return normalizePreviewSupportedEfforts(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function knowledgeDeclaredDefaultEffort(
  declaration: Record<string, unknown>,
): PreviewModelCatalogEntry["defaultEffort"] {
  const value = declaration["defaultEffort"];
  return normalizePreviewDefaultEffort(typeof value === "string" ? value : undefined);
}

function knowledgeDeclaredThinkingCapabilities(
  declaration: Record<string, unknown> | undefined,
): ThinkingCapabilities | undefined {
  const value = declaration?.["thinkingCapabilities"];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ThinkingCapabilities)
    : undefined;
}

function mergeThinkingCapabilities(
  api: ThinkingCapabilities | undefined,
  knowledge: ThinkingCapabilities | undefined,
): ThinkingCapabilities | undefined {
  if (!api) {
    return knowledge;
  }
  if (!knowledge) {
    return api;
  }
  return {
    ...knowledge,
    ...api,
    ...(api.types !== undefined || knowledge.types !== undefined
      ? { types: { ...knowledge.types, ...api.types } }
      : {}),
  };
}

type ThinkingCapabilityType = "adaptive" | "betweenTools" | "disabled" | "enabled";

function thinkingTypeFromPatch(
  patch: ThinkingSwitchDeclaration["on"] | ThinkingSwitchDeclaration["off"],
): ThinkingCapabilityType | undefined {
  if (patch === undefined || patch === "omit") {
    return undefined;
  }
  const thinking = patch.body?.["thinking"];
  if (typeof thinking !== "object" || thinking === null || Array.isArray(thinking)) {
    return undefined;
  }
  const type = (thinking as Record<string, unknown>)["type"];
  switch (type) {
    case "adaptive":
      return "adaptive";
    case "between_tools":
      return "betweenTools";
    case "disabled":
      return "disabled";
    case "enabled":
      return "enabled";
    default:
      return undefined;
  }
}

function thinkingTypeSupported(
  capabilities: ThinkingCapabilities | undefined,
  type: ThinkingCapabilityType | undefined,
): boolean | undefined {
  return type === undefined ? undefined : capabilities?.types?.[type];
}

function offPatchForType(type: "disabled" | "between_tools"): ThinkingSwitchWirePatch {
  return {
    body: { thinking: { type } },
    providerOptions: { anthropic: { thinking: { type } } },
  };
}

function resolveThinkingMetadata(input: {
  parserName: string | undefined;
  entry: ProviderListedModelEntry;
  knowledge: Record<string, unknown> | undefined;
  knowledgeCapabilities: ThinkingCapabilities | undefined;
  knowledgeSwitch: ThinkingSwitchDeclaration | undefined;
  knowledgeSwitchSupport: boolean | undefined;
  knowledgeType: "only" | undefined;
}): Pick<
  PreviewModelCatalogEntry,
  "thinkingCapabilities" | "supportsThinkingSwitch" | "supportsThinkingType" | "thinkingSwitch"
> {
  const { entry, knowledgeSwitch, knowledgeCapabilities, knowledgeType } = input;
  const capabilities =
    input.parserName === "anthropic-models"
      ? mergeThinkingCapabilities(entry.thinkingCapabilities, knowledgeCapabilities)
      : (knowledgeCapabilities ?? entry.thinkingCapabilities);
  if (capabilities === undefined) {
    return {
      ...(input.knowledgeSwitchSupport !== undefined || entry.supportsThinkingSwitch !== undefined
        ? {
            supportsThinkingSwitch: input.knowledgeSwitchSupport ?? entry.supportsThinkingSwitch,
          }
        : {}),
      ...(knowledgeType !== undefined
        ? { supportsThinkingType: knowledgeType }
        : entry.supportsThinkingType !== undefined
          ? { supportsThinkingType: entry.supportsThinkingType }
          : {}),
      ...(knowledgeSwitch !== undefined ? { thinkingSwitch: knowledgeSwitch } : {}),
    };
  }
  if (capabilities.supported === false) {
    return {
      thinkingCapabilities: capabilities,
      supportsThinkingSwitch: false,
    };
  }

  const on = knowledgeSwitch?.on;
  const onType = thinkingTypeFromPatch(on);
  const onSupported = on !== undefined && (thinkingTypeSupported(capabilities, onType) ?? true);
  const defaultState = knowledgeSwitch?.defaultState;
  let off = knowledgeSwitch?.off;
  let offType = thinkingTypeFromPatch(off);
  let offSupported: boolean;

  if (off === "omit") {
    offSupported = defaultState === "off";
  } else if (off !== undefined) {
    offSupported = thinkingTypeSupported(capabilities, offType) === true;
    if (!offSupported) {
      if (thinkingTypeSupported(capabilities, "betweenTools") === true) {
        off = offPatchForType("between_tools");
        offType = "betweenTools";
        offSupported = true;
      } else if (thinkingTypeSupported(capabilities, "disabled") === true) {
        off = offPatchForType("disabled");
        offType = "disabled";
        offSupported = true;
      }
    }
  } else if (defaultState === "off") {
    off = "omit";
    offSupported = onSupported;
  } else if (thinkingTypeSupported(capabilities, "disabled") === true) {
    off = offPatchForType("disabled");
    offType = "disabled";
    offSupported = true;
  } else if (thinkingTypeSupported(capabilities, "betweenTools") === true) {
    off = offPatchForType("between_tools");
    offType = "betweenTools";
    offSupported = true;
  } else {
    offSupported = false;
  }

  if (!offSupported) {
    if (defaultState === "off") {
      off = "omit";
      offSupported = onSupported;
    } else {
      off = undefined;
    }
  }

  const hasSwitch = onSupported && off !== undefined && offSupported;
  const alwaysOn =
    capabilities.supported === true && defaultState !== "off" && !hasSwitch && !offSupported;
  const thinkingSwitch =
    onSupported && knowledgeSwitch !== undefined
      ? {
          ...knowledgeSwitch,
          on,
          ...(off !== undefined ? { off } : {}),
        }
      : undefined;
  if (thinkingSwitch !== undefined && off === undefined) {
    delete thinkingSwitch.off;
  }

  return {
    thinkingCapabilities: capabilities,
    supportsThinkingSwitch: hasSwitch,
    ...(alwaysOn
      ? { supportsThinkingType: "only" as const }
      : knowledgeType !== undefined
        ? { supportsThinkingType: knowledgeType }
        : {}),
    ...(thinkingSwitch !== undefined ? { thinkingSwitch } : {}),
  };
}

function basePreviewEntryFields(
  parserName: string | undefined,
  entry: ProviderListedModelEntry,
): PreviewModelCatalogEntry {
  return {
    id: entry.id,
    capabilities: previewCapabilitiesFromListedEntry(entry),
    ...resolvePreviewCatalogDisplayName(parserName, entry),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.outputLimit !== undefined ? { outputLimit: entry.outputLimit } : {}),
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(entry.inferenceProvider !== undefined
      ? { inferenceProvider: entry.inferenceProvider }
      : {}),
    ...(entry.upstreamProvider !== undefined ? { upstreamProvider: entry.upstreamProvider } : {}),
    ...(entry.isPartner !== undefined ? { isPartner: entry.isPartner } : {}),
  };
}

/**
 * One catalog write entry = the listing's API facts with model-knowledge declarations folded in.
 * Anthropic's own catalog wins on fields it actually reports; other listing shapes keep curated
 * model knowledge as their source for output-effort declarations.
 */
function previewEntryFromListedEntry(
  parserName: string | undefined,
  entry: ProviderListedModelEntry,
): PreviewModelCatalogEntry {
  const base = basePreviewEntryFields(parserName, entry);
  const knowledge = lookupCatalogModelKnowledge(entry.id);
  const knowledgeEfforts = knowledge ? knowledgeDeclaredReasoningEfforts(knowledge) : undefined;
  const knowledgeModes = knowledge ? knowledgeDeclaredReasoningModes(knowledge) : undefined;
  const knowledgeTiers =
    knowledge && parserName !== "bedrock-models"
      ? knowledgeDeclaredServiceTiers(knowledge)
      : undefined;
  const tierFields =
    entry.serviceTiers !== undefined
      ? { serviceTiers: entry.serviceTiers as SpiritServiceTiersDeclaration }
      : knowledgeTiers !== undefined
        ? { serviceTiers: knowledgeTiers }
        : {};

  if (entry.effortSemantics !== "output" && knowledge?.["effortSemantics"] !== "output") {
    const knowledgeThinkingSwitch =
      knowledge?.["supportsThinkingSwitch"] === true ? true : undefined;
    const knowledgeThinkingType =
      knowledge?.["supportsThinkingType"] === "only" ? ("only" as const) : undefined;
    const knowledgeThinkingSwitchEncoding = knowledge
      ? knowledgeDeclaredThinkingSwitch(knowledge)
      : undefined;
    return {
      ...base,
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
      ...tierFields,
      ...resolvePreviewDefaultReasoningEffortForEntry(entry),
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
    };
  }

  const knowledgeEffortsOutput = knowledge ? knowledgeDeclaredOutputEfforts(knowledge) : undefined;
  const supportedEfforts =
    parserName === "anthropic-models"
      ? entry.supportedEfforts !== undefined
        ? normalizePreviewSupportedEfforts(entry.supportedEfforts)
        : (knowledgeEffortsOutput ?? [])
      : (knowledgeEffortsOutput ?? []);
  const defaultEffort = knowledge ? knowledgeDeclaredDefaultEffort(knowledge) : undefined;
  const knowledgeThinkingSwitch = knowledge
    ? knowledgeDeclaredThinkingSwitch(knowledge)
    : undefined;
  const knowledgeThinkingType =
    knowledge?.["supportsThinkingType"] === "only" ? ("only" as const) : undefined;
  const knowledgeSwitchSupport =
    typeof knowledge?.["supportsThinkingSwitch"] === "boolean"
      ? (knowledge["supportsThinkingSwitch"] as boolean)
      : undefined;
  const thinking = resolveThinkingMetadata({
    parserName,
    entry,
    knowledge,
    knowledgeCapabilities: knowledgeDeclaredThinkingCapabilities(knowledge),
    knowledgeSwitch: knowledgeThinkingSwitch,
    knowledgeSwitchSupport,
    knowledgeType: knowledgeThinkingType,
  });

  return {
    ...base,
    effortSemantics: "output",
    supportedEfforts,
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
    ...tierFields,
    ...thinking,
    ...(entry.catalogCapabilities !== undefined
      ? { catalogCapabilities: entry.catalogCapabilities }
      : {}),
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

function normalizePreviewSupportedEfforts(
  values: readonly string[],
): NonNullable<PreviewModelCatalogEntry["supportedEfforts"]> {
  const seen = new Set<string>();
  const normalized: NonNullable<PreviewModelCatalogEntry["supportedEfforts"]> = [];
  for (const value of values) {
    const effort = value.trim().toLowerCase();
    if (
      !MODEL_OUTPUT_EFFORT_TOKENS.includes(effort as (typeof MODEL_OUTPUT_EFFORT_TOKENS)[number]) ||
      seen.has(effort)
    ) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort as (typeof normalized)[number]);
  }
  return normalized;
}

function normalizePreviewDefaultEffort(
  value: string | undefined,
): PreviewModelCatalogEntry["defaultEffort"] {
  if (typeof value !== "string") {
    return undefined;
  }
  const effort = value.trim().toLowerCase();
  return MODEL_OUTPUT_EFFORT_TOKENS.includes(effort as (typeof MODEL_OUTPUT_EFFORT_TOKENS)[number])
    ? (effort as NonNullable<PreviewModelCatalogEntry["defaultEffort"]>)
    : undefined;
}
