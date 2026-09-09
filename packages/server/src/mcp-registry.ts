import path from "node:path";

import { McpService, type McpExtraConfigProvider } from "@spiritagent/agent-core";
import {
  collectEnabledExtensionInstructionContributions,
  createHostExtensionManager,
} from "@spiritagent/host-internal";

/**
 * Per-workspace shared McpService cache (same pattern as Desktop's
 * `sharedMcpServiceForWorkspace`): sessions and host.mcp* management calls
 * share one background-refreshing service per workspace root.
 */
export function createExtensionMcpExtraConfigs(
  spiritDataDir: string,
  hostKind: "cli" | "desktop" | readonly ("cli" | "desktop")[],
): McpExtraConfigProvider {
  const hostKinds = typeof hostKind === "string" ? [hostKind] : [...hostKind];
  return async () => {
    const servers: Awaited<
      ReturnType<typeof collectEnabledExtensionInstructionContributions>
    >["mcp"]["servers"] = {};
    const extensionServerOwnership: Awaited<
      ReturnType<typeof collectEnabledExtensionInstructionContributions>
    >["mcpOwnership"] = {};
    for (const kind of hostKinds) {
      const manager = createHostExtensionManager({ spiritDataDir, hostKind: kind });
      const contributions = await collectEnabledExtensionInstructionContributions(
        await manager.list(),
      );
      Object.assign(servers, contributions.mcp.servers);
      Object.assign(extensionServerOwnership, contributions.mcpOwnership);
    }
    return { servers, extensionServerOwnership };
  };
}

export class McpRegistry {
  private readonly cache = new Map<string, McpService>();

  constructor(private readonly extraConfigs?: McpExtraConfigProvider) {}

  forWorkspace(workspaceRoot: string): McpService {
    const key = path.resolve(workspaceRoot);
    let service = this.cache.get(key);
    if (!service) {
      service = new McpService(
        key,
        true,
        this.extraConfigs ? { extraConfigs: this.extraConfigs } : {},
      );
      service.startBackgroundRefreshInBackground(false);
      this.cache.set(key, service);
    }
    return service;
  }

  async refreshAllConfigs(): Promise<void> {
    await Promise.all(
      [...this.cache.values()].map(async (service) => {
        await service.refreshConfig();
        service.startBackgroundRefreshInBackground(true);
      }),
    );
  }
}
