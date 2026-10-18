import type { JsonObject } from "../ports.js";
import { RESPONSES_BUILT_IN_SPIRIT_UI_KEY } from "../open-responses/responses-built-in-tools.js";
import { isPlainJsonObject } from "./types.js";

/**
 * Streaming preview bridge for host-executed provider tool calls. The emitted argumentsJson keeps
 * the `_spiritUi` card shape the current desktop reader understands; P7 replaces the contract.
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

export type ParsedProviderToolSpiritUi = {
  inputExcerpt: string;
  headlineDetail?: string;
  suppressExpand: boolean;
};

/**
 * @deprecated Bridge for the current desktop reader (`runtime-event-orchestrator`), which looks up
 * this exact export name; superseded by the P7 UI contract. Parses the `_spiritUi` block emitted
 * by host-executed provider tool previews.
 */
export function parseMoonshotFormulaSpiritUiFromArgumentsJson(
  argumentsJson: string,
): ParsedProviderToolSpiritUi | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonObject;
    if (!isPlainJsonObject(parsed)) {
      return undefined;
    }

    const raw = parsed[RESPONSES_BUILT_IN_SPIRIT_UI_KEY];
    if (!isPlainJsonObject(raw)) {
      return undefined;
    }

    const inputExcerpt = typeof raw.inputExcerpt === "string" ? raw.inputExcerpt : "";
    if (!inputExcerpt.trim()) {
      return undefined;
    }

    const headlineDetail =
      typeof raw.headlineDetail === "string" && raw.headlineDetail.trim()
        ? raw.headlineDetail.trim()
        : undefined;

    return {
      inputExcerpt,
      ...(headlineDetail ? { headlineDetail } : {}),
      suppressExpand: raw.suppressExpand === true,
    };
  } catch {
    return undefined;
  }
}

/** @deprecated Bridge companion of {@link parseMoonshotFormulaSpiritUiFromArgumentsJson}. */
export function moonshotFormulaSpiritUiSuppressesExpand(argumentsJson: string): boolean {
  return parseMoonshotFormulaSpiritUiFromArgumentsJson(argumentsJson)?.suppressExpand === true;
}
