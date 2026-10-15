import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

import type { JsonObject } from "../ports.js";
import type { OpenAiLlmVendor, OpenAiTransportConfig } from "./openai-compat.js";

export function isGatewayGoogleGeminiModel(
  llmVendor: OpenAiLlmVendor | undefined,
  model: string,
): boolean {
  if (llmVendor !== "vercel-ai-gateway") {
    return false;
  }

  return model.trim().toLowerCase().startsWith("google/gemini-");
}

function normalizeGoogleGeminiModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function parseGoogleGeminiModelVersion(
  model: string,
): { major: number; minor: number } | undefined {
  const match = /^gemini-(\d+)(?:\.(\d+))?/.exec(normalizeGoogleGeminiModelId(model));
  if (!match) {
    return undefined;
  }

  const major = Number(match[1]);
  const minor = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return undefined;
  }

  return { major, minor };
}

/**
 * Gemini 3 and newer use thinkingLevel. Earlier models use thinkingBudget.
 * The cut is the numeric version in the id (`gemini-<major>[.<minor>]`),
 * so Gemini 4 and later stay on thinkingLevel.
 */
export function isGoogleGeminiThinkingLevelModel(model: string): boolean {
  const version = parseGoogleGeminiModelVersion(model);
  return version !== undefined && version.major >= 3;
}

/**
 * Gemini 3.7 / 3.8 Flash reject thinkingLevel=minimal with HTTP 400.
 * Match any id that contains "flash", so suffixes such as -lite and -batch are included.
 */
function isGoogleGemini37Or38FlashModel(model: string): boolean {
  const version = parseGoogleGeminiModelVersion(model);
  if (
    version === undefined ||
    version.major !== 3 ||
    (version.minor !== 7 && version.minor !== 8)
  ) {
    return false;
  }

  return normalizeGoogleGeminiModelId(model).includes("flash");
}

/**
 * Flash / Flash-Lite on thinkingLevel models support thinkingLevel=minimal.
 * Pro does not. Gemini 3.7 / 3.8 Flash, including suffixed ids, do not.
 */
export function isGoogleGeminiMinimalThinkingLevelModel(model: string): boolean {
  if (!isGoogleGeminiThinkingLevelModel(model) || isGoogleGemini37Or38FlashModel(model)) {
    return false;
  }

  return normalizeGoogleGeminiModelId(model).includes("flash");
}

/** Gemini 2.5 Pro rejects thinkingBudget 0. 2.5 Flash and Flash-Lite still accept it. */
export function isGoogleGemini25ProModel(model: string): boolean {
  const version = parseGoogleGeminiModelVersion(model);
  if (version === undefined || version.major !== 2 || version.minor !== 5) {
    return false;
  }

  const normalized = normalizeGoogleGeminiModelId(model);
  if (normalized.includes("flash")) {
    return false;
  }

  return /(?:^|[-_])pro(?:$|[-_])/.test(normalized);
}

function googleGemini25ThinkingBudgetForEffort(effort: string): number | undefined {
  switch (effort) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    default:
      return undefined;
  }
}

export function buildGoogleThinkingConfigForEffort(
  model: string,
  effort: string | undefined,
): GoogleLanguageModelOptions["thinkingConfig"] | undefined {
  if (effort === undefined) {
    return undefined;
  }

  if (effort === "minimal") {
    if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
      return { thinkingLevel: "minimal" };
    }

    return undefined;
  }

  if (effort === "none") {
    if (isGoogleGeminiThinkingLevelModel(model)) {
      // Code completion still writes none. Flash models that accept minimal map to it.
      // Gemini 3.7 / 3.8 Flash reject minimal, so none is omitted like Pro.
      if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
        return { thinkingLevel: "minimal" };
      }

      return undefined;
    }

    // Gemini 2.5 Pro rejects thinkingBudget 0. Flash and Flash-Lite still accept it.
    if (isGoogleGemini25ProModel(model)) {
      return undefined;
    }

    return { thinkingBudget: 0 };
  }

  if (isGoogleGeminiThinkingLevelModel(model)) {
    if (effort === "low" || effort === "medium" || effort === "high") {
      return {
        thinkingLevel: effort,
        includeThoughts: true,
      };
    }

    return undefined;
  }

  const thinkingBudget = googleGemini25ThinkingBudgetForEffort(effort);
  if (thinkingBudget === undefined) {
    return undefined;
  }

  return {
    thinkingBudget,
    includeThoughts: thinkingBudget > 0,
  };
}

export function gatewayGoogleGeminiSupportedEfforts(model: string): readonly string[] | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized.startsWith("google/gemini-")) {
    return undefined;
  }

  if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
    return ["minimal", "low", "medium", "high"];
  }

  if (isGoogleGeminiThinkingLevelModel(model) || isGoogleGemini25ProModel(model)) {
    return ["low", "medium", "high"];
  }

  return ["none", "low", "medium", "high"];
}

export function buildGatewayGoogleProviderOptions(
  config: Pick<OpenAiTransportConfig, "llmVendor" | "model" | "reasoningEffort">,
  effort: string | undefined,
): Record<string, JsonObject> {
  if (!isGatewayGoogleGeminiModel(config.llmVendor, config.model)) {
    return {};
  }

  const thinkingConfig = buildGoogleThinkingConfigForEffort(config.model, effort);
  if (thinkingConfig === undefined) {
    return {};
  }

  const googleOptions = {
    thinkingConfig,
  } satisfies GoogleLanguageModelOptions;

  return {
    google: googleOptions as JsonObject,
  };
}
