import type { JsonObject } from "../ports.js";
import { RESPONSES_BUILT_IN_SPIRIT_UI_KEY } from "../open-responses/responses-built-in-tools.js";

/**
 * Streaming preview for host-executed provider tool calls: the emitted argumentsJson carries the
 * `_spiritUi` card shape the desktop reads (label, excerpts, suppressExpand from `ui.expand`).
 */
export interface ProviderToolPreviewInput {
  /** Entry `label`; carried for display, falling back to the tool name. */
  label?: string;
  /** Tool name; the display fallback when no entry label is declared. */
  toolName?: string;
  /** Parsed `query` argument when the call's arguments carry one. */
  query?: string;
  /** Wire status (`in_progress` while executing, terminal state after). */
  status?: string;
  failed?: boolean;
  /** Result excerpt for the card body (truncated). */
  outputExcerpt?: string;
  /** Entry `ui.expand === false`: forbid expanding details (e.g. ciphertext output). */
  suppressExpand?: boolean;
}

const SPIRIT_UI_OUTPUT_EXCERPT_MAX = 4_000;

function truncateOutputExcerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SPIRIT_UI_OUTPUT_EXCERPT_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, SPIRIT_UI_OUTPUT_EXCERPT_MAX)}…`;
}

export function buildProviderToolPreviewArgumentsJson(input: ProviderToolPreviewInput): string {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const label = input.label?.trim() || input.toolName?.trim() || "Provider tool";
  const spiritUi: JsonObject = {
    inputExcerpt: query.length > 0 ? query : label,
    ...(query.length > 0 ? { headlineDetail: query } : {}),
    label,
    ...(input.suppressExpand === true ? { suppressExpand: true } : {}),
  };
  const outputExcerpt = input.outputExcerpt?.trim();
  if (outputExcerpt) {
    spiritUi.outputExcerpt = truncateOutputExcerpt(outputExcerpt);
  }
  const payload: JsonObject = {
    ...(query.length > 0 ? { query } : {}),
    status: input.failed ? "failed" : (input.status ?? "completed"),
    [RESPONSES_BUILT_IN_SPIRIT_UI_KEY]: spiritUi,
  };
  return JSON.stringify(payload);
}
