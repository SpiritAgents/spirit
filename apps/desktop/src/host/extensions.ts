import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildContributedHostToolDefinitions,
  mergeEnabledExtensionSystemPrompts,
  type JsonObject,
  type JsonValue,
  type OpenAiExtensionSystemPrompt,
} from "@spiritagent/agent-core";
import {
  buildExtensionDumpFromEntry,
  buildHostExtensionManifestFromDump,
  collectHostExtensionContributedTools,
  extensionExposesModelContext,
  installSourceForSourceId,
  summarizeDeclaredExtensionContributionPoints,
  type HostExtensionDesktopViewDefinition,
  type HostExtensionManager,
  type HostInstalledExtension,
  type HostMarketplaceCatalogItem,
  type MarketplaceCatalogItem,
} from "@spiritagent/host-internal";

import type {
  DesktopExtensionCssLayer,
  DesktopExtensionDesktopView,
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogEntry,
} from "../types.js";

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
        displayName: item.manifest.displayName,
        ...(item.manifest.icon ? { icon: item.manifest.icon } : {}),
        version: item.manifest.version,
        enabled: item.enabled,
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
        ...(item.manifest.contributes?.desktop?.views?.length
          ? { desktopViews: mapDesktopViews(item.manifest.contributes.desktop.views) }
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
              ...(skipLiveState
                ? {}
                : { settingsValues: await manager.getSettingsValues(item.id) }),
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

/**
 * Map host-internal catalog rows to renderer entries. Icons from local/git
 * registries are read into data URLs (the renderer cannot fetch file paths);
 * index direct-links keep their https URL. Contribution summaries are computed
 * when the content is locally readable (installed, or a local/git registry).
 */
export async function buildDesktopMarketplaceCatalogEntries(
  items: readonly MarketplaceCatalogItem[],
): Promise<DesktopMarketplaceCatalogEntry[]> {
  return Promise.all(
    items.map(async (item) => {
      const { entry, source } = item;
      const manifest = await buildHostExtensionManifestFromDump(
        buildExtensionDumpFromEntry(entry, source.id),
        item.contentDir,
      );

      let instructionContributions: DesktopMarketplaceCatalogEntry["instructionContributions"];
      if (item.contentDir) {
        const summary = await summarizeDeclaredExtensionContributionPoints({
          id: `${source.id}/${entry.name}`,
          sourceId: source.id,
          relativePath: `${source.id}/${entry.name}`,
          manifest,
          directoryPath: item.contentDir,
          manifestPath: "",
          installedAtUnixMs: 0,
          enabled: true,
          installSource: installSourceForSourceId(source.id),
        });
        instructionContributions = summary
          ? {
              ...(summary.mcp?.length ? { mcp: summary.mcp } : {}),
              ...(summary.hooks?.length ? { hooks: summary.hooks } : {}),
              ...(summary.skills?.length ? { skills: summary.skills } : {}),
              ...(summary.rules ? { rules: summary.rules } : {}),
            }
          : undefined;
      }

      let iconUrl = item.iconUrl;
      if (iconUrl && !/^https?:\/\//u.test(iconUrl)) {
        try {
          const bytes = await readFile(iconUrl);
          iconUrl = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
        } catch {
          iconUrl = undefined;
        }
      }

      return {
        id: `${source.id}/${entry.name}`,
        sourceId: source.id,
        sourceName: source.name,
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
        artifactKind: typeof entry.source === "string" ? "local" : "npm",
        ...(iconUrl ? { iconUrl } : {}),
        supportedHosts: [...manifest.supportedHosts],
        ...(manifest.activationEvents?.length
          ? { activationEvents: [...manifest.activationEvents] }
          : {}),
        ...(manifest.requestedCapabilities?.length
          ? { requestedCapabilities: [...manifest.requestedCapabilities] }
          : {}),
        ...(manifest.contributes?.tools?.length
          ? {
              contributedTools: manifest.contributes.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
                ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
              })),
            }
          : {}),
        ...(manifest.contributes?.desktop?.css?.length
          ? {
              desktopCss: manifest.contributes.desktop.css.map((css) => ({
                path: css.path,
                ...(css.media ? { media: css.media } : {}),
              })),
            }
          : {}),
        ...(manifest.contributes?.desktop?.settingsPage
          ? {
              desktopSettingsPage: manifest.contributes.desktop.settingsPage.title
                ? { title: manifest.contributes.desktop.settingsPage.title }
                : {},
            }
          : {}),
        ...(manifest.contributes?.desktop?.views?.length
          ? { desktopViews: mapDesktopViews(manifest.contributes.desktop.views) }
          : {}),
        ...(manifest.contributes?.cli?.hooks?.length
          ? {
              cliHooks: manifest.contributes.cli.hooks.map((hook) => ({
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
        installed: item.installed,
        ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
        ...(item.installedVersion ? { installedVersion: item.installedVersion } : {}),
        updateAvailable: item.updateAvailable,
      } satisfies DesktopMarketplaceCatalogEntry;
    }),
  );
}

function mapDesktopViews(
  views: readonly HostExtensionDesktopViewDefinition[],
): DesktopExtensionDesktopView[] {
  return views.map((view) => ({
    id: view.id,
    path: view.path,
    ...(view.title ? { title: view.title } : {}),
    ...(view.width === undefined ? {} : { width: view.width }),
    ...(view.height === undefined ? {} : { height: view.height }),
  }));
}

export async function resolveEnabledExtensionViewOwner(
  manager: HostExtensionManager,
  viewId: string,
): Promise<{ extensionId: string; title?: string; width?: number; height?: number } | null> {
  const listed = await manager.list();
  const matches = listed.flatMap((item) => {
    if (!item.enabled) {
      return [];
    }
    const view = item.manifest.contributes?.desktop?.views?.find((entry) => entry.id === viewId);
    return view ? [{ extensionId: item.id, view }] : [];
  });
  if (matches.length !== 1) {
    return null;
  }
  const match = matches[0];
  return {
    extensionId: match.extensionId,
    ...(match.view.title ? { title: match.view.title } : {}),
    ...(match.view.width === undefined ? {} : { width: match.view.width }),
    ...(match.view.height === undefined ? {} : { height: match.view.height }),
  };
}

export async function resolveEnabledExtensionViewFile(
  manager: HostExtensionManager,
  extensionId: string,
  viewId: string,
): Promise<{ filePath: string; extensionRoot: string } | null> {
  const listed = await manager.list();
  const item = listed.find((entry) => entry.id === extensionId && entry.enabled);
  const view = item?.manifest.contributes?.desktop?.views?.find((entry) => entry.id === viewId);
  if (!item || !view) {
    return null;
  }
  return {
    filePath: path.join(item.directoryPath, ...view.path.split("/")),
    extensionRoot: item.directoryPath,
  };
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
          extensionName: item.manifest.displayName,
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
  const [installed, collected] = await Promise.all([
    manager.list(),
    manager.collectSystemPromptContributions({
      host,
      logger: console,
    }),
  ]);
  return mergeEnabledExtensionSystemPrompts(
    installed
      .filter((item) => extensionExposesModelContext(item))
      .map((item) => ({
        extensionId: item.id,
        extensionName: item.manifest.displayName,
        enabled: item.enabled,
      })),
    collected.map((entry) => ({
      extensionId: entry.extensionId,
      extensionName: entry.extensionName,
      content: entry.content,
    })),
  );
}
