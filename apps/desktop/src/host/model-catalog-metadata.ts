import { formatTitleFromId } from "@spiritagent/host-internal/id-display-title";
import {
  gatewayGoogleGeminiSupportedEfforts,
  routedAnthropicClaudeSupportedEfforts,
} from "@spiritagent/agent-core";
import type { ProviderListedModelEntry } from "@spiritagent/host-internal";
import { moonshotK3SupportedReasoningEfforts } from "@spiritagent/host-internal/openai-models";

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
} from "../types.js";

export function usesAnthropicModelCatalogMetadata(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
}): boolean {
  return input.transportKind === "anthropic" || input.provider === "anthropic";
}

function providerUsesUpstreamModelDisplayName(provider: DesktopModelProvider | undefined): boolean {
  return provider === "vercel-ai-gateway" || provider === "openrouter";
}

/** Whether the upstream `GET /models` (or equivalent) can be called to list models; Azure has no catalog endpoint, and custom depends on the transport. */
export function providerSupportsModelCatalogListing(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
}): boolean {
  if (!input.provider) {
    return false;
  }
  if (input.provider === "azure" || input.provider === "cloudflare-ai-gateway") {
    return false;
  }
  if (input.provider === "custom") {
    const transportKind = input.transportKind ?? "openai-compatible";
    return (
      transportKind === "openai-compatible" ||
      transportKind === "anthropic" ||
      transportKind === "open-responses"
    );
  }
  return true;
}

export function usesProviderListedModelCatalogMetadata(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
}): boolean {
  if (!providerSupportsModelCatalogListing(input)) {
    return false;
  }
  if (input.provider === "moonshot-ai") {
    return true;
  }
  if (input.provider === "meituan") {
    return true;
  }
  if (input.provider === "tencent-tokenhub") {
    return true;
  }
  if (input.provider === "mistral") {
    return true;
  }
  if (input.provider === "cohere") {
    return true;
  }
  if (input.provider === "xiaomi") {
    return true;
  }
  if (input.provider === "siliconflow") {
    return true;
  }
  if (
    input.provider === "openai" ||
    input.provider === "deepseek" ||
    input.provider === "kimi-code" ||
    input.provider === "xai" ||
    input.provider === "z-ai" ||
    input.provider === "zhipu-ai" ||
    input.provider === "alibaba" ||
    input.provider === "minimax" ||
    input.provider === "vercel-ai-gateway" ||
    input.provider === "openrouter" ||
    input.provider === "fireworks-ai" ||
    input.provider === "together-ai" ||
    input.provider === "groq" ||
    input.provider === "deepinfra" ||
    input.provider === "hugging-face" ||
    input.provider === "baseten" ||
    input.provider === "volcengine" ||
    input.provider === "byteplus" ||
    input.provider === "stepfun" ||
    input.provider === "google" ||
    input.provider === "google-vertex-ai" ||
    input.provider === "amazon-bedrock"
  ) {
    return true;
  }
  return usesAnthropicModelCatalogMetadata(input);
}

export function previewModelCatalogForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  listedModels: readonly ProviderListedModelEntry[];
}): PreviewModelCatalogEntry[] | undefined {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  return input.listedModels.map((entry) => ({
    id: entry.id,
    capabilities: previewCapabilitiesFromListedEntry(entry),
    ...resolvePreviewCatalogDisplayName(input.provider, entry),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
    ...resolvePreviewSupportedReasoningEffortsForEntry(input.provider, entry),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
    ...(entry.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: entry.maxCompletionTokens }
      : {}),
    ...(entry.supportsThinkingType !== undefined
      ? { supportsThinkingType: entry.supportsThinkingType }
      : {}),
    ...(entry.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
    ...(entry.inferenceProvider !== undefined
      ? { inferenceProvider: entry.inferenceProvider }
      : {}),
    ...(entry.isPartner !== undefined ? { isPartner: entry.isPartner } : {}),
  }));
}

export function previewCatalogMapForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  modelCatalog?: readonly PreviewModelCatalogEntry[];
}): Map<string, PreviewModelCatalogEntry> {
  if (!usesProviderListedModelCatalogMetadata(input) || !Array.isArray(input.modelCatalog)) {
    return new Map();
  }

  const normalized: Array<[string, PreviewModelCatalogEntry]> = [];
  for (const entry of input.modelCatalog) {
    const id = entry.id.trim();
    if (!id) {
      continue;
    }
    normalized.push([
      id,
      {
        id,
        ...resolvePreviewCatalogDisplayName(input.provider, {
          id,
          displayName: entry.displayName,
        }),
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
        ...(entry.supportedReasoningEfforts !== undefined
          ? {
              supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(
                entry.supportedReasoningEfforts,
              ),
            }
          : {}),
        ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
        ...(entry.maxCompletionTokens !== undefined
          ? { maxCompletionTokens: entry.maxCompletionTokens }
          : {}),
        ...(entry.supportsThinkingType !== undefined
          ? { supportsThinkingType: entry.supportsThinkingType }
          : {}),
        ...(entry.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
        ...(entry.inferenceProvider !== undefined
          ? { inferenceProvider: entry.inferenceProvider }
          : {}),
        ...(entry.isPartner !== undefined ? { isPartner: entry.isPartner } : {}),
      },
    ]);
  }

  return new Map(normalized);
}

function resolvePreviewCatalogDisplayName(
  provider: DesktopModelProvider | undefined,
  entry: Pick<ProviderListedModelEntry, "id" | "displayName">,
): { displayName?: string } {
  const upstreamDisplayName = entry.displayName?.trim();
  if (upstreamDisplayName) {
    return { displayName: upstreamDisplayName };
  }
  if (providerUsesUpstreamModelDisplayName(provider)) {
    return {};
  }
  return { displayName: formatTitleFromId(entry.id) };
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

  const capabilities: DesktopModelCapability[] = ["chat"];
  if (entry.supportsImageInput === true) {
    capabilities.push("image");
  }
  if (entry.supportsVideoInput === true) {
    capabilities.push("video");
  }
  return capabilities;
}

function isMoonshotKimiK3CatalogModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  const bareId = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return /^kimi-k3(?:-|$)/.test(bareId);
}

function resolvePreviewSupportedReasoningEffortsForEntry(
  provider: DesktopModelProvider | undefined,
  entry: ProviderListedModelEntry,
): { supportedReasoningEfforts?: DesktopModelReasoningEffort[] } {
  // The catalog cache may still hold the K2.x minimal/low/medium/high values; K3 uses the fixed documented tiers.
  if (isMoonshotKimiK3CatalogModelId(entry.id)) {
    return {
      supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(
        moonshotK3SupportedReasoningEfforts(),
      ),
    };
  }

  if (entry.supportedReasoningEfforts !== undefined) {
    return {
      supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(
        entry.supportedReasoningEfforts,
      ),
    };
  }

  if (provider !== "vercel-ai-gateway" && provider !== "openrouter") {
    return {};
  }

  const inferredAnthropic = routedAnthropicClaudeSupportedEfforts(entry.id);
  if (inferredAnthropic !== undefined) {
    return {
      supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(inferredAnthropic),
    };
  }

  const inferredGemini = gatewayGoogleGeminiSupportedEfforts(entry.id);
  if (inferredGemini !== undefined) {
    return {
      supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(inferredGemini),
    };
  }

  return {};
}

function normalizePreviewSupportedReasoningEfforts(
  values: readonly DesktopModelReasoningEffort[],
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
