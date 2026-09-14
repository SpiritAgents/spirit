import {
  defaultPresetProviderGroupId,
  isEmptyModelRef,
  modelRefKey,
  modelRefsEqual,
  parseModelProviderId,
  parsePresetModelProviderId,
  slugifyProviderGroupLabel,
  type ModelEntryV2,
  type ModelRef,
  type ProviderGroupV2,
} from "@spiritagent/host-internal";
import {
  defaultModelReasoningEffort,
  resolveModelReasoningEffortForContext,
  resolveModelReasoningMode,
  type ModelReasoningEffort,
} from "@spiritagent/agent-core/reasoning-effort";
import { shouldPinReasoningEffortToDefault } from "@spiritagent/agent-core/model-thinking-controls";

import { resolveDesktopAgentMode } from "../lib/agent-mode.js";
import { parseTranslucencyPreference } from "../lib/translucency.js";
import { parseModelContextLength } from "../lib/context-usage.js";
import i18n from "../lib/i18n-host.js";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopAlibabaBillingMode,
  DesktopGlmCodingPlanBillingMode,
  DesktopStepfunBillingMode,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopProviderConnectSiteId,
  DesktopSnapshot,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelsRequest,
  PreviewModelsResponse,
  RemoveModelRequest,
  RemoveProviderGroupRequest,
  RemoveProviderModelsRequest,
  UpdateConfigRequest,
} from "../types.js";
import {
  syncExistingModelsFromCatalog,
  removeDelistedModelsFromCatalog,
} from "./model-catalog-startup-refresh.js";
import {
  defaultApiBaseForTransport,
  findCatalogEntryForModel,
  loadPreviewModelsForTransport,
  previewCatalogMapForAddProviderRequest,
  reasoningProviderForTransport,
  resolveAddedModelCapabilities,
  resolveDesktopTransportKind,
  resolveProfileApiBase,
} from "./model-config.js";
import {
  bedrockApiBaseFromRegion,
  azureApiBaseFromResourceName,
  cloudflareAiGatewayApiBaseFromAccountId,
  isValidAzureResourceName,
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
  vertexApiBaseFromProjectAndLocation,
} from "@spiritagent/host-internal";
import {
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
} from "./provider-presets.js";
import {
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
} from "@spiritagent/host-internal/bedrock-mantle";
import { modelSupportsChat } from "./lightweight-chat-model.js";
import {
  applyModelsRemovalToConfig,
  filterNewGroupModelIds,
  type ModelRemovalTarget,
} from "./provider-api-key.js";
import {
  flattenProviderGroups,
  findProviderGroup,
  modelExistsInGroup,
  modelSupportsImageGeneration,
  modelSupportsVideoGeneration,
  normalizeSlotModelRef,
  resolveModelProfile,
} from "./model-config-access.js";
import {
  loadHostMetadata,
  normalizeDreamConfig,
  normalizeAgentsConfig,
  normalizeNetworksConfig,
  applyLlmClientVersionFromApp,
  applyLlmHttpVersionFromConfig,
  normalizeModelCapabilities,
  normalizeWebHostConfig,
  removeBedrockProviderCredentials,
  removeGoogleVertexProviderCredentials,
  removeModelApiKey,
  removeProviderApiKey,
  saveApiKeyForModel,
  saveApiKeyForProvider,
  saveBedrockProviderCredentialsForProvider,
  saveGoogleVertexProviderCredentialsForProvider,
  saveConfig,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from "./storage.js";
import {
  hasBedrockIamCredentials,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from "./provider-api-key.js";
import { currentApiBase } from "./service-utils.js";

interface HostModelState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  metadata: HostMetadataSummary;
}

interface HostModelBundle {
  activePlanPath?: string;
  activeModel?: ModelRef;
  deferredRuntimeRefreshWhileBusy: boolean;
}

export interface HostModelCommandContext {
  runSerialized<T>(work: () => Promise<T>, label?: string): Promise<T>;
  ensureInitialized(options?: { fastPath?: boolean }): Promise<void>;
  requireState(): HostModelState;
  activeBundle(): HostModelBundle;
  isRuntimeBusy(): boolean;
  refreshRuntime(): Promise<void>;
  refreshActiveModelTransportConfig(): Promise<void>;
  refreshModelKeyPresence(): Promise<void>;
  flushDeferredRuntimeRefreshIfIdle(): Promise<void>;
  persistCurrentSessionIfNeeded(): Promise<void>;
  clearActiveContextUsage(): void;
  setLastRuntimeError(error: string): void;
  buildSnapshot(): DesktopSnapshot;
  disposeAllLspServices(): Promise<void>;
  invalidateToolExecutors(): void;
  refreshLspSnapshot(): Promise<void>;
}

interface ConnectRequestFields {
  groupId: string;
  provider?: DesktopModelProvider;
  customGroupLabel?: string;
  transportKind?: DesktopTransportKind;
  apiBase: string;
  awsRegion?: string;
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: DesktopAlibabaBillingMode;
  stepfunBillingMode?: DesktopStepfunBillingMode;
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  vertexProject?: string;
  vertexLocation?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
}

interface ModelEntryLocation {
  group: ProviderGroupV2;
  model: ModelEntryV2;
}

function asModelEntryReasoningEffort(value: ModelReasoningEffort): ModelEntryV2["reasoningEffort"] {
  return value as ModelEntryV2["reasoningEffort"];
}

function asModelEntryReasoningMode(
  value: DesktopModelReasoningMode,
): NonNullable<ModelEntryV2["reasoningMode"]> {
  return value;
}

function applyModelReasoningModeToEntry(
  model: ModelEntryV2,
  reasoningMode: DesktopModelReasoningMode | undefined,
  modelContext: Parameters<typeof resolveModelReasoningMode>[1],
): void {
  if (reasoningMode === undefined) {
    return;
  }

  const resolved = resolveModelReasoningMode(reasoningMode, modelContext);
  if (resolved === "pro") {
    model.reasoningMode = asModelEntryReasoningMode("pro");
  } else {
    delete model.reasoningMode;
  }
}

function asModelEntrySupportedReasoningEfforts(
  value: DesktopModelReasoningEffort[],
): NonNullable<ModelEntryV2["supportedReasoningEfforts"]> {
  return value as NonNullable<ModelEntryV2["supportedReasoningEfforts"]>;
}

function resolveConnectGroupId(input: ConnectRequestFields): string {
  const provider = input.provider;
  if (provider === "custom") {
    const label = input.customGroupLabel?.trim();
    if (label) {
      return slugifyProviderGroupLabel(label);
    }
    const groupId = input.groupId?.trim() ?? "";
    if (groupId) {
      return groupId;
    }
    throw new Error(i18n.t("error.modelNameRequired"));
  }
  const explicitGroupId = input.groupId?.trim() ?? "";
  if (explicitGroupId) {
    return explicitGroupId;
  }
  if (provider) {
    return defaultPresetProviderGroupId(provider);
  }
  throw new Error(i18n.t("error.modelNameRequired"));
}

function findModelEntryInConfig(
  config: Pick<DesktopConfigFile, "providerGroups">,
  ref: ModelRef,
): ModelEntryLocation | null {
  const group = findProviderGroup(config, ref.groupId);
  if (!group) {
    return null;
  }
  const model = group.models.find((entry) => entry.name === ref.name.trim());
  if (!model) {
    return null;
  }
  return { group, model };
}

function buildProviderGroupConnect(
  input: ConnectRequestFields & { modelName?: string },
): Omit<ProviderGroupV2, "id" | "models"> {
  const provider = input.provider ?? "custom";
  const transportKind = resolveDesktopTransportKind({
    provider,
    transportKind: input.transportKind,
  });
  const apiBase = resolveManagedConnectApiBase(
    provider,
    transportKind,
    input.apiBase,
    input.awsRegion,
    input.modelName,
    input.vertexProject,
    input.vertexLocation,
    input.azureResourceName,
    input.providerSite,
    input.alibabaWorkspaceId,
    input.alibabaBillingMode,
    input.stepfunBillingMode,
    input.zAiBillingMode,
    input.zhipuBillingMode,
    input.cloudflareAccountId,
  );
  const group: Omit<ProviderGroupV2, "id" | "models"> = {
    provider,
    apiBase,
  };
  const label = input.customGroupLabel?.trim();
  if (provider === "custom") {
    group.label = label || input.groupId?.trim() || defaultPresetProviderGroupId("custom");
  }
  if (
    transportKind === "anthropic" ||
    transportKind === "open-responses" ||
    transportKind === "bedrock"
  ) {
    group.transportKind = transportKind;
  }
  if (provider === "amazon-bedrock" && input.awsRegion?.trim()) {
    group.awsRegion = input.awsRegion.trim();
  }
  if (provider === "azure" && input.azureResourceName?.trim()) {
    group.azureResourceName = input.azureResourceName.trim();
  }
  if (provider === "google-vertex-ai") {
    if (input.vertexProject?.trim()) {
      group.vertexProject = input.vertexProject.trim();
    }
    if (input.vertexLocation?.trim()) {
      group.vertexLocation = input.vertexLocation.trim();
    }
  }
  if (provider === "cloudflare-ai-gateway") {
    if (input.cloudflareAccountId?.trim()) {
      group.cloudflareAccountId = input.cloudflareAccountId.trim();
    }
    if (input.cloudflareGatewayId?.trim()) {
      group.cloudflareGatewayId = input.cloudflareGatewayId.trim();
    }
  }
  applyManagedProviderConnectFields(group, {
    provider,
    providerSite: input.providerSite,
    alibabaWorkspaceId: input.alibabaWorkspaceId,
    alibabaBillingMode: input.alibabaBillingMode,
    stepfunBillingMode: input.stepfunBillingMode,
    zAiBillingMode: input.zAiBillingMode,
    zhipuBillingMode: input.zhipuBillingMode,
  });
  return group;
}

function findOrCreateProviderGroup(
  config: DesktopConfigFile,
  groupId: string,
  connect: Omit<ProviderGroupV2, "id" | "models">,
): ProviderGroupV2 {
  const existing = findProviderGroup(config, groupId);
  if (existing) {
    Object.assign(existing, connect);
    // Object.assign does not delete keys missing from connect; standard billing depends on those fields, so sync once more.
    applyManagedProviderConnectFields(existing, {
      provider: connect.provider,
      providerSite: connect.providerSite,
      alibabaWorkspaceId: connect.alibabaWorkspaceId,
      alibabaBillingMode: connect.alibabaBillingMode,
      stepfunBillingMode: connect.stepfunBillingMode,
      zAiBillingMode: connect.zAiBillingMode,
      zhipuBillingMode: connect.zhipuBillingMode,
    });
    return existing;
  }
  const created: ProviderGroupV2 = {
    id: groupId,
    ...connect,
    models: [],
  };
  config.providerGroups.push(created);
  return created;
}

function existingModelsForGroupAdd(config: DesktopConfigFile) {
  return flattenProviderGroups(config).map((profile) => ({
    groupId: profile.groupId,
    name: profile.name,
    provider: profile.provider,
    ...(profile.vertexProject ? { vertexProject: profile.vertexProject } : {}),
    ...(profile.vertexLocation ? { vertexLocation: profile.vertexLocation } : {}),
  }));
}

async function saveGroupCredentials(
  groupId: string,
  provider: DesktopModelProvider,
  input: {
    apiKey: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    vertexClientEmail?: string;
    vertexPrivateKey?: string;
  },
): Promise<void> {
  if (provider === "amazon-bedrock") {
    await saveBedrockProviderCredentialsForProvider(groupId, {
      apiKey: input.apiKey,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    });
    return;
  }
  if (provider === "google-vertex-ai") {
    await saveGoogleVertexProviderCredentialsForProvider(groupId, {
      apiKey: input.apiKey,
      clientEmail: input.vertexClientEmail,
      privateKey: input.vertexPrivateKey,
    });
    return;
  }
  if (!input.apiKey.trim()) {
    await removeProviderApiKey(groupId);
    return;
  }
  await saveApiKeyForProvider(groupId, input.apiKey);
}

async function clearGroupCredentials(
  groupId: string,
  provider: DesktopModelProvider,
): Promise<void> {
  if (provider === "amazon-bedrock") {
    await saveBedrockProviderCredentialsForProvider(groupId, {});
    return;
  }
  if (provider === "google-vertex-ai") {
    await saveGoogleVertexProviderCredentialsForProvider(groupId, {});
    return;
  }
  await removeProviderApiKey(groupId);
}

async function removeGroupKeyring(groupId: string, provider: DesktopModelProvider): Promise<void> {
  if (provider === "amazon-bedrock") {
    await removeBedrockProviderCredentials(groupId);
    return;
  }
  if (provider === "google-vertex-ai") {
    await removeGoogleVertexProviderCredentials(groupId);
    return;
  }
  await removeProviderApiKey(groupId);
}

export async function updateConfigCommand(
  ctx: HostModelCommandContext,
  request: UpdateConfigRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized({ fastPath: true });
    const state = ctx.requireState();
    const wasBusy = ctx.isRuntimeBusy();
    const prevActiveModel = state.config.activeModel;
    const prevImageGenerationModel = state.config.imageGenerationModel;
    const prevVideoGenerationModel = state.config.videoGenerationModel;
    const prevApiBase = currentApiBase(state.config);
    const prevAgentMode = resolveDesktopAgentMode(state.config);
    const prevLspEnabled = state.config.agents.lsp.enabled;
    const prevActiveModelProfile = resolveModelProfile(state.config, state.config.activeModel);
    const prevActiveModelInference = prevActiveModelProfile
      ? {
          thinkingEnabled: prevActiveModelProfile.thinkingEnabled,
          reasoningEffort: prevActiveModelProfile.reasoningEffort,
          reasoningMode: prevActiveModelProfile.reasoningMode,
        }
      : undefined;

    if (ctx.isRuntimeBusy() && Boolean(request.apiKey?.trim())) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const activeRef = request.activeModel;
    const apiBase = request.apiBase.trim();
    const reasoningEffort = request.reasoningEffort;
    const reasoningMode = request.reasoningMode;
    const thinkingEnabled = request.thinkingEnabled;
    let activeEntry: ModelEntryLocation | null = null;
    if (!isEmptyModelRef(activeRef)) {
      activeEntry = findModelEntryInConfig(state.config, activeRef);
      if (!activeEntry) {
        throw new Error(i18n.t("error.modelNotFound", { name: activeRef.name }));
      }
      const { group, model } = activeEntry;
      const resolved = resolveModelProfile(state.config, activeRef);
      if (!resolved) {
        throw new Error(i18n.t("error.modelNotFound", { name: activeRef.name }));
      }
      if (resolved.provider && resolved.provider !== "custom") {
        if (!modelRefsEqual(state.config.activeModel, activeRef)) {
          group.apiBase = resolveProfileApiBase(resolved);
        }
      } else {
        group.apiBase = apiBase;
      }
      if (reasoningEffort !== undefined) {
        model.reasoningEffort = asModelEntryReasoningEffort(
          resolveModelReasoningEffortForContext(reasoningEffort, {
            ...(resolved.provider ? { provider: resolved.provider } : {}),
            model: model.name,
            ...(resolved.transportKind ? { transportKind: resolved.transportKind } : {}),
            ...(resolved.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: resolved.supportedReasoningEfforts }
              : {}),
          }),
        );
      }
      if (reasoningMode !== undefined) {
        applyModelReasoningModeToEntry(model, reasoningMode, {
          ...(resolved.provider ? { provider: resolved.provider } : {}),
          model: model.name,
          ...(resolved.transportKind ? { transportKind: resolved.transportKind } : {}),
        });
      }
      if (thinkingEnabled !== undefined) {
        const modelContext = {
          ...(resolved.provider ? { provider: resolved.provider } : {}),
          model: model.name,
          ...(resolved.transportKind ? { transportKind: resolved.transportKind } : {}),
          ...(resolved.supportedReasoningEfforts !== undefined
            ? { supportedEfforts: resolved.supportedReasoningEfforts }
            : {}),
          ...(resolved.supportsThinkingType
            ? { supportsThinkingType: resolved.supportsThinkingType }
            : {}),
          ...(resolved.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
        };
        if (thinkingEnabled) {
          delete model.thinkingEnabled;
        } else {
          model.thinkingEnabled = false;
        }
        if (shouldPinReasoningEffortToDefault(thinkingEnabled, modelContext)) {
          model.reasoningEffort = asModelEntryReasoningEffort(
            resolveModelReasoningEffortForContext("default", modelContext),
          );
        }
      }
      state.config.activeModel = {
        groupId: activeRef.groupId.trim(),
        name: activeRef.name.trim(),
      };
    } else {
      state.config.activeModel = { groupId: "", name: "" };
      activeEntry = null;
    }
    state.config.uiLocale = request.uiLocale?.trim() || undefined;
    if (request.imageGenerationModel !== undefined) {
      if (isEmptyModelRef(request.imageGenerationModel)) {
        delete state.config.imageGenerationModel;
      } else {
        const imageRef = normalizeSlotModelRef(
          request.imageGenerationModel,
          state.config,
          modelSupportsImageGeneration,
        );
        if (!imageRef) {
          throw new Error(
            i18n.t("error.imageGenModelNotFound", {
              model: request.imageGenerationModel.name,
            }),
          );
        }
        state.config.imageGenerationModel = imageRef;
      }
    }
    if (request.videoGenerationModel !== undefined) {
      if (isEmptyModelRef(request.videoGenerationModel)) {
        delete state.config.videoGenerationModel;
      } else {
        const videoRef = normalizeSlotModelRef(
          request.videoGenerationModel,
          state.config,
          modelSupportsVideoGeneration,
        );
        if (!videoRef) {
          throw new Error(
            i18n.t("error.videoGenModelNotFound", {
              model: request.videoGenerationModel.name,
            }),
          );
        }
        state.config.videoGenerationModel = videoRef;
      }
    }
    if (request.lightweightChatModel !== undefined) {
      if (isEmptyModelRef(request.lightweightChatModel)) {
        delete state.config.lightweightChatModel;
      } else {
        const chatRef = normalizeSlotModelRef(
          request.lightweightChatModel,
          state.config,
          modelSupportsChat,
        );
        if (!chatRef) {
          throw new Error(
            i18n.t("error.lightweightChatModelNotFound", {
              model: request.lightweightChatModel.name,
            }),
          );
        }
        state.config.lightweightChatModel = chatRef;
      }
    }
    if (request.translucency !== undefined) {
      state.config.translucency = parseTranslucencyPreference(request.translucency);
    }
    if (request.systemNotifications !== undefined) {
      state.config.systemNotifications = request.systemNotifications !== false;
    }
    if (request.trayIcon !== undefined) {
      state.config.trayIcon = request.trayIcon !== false;
    }
    if (request.onboardingCompleted !== undefined) {
      state.config.onboardingCompleted = request.onboardingCompleted === true;
    }
    if (request.agentMode !== undefined) {
      state.config.agentMode = request.agentMode;
    } else if (request.planMode !== undefined) {
      state.config.agentMode = request.planMode ? "plan" : "agent";
    }
    if (request.webHost !== undefined) {
      const nextWebHost = normalizeWebHostConfig({
        ...state.config.webHost,
        ...request.webHost,
      });
      if (request.webHost.resetPairing === true) {
        delete nextWebHost.authTokenHash;
      }
      state.config.webHost = nextWebHost;
    }
    if (request.dreams !== undefined) {
      const nextDreamConfig = {
        ...state.config.dreams,
        ...request.dreams,
      };
      if (request.dreams.clearCollectorModel === true) {
        delete nextDreamConfig.collectorModel;
      }
      state.config.dreams = normalizeDreamConfig(nextDreamConfig);
    }
    if (request.agents?.lsp !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        lsp: {
          ...state.config.agents.lsp,
          ...request.agents.lsp,
        },
      });
    }
    if (request.agents?.codeCompletion !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        codeCompletion: {
          ...state.config.agents.codeCompletion,
          ...request.agents.codeCompletion,
        },
      });
    }
    if (request.agents?.attribution !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        attribution: {
          commit: {
            ...state.config.agents.attribution.commit,
            ...request.agents.attribution.commit,
          },
          pr: {
            ...state.config.agents.attribution.pr,
            ...request.agents.attribution.pr,
          },
        },
      });
    }
    if (request.networks?.llmHttpVersion !== undefined) {
      state.config.networks = normalizeNetworksConfig({
        ...state.config.networks,
        llmHttpVersion: request.networks.llmHttpVersion,
      });
      applyLlmHttpVersionFromConfig(state.config);
      applyLlmClientVersionFromApp();
    }
    await saveConfig(state.config);
    if (request.apiKey?.trim() && activeEntry) {
      await saveApiKeyForProvider(activeEntry.group.id, request.apiKey);
    }

    const agentModeNow = resolveDesktopAgentMode(state.config);
    const lspEnabledChanged = state.config.agents.lsp.enabled !== prevLspEnabled;
    const modelOrEndpointChanged =
      !modelRefsEqual(state.config.activeModel, prevActiveModel) ||
      currentApiBase(state.config) !== prevApiBase;
    const imageGenerationModelChanged = !modelRefsEqual(
      state.config.imageGenerationModel,
      prevImageGenerationModel,
    );
    const videoGenerationModelChanged = !modelRefsEqual(
      state.config.videoGenerationModel,
      prevVideoGenerationModel,
    );

    if (agentModeNow !== prevAgentMode) {
      state.metadata = await loadHostMetadata(state.workspaceRoot, agentModeNow, {
        activePlanPath: ctx.activeBundle().activePlanPath,
        workspaceBinding: state.workspaceBinding,
      });
    }

    if (lspEnabledChanged) {
      await ctx.disposeAllLspServices();
      ctx.invalidateToolExecutors();
    }

    if (!modelRefsEqual(state.config.activeModel, prevActiveModel)) {
      ctx.clearActiveContextUsage();
      ctx.activeBundle().activeModel = state.config.activeModel;
    }

    const transportOrPlanChanged =
      agentModeNow !== prevAgentMode ||
      modelOrEndpointChanged ||
      imageGenerationModelChanged ||
      videoGenerationModelChanged;
    const activeModelProfile = resolveModelProfile(state.config, state.config.activeModel);
    const inferencePreferenceOnlyUpdate =
      !transportOrPlanChanged &&
      !lspEnabledChanged &&
      agentModeNow === prevAgentMode &&
      !request.apiKey?.trim() &&
      activeModelProfile !== null &&
      prevActiveModelInference !== undefined &&
      modelRefsEqual(state.config.activeModel, prevActiveModel) &&
      (activeModelProfile.thinkingEnabled !== prevActiveModelInference.thinkingEnabled ||
        activeModelProfile.reasoningEffort !== prevActiveModelInference.reasoningEffort ||
        activeModelProfile.reasoningMode !== prevActiveModelInference.reasoningMode);
    const deferRuntimeRefresh = wasBusy && transportOrPlanChanged && !request.apiKey?.trim();

    if (deferRuntimeRefresh) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
    } else if (inferencePreferenceOnlyUpdate) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshActiveModelTransportConfig();
    } else {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshRuntime();
    }

    if (!inferencePreferenceOnlyUpdate) {
      await ctx.refreshLspSnapshot();
    }

    ctx.setLastRuntimeError("");
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

