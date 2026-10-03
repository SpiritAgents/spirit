import type { JsonObject, JsonValue } from "../ports.js";
import { isOpenResponsesTransportConfig, type LlmTransportConfig } from "../provider-config.js";

export const DEEPSEEK_RESPONSES_BUILT_IN_TOOL_TYPES = ["web_search"] as const;

export type DeepSeekResponsesBuiltInToolType =
  (typeof DEEPSEEK_RESPONSES_BUILT_IN_TOOL_TYPES)[number];

export function shouldUseDeepSeekResponsesBuiltInTools(config: LlmTransportConfig): boolean {
  return (
    isOpenResponsesTransportConfig(config) &&
    config.llmVendor === "deepseek" &&
    config.webSearchEnabled !== false
  );
}

export function buildDeepSeekResponsesBuiltInTools(): JsonObject[] {
  return DEEPSEEK_RESPONSES_BUILT_IN_TOOL_TYPES.map((type) => ({ type }));
}

export function mergeDeepSeekResponsesBuiltInTools(
  existingTools: readonly JsonValue[],
): JsonValue[] {
  const merged = [...existingTools];
  const presentTypes = new Set<string>();

  for (const tool of merged) {
    const type = readResponsesBuiltInToolType(tool);
    if (type) {
      presentTypes.add(type);
    }
  }

  for (const type of DEEPSEEK_RESPONSES_BUILT_IN_TOOL_TYPES) {
    if (!presentTypes.has(type)) {
      merged.push({ type });
      presentTypes.add(type);
    }
  }

  return merged;
}

function readResponsesBuiltInToolType(tool: JsonValue): string | undefined {
  if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
    return undefined;
  }

  const record = tool as JsonObject;
  return typeof record.type === "string" ? record.type : undefined;
}
