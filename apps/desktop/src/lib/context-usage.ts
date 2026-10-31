import { parseModelContextLength } from "./model-context-length.js";
import type {
  ConversationContextUsageSnapshot,
  DesktopModelCatalogHint,
  DesktopTransportKind,
} from "../types.js";

export interface ContextUsageModelProfile {
  name: string;
  apiBase: string;
  /** Provider entry id; catalog hints are scoped by it. */
  providerId?: string;
  transportKind?: DesktopTransportKind;
  contextLength?: number;
}

export { parseModelContextLength } from "./model-context-length.js";

/**
 * Context usage display resolution: the model's declared `contextLength` first, then the provider
 * entry's catalog cache hint. No provider gating — any catalog that lists a context length feeds
 * the ring.
 */
export function resolveModelContextLength(
  activeModel: ContextUsageModelProfile | undefined,
  catalogHints: DesktopModelCatalogHint[] | undefined,
): number | undefined {
  if (!activeModel) {
    return undefined;
  }

  const profileLength = parseModelContextLength(activeModel.contextLength);
  if (profileLength !== undefined) {
    return profileLength;
  }

  const providerId = activeModel.providerId?.trim();
  const modelName = activeModel.name.trim();
  if (!providerId || !modelName) {
    return undefined;
  }

  const hint = catalogHints?.find((entry) => entry.providerId === providerId);
  const catalogEntry = hint?.modelCatalog?.find((entry) => entry.id === modelName);
  const contextLength = catalogEntry?.contextLength;
  if (typeof contextLength !== "number" || !Number.isFinite(contextLength) || contextLength <= 0) {
    return undefined;
  }

  return Math.trunc(contextLength);
}

export function buildContextUsagePercent(inputTokens: number, contextLength: number): number {
  if (contextLength <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((inputTokens / contextLength) * 100)));
}

export function normalizeContextUsageSnapshot(
  value: unknown,
): ConversationContextUsageSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rawInputTokens =
    typeof record.inputTokens === "number" && Number.isFinite(record.inputTokens)
      ? Math.trunc(record.inputTokens)
      : undefined;
  const contextLength =
    typeof record.contextLength === "number" && Number.isFinite(record.contextLength)
      ? Math.max(0, Math.trunc(record.contextLength))
      : undefined;
  if (
    rawInputTokens === undefined ||
    rawInputTokens < 0 ||
    contextLength === undefined ||
    contextLength <= 0
  ) {
    return undefined;
  }

  const inputTokens = rawInputTokens;

  const percent =
    typeof record.percent === "number" && Number.isFinite(record.percent)
      ? Math.max(0, Math.min(100, Math.round(record.percent)))
      : buildContextUsagePercent(inputTokens, contextLength);
  return { inputTokens, contextLength, percent };
}
