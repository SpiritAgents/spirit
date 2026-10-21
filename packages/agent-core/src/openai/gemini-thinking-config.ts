import type { GoogleLanguageModelOptions } from "@ai-sdk/google";

/**
 * Gemini thinking plumbing: Gemini 3+ speaks `thinkingLevel`, earlier generations speak
 * `thinkingBudget` (the era is read off the model id's major version). The declared effort passes
 * verbatim — the catalog's `supportedReasoningEfforts` withholds the values an era rejects (e.g.
 * Gemini 2.5 Pro has no `none`), so nothing is suppressed or clamped here.
 */
export function buildGeminiThinkingConfigForEffort(
  model: string,
  effort: string | undefined,
): GoogleLanguageModelOptions["thinkingConfig"] | undefined {
  if (effort === undefined) {
    return undefined;
  }

  const major = parseGeminiMajorVersion(model);
  if (major !== undefined && major >= 3) {
    switch (effort) {
      case "minimal":
        return { thinkingLevel: "minimal" };
      case "low":
      case "medium":
      case "high":
        return { thinkingLevel: effort, includeThoughts: true };
      default:
        return undefined;
    }
  }

  switch (effort) {
    case "none":
      return { thinkingBudget: 0 };
    case "low":
      return { thinkingBudget: 1024, includeThoughts: true };
    case "medium":
      return { thinkingBudget: 4096, includeThoughts: true };
    case "high":
      return { thinkingBudget: 8192, includeThoughts: true };
    default:
      return undefined;
  }
}

function parseGeminiMajorVersion(model: string): number | undefined {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf("/");
  const bareId = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const match = /^gemini-(\d+)/.exec(bareId);
  if (!match) {
    return undefined;
  }
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : undefined;
}
