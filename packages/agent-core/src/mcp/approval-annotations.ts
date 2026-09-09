import type { McpToolApprovalAnnotations } from "./types.js";

export function parseMcpToolApprovalAnnotations(
  value: unknown,
): McpToolApprovalAnnotations | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const annotations: McpToolApprovalAnnotations = {
    ...(typeof record.readOnlyHint === "boolean" ? { readOnlyHint: record.readOnlyHint } : {}),
    ...(typeof record.openWorldHint === "boolean" ? { openWorldHint: record.openWorldHint } : {}),
  };
  if (annotations.readOnlyHint === undefined && annotations.openWorldHint === undefined) {
    return undefined;
  }
  return annotations;
}
