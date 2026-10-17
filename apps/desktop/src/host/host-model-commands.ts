import {
  emptyModelRef,
  findProviderEntry,
  isEmptyModelRef,
  modelRefsEqual,
  providerCredentialSlotNames,
  providerInternalSlotAccount,
  resolveProviderTransportKind,
  saveProviderSetup,
  type ModelEntry,
  type ModelRef,
  type ProviderEntry,
  type ProviderOptions,
} from "@spiritagent/host-internal";
import {
  findProviderPreset,
  materializeProviderPreset,
  type MaterializeProviderPresetInput,
} from "@spiritagent/agent-core/provider-presets";
import { isValidAzureResourceName } from "@spiritagent/agent-core/azure-resource";
import {
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
} from "@spiritagent/agent-core/cloudflare-ai-gateway-resource";

import { resolveDesktopAgentMode } from "../lib/agent-mode.js";
import { parseTranslucencyPreference } from "../lib/translucency.js";
import { parseModelContextLength } from "../lib/context-usage.js";
import i18n from "../lib/i18n-host.js";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopSnapshot,
  DesktopTransportKind,
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
  catalogEntryToModelEntry,
} from "./model-catalog-startup-refresh.js";
import {
  findCatalogEntryForModel,
  loadPreviewModelsForTransport,
  previewCatalogMapForAddProviderRequest,
  resolveAddedModelCapabilities,
} from "./model-config.js";
import { providerConnectSiteRequiresWorkspaceId } from "./provider-presets.js";
import { modelSupportsLanguageModel } from "./secondary-language-model.js";
import {
  applyModelsRemovalToConfig,
  filterNewProviderModelIds,
  type ModelRemovalTarget,
} from "./provider-api-key.js";
import {
  flattenProviders,
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
  saveApiKeyForProvider,
  saveConfig,
  loadConfig,
  spiritDataDir,
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
import { deleteKeyringPassword } from "./keyring-secret.js";
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
  applyWebToolExposureToRuntimes(exposure: {
    providerToolsEnabled: boolean;
    webFetchEnabled: boolean;
  }): Promise<void>;
  refreshLspSnapshot(): Promise<void>;
}

/** Matches the keyring naming in host-internal (`provider::{id}[::{slot}]`). */
const KEYRING_SERVICE = "Spirit";

/** Cloudflare AI Gateway's gateway id materializes into a literal request header (see .spec/config.md). */
const CLOUDFLARE_GATEWAY_ID_HEADER = "cf-aig-gateway-id";

interface ModelEntryLocation {
  provider: ProviderEntry;
  model: ModelEntry;
}

function findModelEntryInConfig(
  config: Pick<DesktopConfigFile, "providers">,
  ref: ModelRef,
): ModelEntryLocation | null {
  const provider = findProviderEntry(config.providers, ref.providerId);
  if (!provider) {
    return null;
  }
  const model = provider.models.find((entry) => entry.name === ref.name.trim());
  if (!model) {
    return null;
  }
  return { provider, model };
}

/** Fail-fast: a chosen effort must be one of the model's declared efforts when a list exists. */
function assertDeclaredReasoningEffort(
  modelName: string,
  effort: DesktopModelReasoningEffort,
  declared: readonly string[] | undefined,
): void {
  if (effort === "default") {
    return;
  }
  if (Array.isArray(declared) && !declared.includes(effort)) {
    throw new Error(
      `Reasoning effort "${effort}" is not in the declared supportedReasoningEfforts for model "${modelName}".`,
    );
  }
}

/** Fail-fast: a chosen mode must be one of the model's declared modes when a list exists. */
function assertDeclaredReasoningMode(
  modelName: string,
  mode: DesktopModelReasoningMode,
  declared: readonly string[] | undefined,
): void {
  if (mode === "standard") {
    return;
  }
  if (Array.isArray(declared) && !declared.includes(mode)) {
    throw new Error(
      `Reasoning mode "${mode}" is not in the declared supportedReasoningModes for model "${modelName}".`,
    );
  }
}

