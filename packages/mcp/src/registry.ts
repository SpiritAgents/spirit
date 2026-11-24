import path from "node:path";

import type { McpExtraConfigProvider, McpService } from "@spiritagent/agent-core";

import { createHostMcpService } from "./mcp-config-source.js";

export class McpRegistry {
  private readonly cache = new Map<string, McpService>();

  constructor(
    private readonly spiritDataDir: string,
    private readonly extraConfigs?: McpExtraConfigProvider,
  ) {}

  forWorkspace(workspaceRoot: string, options?: { enableMcpApps?: boolean }): McpService {
    const resolvedRoot = path.resolve(workspaceRoot);
    const enableMcpApps = options?.enableMcpApps === true;
    const key = `${resolvedRoot}|${enableMcpApps ? "mcp-apps" : "headless"}`;
    let service = this.cache.get(key);
    if (!service) {
      service = createHostMcpService(resolvedRoot, this.spiritDataDir, true, {
        ...(this.extraConfigs ? { extraConfigs: this.extraConfigs } : {}),
        enableMcpApps,
      });
      this.cache.set(key, service);
    }
    return service;
  }

  async refreshAllConfigs(): Promise<void> {
    await Promise.all(
      [...this.cache.values()].map(async (service) => {
        const changed = await service.refreshConfig();
        if (changed) {
          service.startBackgroundRefreshInBackground(true);
        }
      }),
    );
  }

  async disposeWorkspace(workspaceRoot: string): Promise<void> {
    const prefix = `${path.resolve(workspaceRoot)}|`;
    const toDispose: McpService[] = [];
    for (const [key, service] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        toDispose.push(service);
      }
    }
    await Promise.all(toDispose.map((service) => service.dispose()));
  }

  async disposeAll(): Promise<void> {
    const services = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(services.map((service) => service.dispose()));
  }
}
