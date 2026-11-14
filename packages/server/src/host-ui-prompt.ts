import type { HostToolDescriptionHint } from "@spiritagent/agent-core";

/** Max chars accepted for session.create hostUiPromptSection (Desktop Markdown hints). */
export const HOST_UI_PROMPT_SECTION_MAX_CHARS = 4000;

/** Max accepted hostToolDescriptionHints entries per session.create. */
export const HOST_TOOL_DESCRIPTION_HINT_MAX_COUNT = 16;

/** Max chars accepted per hostToolDescriptionHints text. */
export const HOST_TOOL_DESCRIPTION_HINT_TEXT_MAX_CHARS = 500;

export function normalizeHostUiPromptSection(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > HOST_UI_PROMPT_SECTION_MAX_CHARS) {
    return undefined;
  }
  return trimmed;
}

export function normalizeHostToolDescriptionHints(
  value: unknown,
): HostToolDescriptionHint[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > HOST_TOOL_DESCRIPTION_HINT_MAX_COUNT
  ) {
    return undefined;
  }
  const hints: HostToolDescriptionHint[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return undefined;
    }
    const raw = entry as Record<string, unknown>;
    const toolName = typeof raw["toolName"] === "string" ? raw["toolName"].trim() : "";
    const text = typeof raw["text"] === "string" ? raw["text"].trim() : "";
    const parameterName =
      typeof raw["parameterName"] === "string" && raw["parameterName"].trim()
        ? raw["parameterName"].trim()
        : undefined;
    if (!toolName || !text || text.length > HOST_TOOL_DESCRIPTION_HINT_TEXT_MAX_CHARS) {
      return undefined;
    }
    hints.push({ toolName, ...(parameterName ? { parameterName } : {}), text });
  }
  return hints;
}