/** Fail-fast: a service tier requires declared `serviceTiers` and must be one of them. */
function assertDeclaredServiceTier(
  modelName: string,
  tier: string,
  tiers: ModelEntry["serviceTiers"],
): void {
  if (tiers === undefined) {
    throw new Error(`Model "${modelName}" declares no serviceTiers; cannot set serviceTier.`);
  }
  const declared = Array.isArray(tiers) ? tiers : Object.keys(tiers);
  if (!declared.includes(tier)) {
    throw new Error(
      `Service tier "${tier}" is not in the declared serviceTiers for model "${modelName}".`,
    );
  }
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
    const prevProviderToolsEnabled = state.config.agents.providerTools.enabled;
    const prevWebFetchEnabled = state.config.agents.webFetch.enabled;
    const prevActiveModelProfile = resolveModelProfile(state.config, state.config.activeModel);
    const prevActiveModelInference = prevActiveModelProfile
      ? {
          reasoningEffort: prevActiveModelProfile.reasoningEffort,
          reasoningMode: prevActiveModelProfile.reasoningMode,
          serviceTier: prevActiveModelProfile.serviceTier,
        }
      : undefined;

    if (ctx.isRuntimeBusy() && Boolean(request.apiKey?.trim())) {
      throw new Error(i18n.t("error.runtimeBusy"));
    }

    const activeRef = request.activeModel;
    const apiBase = request.apiBase.trim();
    const reasoningEffort = request.reasoningEffort;
    const reasoningMode = request.reasoningMode;
    const serviceTier = request.serviceTier;
    let activeEntry: ModelEntryLocation | null = null;
    if (!isEmptyModelRef(activeRef)) {
      activeEntry = findModelEntryInConfig(state.config, activeRef);
      if (!activeEntry) {
        throw new Error(i18n.t("error.modelNotFound", { name: activeRef.name }));
      }
      const { provider, model } = activeEntry;
      // apiBase is the materialized runtime truth: editable only for custom (non-preset) entries;
      // preset entries get their base from the wizard's materialization (connect / reconnect).
      if (findProviderPresetForEntry(provider) === undefined && apiBase) {
        provider.apiBase = apiBase;
      }
      if (reasoningEffort !== undefined) {
        // Fail-fast against the declared list (effective = model over provider inheritance); the
        // config file is left untouched when the value is out of range.
        assertDeclaredReasoningEffort(
          model.name,
          reasoningEffort,
          resolveEffectiveSupportedReasoningEfforts(provider, model),
        );
        if (reasoningEffort === "default") {
          delete model.reasoningEffort;
        } else {
          model.reasoningEffort = reasoningEffort as ModelEntry["reasoningEffort"];
        }
      }
      if (reasoningMode !== undefined) {
        assertDeclaredReasoningMode(
          model.name,
          reasoningMode,
          resolveEffectiveSupportedReasoningModes(provider, model),
        );
        if (reasoningMode === "pro") {
          model.reasoningMode = "pro";
        } else {
          delete model.reasoningMode;
        }
      }
      if (serviceTier !== undefined) {
        // `null` clears the preference; a value must be one of the declared serviceTiers.
        if (serviceTier === null) {
          delete model.serviceTier;
        } else {
          assertDeclaredServiceTier(
            model.name,
            serviceTier,
            model.serviceTiers ?? provider.serviceTiers,
          );
          model.serviceTier = serviceTier;
        }
      }
      state.config.activeModel = {
        providerId: activeRef.providerId.trim(),
        name: activeRef.name.trim(),
      };
    } else {
      state.config.activeModel = emptyModelRef();
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
    if (request.secondaryLanguageModel !== undefined) {
      if (isEmptyModelRef(request.secondaryLanguageModel)) {
        delete state.config.secondaryLanguageModel;
      } else {
        const languageModelRef = normalizeSlotModelRef(
          request.secondaryLanguageModel,
          state.config,
          modelSupportsLanguageModel,
        );
        if (!languageModelRef) {
          throw new Error(
            i18n.t("error.secondaryLanguageModelNotFound", {
              model: request.secondaryLanguageModel.name,
            }),
          );
        }
        state.config.secondaryLanguageModel = languageModelRef;
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
      state.config.dreams = normalizeDreamConfig(nextDreamConfig, state.config.providers);
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
    if (request.agents?.providerTools !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        providerTools: {
          ...state.config.agents.providerTools,
          ...request.agents.providerTools,
        },
      });
    }
    if (request.agents?.webFetch !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        webFetch: {
          ...state.config.agents.webFetch,
          ...request.agents.webFetch,
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
      await saveApiKeyForProvider(activeEntry.provider.id, request.apiKey);
    }

    const agentModeNow = resolveDesktopAgentMode(state.config);
    const lspEnabledChanged = state.config.agents.lsp.enabled !== prevLspEnabled;
    const webToolExposureChanged =
      state.config.agents.providerTools.enabled !== prevProviderToolsEnabled ||
      state.config.agents.webFetch.enabled !== prevWebFetchEnabled;
    const modelOrEndpointChanged =
      !modelRefsEqual(state.config.activeModel, prevActiveModel) ||
      currentApiBase(state.config) !== prevApiBase;
    // modelRefsEqual(undefined, undefined) is false, so a config without the slot would
    // permanently read as "changed" and defeat the inference-preference light refresh below;
    // the reference check keeps an untouched (or both-unset) slot at "unchanged".
    const imageGenerationModelChanged =
      state.config.imageGenerationModel !== prevImageGenerationModel &&
      !modelRefsEqual(state.config.imageGenerationModel, prevImageGenerationModel);
    const videoGenerationModelChanged =
      state.config.videoGenerationModel !== prevVideoGenerationModel &&
      !modelRefsEqual(state.config.videoGenerationModel, prevVideoGenerationModel);

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

    if (webToolExposureChanged) {
      // In-process executors (side tasks) rebuild lazily with the new webFetch flag;
      // attached daemon sessions get the live push so their tool surface updates now.
      ctx.invalidateToolExecutors();
      await ctx.applyWebToolExposureToRuntimes({
        providerToolsEnabled: state.config.agents.providerTools.enabled,
        webFetchEnabled: state.config.agents.webFetch.enabled,
      });
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
      (activeModelProfile.reasoningEffort !== prevActiveModelInference.reasoningEffort ||
        activeModelProfile.reasoningMode !== prevActiveModelInference.reasoningMode ||
        activeModelProfile.serviceTier !== prevActiveModelInference.serviceTier);
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

function findProviderPresetForEntry(provider: ProviderEntry) {
  return findProviderPreset(provider.id);
}

function resolveEffectiveSupportedReasoningEfforts(
  provider: ProviderEntry,
  model: ModelEntry,
): readonly string[] | undefined {
  return model.supportedReasoningEfforts ?? provider.supportedReasoningEfforts;
}

function resolveEffectiveSupportedReasoningModes(
  provider: ProviderEntry,
  model: ModelEntry,
): readonly string[] | undefined {
  return model.supportedReasoningModes ?? provider.supportedReasoningModes;
}

/**
 * Wizard form → materialization input. Sites, billing plans, and template values resolve to the
 * final apiBase here (write-time pipeline); nothing about them is persisted in config.
 */
function buildMaterializeInput(input: {
  provider?: string;
  customProviderLabel?: string;
  transportKind?: DesktopTransportKind;
  apiBase: string;
  siteId?: string;
  workspaceId?: string;
  billingPlanId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): MaterializeProviderPresetInput {
  const provider = input.provider ?? "custom";
  const templateValues: Record<string, string> = {};
  if (input.awsRegion?.trim()) {
    templateValues["awsRegion"] = input.awsRegion.trim();
  }
  if (input.azureResourceName?.trim()) {
    templateValues["resourceName"] = input.azureResourceName.trim();
  }
  if (input.cloudflareAccountId?.trim()) {
    templateValues["accountId"] = input.cloudflareAccountId.trim();
  }
  if (input.vertexProject?.trim()) {
    templateValues["project"] = input.vertexProject.trim();
  }
  if (input.vertexLocation?.trim()) {
    templateValues["location"] = input.vertexLocation.trim();
  }
  return {
    presetId: provider,
    ...(input.transportKind ? { transportKind: input.transportKind } : {}),
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.workspaceId?.trim() ? { workspaceId: input.workspaceId.trim() } : {}),
    ...(input.billingPlanId ? { billingPlanId: input.billingPlanId } : {}),
    ...(input.customProviderLabel?.trim() ? { label: input.customProviderLabel.trim() } : {}),
    ...(input.apiBase.trim() ? { apiBaseOverride: input.apiBase.trim() } : {}),
    ...(Object.keys(templateValues).length > 0 ? { templateValues } : {}),
  };
}

/** Wizard-owned transport options written onto the entry (bedrock region / vertex project+location). */
function buildSetupOptions(input: {
  provider?: string;
  awsRegion?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): ProviderOptions | undefined {
  if (input.provider === "amazon-bedrock") {
    const awsRegion = input.awsRegion?.trim();
    return awsRegion ? { awsRegion } : undefined;
  }
  if (input.provider === "google-vertex-ai") {
    const options: ProviderOptions = {};
    if (input.vertexProject?.trim()) {
      options.project = input.vertexProject.trim();
    }
    if (input.vertexLocation?.trim()) {
      options.location = input.vertexLocation.trim();
    }
    return Object.keys(options).length > 0 ? options : undefined;
  }
  return undefined;
}

/** Internal-keyring credential writes for the wizard (`apiKey` slot or bedrock/vertex slots). */
function buildSetupCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
}): Record<string, string> {
  const credentials: Record<string, string> = {};
  if (input.apiKey.trim()) {
    credentials["apiKey"] = input.apiKey.trim();
  }
  if (input.accessKeyId?.trim()) {
    credentials["accessKeyId"] = input.accessKeyId.trim();
  }
  if (input.secretAccessKey?.trim()) {
    credentials["secretAccessKey"] = input.secretAccessKey.trim();
  }
  if (input.vertexClientEmail?.trim()) {
    credentials["clientEmail"] = input.vertexClientEmail.trim();
  }
  if (input.vertexPrivateKey?.trim()) {
    credentials["privateKey"] = input.vertexPrivateKey.trim();
  }
  return credentials;
}

function assertWorkspaceIdRequired(input: {
  provider?: string;
  siteId?: string;
  workspaceId?: string;
  billingPlanId?: string;
}): void {
  if (!input.provider || input.billingPlanId !== undefined || !input.siteId) {
    return;
  }
  if (
    providerConnectSiteRequiresWorkspaceId(input.provider, input.siteId) &&
    !input.workspaceId?.trim()
  ) {
    throw new Error(i18n.t("error.alibabaWorkspaceIdRequired"));
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

function assertBedrockConnectCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): void {
  if (hasBedrockRuntimeCredentials(input)) {
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

/** The effective apiBase a wizard form produces (preview + connect share this resolution). */
function resolveWizardApiBase(input: Parameters<typeof buildMaterializeInput>[0]): string {
  if ((input.provider ?? "custom") === "custom" && !input.apiBase.trim()) {
    throw new Error(i18n.t("error.endpointRequired"));
  }
  return materializeProviderPreset(buildMaterializeInput(input)).apiBase;
}

export async function previewModelsCommand(
  request: PreviewModelsRequest,
): Promise<PreviewModelsResponse> {
  const provider = request.provider?.trim() || undefined;
  const preset = provider ? findProviderPreset(provider) : undefined;
  const transportKind = resolveWizardTransportKind(preset?.defaultTransport, request.transportKind);
  const awsRegion = request.awsRegion?.trim();
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
  assertWorkspaceIdRequired({
    provider,
    siteId: request.siteId,
    workspaceId: request.workspaceId,
    billingPlanId: request.billingPlanId,
  });
  const apiBase = resolveWizardApiBase({
    provider,
    transportKind,
    apiBase: request.apiBase,
    siteId: request.siteId,
    workspaceId: request.workspaceId,
    billingPlanId: request.billingPlanId,
    awsRegion,
    azureResourceName: request.azureResourceName,
    cloudflareAccountId,
    vertexProject,
    vertexLocation,
  });
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
    ...(provider ? { providerId: provider } : {}),
    transportKind,
    apiBase,
    apiKey,
    options: buildSetupOptions({ provider, awsRegion, vertexProject, vertexLocation }),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    forceRefresh: request.forceRefresh === true,
  });
  return {
    modelIds: result.modelIds,
    ...(result.modelCatalog ? { models: result.modelCatalog } : {}),
    fromCache: result.fromCache,
  };
}

function resolveWizardTransportKind(
  presetDefault: DesktopTransportKind | undefined,
  requested: DesktopTransportKind | undefined,
): DesktopTransportKind {
  return requested ?? presetDefault ?? "openai-compatible";
}

/**
 * The Cloudflare gateway id materializes into literal entry `headers` (saveProviderSetup does not
 * own headers, so the wizard patches them after the merge; reconnect re-applies from the form).
 */
function applyCloudflareGatewayIdHeader(
  config: DesktopConfigFile,
  providerId: string,
  cloudflareGatewayId: string | undefined,
): void {
  const entry = findProviderEntry(config.providers, providerId);
  if (!entry) {
    return;
  }
  const gatewayId = cloudflareGatewayId?.trim();
  if (gatewayId) {
    entry.headers = { ...entry.headers, [CLOUDFLARE_GATEWAY_ID_HEADER]: gatewayId };
  } else if (entry.headers && CLOUDFLARE_GATEWAY_ID_HEADER in entry.headers) {
    const rest = { ...entry.headers };
    delete rest[CLOUDFLARE_GATEWAY_ID_HEADER];
    if (Object.keys(rest).length > 0) {
      entry.headers = rest;
    } else {
      delete entry.headers;
    }
  }
}

/** Reload config.json into the in-memory host state after a wizard write. */
async function reloadStateConfig(state: HostModelState): Promise<void> {
  state.config = await loadConfig();
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

    const provider = request.provider?.trim() || undefined;
    const preset = provider ? findProviderPreset(provider) : undefined;
    const transportKind = resolveWizardTransportKind(
      preset?.defaultTransport,
      request.transportKind,
    );
    const awsRegion = request.awsRegion?.trim();
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
    assertWorkspaceIdRequired({
      provider,
      siteId: request.siteId,
      workspaceId: request.workspaceId,
      billingPlanId: request.billingPlanId,
    });

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

    const materializeInput = buildMaterializeInput({
      provider,
      customProviderLabel: request.customProviderLabel,
      transportKind,
      apiBase: request.apiBase,
      siteId: request.siteId,
      workspaceId: request.workspaceId,
      billingPlanId: request.billingPlanId,
      awsRegion,
      azureResourceName: request.azureResourceName,
      cloudflareAccountId,
      vertexProject,
      vertexLocation,
    });
    const existingProviderId = request.providerId?.trim() ?? "";
    // The entry id comes from the materialization (preset id, or the custom label slug); a
    // reconnect addresses the same entry and merges by key ownership.
    const materialized = materializeProviderPreset(materializeInput);
    const providerId = existingProviderId || materialized.id;

    const newIds = filterNewProviderModelIds(
      flattenProviders(state.config).map((profile) => ({
        providerId: profile.providerId,
        name: profile.name,
      })),
      uniqueIds,
      providerId,
    );
    const catalogEntries = previewCatalogMapForAddProviderRequest(request);
    const toAdd: ModelEntry[] = newIds.map((name) =>
      catalogEntryToModelEntry(name, catalogEntries.get(name)),
    );

    const catalogRefreshResult = {
      modelIds: uniqueIds,
      fromCache: false,
      modelCatalog: request.modelCatalog,
    };
    const configPreview = structuredClone(state.config);
    const previewConfigEntry = findProviderEntry(configPreview.providers, providerId);
    const prunedPreview = previewConfigEntry
      ? removeDelistedModelsFromCatalog(configPreview, previewConfigEntry, catalogRefreshResult)
      : [];
    const syncedPreview =
      previewConfigEntry && request.modelCatalog?.length
        ? syncExistingModelsFromCatalog(configPreview, previewConfigEntry, catalogRefreshResult)
        : 0;

    if (toAdd.length === 0 && syncedPreview === 0 && prunedPreview.length === 0) {
      throw new Error(i18n.t("error.modelsAlreadyExist"));
    }

    const setupOptions = buildSetupOptions({ provider, awsRegion, vertexProject, vertexLocation });
    const setupCredentials = buildSetupCredentials({
      apiKey,
      ...(accessKeyId ? { accessKeyId } : {}),
      ...(secretAccessKey ? { secretAccessKey } : {}),
      ...(vertexClientEmail ? { vertexClientEmail } : {}),
      ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    });
    await saveProviderSetup(spiritDataDir(), {
      materialize: materializeInput,
      ...(setupOptions ? { options: setupOptions } : {}),
      ...(Object.keys(setupCredentials).length > 0 ? { credentials: setupCredentials } : {}),
      models: toAdd,
      ...(toAdd[0] ? { activeModel: { providerId, name: toAdd[0].name } } : {}),
    });
    await reloadStateConfig(state);

    // The wizard owns `headers` for the Cloudflare gateway id (not covered by saveProviderSetup).
    if (provider === "cloudflare-ai-gateway" || cloudflareGatewayId) {
      applyCloudflareGatewayIdHeader(state.config, providerId, cloudflareGatewayId);
    }

    const writtenEntry = findProviderEntry(state.config.providers, providerId);
    if (writtenEntry) {
      removeDelistedModelsFromCatalog(state.config, writtenEntry, catalogRefreshResult);
      if (request.modelCatalog?.length) {
        syncExistingModelsFromCatalog(state.config, writtenEntry, catalogRefreshResult);
      }
    }

    if (!state.config.imageGenerationModel) {
      const imageEntry = toAdd.find((entry) => modelSupportsImageGeneration(entry));
      if (imageEntry) {
        state.config.imageGenerationModel = { providerId, name: imageEntry.name };
      }
    }
    if (!state.config.videoGenerationModel) {
      const videoEntry = toAdd.find((entry) => modelSupportsVideoGeneration(entry));
      if (videoEntry) {
        state.config.videoGenerationModel = { providerId, name: videoEntry.name };
      }
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
    if (!name) {
      throw new Error(i18n.t("error.modelNameRequired"));
    }
    const provider = request.provider?.trim() || "custom";
    if (
      provider === "azure" &&
      request.transportKind !== undefined &&
      request.transportKind !== "open-responses"
    ) {
      throw new Error(i18n.t("error.azureOpenResponsesOnly"));
    }
    const preset = findProviderPreset(provider);
    const transportKind = resolveWizardTransportKind(
      preset?.defaultTransport,
      request.transportKind,
    );
    const awsRegion = request.awsRegion?.trim();
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
    assertWorkspaceIdRequired({
      provider,
      siteId: request.siteId,
      workspaceId: request.workspaceId,
      billingPlanId: request.billingPlanId,
    });
    const apiKey = request.apiKey.trim();
    if (provider === "google-vertex-ai") {
      assertVertexConnectCredentials({
        apiKey,
        vertexProject,
        vertexLocation,
        vertexClientEmail: request.vertexClientEmail,
        vertexPrivateKey: request.vertexPrivateKey,
      });
    } else if (provider === "azure" && /\s/u.test(name)) {
      throw new Error(i18n.t("error.azureDeploymentNameWhitespace"));
    } else if (provider !== "cloudflare-ai-gateway" && provider !== "custom" && !apiKey) {
      throw new Error(i18n.t("error.apiKeyRequired"));
    }

    const materializeInput = buildMaterializeInput({
      provider,
      customProviderLabel: request.customProviderLabel,
      transportKind,
      apiBase: request.apiBase,
      siteId: request.siteId,
      workspaceId: request.workspaceId,
      billingPlanId: request.billingPlanId,
      awsRegion,
      azureResourceName,
      cloudflareAccountId,
      vertexProject,
      vertexLocation,
    });
    const materialized = materializeProviderPreset(materializeInput);
    const providerId = request.providerId?.trim() || materialized.id;

    const existingEntry = findProviderEntry(state.config.providers, providerId);
    if (existingEntry?.models.some((model) => model.name === name)) {
      throw new Error(i18n.t("error.modelExists", { name }));
    }

    const catalogEntry = await findCatalogEntryForModel({
      providerId: provider !== "custom" ? provider : undefined,
      transportKind,
      apiBase: materialized.apiBase,
      apiKey,
      model: name,
    });
    const requestedCapabilities = normalizeModelCapabilities(request.capabilities);

    const modelEntry: ModelEntry = catalogEntryToModelEntry(name, catalogEntry);
    const capabilities = resolveAddedModelCapabilities({
      providerId: provider,
      requestedCapabilities,
      catalogEntry,
    });
    if (capabilities) {
      modelEntry.capabilities = capabilities;
    }
    if (catalogEntry?.contextLength !== undefined && request.contextLength === undefined) {
      modelEntry.contextLength = catalogEntry.contextLength;
    }
    if (request.contextLength !== undefined) {
      const contextLength = parseModelContextLength(request.contextLength);
      if (contextLength === undefined) {
        throw new Error(i18n.t("error.contextLengthInvalid"));
      }
      modelEntry.contextLength = contextLength;
    }

    const setupOptions = buildSetupOptions({
      provider,
      awsRegion,
      vertexProject,
      vertexLocation,
    });
    const setupCredentials = buildSetupCredentials({
      apiKey,
      ...(request.accessKeyId ? { accessKeyId: request.accessKeyId } : {}),
      ...(request.secretAccessKey ? { secretAccessKey: request.secretAccessKey } : {}),
      ...(request.vertexClientEmail ? { vertexClientEmail: request.vertexClientEmail } : {}),
      ...(request.vertexPrivateKey ? { vertexPrivateKey: request.vertexPrivateKey } : {}),
    });
    await saveProviderSetup(spiritDataDir(), {
      materialize: materializeInput,
      ...(setupOptions ? { options: setupOptions } : {}),
      ...(Object.keys(setupCredentials).length > 0 ? { credentials: setupCredentials } : {}),
      models: [modelEntry],
      activeModel: { providerId, name },
    });
    await reloadStateConfig(state);
    if (provider === "cloudflare-ai-gateway" || cloudflareGatewayId) {
      applyCloudflareGatewayIdHeader(state.config, providerId, cloudflareGatewayId);
    }

    const modelRef: ModelRef = { providerId, name };
    state.config.activeModel = modelRef;
    ctx.clearActiveContextUsage();
    if (!state.config.imageGenerationModel && modelSupportsImageGeneration(modelEntry)) {
      state.config.imageGenerationModel = modelRef;
    }
    if (!state.config.videoGenerationModel && modelSupportsVideoGeneration(modelEntry)) {
      state.config.videoGenerationModel = modelRef;
    }
    await saveConfig(state.config);

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
      { ref: { providerId: ref.providerId.trim(), name: ref.name.trim() } },
    ];
    return finalizeModelRemoval(ctx, state, targetsToRemove);
  });
}

export async function removeProviderGroupCommand(
  ctx: HostModelCommandContext,
  request: RemoveProviderGroupRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const providerId = request.providerId.trim();
    if (!providerId) {
      throw new Error(i18n.t("error.modelNameRequired"));
    }
    const provider = findProviderEntry(state.config.providers, providerId);
    if (!provider || provider.models.length === 0) {
      throw new Error(i18n.t("error.noModelsInProvider"));
    }

    const targetsToRemove: ModelRemovalTarget[] = provider.models.map((model) => ({
      ref: { providerId, name: model.name },
    }));
    applyModelsRemovalToConfig(state.config, targetsToRemove);
    state.config.providers = state.config.providers.filter((entry) => entry.id !== providerId);
    await saveConfig(state.config);
    removeProviderKeyring(provider);
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
  const provider = request.provider.trim();
  if (!provider || provider === "custom") {
    throw new Error(i18n.t("error.providerDeleteOnly"));
  }
  return removeProviderGroupCommand(ctx, {
    providerId: provider,
  });
}

/** Deletes the entry's internal keyring credential accounts (`provider::{id}[::{slot}]`). */
function removeProviderKeyring(provider: ProviderEntry): void {
  const slots = providerCredentialSlotNames(
    resolveProviderTransportKind(provider),
    provider.sdk,
    provider.options,
  );
  for (const slot of slots) {
    deleteKeyringPassword(KEYRING_SERVICE, providerInternalSlotAccount(provider.id, slot));
  }
}

async function finalizeModelRemoval(
  ctx: HostModelCommandContext,
  state: HostModelState,
  targetsToRemove: readonly ModelRemovalTarget[],
): Promise<DesktopSnapshot> {
  applyModelsRemovalToConfig(state.config, targetsToRemove);
  state.config.providers = state.config.providers.filter((provider) => provider.models.length > 0);
  await saveConfig(state.config);
  await ctx.refreshModelKeyPresence();
  await ctx.refreshRuntime();
  ctx.setLastRuntimeError("");
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}
