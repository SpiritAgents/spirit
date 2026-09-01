import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildContributedHostToolDefinitions,
  type JsonObject,
  type JsonValue,
  type OpenAiExtensionSystemPrompt,
} from "@spiritagent/agent-core";
import {
  collectHostExtensionContributedTools,
  summarizeDeclaredExtensionContributionPoints,
  type HostExtensionManager,
  type HostInstalledExtension,
  type HostMarketplaceCatalogItem,
} from "@spiritagent/host-internal";

import type { DesktopExtensionCssLayer, DesktopExtensionListItem } from "../types.js";

export function buildDesktopExtensionToolDefinitions(
  extensions: readonly HostInstalledExtension[],
): JsonValue[] {
  return buildContributedHostToolDefinitions(
    collectHostExtensionContributedTools(extensions).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as JsonObject,
    })),
  );
}

export async function buildDesktopExtensionListItems(
  manager: HostExtensionManager,
  extensions: readonly HostInstalledExtension[],
  options?: { metadataOnly?: boolean },
): Promise<DesktopExtensionListItem[]> {
  const metadataOnly = options?.metadataOnly === true;
  return Promise.all(
    extensions.map(async (item) => {
      const catalogInstalled = isMarketplaceCatalogInstalled(item);
      const skipLiveState = metadataOnly || !catalogInstalled;
      const instructionContributions = await summarizeDeclaredExtensionContributionPoints(item);
      return {
        id: item.id,
        displayName: item.manifest.name,
        ...(item.manifest.icon ? { icon: item.manifest.icon } : {}),
        version: item.manifest.version,
        enabled: item.enabled,
        ...(item.manifest.description ? { description: item.manifest.description } : {}),
        ...(item.manifest.author ? { author: item.manifest.author } : {}),
        ...(item.manifest.homepage ? { homepage: item.manifest.homepage } : {}),
        ...(item.manifest.main ? { main: item.manifest.main } : {}),
        supportedHosts: [...item.manifest.supportedHosts],
        ...(item.manifest.activationEvents?.length
          ? { activationEvents: [...item.manifest.activationEvents] }
          : {}),
        ...(item.manifest.requestedCapabilities?.length
          ? { requestedCapabilities: [...item.manifest.requestedCapabilities] }
          : {}),
        ...(item.manifest.contributes?.tools?.length
          ? {
              contributedTools: item.manifest.contributes.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
                ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
              })),
            }
          : {}),
        ...(item.manifest.contributes?.desktop?.css?.length
          ? {
              desktopCss: item.manifest.contributes.desktop.css.map((entry) => ({
                path: entry.path,
                ...(entry.media ? { media: entry.media } : {}),
              })),
            }
          : {}),
        ...(item.manifest.contributes?.desktop?.settingsPage
          ? {
              desktopSettingsPage: item.manifest.contributes.desktop.settingsPage.title
                ? { title: item.manifest.contributes.desktop.settingsPage.title }
                : {},
            }
          : {}),
        ...(item.manifest.contributes?.cli?.hooks?.length
          ? {
              cliHooks: item.manifest.contributes.cli.hooks.map((hook) => ({
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
            }
          : {}),
        ...(instructionContributions ? { instructionContributions } : {}),
        ...(item.manifest.settingsSchema?.length
          ? {
              settingsSchema: item.manifest.settingsSchema.map((setting) => ({
                key: setting.key,
                type: setting.type,
                title: setting.title,
                ...(setting.description ? { description: setting.description } : {}),
                ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
                ...(setting.required !== undefined ? { required: setting.required } : {}),
                ...(setting.defaultValue !== undefined
                  ? { defaultValue: setting.defaultValue }
                  : {}),
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
              ...(skipLiveState ? {} : { settingsValues: await manager.getSettingsValues(item.id) }),
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
              ...(skipLiveState
                ? {}
                : {
                    secretStatuses: Object.entries(await manager.getSecretStatus(item.id)).map(
                      ([key, configured]) => ({
                        key,
                        configured,
                      }),
                    ),
                  }),
            }
          : {}),
        ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
        ...(item.installSource ? { installSource: item.installSource } : {}),
        installed: catalogInstalled,
        ...(catalogInstalled ? { installedAtUnixMs: item.installedAtUnixMs } : {}),
      };
    }),
  );
}

function isMarketplaceCatalogInstalled(item: HostInstalledExtension): boolean {
  if (!("installed" in item)) {
    return true;
  }
  return (item as HostMarketplaceCatalogItem).installed;
}

export async function collectDesktopExtensionCssLayers(
  extensions: readonly HostInstalledExtension[],
): Promise<DesktopExtensionCssLayer[]> {
  const layers: DesktopExtensionCssLayer[] = [];

  for (const item of extensions) {
    if (!item.enabled) {
      continue;
    }
    const cssEntries = item.manifest.contributes?.desktop?.css ?? [];
    for (const entry of cssEntries) {
      const sourcePath = path.join(item.directoryPath, ...entry.path.split("/"));
      try {
        const cssText = await readFile(sourcePath, "utf8");
        if (!cssText.trim()) {
          continue;
        }
        layers.push({
          extensionId: item.id,
          extensionName: item.manifest.name,
          sourcePath: entry.path,
          cssText,
          ...(entry.media ? { media: entry.media } : {}),
        });
      } catch (error) {
        console.warn(`[desktop-host][extensions] read css failed: ${item.id}:${entry.path}`, error);
      }
    }
  }

  return layers;
}

export async function collectExtensionSystemPrompts(
  manager: HostExtensionManager,
  host: unknown,
): Promise<OpenAiExtensionSystemPrompt[]> {
  const collected = await manager.collectSystemPromptContributions({
    host,
    logger: console,
  });
  return collected.map((entry) => ({
    extensionId: entry.extensionId,
    extensionName: entry.extensionName,
    content: entry.content,
  }));
}
