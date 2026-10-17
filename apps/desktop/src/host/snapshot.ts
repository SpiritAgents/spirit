import type {
  ActiveSessionSnapshot,
  ConversationSnapshot,
  DesktopAutomationListItem,
  DesktopDreamCollectorSnapshot,
  DesktopExtensionCssLayer,
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogEntry,
  DesktopMarketplaceSource,
  DesktopHookListItem,
  DesktopGitSnapshot,
  DesktopMcpServerListItem,
  DesktopExtensionSkillSlashItem,
  WorkspaceContentInvalidation,
  DesktopModelCatalogHint,
  DesktopSnapshot,
  McpStatusSnapshot,
} from "../types.js";
import type { ProviderEntry } from "@spiritagent/host-internal";

import { readModelCatalogCacheSync } from "./model-catalog-cache.js";
import { flattenProviders } from "./model-config-access.js";
import {
  normalizeAgentsConfig,
  normalizeWorkspaceBinding,
  type DesktopConfigFile,
  type HostMetadataSummary,
} from "./storage.js";
import { parseTranslucencyPreference } from "../lib/translucency.js";
import { buildAvailableWorkspaces, buildWebHostSnapshot } from "./service-utils.js";
import { resolveDesktopHomeDirectory } from "./storage.js";
import type { DesktopLspSnapshot } from "../types.js";

function isSettingsInstructionScope<T extends { source: { scope: string } }>(
  entry: T,
): entry is T & { source: { scope: "workspace" | "user" } } {
  return entry.source.scope === "workspace" || entry.source.scope === "user";
}

export interface BuildDesktopSnapshotInput {
  workspaceRoot: string;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  workspaceContentInvalidation?: WorkspaceContentInvalidation;
  metadata: HostMetadataSummary;
  plan: DesktopSnapshot["plan"];
  extensionsList: DesktopExtensionListItem[];
  marketplaceSources?: DesktopMarketplaceSource[];
  marketplaceCatalogs?: Record<string, DesktopMarketplaceCatalogEntry[]>;
  marketplaceCatalogAll?: DesktopMarketplaceCatalogEntry[];
  marketplaceWarnings?: string[];
  extensionCss: DesktopExtensionCssLayer[];
  extensionSkills?: DesktopExtensionSkillSlashItem[];
  extensionsLoading?: boolean;
  dreamCollectorStatus: DesktopDreamCollectorSnapshot;
  runtimeReady: boolean;
  runtimeError?: string;
  modelKeyPresence: Record<string, boolean>;
  activeApiKeyConfigured: boolean;
  mcpStatus: McpStatusSnapshot;
  mcpServers: DesktopMcpServerListItem[];
  hooksList: DesktopHookListItem[];
  lsp: DesktopLspSnapshot;
  conversation: ConversationSnapshot;
  activeSession?: ActiveSessionSnapshot;
  composerSessionKey: string;
  subagentViewer?: DesktopSnapshot["subagentViewer"];
  automationsList: DesktopAutomationListItem[];
  paneSessions?: DesktopSnapshot["paneSessions"];
  pendingWorkspaceCapabilityTrust?: DesktopSnapshot["pendingWorkspaceCapabilityTrust"];
  pendingExtensionUi?: DesktopSnapshot["pendingExtensionUi"];
}

/** Renderer-facing provider entries: credential channels never cross the IPC boundary. */
function snapshotProviders(config: DesktopConfigFile): DesktopSnapshot["config"]["providers"] {
  return config.providers.map((provider) => {
    const entry: Partial<ProviderEntry> = {
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
    };
    delete entry.apiKey;
    delete entry.apiKeyEnv;
    delete entry.apiKeyKeyring;
    delete entry.credentials;
    return entry as DesktopSnapshot["config"]["providers"][number];
  });
}

