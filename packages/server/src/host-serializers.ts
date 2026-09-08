import type { JsonObject, JsonValue } from "@spiritagent/agent-core";
import {
  summarizeDeclaredExtensionContributionPoints,
  type HostInstalledExtension,
  type HostMarketplaceCatalogItem,
  type MarketplaceCatalogItem,
  type MarketplaceSourceRecord,
} from "@spiritagent/host-internal";

/**
 * Serializers mirroring the legacy host-bridge shapes — CLI/Desktop clients
 * already deserialize these exact field layouts.
 */

interface ExtensionToolContribution {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  approvalMode?: string;
  executionMode?: string;
}

interface ExtensionManifestLike {
  name: string;
  displayName: string;
  icon?: string;
  version: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  keywords?: string[];
  main?: string;
  supportedHosts: Array<"cli" | "desktop">;
  activationEvents?: string[];
  requestedCapabilities?: string[];
  contributes?: {
    tools?: ExtensionToolContribution[];
    desktop?: { css?: Array<{ path: string; media?: string }> };
    cli?: {
      hooks?: Array<{
        slot: string;
        variant?: string;
        tokens?: { foreground?: string; border?: string; accent?: string };
        prefix?: string;
        suffix?: string;
      }>;
    };
  };
  settingsSchema?: Array<{
    key: string;
    type: string;
    title: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: string | boolean | number;
    options?: Array<{ value: string; label: string; description?: string }>;
  }>;
  secretSlots?: Array<{
    key: string;
    title: string;
    description?: string;
    required?: boolean;
  }>;
}

function serializeExtensionContributes(
  item: ExtensionManifestLike["contributes"],
): JsonObject | Record<string, never> {
  if (!item) {
    return {};
  }
  const contributes = {
    ...(item.tools?.length
      ? {
          tools: item.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
            ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
          })),
        }
      : {}),
    ...(item.desktop?.css?.length
      ? {
          desktop: {
            css: item.desktop.css.map((entry) => ({
              path: entry.path,
              ...(entry.media ? { media: entry.media } : {}),
            })),
          },
        }
      : {}),
    ...(item.cli?.hooks?.length
      ? {
          cli: {
            hooks: item.cli.hooks.map((hook) => ({
              slot: hook.slot,
              ...(hook.variant ? { variant: hook.variant } : {}),
              ...(hook.tokens
                ? {
                    tokens: {
                      ...(hook.tokens.foreground ? { foreground: hook.tokens.foreground } : {}),
                      ...(hook.tokens.border ? { border: hook.tokens.border } : {}),
                      ...(hook.tokens.accent ? { accent: hook.tokens.accent } : {}),
                    },
                  }
                : {}),
              ...(hook.prefix ? { prefix: hook.prefix } : {}),
              ...(hook.suffix ? { suffix: hook.suffix } : {}),
            })),
          },
        }
      : {}),
  };
  return Object.keys(contributes).length > 0 ? { contributes } : {};
}