function assertAlibabaConnectWorkspace(input: {
  provider?: DesktopModelProvider;
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: DesktopAlibabaBillingMode;
}): void {
  if (
    input.provider !== "alibaba" ||
    input.alibabaBillingMode === "token-plan" ||
    !input.providerSite
  ) {
    return;
  }
  if (
    providerConnectSiteRequiresWorkspaceId("alibaba", input.providerSite) &&
    !input.alibabaWorkspaceId?.trim()
  ) {
    throw new Error(i18n.t("error.alibabaWorkspaceIdRequired"));
  }
}

function applyManagedProviderConnectFields<
  T extends {
    providerSite?: DesktopProviderConnectSiteId;
    alibabaWorkspaceId?: string;
    alibabaBillingMode?: DesktopAlibabaBillingMode;
    stepfunBillingMode?: DesktopStepfunBillingMode;
    zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
    zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  },
>(
  profile: T,
  input: {
    provider?: DesktopModelProvider;
    providerSite?: DesktopProviderConnectSiteId;
    alibabaWorkspaceId?: string;
    alibabaBillingMode?: DesktopAlibabaBillingMode;
    stepfunBillingMode?: DesktopStepfunBillingMode;
    zAiBillingMode?: DesktopGlmCodingPlanBillingMode;
    zhipuBillingMode?: DesktopGlmCodingPlanBillingMode;
  },
): void {
  if (input.provider === "stepfun") {
    if (input.stepfunBillingMode === "step-plan") {
      profile.stepfunBillingMode = "step-plan";
    } else {
      delete profile.stepfunBillingMode;
    }
    return;
  }

  if (input.provider === "z-ai") {
    if (input.zAiBillingMode === "glm-coding-plan") {
      profile.zAiBillingMode = "glm-coding-plan";
    } else {
      delete profile.zAiBillingMode;
    }
    return;
  }

  if (input.provider === "zhipu-ai") {
    if (input.zhipuBillingMode === "glm-coding-plan") {
      profile.zhipuBillingMode = "glm-coding-plan";
    } else {
      delete profile.zhipuBillingMode;
    }
    return;
  }

  if (input.provider === "alibaba") {
    if (input.alibabaBillingMode === "token-plan") {
      profile.alibabaBillingMode = "token-plan";
      delete profile.providerSite;
      delete profile.alibabaWorkspaceId;
      return;
    }
    delete profile.alibabaBillingMode;
    if (input.providerSite) {
      profile.providerSite = input.providerSite;
    } else {
      delete profile.providerSite;
    }
    if (input.alibabaWorkspaceId?.trim()) {
      profile.alibabaWorkspaceId = input.alibabaWorkspaceId.trim();
    } else {
      delete profile.alibabaWorkspaceId;
    }
    return;
  }

  if (input.provider && providerSupportsSiteSelection(input.provider)) {
    if (input.providerSite) {
      profile.providerSite = input.providerSite;
    } else {
      delete profile.providerSite;
    }
  }
}

