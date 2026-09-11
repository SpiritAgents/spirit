export const SPIRIT_UI_OPEN_METHOD = "spirit/ui/open";
export const SPIRIT_UI_EXPERIMENTAL_KEY = "spirit/ui";

/** tools/call stays in flight while a Desktop Dialog is open. */
export const SPIRIT_UI_CALL_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface ExtensionMcpServerOwnership {
  extensionId: string;
  viewIds: readonly string[];
}

export interface McpUiOpenRequest {
  extensionId: string;
  viewId: string;
  params?: unknown;
}

export type McpUiOpenResult =
  | { kind: "opened"; result: unknown }
  | { kind: "unavailable"; reason: "host-has-no-ui" };

export type McpUiOpener = (request: McpUiOpenRequest) => Promise<McpUiOpenResult>;

export function parseSpiritUiOpenParams(value: unknown): { viewId: string; params?: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("spirit/ui/open params must be an object");
  }
  const record = value as { viewId?: unknown; params?: unknown };
  if (typeof record.viewId !== "string" || !record.viewId.trim()) {
    throw new Error("spirit/ui/open requires viewId");
  }
  return {
    viewId: record.viewId.trim(),
    ...(record.params === undefined ? {} : { params: record.params }),
  };
}

export function resolveSpiritUiOpen(input: {
  ownership: ExtensionMcpServerOwnership | undefined;
  opener: McpUiOpener | undefined;
  viewId: string;
  params?: unknown;
}): Promise<McpUiOpenResult> {
  if (!input.ownership) {
    return Promise.reject(new Error("MCP server has no extension UI ownership"));
  }
  if (!input.ownership.viewIds.includes(input.viewId)) {
    return Promise.reject(new Error(`View is not owned by this extension: ${input.viewId}`));
  }
  if (!input.opener) {
    return Promise.resolve({ kind: "unavailable", reason: "host-has-no-ui" });
  }
  return input.opener({
    extensionId: input.ownership.extensionId,
    viewId: input.viewId,
    ...(input.params === undefined ? {} : { params: input.params }),
  });
}
