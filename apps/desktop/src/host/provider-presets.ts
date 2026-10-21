/** Thin wrapper: preset provider data comes from `@spiritagent/agent-core`, avoiding Desktop/CLI divergence. */
import { findProviderPreset } from "@spiritagent/agent-core/provider-presets";

export function providerSupportsSiteSelection(provider: string): boolean {
  return findProviderPreset(provider)?.sites !== undefined;
}

export function providerConnectSiteRequiresWorkspaceId(provider: string, site: string): boolean {
  const siteDef = findProviderPreset(provider)?.sites?.items.find((item) => item.id === site);
  if (!siteDef) {
    return false;
  }
  if (siteDef.requiresWorkspaceId === true) {
    return true;
  }
  const bases = [siteDef.apiBase, ...Object.values(siteDef.transports ?? {})];
  return bases.some((base) => base?.includes("{workspaceId}"));
}
