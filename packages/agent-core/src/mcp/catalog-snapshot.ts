import { McpRegistry } from "./registry.js";
import type {
  McpResourceIndexEntry,
  McpToolIndexEntry,
  ResolvedMcpServerConfig,
  ToolAgentMcpToolCatalogSnapshot,
} from "./types.js";

export const MCP_CATALOG_TOOL_LIMIT = 128;
export const MCP_CATALOG_RESOURCE_LIMIT = 128;

export function aggregateListedResourcesForServer(
  serverName: string,
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>,
): McpResourceIndexEntry[] {
  const byUri = new Map<string, McpResourceIndexEntry>();

  for (const resource of resources) {
    const existing = byUri.get(resource.uri);
    const mimeTypes = new Set(existing?.mimeTypes ?? []);
    if (typeof resource.mimeType === "string" && resource.mimeType.trim()) {
      mimeTypes.add(resource.mimeType.trim());
    }

    byUri.set(resource.uri, {
      server: serverName,
      uri: resource.uri,
      name: resource.name,
      ...(typeof resource.description === "string" && resource.description.trim()
        ? { description: resource.description.trim() }
        : existing?.description !== undefined
          ? { description: existing.description }
          : {}),
      ...(mimeTypes.size > 0 ? { mimeTypes: [...mimeTypes].sort() } : {}),
    });
  }

  return [...byUri.values()];
}

export function findResourceIndexEntry(
  entries: McpResourceIndexEntry[],
  serverName: string,
  uri: string,
): McpResourceIndexEntry | undefined {
  return entries.find((entry) => entry.server === serverName && entry.uri === uri);
}

export function buildMcpToolCatalogSnapshot(
  indexEntries: McpToolIndexEntry[],
  resourceEntries: McpResourceIndexEntry[],
  registry: McpRegistry,
  resolvedServers: Record<string, ResolvedMcpServerConfig>,
): ToolAgentMcpToolCatalogSnapshot {
  const enabledServers = Object.values(resolvedServers).filter((server) => server.enabled);
  const enabledServerNames = new Set(enabledServers.map((server) => server.name));
  const enabledLazyServerNames = new Set(
    enabledServers.filter((server) => server.lazyTools !== false).map((server) => server.name),
  );
  const lazyIndexEntries = indexEntries.filter((entry) => enabledLazyServerNames.has(entry.server));
  const groupedTools = new Map<string, McpToolIndexEntry[]>();
  for (const entry of lazyIndexEntries) {
    const current = groupedTools.get(entry.server) ?? [];
    current.push(entry);
    groupedTools.set(entry.server, current);
  }

  const enabledResourceEntries = resourceEntries.filter((entry) =>
    enabledServerNames.has(entry.server),
  );
  const groupedResources = new Map<string, McpResourceIndexEntry[]>();
  for (const entry of enabledResourceEntries) {
    const current = groupedResources.get(entry.server) ?? [];
    current.push(entry);
    groupedResources.set(entry.server, current);
  }

  const totalToolCount = lazyIndexEntries.length;
  const truncated = totalToolCount > MCP_CATALOG_TOOL_LIMIT;
  let remainingTools = MCP_CATALOG_TOOL_LIMIT;

  const totalResourceCount = enabledResourceEntries.length;
  const resourcesTruncated = totalResourceCount > MCP_CATALOG_RESOURCE_LIMIT;
  let remainingResources = MCP_CATALOG_RESOURCE_LIMIT;

  const servers = enabledServers
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((server) => {
      const status = registry.get(server.name);
      const toolsForServer = groupedTools.get(server.name) ?? [];
      const visibleTools = remainingTools > 0 ? toolsForServer.slice(0, remainingTools) : [];
      remainingTools -= visibleTools.length;

      const resourcesForServer = groupedResources.get(server.name) ?? [];
      const visibleResources =
        remainingResources > 0 ? resourcesForServer.slice(0, remainingResources) : [];
      remainingResources -= visibleResources.length;

      return {
        name: server.name,
        displayName: server.displayName,
        state: status?.state ?? "idle",
        ...(status?.lastError === undefined ? {} : { lastError: status.lastError }),
        tools: visibleTools.map((tool) => ({
          name: tool.toolName,
          description: tool.description,
        })),
        resources: visibleResources.map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          ...(resource.description === undefined ? {} : { description: resource.description }),
          ...(resource.mimeTypes === undefined || resource.mimeTypes.length === 0
            ? {}
            : { mimeTypes: resource.mimeTypes }),
        })),
      };
    })
    .filter(
      (server) =>
        server.tools.length > 0 || server.resources.length > 0 || server.state === "error",
    );

  return {
    servers,
    truncated,
    totalToolCount,
    resourcesTruncated,
    totalResourceCount,
  };
}