function assertCloudflareConnectFields(input: {
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  apiKey?: string;
}): void {
  const accountId = input.cloudflareAccountId?.trim();
  const gatewayId = input.cloudflareGatewayId?.trim();
  if (!accountId) {
    throw new Error(i18n.t("settings.cloudflareAccountIdRequired"));
  }
  if (!isValidCloudflareAccountId(accountId)) {
    throw new Error(i18n.t("settings.cloudflareAccountIdInvalid"));
  }
  if (!gatewayId) {
    throw new Error(i18n.t("settings.cloudflareGatewayIdRequired"));
  }
  if (!isValidCloudflareGatewayId(gatewayId)) {
    throw new Error(i18n.t("settings.cloudflareGatewayIdInvalid"));
  }
  if (!input.apiKey?.trim()) {
    throw new Error(i18n.t("settings.cloudflareAiGatewayApiTokenRequired"));
  }
}

function resolveManagedConnectApiBase(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
  requestApiBase: string,
  awsRegion?: string,
  modelName?: string,
  vertexProject?: string,
  vertexLocation?: string,
  azureResourceName?: string,
  providerSite?: DesktopProviderConnectSiteId,
  alibabaWorkspaceId?: string,
  alibabaBillingMode?: DesktopAlibabaBillingMode,
  stepfunBillingMode?: DesktopStepfunBillingMode,
  zAiBillingMode?: DesktopGlmCodingPlanBillingMode,
  zhipuBillingMode?: DesktopGlmCodingPlanBillingMode,
  cloudflareAccountId?: string,
): string {
  if (provider === "amazon-bedrock") {
    const region = awsRegion?.trim();
    if (region) {
      if (modelName && isBedrockMantleOpenAiModel(modelName)) {
        return bedrockMantleApiBaseFromRegion(region);
      }
      return bedrockApiBaseFromRegion(region);
    }
  }
  if (provider === "google-vertex-ai") {
    const project = vertexProject?.trim();
    const location = vertexLocation?.trim();
    if (project && location) {
      return vertexApiBaseFromProjectAndLocation(project, location);
    }
  }
  if (provider === "azure") {
    const resourceName = azureResourceName?.trim();
    if (resourceName) {
      return azureApiBaseFromResourceName(resourceName);
    }
  }
  if (provider === "cloudflare-ai-gateway") {
    const accountId = cloudflareAccountId?.trim();
    if (accountId) {
      return cloudflareAiGatewayApiBaseFromAccountId(accountId);
    }
  }
  if (provider === "custom") {
    const trimmed = requestApiBase.trim();
    if (!trimmed) {
      throw new Error(i18n.t("error.endpointRequired"));
    }
    return trimmed;
  }
  if (!provider) {
    const trimmed = requestApiBase.trim();
    return trimmed || defaultApiBaseForTransport("custom", transportKind);
  }
  return defaultApiBaseForTransport(
    provider,
    transportKind,
    providerSite,
    alibabaWorkspaceId,
    alibabaBillingMode,
    stepfunBillingMode,
    zAiBillingMode,
    zhipuBillingMode,
  );
}

function assertBedrockConnectCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): void {
  const apiKey = input.apiKey.trim();
  const accessKeyId = input.accessKeyId?.trim();
  const secretAccessKey = input.secretAccessKey?.trim();
  if (hasBedrockRuntimeCredentials({ apiKey, accessKeyId, secretAccessKey })) {
    return;
  }
  throw new Error(i18n.t("error.bedrockCredentialsRequired"));
}

function assertBedrockCatalogCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): void {
  if (hasBedrockIamCredentials(input)) {
    return;
  }
  throw new Error(i18n.t("error.bedrockCatalogIamRequired"));
}

function assertVertexCatalogCredentials(input: {
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): void {
  if (input.apiKey?.trim()) {
    throw new Error(i18n.t("error.vertexExpressCatalogUnsupported"));
  }
  if (!input.vertexProject?.trim() || !input.vertexLocation?.trim()) {
    throw new Error(i18n.t("error.vertexProjectLocationRequired"));
  }
  const hasServiceAccountFields = Boolean(
    input.vertexClientEmail?.trim() || input.vertexPrivateKey?.trim(),
  );
  if (
    hasServiceAccountFields &&
    !hasGoogleVertexServiceAccountCredentials({
      clientEmail: input.vertexClientEmail,
      privateKey: input.vertexPrivateKey,
    })
  ) {
    throw new Error(i18n.t("error.vertexCatalogServiceAccountRequired"));
  }
}

function assertVertexConnectCredentials(input: {
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): void {
  if (hasGoogleVertexRuntimeCredentials(input)) {
    return;
  }
  throw new Error(i18n.t("error.vertexCredentialsRequired"));
}

export async function previewModelsCommand(
  request: PreviewModelsRequest,
): Promise<PreviewModelsResponse> {
  const provider = parseModelProviderId(request.provider);
  const transportKind = resolveDesktopTransportKind({
    provider,
    transportKind: request.transportKind,
  });
  const awsRegion = request.awsRegion?.trim();
  const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
  const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
  const alibabaBillingMode = request.alibabaBillingMode;
  const stepfunBillingMode = request.stepfunBillingMode;
  const zAiBillingMode = request.zAiBillingMode;
  const zhipuBillingMode = request.zhipuBillingMode;
  const vertexProject = request.vertexProject?.trim();
  const vertexLocation = request.vertexLocation?.trim();
  const cloudflareAccountId = request.cloudflareAccountId?.trim();
  const cloudflareGatewayId = request.cloudflareGatewayId?.trim();
  if (provider === "amazon-bedrock" && !awsRegion) {
    throw new Error(i18n.t("error.bedrockRegionRequired"));
  }
  if (provider === "cloudflare-ai-gateway") {
    assertCloudflareConnectFields({
      cloudflareAccountId,
      cloudflareGatewayId,
      apiKey: request.apiKey,
    });
  }
  assertAlibabaConnectWorkspace({ provider, providerSite, alibabaWorkspaceId, alibabaBillingMode });
  const apiBase = resolveManagedConnectApiBase(
    provider,
    transportKind,
    request.apiBase,
    awsRegion,
    undefined,
    vertexProject,
    vertexLocation,
    undefined,
    providerSite,
    alibabaWorkspaceId,
    alibabaBillingMode,
    stepfunBillingMode,
    zAiBillingMode,
    zhipuBillingMode,
    cloudflareAccountId,
  );
  const apiKey = request.apiKey.trim();
  const accessKeyId = request.accessKeyId?.trim();
  const secretAccessKey = request.secretAccessKey?.trim();
  const vertexClientEmail = request.vertexClientEmail?.trim();
  const vertexPrivateKey = request.vertexPrivateKey?.trim();
  if (provider === "amazon-bedrock") {
    assertBedrockCatalogCredentials({ apiKey, accessKeyId, secretAccessKey });
  } else if (provider === "google-vertex-ai") {
    assertVertexCatalogCredentials({
      apiKey,
      vertexClientEmail,
      vertexPrivateKey,
      vertexProject,
      vertexLocation,
    });
  } else if (provider !== "cloudflare-ai-gateway" && provider !== "custom" && !apiKey) {
    throw new Error(i18n.t("error.apiKeyRequired"));
  }
  const result = await loadPreviewModelsForTransport({
    provider,
    transportKind,
    apiBase,
    apiKey,
    ...(awsRegion ? { awsRegion } : {}),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    ...(cloudflareAccountId ? { cloudflareAccountId } : {}),
    forceRefresh: request.forceRefresh === true,
  });
  return {
    modelIds: result.modelIds,
    ...(result.modelCatalog ? { models: result.modelCatalog } : {}),
    fromCache: result.fromCache,
  };
}

export async function addProviderModelsCommand(
  ctx: HostModelCommandContext,
  request: AddProviderModelsRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const provider = parseModelProviderId(request.provider);
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const awsRegion = request.awsRegion?.trim();
    const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
    const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
    const alibabaBillingMode = request.alibabaBillingMode;
    const stepfunBillingMode = request.stepfunBillingMode;
    const zAiBillingMode = request.zAiBillingMode;
    const zhipuBillingMode = request.zhipuBillingMode;
    const vertexProject = request.vertexProject?.trim();
    const vertexLocation = request.vertexLocation?.trim();
    const cloudflareAccountId = request.cloudflareAccountId?.trim();
    const cloudflareGatewayId = request.cloudflareGatewayId?.trim();
    if (provider === "amazon-bedrock" && !awsRegion) {
      throw new Error(i18n.t("error.bedrockRegionRequired"));
    }
    if (provider === "cloudflare-ai-gateway") {
      assertCloudflareConnectFields({
        cloudflareAccountId,
        cloudflareGatewayId,
        apiKey: request.apiKey,
      });
    }
    assertAlibabaConnectWorkspace({
      provider,
      providerSite,
      alibabaWorkspaceId,
      alibabaBillingMode,
    });
    const connectInput: ConnectRequestFields = {
      groupId: request.groupId,
      ...(provider !== undefined ? { provider } : {}),
      ...(request.customGroupLabel?.trim()
        ? { customGroupLabel: request.customGroupLabel.trim() }
        : {}),
      transportKind,
      apiBase: request.apiBase,
      ...(awsRegion ? { awsRegion } : {}),
      ...(providerSite ? { providerSite } : {}),
      ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
      ...(alibabaBillingMode ? { alibabaBillingMode } : {}),
      ...(stepfunBillingMode ? { stepfunBillingMode } : {}),
      ...(zAiBillingMode ? { zAiBillingMode } : {}),
      ...(zhipuBillingMode ? { zhipuBillingMode } : {}),
      ...(vertexProject ? { vertexProject } : {}),
      ...(vertexLocation ? { vertexLocation } : {}),
      ...(cloudflareAccountId ? { cloudflareAccountId } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
    };
    const groupId = resolveConnectGroupId(connectInput);
    const groupConnect = buildProviderGroupConnect(connectInput);
    const apiBase = groupConnect.apiBase;
    const apiKey = request.apiKey.trim();
    const accessKeyId = request.accessKeyId?.trim();
    const secretAccessKey = request.secretAccessKey?.trim();
    const vertexClientEmail = request.vertexClientEmail?.trim();
    const vertexPrivateKey = request.vertexPrivateKey?.trim();
    if (provider === "amazon-bedrock") {
      assertBedrockConnectCredentials({ apiKey, accessKeyId, secretAccessKey });
    } else if (provider === "google-vertex-ai") {
      assertVertexConnectCredentials({
        apiKey,
        vertexClientEmail,
        vertexPrivateKey,
        vertexProject,
        vertexLocation,
      });
    } else if (provider !== "cloudflare-ai-gateway" && provider !== "custom" && !apiKey) {
      throw new Error(i18n.t("error.apiKeyRequired"));
    }

    const rawIds = request.modelIds.map((id) => id.trim()).filter((id) => id.length > 0);
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length === 0) {
      throw new Error(i18n.t("error.emptyModelList"));
    }

    const existingModels = existingModelsForGroupAdd(state.config);
    const newIds = filterNewGroupModelIds(existingModels, uniqueIds, groupId);
    const catalogEntries = previewCatalogMapForAddProviderRequest(request, provider, transportKind);
    const toAdd: ModelEntryV2[] = [];
    for (const name of newIds) {
      const catalogEntry = catalogEntries.get(name);
      const entry: ModelEntryV2 = {
        name,
        reasoningEffort: asModelEntryReasoningEffort(
          defaultModelReasoningEffort({
            ...(reasoningProviderForTransport(provider, transportKind)
              ? { provider: reasoningProviderForTransport(provider, transportKind) }
              : {}),
            model: name,
            ...(catalogEntry?.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
              : {}),
            ...(catalogEntry?.defaultReasoningEffort
              ? { defaultEffort: catalogEntry.defaultReasoningEffort }
              : {}),
            ...(catalogEntry?.supportsThinkingType
              ? { supportsThinkingType: catalogEntry.supportsThinkingType }
              : {}),
            ...(catalogEntry?.supportsThinkingSwitch === true
              ? { supportsThinkingSwitch: true }
              : {}),
          }),
        ),
      };
      if (catalogEntry?.supportedReasoningEfforts !== undefined) {
        entry.supportedReasoningEfforts = asModelEntrySupportedReasoningEfforts(
          catalogEntry.supportedReasoningEfforts,
        );
      }
      if (catalogEntry?.capabilities) {
        entry.capabilities = catalogEntry.capabilities;
      }
      if (catalogEntry?.contextLength !== undefined) {
        const contextLength = parseModelContextLength(catalogEntry.contextLength);
        if (contextLength !== undefined) {
          entry.contextLength = contextLength;
        }
      }
      if (catalogEntry?.supportsThinkingType !== undefined) {
        entry.supportsThinkingType = catalogEntry.supportsThinkingType;
      }
      if (catalogEntry?.supportsThinkingSwitch === true) {
        entry.supportsThinkingSwitch = true;
      }
      toAdd.push(entry);
    }

    const firstCatalogEntry = catalogEntries.get(uniqueIds[0] ?? "");
    const scopeProfile: ModelProfileSnapshot = {
      groupId,
      name: uniqueIds[0] ?? "",
      apiBase,
      provider,
      reasoningEffort: defaultModelReasoningEffort({
        ...(reasoningProviderForTransport(provider, transportKind)
          ? { provider: reasoningProviderForTransport(provider, transportKind) }
          : {}),
        model: uniqueIds[0] ?? "",
        ...(firstCatalogEntry?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: firstCatalogEntry.supportedReasoningEfforts }
          : {}),
        ...(firstCatalogEntry?.defaultReasoningEffort
          ? { defaultEffort: firstCatalogEntry.defaultReasoningEffort }
          : {}),
      }),
      ...(transportKind === "anthropic" ||
      transportKind === "open-responses" ||
      transportKind === "bedrock"
        ? { transportKind }
        : {}),
      ...(provider === "amazon-bedrock" && awsRegion ? { awsRegion } : {}),
      ...(provider === "google-vertex-ai" && vertexProject ? { vertexProject } : {}),
      ...(provider === "google-vertex-ai" && vertexLocation ? { vertexLocation } : {}),
      ...(provider === "cloudflare-ai-gateway" && cloudflareAccountId
        ? { cloudflareAccountId }
        : {}),
      ...(provider === "cloudflare-ai-gateway" && cloudflareGatewayId
        ? { cloudflareGatewayId }
        : {}),
    };
    applyManagedProviderConnectFields(scopeProfile, {
      provider,
      providerSite,
      alibabaWorkspaceId,
      alibabaBillingMode,
      stepfunBillingMode,
      zAiBillingMode,
      zhipuBillingMode,
    });
    const catalogRefreshResult = {
      modelIds: uniqueIds,
      fromCache: false,
      modelCatalog: request.modelCatalog,
    };
    const configPreview = structuredClone(state.config);
    const prunedPreview = removeDelistedModelsFromCatalog(
      configPreview,
      scopeProfile,
      catalogRefreshResult,
    );
    const syncedPreview = request.modelCatalog?.length
      ? syncExistingModelsFromCatalog(configPreview, scopeProfile, catalogRefreshResult)
      : 0;

    if (toAdd.length === 0 && syncedPreview === 0 && prunedPreview.length === 0) {
      throw new Error(i18n.t("error.modelsAlreadyExist"));
    }

    const resolvedProvider = provider ?? "custom";
    try {
      await saveGroupCredentials(groupId, resolvedProvider, {
        apiKey,
        accessKeyId,
        secretAccessKey,
        vertexClientEmail,
        vertexPrivateKey,
      });
    } catch (err) {
      await clearGroupCredentials(groupId, resolvedProvider);
      throw err;
    }

    const group = findOrCreateProviderGroup(state.config, groupId, groupConnect);
    const pruned = removeDelistedModelsFromCatalog(
      state.config,
      scopeProfile,
      catalogRefreshResult,
    );
    if (request.modelCatalog?.length) {
      syncExistingModelsFromCatalog(state.config, scopeProfile, catalogRefreshResult);
    }

    for (const entry of toAdd) {
      group.models.push(entry);
    }

    const firstNewRef: ModelRef = toAdd[0]
      ? { groupId, name: toAdd[0].name }
      : state.config.activeModel;
    if (toAdd.length > 0) {
      state.config.activeModel = firstNewRef;
    }
    if (!state.config.imageGenerationModel) {
      const imageEntry = toAdd.find((entry) => modelSupportsImageGeneration(entry));
      if (imageEntry) {
        state.config.imageGenerationModel = { groupId, name: imageEntry.name };
      }
    }
    if (!state.config.videoGenerationModel) {
      const videoEntry = toAdd.find((entry) => modelSupportsVideoGeneration(entry));
      if (videoEntry) {
        state.config.videoGenerationModel = { groupId, name: videoEntry.name };
      }
    }
    for (const name of pruned) {
      await removeModelApiKey(modelRefKey({ groupId, name }));
    }
    await saveConfig(state.config);
    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function addModelCommand(
  ctx: HostModelCommandContext,
  request: AddModelRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const name = request.name.trim();
    const provider = parseModelProviderId(request.provider) ?? "custom";
    if (
      provider === "azure" &&
      request.transportKind !== undefined &&
      request.transportKind !== "open-responses"
    ) {
      throw new Error(i18n.t("error.azureOpenResponsesOnly"));
    }
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const awsRegion = request.awsRegion?.trim();
    const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
    const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
    const alibabaBillingMode = request.alibabaBillingMode;
    const stepfunBillingMode = request.stepfunBillingMode;
    const zAiBillingMode = request.zAiBillingMode;
    const zhipuBillingMode = request.zhipuBillingMode;
    const vertexProject = request.vertexProject?.trim();
    const vertexLocation = request.vertexLocation?.trim();
    const azureResourceName = request.azureResourceName?.trim();
    const cloudflareAccountId = request.cloudflareAccountId?.trim();
    const cloudflareGatewayId = request.cloudflareGatewayId?.trim();
    if (provider === "amazon-bedrock" && !awsRegion) {
      throw new Error(i18n.t("error.bedrockRegionRequired"));
    }
    if (provider === "azure" && !azureResourceName) {
      throw new Error(i18n.t("error.azureResourceNameRequired"));
    }
    if (provider === "azure" && azureResourceName && !isValidAzureResourceName(azureResourceName)) {
      throw new Error(i18n.t("error.azureResourceNameInvalid"));
    }
    if (provider === "cloudflare-ai-gateway") {
      assertCloudflareConnectFields({
        cloudflareAccountId,
        cloudflareGatewayId,
        apiKey: request.apiKey,
      });
    }
    assertAlibabaConnectWorkspace({
      provider,
      providerSite,
      alibabaWorkspaceId,
      alibabaBillingMode,
    });
    const connectInput: ConnectRequestFields = {
      groupId: request.groupId,
      provider,
      customGroupLabel: request.customGroupLabel,
      transportKind,
      apiBase: request.apiBase,
      ...(awsRegion ? { awsRegion } : {}),
      ...(providerSite ? { providerSite } : {}),
      ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
      ...(alibabaBillingMode ? { alibabaBillingMode } : {}),
      ...(stepfunBillingMode ? { stepfunBillingMode } : {}),
      ...(zAiBillingMode ? { zAiBillingMode } : {}),
      ...(zhipuBillingMode ? { zhipuBillingMode } : {}),
      ...(vertexProject ? { vertexProject } : {}),
      ...(vertexLocation ? { vertexLocation } : {}),
      ...(azureResourceName ? { azureResourceName } : {}),
      ...(cloudflareAccountId ? { cloudflareAccountId } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
    };
    const groupId = resolveConnectGroupId(connectInput);
    const groupConnect = buildProviderGroupConnect({ ...connectInput, modelName: name });
    const apiBase = groupConnect.apiBase;
    const apiKey = request.apiKey.trim();

    if (!name) {
      throw new Error(i18n.t("error.modelNameRequired"));
    }
    if (provider === "google-vertex-ai") {
      assertVertexConnectCredentials({
        apiKey,
        vertexProject,
        vertexLocation,
      });
    } else if (provider === "azure" && /\s/u.test(name)) {
      throw new Error(i18n.t("error.azureDeploymentNameWhitespace"));
    } else if (provider !== "cloudflare-ai-gateway" && provider !== "custom" && !apiKey) {
      throw new Error(i18n.t("error.apiKeyRequired"));
    }
    if (modelExistsInGroup(state.config, groupId, name)) {
      throw new Error(i18n.t("error.modelExists", { name }));
    }

    const catalogEntry = await findCatalogEntryForModel({
      provider,
      transportKind,
      apiBase,
      apiKey,
      model: name,
    });
    const requestedCapabilities = normalizeModelCapabilities(request.capabilities);

    const modelEntry: ModelEntryV2 = {
      name,
      reasoningEffort: asModelEntryReasoningEffort(
        defaultModelReasoningEffort({
          ...(reasoningProviderForTransport(provider, transportKind)
            ? { provider: reasoningProviderForTransport(provider, transportKind) }
            : {}),
          model: name,
          ...(catalogEntry?.supportedReasoningEfforts !== undefined
            ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
            : {}),
          ...(catalogEntry?.defaultReasoningEffort
            ? { defaultEffort: catalogEntry.defaultReasoningEffort }
            : {}),
          ...(catalogEntry?.supportsThinkingType
            ? { supportsThinkingType: catalogEntry.supportsThinkingType }
            : {}),
          ...(catalogEntry?.supportsThinkingSwitch === true
            ? { supportsThinkingSwitch: true }
            : {}),
        }),
      ),
    };
    if (catalogEntry?.supportedReasoningEfforts !== undefined) {
      modelEntry.supportedReasoningEfforts = asModelEntrySupportedReasoningEfforts(
        catalogEntry.supportedReasoningEfforts,
      );
    }
    const capabilities = resolveAddedModelCapabilities({
      provider,
      requestedCapabilities,
      catalogEntry,
    });
    if (capabilities) {
      modelEntry.capabilities = capabilities;
    }
    if (catalogEntry?.contextLength !== undefined && request.contextLength === undefined) {
      const contextLength = parseModelContextLength(catalogEntry.contextLength);
      if (contextLength !== undefined) {
        modelEntry.contextLength = contextLength;
      }
    }
    if (catalogEntry?.supportsThinkingType !== undefined) {
      modelEntry.supportsThinkingType = catalogEntry.supportsThinkingType;
    }
    if (catalogEntry?.supportsThinkingSwitch === true) {
      modelEntry.supportsThinkingSwitch = true;
    }
    if (request.contextLength !== undefined) {
      const contextLength = parseModelContextLength(request.contextLength);
      if (contextLength === undefined) {
        throw new Error(i18n.t("error.contextLengthInvalid"));
      }
      modelEntry.contextLength = contextLength;
    }

    const group = findOrCreateProviderGroup(state.config, groupId, groupConnect);
    group.models.push(modelEntry);
    const modelRef: ModelRef = { groupId, name };
    state.config.activeModel = modelRef;
    ctx.clearActiveContextUsage();
    if (!state.config.imageGenerationModel && modelSupportsImageGeneration(modelEntry)) {
      state.config.imageGenerationModel = modelRef;
    }
    if (!state.config.videoGenerationModel && modelSupportsVideoGeneration(modelEntry)) {
      state.config.videoGenerationModel = modelRef;
    }
    await saveConfig(state.config);
    if (provider === "custom" && !request.provider) {
      await saveApiKeyForModel(modelRefKey(modelRef), apiKey);
    } else {
      await saveGroupCredentials(groupId, provider, { apiKey });
    }

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function removeModelCommand(
  ctx: HostModelCommandContext,
  request: RemoveModelRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const ref = request.ref;
    if (isEmptyModelRef(ref)) {
      throw new Error(i18n.t("error.modelNameRequired"));
    }
    if (!resolveModelProfile(state.config, ref)) {
      throw new Error(i18n.t("error.modelNotFound", { name: ref.name }));
    }
    const targetsToRemove: ModelRemovalTarget[] = [
      { ref: { groupId: ref.groupId.trim(), name: ref.name.trim() } },
    ];
    return finalizeModelRemoval(ctx, state, targetsToRemove, { removeLegacyModelKeys: true });
  });
}

export async function removeProviderGroupCommand(
  ctx: HostModelCommandContext,
  request: RemoveProviderGroupRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const groupId = request.groupId.trim();
    if (!groupId) {
      throw new Error(i18n.t("error.modelNameRequired"));
    }
    const group = findProviderGroup(state.config, groupId);
    if (!group || group.models.length === 0) {
      throw new Error(i18n.t("error.noModelsInProvider"));
    }

    const targetsToRemove: ModelRemovalTarget[] = group.models.map((model) => ({
      ref: { groupId, name: model.name },
    }));
    const provider = group.provider as DesktopModelProvider;
    applyModelsRemovalToConfig(state.config, targetsToRemove);
    state.config.providerGroups = state.config.providerGroups.filter(
      (entry) => entry.id !== groupId,
    );
    await saveConfig(state.config);
    await removeGroupKeyring(groupId, provider);
    await ctx.refreshModelKeyPresence();
    await ctx.refreshRuntime();
    ctx.setLastRuntimeError("");
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

/** @deprecated use {@link removeProviderGroupCommand} */
export async function removeProviderModelsCommand(
  ctx: HostModelCommandContext,
  request: RemoveProviderModelsRequest,
): Promise<DesktopSnapshot> {
  const provider = parsePresetModelProviderId(request.provider);
  if (!provider) {
    throw new Error(i18n.t("error.providerDeleteOnly"));
  }
  return removeProviderGroupCommand(ctx, {
    groupId: defaultPresetProviderGroupId(provider),
  });
}

async function finalizeModelRemoval(
  ctx: HostModelCommandContext,
  state: HostModelState,
  targetsToRemove: readonly ModelRemovalTarget[],
  options?: {
    removeLegacyModelKeys?: boolean;
  },
): Promise<DesktopSnapshot> {
  applyModelsRemovalToConfig(state.config, targetsToRemove);
  state.config.providerGroups = state.config.providerGroups.filter(
    (group) => group.models.length > 0,
  );
  await saveConfig(state.config);
  if (options?.removeLegacyModelKeys) {
    for (const target of targetsToRemove) {
      await removeModelApiKey(modelRefKey(target.ref));
    }
  }
  await ctx.refreshModelKeyPresence();
  await ctx.refreshRuntime();
  ctx.setLastRuntimeError("");
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}
