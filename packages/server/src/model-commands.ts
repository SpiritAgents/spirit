import { listProviderPresets } from "@spiritagent/agent-core/provider-presets";
import type { DesktopSnapshot } from "@spiritagent/api/types";
import {
  KEYRING_SERVICE,
  keyringStore,
  providerInternalSlotAccount,
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
import { loadConfig, loadHostMetadata } from "@spiritagent/sessions/host/storage";

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
): Promise<unknown> {
  if (method === "host.getConfig") {
    return loadConfig();
  }
  if (method === "host.listProviderPresets") {
    return listProviderPresets();
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
