import { RESPONSES_BUILT_IN_SPIRIT_UI_KEY } from "@spiritagent/agent-core";

/**
 * The desktop read of the `_spiritUi` preview block that provider tool call events carry
 * (agent-core `buildProviderToolPreviewArgumentsJson` for declaration-driven provider tools, and
 * the responses/anthropic built-in tool cards). `label` and `suppressExpand` are the entry
 * declaration's `label` and `ui.expand` projected onto the event; the rest are display payloads.
 */
export interface ProviderToolSpiritUiPreview {
  /** Entry `label`; a non-empty value marks a declaration-driven provider tool call. */
  label?: string;
  /** Entry `ui.expand === false`: forbid expanding the card details (server-side ciphertext). */
  suppressExpand: boolean;
  inputExcerpt?: string;
  outputExcerpt?: string;
  headlineDetail?: string;
  detailLines?: string[];
  sourceCount?: number;
  internalActionType?: "search" | "open_page" | "find_in_page";
}

function readPlainObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function parseProviderToolSpiritUiPreview(
  argumentsJson: string,
): ProviderToolSpiritUiPreview | undefined {
  try {
    const parsed = readPlainObject(JSON.parse(argumentsJson));
    if (!parsed) {
      return undefined;
    }
    const ui = readPlainObject(parsed[RESPONSES_BUILT_IN_SPIRIT_UI_KEY]);
    if (!ui) {
      return undefined;
    }
    const detailLines = Array.isArray(ui.detailLines)
      ? ui.detailLines.filter(
          (line): line is string => typeof line === "string" && line.trim().length > 0,
        )
      : undefined;
    const sourceCount =
      typeof ui.sourceCount === "number" && Number.isFinite(ui.sourceCount) && ui.sourceCount > 0
        ? Math.floor(ui.sourceCount)
        : undefined;
    const internalActionType =
      ui.internalActionType === "search" ||
      ui.internalActionType === "open_page" ||
      ui.internalActionType === "find_in_page"
        ? ui.internalActionType
        : undefined;
    const label = readNonEmptyString(ui.label)?.trim();
    const inputExcerpt = readNonEmptyString(ui.inputExcerpt);
    const outputExcerpt = readNonEmptyString(ui.outputExcerpt);
    const headlineDetail = readNonEmptyString(ui.headlineDetail)?.trim();
    return {
      ...(label ? { label } : {}),
      suppressExpand: ui.suppressExpand === true,
      ...(inputExcerpt ? { inputExcerpt } : {}),
      ...(outputExcerpt ? { outputExcerpt } : {}),
      ...(headlineDetail ? { headlineDetail } : {}),
      ...(detailLines && detailLines.length > 0 ? { detailLines } : {}),
      ...(sourceCount !== undefined ? { sourceCount } : {}),
      ...(internalActionType ? { internalActionType } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Host-executed provider tool requests ride as `{ name, argumentsJson }`; the completed card's
 * Input shows the call arguments as pretty JSON (MCP-style input/output detail).
 */
export function providerToolInputJsonFromRequest(request: unknown): string | undefined {
  const record = readPlainObject(request);
  const argumentsJson = readNonEmptyString(record?.argumentsJson);
  if (!argumentsJson) {
    return undefined;
  }
  try {
    return JSON.stringify(JSON.parse(argumentsJson), null, 2);
  } catch {
    return argumentsJson;
  }
}
