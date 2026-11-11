import path from "node:path";

import type { McpExtraConfigProvider, McpService } from "@spiritagent/agent-core";

import { createHostMcpService } from "./mcp-config-source.js";

export class McpRegistry {
  private readonly cache = new Map<string, McpService>();

  constructor(
    private readonly spiritDataDir: string,
    private readonly extraConfigs?: McpExtraConfigProvider,
  ) {}

  forWorkspace(workspaceRoot: string): McpService {
    const key = path.resolve(workspaceRoot);
    let service = this.cache.get(key);
    if (!service) {
      service = createHostMcpService(
        key,
        this.spiritDataDir,
        true,
        this.extraConfigs ? { extraConfigs: this.extraConfigs } : {},
      );
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
