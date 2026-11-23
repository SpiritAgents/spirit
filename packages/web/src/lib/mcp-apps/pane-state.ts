import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps/app-bridge";
import { formatTitleFromId } from "@spiritagent/agent-core/model-catalog/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/agent-core/model-catalog/well-known-casing";

export const MAX_ACTIVE_MCP_APPS_PER_PANE = 6;
export const DEFAULT_MCP_APP_INLINE_HEIGHT_PX = 240;
export const MIN_MCP_APP_INLINE_HEIGHT_PX = 150;
export const MAX_MCP_APP_INLINE_HEIGHT_PX = 800;

export interface McpAppPaneEntryMeta {
  appKey: string;
  displayMode: McpUiDisplayMode;
  lastTouchedAt: number;
}

/**
 * Derive a Title Case display name for an MCP App tab/card by combining the MCP server
 * name and the resource name from its `ui://` URI (falling back to the tool name).
 * Example: `server="github"`, `displayName="GitHub"`, `resourceUri="ui://github-mcp-server/get-me"` -> `"GitHub Get Me"`.
 */
export function formatMcpAppTabTitle(input: {
  server: string;
  displayName?: string;
  toolName?: string;
  resourceUri?: string;
}): string {
  const rawServer = input.server.trim();
  const rawDisplayName = input.displayName?.trim() ?? "";
  const serverLabel =
    rawDisplayName && rawDisplayName.toLowerCase() !== rawServer.toLowerCase()
      ? rawDisplayName
      : formatTitleFromId(rawDisplayName || rawServer, {
          casingOverrides: WELL_KNOWN_CASING_OVERRIDES,
        });

  const resourceSegment = extractMcpAppResourceSegment(input.resourceUri) || input.toolName?.trim();
  const resourceLabel = resourceSegment
    ? formatTitleFromId(resourceSegment, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES })
    : "";

  if (!resourceLabel) {
    return serverLabel || rawServer;
  }
  if (!serverLabel) {
    return resourceLabel;
  }
  if (resourceLabel.toLowerCase().startsWith(serverLabel.toLowerCase())) {
    return resourceLabel;
  }
  return `${serverLabel} ${resourceLabel}`;
}

function extractMcpAppResourceSegment(resourceUri: string | undefined): string {
  const trimmed = resourceUri?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  const withoutScheme = trimmed.replace(/^ui:\/\//i, "");
  const withoutQuery = withoutScheme.split(/[?#]/u)[0] ?? "";
  const segments = withoutQuery
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const lastSegment = segments.length > 1 ? segments[segments.length - 1]! : (segments[0] ?? "");
  return lastSegment.replace(/\.html?$/i, "");
}

export function clampMcpAppInlineHeight(heightPx: number | undefined): number {
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx) || heightPx <= 0) {
    return DEFAULT_MCP_APP_INLINE_HEIGHT_PX;
  }
  return Math.round(
    Math.min(MAX_MCP_APP_INLINE_HEIGHT_PX, Math.max(MIN_MCP_APP_INLINE_HEIGHT_PX, heightPx)),
  );
}

/**
 * Select keys to evict from a pane's active MCP App registry when exceeding `maxActive`.
 * Active `pip` and `fullscreen` apps are strictly exempt from eviction.
 */
export function selectEvictableMcpAppKeys(
  entries: readonly McpAppPaneEntryMeta[],
  maxActive: number = MAX_ACTIVE_MCP_APPS_PER_PANE,
): string[] {
  if (entries.length <= maxActive) {
    return [];
  }
  const excess = entries.length - maxActive;
  const candidates = entries
    .filter((entry) => entry.displayMode === "inline")
    .sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
  return candidates.slice(0, excess).map((entry) => entry.appKey);
}

/**
 * Compute the next display-mode list for all entries when `targetKey` transitions
 * to `targetMode`:
 * - Multiple `pip` apps may coexist concurrently as independent floating windows
 *   across sessions and app surfaces.
 * - Multiple `fullscreen` apps may coexist concurrently as separate right-panel tabs.
 */
export function computeMcpAppDisplayModesAfterTransition<
  T extends { appKey: string; displayMode: McpUiDisplayMode },
>(entries: readonly T[], targetKey: string, targetMode: McpUiDisplayMode): T[] {
  return entries.map((entry) => {
    if (entry.appKey === targetKey) {
      return entry.displayMode === targetMode ? entry : { ...entry, displayMode: targetMode };
    }
    return entry;
  });
}

type ParentNodeWithMoveBefore = ParentNode & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

/**
 * Move `node` into `targetParent` without resetting embedded browsing contexts
 * (such as `<iframe>`) when the browser supports DOM atomic moves (`moveBefore`).
 * Falls back to `appendChild` when `node` is not yet connected or on older browsers.
 */
export function atomicMoveNode(targetParent: HTMLElement, node: HTMLElement): void {
  if (node.parentNode === targetParent) {
    return;
  }
  const parentWithMoveBefore = targetParent as ParentNodeWithMoveBefore;
  if (
    typeof parentWithMoveBefore.moveBefore === "function" &&
    node.isConnected &&
    targetParent.isConnected
  ) {
    try {
      parentWithMoveBefore.moveBefore(node, null);
      return;
    } catch {
      // Fall through to appendChild if the browser rejects an edge-case atomic move.
    }
  }
  targetParent.appendChild(node);
}
