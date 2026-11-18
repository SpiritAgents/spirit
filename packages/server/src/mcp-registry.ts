import type { McpExtraConfigProvider } from "@spiritagent/agent-core";
import {
  collectEnabledExtensionInstructionContributions,
  createHostExtensionManager,
} from "@spiritagent/extensions";
import {
  createKeyringExtensionStateStore,
  type ExtensionManagementContext,
  type ExtensionStateStore,
} from "@spiritagent/extensions/storage";

export { McpRegistry } from "@spiritagent/mcp/registry";

/**
 * Per-workspace shared McpService cache (same pattern as Desktop's
 * `sharedMcpServiceForWorkspace`): sessions and host.mcp* management calls
 * share one background-refreshing service per workspace root.
 */
export function createExtensionMcpExtraConfigs(
  spiritDataDir: string,
  hostKind: "cli" | "desktop" | readonly ("cli" | "desktop")[],
  createStateStore: (
    context: ExtensionManagementContext,
  ) => ExtensionStateStore = createKeyringExtensionStateStore,
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
      const stateStore = createStateStore({ spiritDataDir, hostKind: kind });
      const manager = createHostExtensionManager({ spiritDataDir, hostKind: kind, stateStore });
      const contributions = await collectEnabledExtensionInstructionContributions(
        await manager.list(),
        undefined,
        {
          loadSecret: (extensionId, key) =>
            stateStore.loadSecret?.(extensionId, key) ?? Promise.resolve(undefined),
        },
      );
      Object.assign(servers, contributions.mcp.servers);
      Object.assign(extensionServerOwnership, contributions.mcpOwnership);
    }
    return { servers, extensionServerOwnership };
  };
}