export function buildDesktopSnapshot(input: BuildDesktopSnapshotInput): DesktopSnapshot {
  const flattenedModels = flattenProviders(input.config);
  const agents = normalizeAgentsConfig(input.config.agents);

  return {
    workspaceRoot: input.workspaceRoot,
    userHomeDirectory: resolveDesktopHomeDirectory(),
    workspaceBinding: normalizeWorkspaceBinding(input.config.workspaceBinding),
    availableWorkspaces: buildAvailableWorkspaces(
      input.workspaceRoot,
      input.config.recentWorkspaces,
      normalizeWorkspaceBinding(input.config.workspaceBinding),
    ),
    git: { ...input.git },
    ...(input.workspaceContentInvalidation
      ? { workspaceContentInvalidation: { ...input.workspaceContentInvalidation } }
      : {}),
    dreams: {
      settings: {
        enabled: input.config.dreams.enabled === true,
        debugMode: input.config.dreams.debugMode === true,
      },
      collector: { ...input.dreamCollectorStatus },
    },
    runtimeReady: input.runtimeReady,
    ...(input.runtimeError ? { runtimeError: input.runtimeError } : {}),
    config: {
      providers: snapshotProviders(input.config),
      models: flattenedModels.map((model) => ({
        ...model,
        keyConfigured: input.modelKeyPresence[model.name] ?? false,
      })),
      activeModel: input.config.activeModel,
      ...(input.config.imageGenerationModel
        ? { imageGenerationModel: input.config.imageGenerationModel }
        : {}),
      ...(input.config.videoGenerationModel
        ? { videoGenerationModel: input.config.videoGenerationModel }
        : {}),
      ...(input.config.secondaryLanguageModel
        ? { secondaryLanguageModel: input.config.secondaryLanguageModel }
        : {}),
      ...(input.config.uiLocale ? { uiLocale: input.config.uiLocale } : {}),
      activeApiKeyConfigured: input.activeApiKeyConfigured,
      translucency: parseTranslucencyPreference(input.config.translucency),
      systemNotifications: input.config.systemNotifications !== false,
      trayIcon: input.config.trayIcon !== false,
      onboardingCompleted: input.config.onboardingCompleted === true,
      agentMode: input.config.agentMode ?? "agent",
      modelCatalogHints: buildModelCatalogHints(input.config),
      networks: {
        llmHttpVersion: input.config.networks.llmHttpVersion,
      },
    },
    webHost: buildWebHostSnapshot(input.config.webHost),
    rules: {
      discovered: input.metadata.rules.discovered,
      enabled: input.metadata.rules.enabled,
    },
    skills: {
      discovered: input.metadata.skills.discovered,
      enabled: input.metadata.skills.enabled,
    },
    rulesList: input.metadata.rules.entries.filter(isSettingsInstructionScope).map((entry) => ({
      id: entry.source.id,
      title: entry.source.title,
      shortLabel: entry.source.shortLabel,
      scope: entry.source.scope,
      rootKind: entry.source.rootKind,
      exists: entry.exists,
      enabled: entry.enabled,
      ...(entry.preview
        ? {
            previewExcerpt: entry.preview.excerpt,
            previewTruncated: entry.preview.truncated,
          }
        : {}),
    })),
    skillsList: input.metadata.skills.entries.filter(isSettingsInstructionScope).map((entry) => ({
      id: entry.source.id,
      name: entry.source.name,
      description: entry.source.description,
      shortLabel: entry.source.shortLabel,
      scope: entry.source.scope,
      rootKind: entry.source.rootKind,
      enabled: entry.enabled,
      path: entry.source.path,
    })),
    extensionSkills: (input.extensionSkills ?? []).map((skill) => ({ ...skill })),
    extensionsList: input.extensionsList.map((item) => ({ ...item })),
    marketplaceSources: (input.marketplaceSources ?? []).map((item) => ({ ...item })),
    marketplaceCatalogs: Object.fromEntries(
      Object.entries(input.marketplaceCatalogs ?? {}).map(([sourceId, items]) => [
        sourceId,
        items.map((item) => ({ ...item })),
      ]),
    ),
    marketplaceCatalogAll: (input.marketplaceCatalogAll ?? []).map((item) => ({ ...item })),
    ...(input.marketplaceWarnings?.length
      ? { marketplaceWarnings: [...input.marketplaceWarnings] }
      : {}),
    extensionCss: input.extensionCss.map((entry) => ({ ...entry })),
    ...(input.extensionsLoading ? { extensionsLoading: true } : {}),
    plan: { ...input.plan },
    mcpStatus: input.mcpStatus,
    mcpServers: input.mcpServers,
    hooksList: input.hooksList,
    lsp: input.lsp,
    codeCompletion: {
      userEnabled: agents.codeCompletion.enabled,
    },
    attribution: {
      commitEnabled: agents.attribution.commit.enabled,
      prEnabled: agents.attribution.pr.enabled,
    },
    webToolExposure: {
      providerToolsEnabled: agents.providerTools.enabled,
      webFetchEnabled: agents.webFetch.enabled,
    },
    conversation: input.conversation,
    ...(input.paneSessions ? { paneSessions: input.paneSessions } : {}),
    ...(input.activeSession ? { activeSession: { ...input.activeSession } } : {}),
    composerSessionKey: input.composerSessionKey,
    ...(input.subagentViewer ? { subagentViewer: input.subagentViewer } : {}),
    automationsList: input.automationsList.map((item) => ({ ...item })),
    ...(input.pendingWorkspaceCapabilityTrust
      ? { pendingWorkspaceCapabilityTrust: input.pendingWorkspaceCapabilityTrust }
      : {}),
    ...(input.pendingExtensionUi ? { pendingExtensionUi: input.pendingExtensionUi } : {}),
  };
}

/** buildSnapshot / context usage are called at high frequency; the catalog cache file only changes after writeModelCatalogCache, so memoize in memory by the provider key set. */
let modelCatalogHintsMemo: { key: string; hints: DesktopModelCatalogHint[] } | undefined;

export function invalidateModelCatalogHintsMemo(): void {
  modelCatalogHintsMemo = undefined;
}

export function buildModelCatalogHints(config: DesktopConfigFile): DesktopModelCatalogHint[] {
  const memoKey = config.providers
    .map((provider) => `${provider.id}::${provider.apiBase}`)
    .join("\n");
  if (modelCatalogHintsMemo?.key === memoKey) {
    return modelCatalogHintsMemo.hints;
  }
  const hints: DesktopModelCatalogHint[] = [];
  for (const provider of config.providers) {
    const hit = readModelCatalogCacheSync(provider.apiBase, provider.id);
    if (hit && hit.modelIds.length > 0) {
      hints.push({
        providerId: provider.id,
        apiBase: hit.apiBase,
        modelIds: hit.modelIds,
        ...(hit.modelCatalog ? { modelCatalog: hit.modelCatalog } : {}),
        fetchedAtUnixMs: hit.fetchedAtUnixMs,
      });
    }
  }
  modelCatalogHintsMemo = { key: memoKey, hints };
  return hints;
}
