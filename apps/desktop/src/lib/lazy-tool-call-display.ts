import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";

/**
 * "{Server} {Tool}" in UI casing for the lazy tool_call card detail (`notes · search_notes`
 * becomes `Notes Search Notes`, `github · search_code` becomes `GitHub Search Code`). The MCP
 * form drops the provider segment, matching the MCP approval title; other providers keep it as
 * a raw prefix since the formatted pair alone cannot carry it.
 */
export function formatLazyToolCallDetail(provider: string, server: string, tool: string): string {
  const formatted = [server, tool]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => formatTitleFromId(part, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES }))
    .join(" ");
  if (provider === "mcp") {
    return formatted;
  }
  return [provider.trim(), formatted].filter((part) => part.length > 0).join(" / ");
}