export function serializeHostExtension(item: {
  id: string;
  manifest: ExtensionManifestLike;
  installedAtUnixMs: number;
  enabled: boolean;
  archiveFileName?: string;
  installSource?: "built-in" | "archive" | "marketplace";
}): JsonObject {
  return {
    id: item.id,
    displayName: item.manifest.displayName,
    enabled: item.enabled,
    ...(item.manifest.icon ? { icon: item.manifest.icon } : {}),
    version: item.manifest.version,
    ...(item.manifest.description ? { description: item.manifest.description } : {}),
    ...(item.manifest.author
      ? {
          author: {
            name: item.manifest.author.name,
            ...(item.manifest.author.email ? { email: item.manifest.author.email } : {}),
            ...(item.manifest.author.url ? { url: item.manifest.author.url } : {}),
          },
        }
      : {}),
    ...(item.manifest.keywords?.length ? { keywords: [...item.manifest.keywords] } : {}),
    ...(item.manifest.main ? { main: item.manifest.main } : {}),
    supportedHosts: [...item.manifest.supportedHosts],
    ...(item.manifest.activationEvents?.length
      ? { activationEvents: [...item.manifest.activationEvents] }
      : {}),
    ...(item.manifest.requestedCapabilities?.length
      ? { requestedCapabilities: [...item.manifest.requestedCapabilities] }
      : {}),
    ...serializeExtensionContributes(item.manifest.contributes),
    ...(item.manifest.settingsSchema?.length
      ? {
          settingsSchema: item.manifest.settingsSchema.map((setting) => ({
            key: setting.key,
            type: setting.type,
            title: setting.title,
            ...(setting.description ? { description: setting.description } : {}),
            ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
            ...(setting.required !== undefined ? { required: setting.required } : {}),
            ...(setting.defaultValue !== undefined ? { defaultValue: setting.defaultValue } : {}),
            ...(setting.options?.length
              ? {
                  options: setting.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                    ...(option.description ? { description: option.description } : {}),
                  })),
                }
              : {}),
          })),
        }
      : {}),
    ...(item.manifest.secretSlots?.length
      ? {
          secretSlots: item.manifest.secretSlots.map((slot) => ({
            key: slot.key,
            title: slot.title,
            ...(slot.description ? { description: slot.description } : {}),
            ...(slot.required !== undefined ? { required: slot.required } : {}),
          })),
        }
      : {}),
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
    ...(item.installSource ? { installSource: item.installSource } : {}),
    installedAtUnixMs: item.installedAtUnixMs,
  } as unknown as JsonObject;
}

export async function serializeListedHostExtension(
  item: HostInstalledExtension,
): Promise<JsonObject> {
  const summary = await summarizeDeclaredExtensionContributionPoints(item);
  return {
    ...serializeHostExtension(item),
    ...(summary ? { instructionContributions: summary as unknown as JsonValue } : {}),
  };
}

export async function serializeListedMarketplaceCatalogItem(
  item: HostMarketplaceCatalogItem,
): Promise<JsonObject> {
  return {
    ...(await serializeListedHostExtension(item)),
    installed: item.installed,
  };
}

export function serializeMarketplaceSource(record: MarketplaceSourceRecord): JsonObject {
  return {
    id: record.id,
    name: record.name,
    displayName: record.displayName,
    kind: record.kind,
    locator: record.locator,
    ...(record.ref ? { ref: record.ref } : {}),
    addedAtUnixMs: record.addedAtUnixMs,
    internal: record.id === "built-in" || record.id === "personal",
  };
}

/** Multi-source catalog row: registry entry fields plus install state. */
export function serializeMarketplaceCatalogItem(item: MarketplaceCatalogItem): JsonObject {
  const { entry } = item;
  return {
    id: `${item.source.id}/${entry.name}`,
    sourceId: item.source.id,
    sourceName: item.source.name,
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    version: entry.version,
    ...(entry.author
      ? {
          author: {
            name: entry.author.name,
            ...(entry.author.email ? { email: entry.author.email } : {}),
            ...(entry.author.url ? { url: entry.author.url } : {}),
          },
        }
      : {}),
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.keywords?.length ? { keywords: [...entry.keywords] } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(entry.featured !== undefined ? { featured: entry.featured } : {}),
    reviewStatus: entry.reviewStatus,
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    supportedHosts: [...entry.manifest.supportedHosts],
    ...(entry.manifest.activationEvents?.length
      ? { activationEvents: [...entry.manifest.activationEvents] }
      : {}),
    ...(entry.manifest.requestedCapabilities?.length
      ? { requestedCapabilities: [...entry.manifest.requestedCapabilities] }
      : {}),
    ...(entry.manifest.contributes
      ? { contributes: entry.manifest.contributes as unknown as JsonValue }
      : {}),
    ...(entry.manifest.settingsSchema?.length
      ? { settingsSchema: entry.manifest.settingsSchema as unknown as JsonValue }
      : {}),
    ...(entry.manifest.secretSlots?.length
      ? { secretSlots: entry.manifest.secretSlots as unknown as JsonValue }
      : {}),
    installed: item.installed,
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(item.installedVersion ? { installedVersion: item.installedVersion } : {}),
    updateAvailable: item.updateAvailable,
  } as unknown as JsonObject;
}

export type { JsonValue };
