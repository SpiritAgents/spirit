import {
  LSP_PROVIDERS,
  discoverAllLspProviders,
  type LspProviderDescriptor,
  type LspProviderId,
} from "./index.js";

import type { DesktopLspProviderSnapshot, DesktopLspSnapshot } from "@spiritagent/api/types";

interface LspSnapshotConfig {
  agents?: { lsp?: { enabled?: boolean } | undefined } | undefined;
}

function snapshotFromProvider(
  provider: LspProviderDescriptor,
  status: DesktopLspProviderSnapshot["status"],
  command?: string,
): DesktopLspProviderSnapshot {
  return {
    id: provider.id,
    displayName: provider.displayName,
    languages: [...provider.languageLabels],
    status,
    ...(command ? { command } : {}),
  };
}

export function defaultDesktopLspSnapshot(): DesktopLspSnapshot {
  return {
    userEnabled: true,
    active: false,
    providers: LSP_PROVIDERS.map((provider) => snapshotFromProvider(provider, "not_found")),
  };
}

export async function buildDesktopLspSnapshot(
  config: LspSnapshotConfig,
): Promise<DesktopLspSnapshot> {
  const userEnabled = config.agents?.lsp?.enabled !== false;

  if (!userEnabled) {
    return {
      userEnabled,
      active: false,
      providers: LSP_PROVIDERS.map((provider) => snapshotFromProvider(provider, "disabled")),
    };
  }

  const discoveries = await discoverAllLspProviders(process.env, process.platform, {
    lightweight: true,
  });
  const discoveryById = new Map(discoveries.map((item) => [item.id, item]));

  const providers: DesktopLspProviderSnapshot[] = LSP_PROVIDERS.map((provider) => {
    const discovery = discoveryById.get(provider.id as LspProviderId);
    if (discovery?.status === "ready") {
      return snapshotFromProvider(provider, "ready", discovery.command);
    }
    return snapshotFromProvider(provider, "not_found");
  });

  return {
    userEnabled,
    active: providers.some((provider) => provider.status === "ready"),
    providers,
  };
}
