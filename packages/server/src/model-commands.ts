import { listProviderPresets } from "@spiritagent/agent-core/provider-presets";
import { buildFormattedDisplayTitlesFromIds } from "@spiritagent/agent-core/model-catalog/id-display-title";
import type { DesktopSnapshot } from "@spiritagent/api/types";
import {
  KEYRING_SERVICE,
  keyringStore,
  providerInternalSlotAccount,
  resolveProviderApiKeyResolution,
} from "@spiritagent/config/credentials";
import {
  addModelCommand,
  addProviderModelsCommand,
  previewModelsCommand,
  removeModelCommand,
  removeProviderGroupCommand,
  removeProviderModelsCommand,
  updateConfigCommand,
  type HostModelCommandContext,
} from "@spiritagent/sessions/host/host-model-commands";
import {
  loadConfig,
  loadHostMetadata,
  runWithSpiritDataDir,
} from "@spiritagent/sessions/host/storage";
import { saveConfig } from "@spiritagent/sessions/host/storage";
import { buildModelCatalogHints } from "@spiritagent/sessions/host/model-config";
import { assertSpiritConfigSchemaVersion, validateSpiritConfig } from "@spiritagent/config";

function modelContext(): HostModelCommandContext {
  return {
    runSerialized: (work) => work(),
    ensureInitialized: async () => {},
    requireState: () => {
      throw new Error("Model command state has not been initialized.");
    },
    activeBundle: () => ({ deferredRuntimeRefreshWhileBusy: false }),
    isRuntimeBusy: () => false,
    refreshRuntime: async () => {},
    refreshActiveModelTransportConfig: async () => {},
    refreshModelKeyPresence: async () => {},
    flushDeferredRuntimeRefreshIfIdle: async () => {},
    persistCurrentSessionIfNeeded: async () => {},
    clearActiveContextUsage: () => {},
    setLastRuntimeError: () => {},
    buildSnapshot: () => ({}) as DesktopSnapshot,
    disposeAllLspServices: async () => {},
    invalidateToolExecutors: () => {},
    applyWebToolExposureToRuntimes: async () => {},
    refreshLspSnapshot: async () => {},
  };
}

export async function executeHostModelCommand(
  method: string,
  params: Record<string, unknown>,
  spiritDataDir: string,
): Promise<unknown> {
  return runWithSpiritDataDir(spiritDataDir, () => executeHostModelCommandInScope(method, params));
}

async function executeHostModelCommandInScope(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (method === "host.getConfig") {
    return loadConfig();
  }
  if (method === "host.validateConfig") {
    const config = params["config"];
    assertSpiritConfigSchemaVersion(config);
    validateSpiritConfig(config);
    return { ok: true };
  }
  if (method === "host.replaceConfig") {
    await saveConfig(params["config"] as never);
    return loadConfig();
  }
  if (method === "host.listProviderPresets") {
    return listProviderPresets();
  }
  if (method === "host.buildModelDisplayTitles") {
    const profiles = (params["profiles"] as Array<Record<string, unknown>>) ?? [];
    const hints = buildModelCatalogHints(await loadConfig());
    const titles: Record<string, string> = {};
    const idsToFormat: string[] = [];
    for (const profile of profiles) {
      const providerId = String(profile["providerId"] ?? "");
      const apiBase = String(profile["apiBase"] ?? "");
      const name = String(profile["name"] ?? "");
      const catalog = hints.find(
        (hint) => hint.providerId === providerId && hint.apiBase === apiBase,
      )?.modelCatalog;
      const displayName = catalog?.find((entry) => entry.id === name)?.displayName?.trim();
      if (displayName && displayName !== name) {
        titles[name] = displayName;
      } else if (!name.includes("/")) {
        idsToFormat.push(name);
      }
    }
    return { ...titles, ...buildFormattedDisplayTitlesFromIds(idsToFormat) };
  }
  if (method === "host.hasProviderCredential") {
    const provider = params["provider"] as Record<string, unknown>;
    return (
      resolveProviderApiKeyResolution({
        id: String(provider["id"] ?? provider["providerId"] ?? ""),
        apiKey: (provider["apiKey"] ?? undefined) as never,
        apiKeyEnv: (provider["apiKeyEnv"] ?? undefined) as never,
        apiKeyKeyring: (provider["apiKeyKeyring"] ?? undefined) as never,
        credentials: (provider["credentials"] ?? undefined) as never,
      }).value !== undefined
    );
  }
  if (method === "host.readKeyringSecret") {
    return {
      value: keyringStore().getPassword(
        String(params["service"] ?? ""),
        String(params["account"] ?? ""),
      ),
    };
  }
  if (method === "host.writeKeyringSecret" || method === "host.deleteKeyringSecret") {
    const service = String(params["service"] ?? "");
    const account = String(params["account"] ?? "");
    if (method === "host.deleteKeyringSecret") {
      keyringStore().deletePassword(service, account);
    } else {
      keyringStore().setPassword(service, account, String(params["value"] ?? ""));
    }
    return null;
  }
  if (method === "host.previewModels") {
    return previewModelsCommand(params["request"] as never);
  }
  if (method === "host.writeProviderSecret" || method === "host.deleteProviderSecret") {
    const providerId = String(params["providerId"] ?? "").trim();
    const slot = String(params["slot"] ?? "apiKey").trim() || "apiKey";
    if (!providerId) {
      throw new Error("missing providerId");
    }
    const account = providerInternalSlotAccount(providerId, slot);
    if (method === "host.deleteProviderSecret") {
      keyringStore().deletePassword(KEYRING_SERVICE, account);
    } else {
      keyringStore().setPassword(KEYRING_SERVICE, account, String(params["value"] ?? "").trim());
    }
    return null;
  }

  const workspaceRoot = String(params["workspaceRoot"] ?? "").trim();
  if (!workspaceRoot) {
    throw new Error("missing workspaceRoot");
  }
  const context = await createInitializedModelContext(workspaceRoot);
  const request = params["request"] as never;
  switch (method) {
    case "host.updateConfig":
      await updateConfigCommand(context, request);
      break;
    case "host.addModel":
      await addModelCommand(context, request);
      break;
    case "host.addProviderModels":
      await addProviderModelsCommand(context, request);
      break;
    case "host.removeModel":
      await removeModelCommand(context, request);
      break;
    case "host.removeProviderModels":
      await removeProviderModelsCommand(context, request);
      break;
    case "host.removeProviderGroup":
      await removeProviderGroupCommand(context, request);
      break;
    default:
      throw new Error(`unknown model command: ${method}`);
  }
  return loadConfig();
}

async function createInitializedModelContext(
  workspaceRoot: string,
): Promise<HostModelCommandContext> {
  const [config, metadata] = await Promise.all([loadConfig(), loadHostMetadata(workspaceRoot)]);
  const context = modelContext();
  context.requireState = () => ({ workspaceRoot, workspaceBinding: "project", config, metadata });
  context.activeBundle = () => ({
    deferredRuntimeRefreshWhileBusy: false,
    activeModel: config.activeModel,
  });
  return context;
}
