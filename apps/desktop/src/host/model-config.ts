import {
  applyCodeCompletionTransportProfile,
  resolveOpenResponsesReasoningSummary,
  type AnthropicTransportConfig,
  type LlmModelCapabilities,
  type LlmTransportConfig,
  type OpenResponsesSdkProvider,
} from "@spiritagent/agent-core";
import {
  isXiaomiResponsesReasoningEffortContext,
  resolveAnthropicTransportReasoningEffortForContext,
  resolveGroqTransportReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
  resolveOpenAiTransportReasoningModeForContext,
  type ModelReasoningEffortContext,
} from "@spiritagent/agent-core/reasoning-effort";
import {
  modelSupportsThinkingSwitch,
  resolveAnthropicExplicitThinkingConfig,
  resolveVendorExtendedThinking,
  shouldPinReasoningEffortToDefault,
} from "@spiritagent/agent-core/model-thinking-controls";
import {
  listProviderModels,
  listProviderConnectSiteOptions,
  providerSupportsSiteSelection,
  resolveProviderConnectApiBase,
  bedrockApiBaseFromRegion,
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
  azureApiBaseFromResourceName,
  cloudflareAiGatewayApiBaseFromAccountId,
  vertexApiBaseFromProjectAndLocation,
  type ProviderListedModelEntry,
} from "@spiritagent/host-internal";

import type {
  AddProviderModelsRequest,
  DesktopAgentMode,
  DesktopModelCapability,
  DesktopModelCatalogHint,
  DesktopModelProvider,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from "../types.js";
import type { BedrockProviderCredentials } from "./provider-api-key.js";
import type { GoogleVertexProviderCredentials } from "./provider-api-key.js";
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
  writeModelCatalogCache,
} from "./model-catalog-cache.js";
import { invalidateModelCatalogHintsMemo } from "./snapshot.js";
import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesProviderListedModelCatalogMetadata,
} from "./model-catalog-metadata.js";
import { findModelCatalogEntry } from "../lib/model-catalog-detail.js";
import {
  resolveComposerDirectMediaTool,
  type DirectMediaTool,
} from "../lib/composer-direct-media.js";
import { DEFAULT_API_BASE, defaultCustomModelCapabilities } from "./storage.js";

export { resolveComposerDirectMediaTool, type DirectMediaTool };

function inferProviderSiteFromStoredApiBase(
  profile: Pick<ModelProfileSnapshot, "provider" | "transportKind" | "apiBase">,
): ModelProfileSnapshot["providerSite"] | undefined {
  const provider = profile.provider;
  if (!provider || !providerSupportsSiteSelection(provider)) {
    return undefined;
  }
  const storedApiBase = profile.apiBase?.trim();
  if (!storedApiBase) {
    return undefined;
  }
  const transportKind = resolveDesktopTransportKind(profile);
  for (const option of listProviderConnectSiteOptions(provider)) {
    const siteApiBase = resolveProviderConnectApiBase(provider, transportKind, { site: option.id });
    if (storedApiBase === siteApiBase) {
      return option.id as ModelProfileSnapshot["providerSite"];
    }
  }
  return undefined;
}

export function resolveProfileApiBase(
  profile: Pick<
    ModelProfileSnapshot,
    | "name"
    | "provider"
    | "transportKind"
    | "apiBase"
    | "awsRegion"
    | "azureResourceName"
    | "cloudflareAccountId"
    | "cloudflareGatewayId"
    | "vertexProject"
    | "vertexLocation"
    | "providerSite"
    | "alibabaWorkspaceId"
    | "alibabaBillingMode"
    | "stepfunBillingMode"
    | "zAiBillingMode"
    | "zhipuBillingMode"
  >,
): string {
  if (profile.provider === "amazon-bedrock") {
    const region = profile.awsRegion?.trim();
    if (region) {
      if (isBedrockMantleOpenAiModel(profile.name)) {
        return bedrockMantleApiBaseFromRegion(region);
      }
      return bedrockApiBaseFromRegion(region);
    }
  }

  if (profile.provider === "google-vertex-ai") {
    const project = profile.vertexProject?.trim();
    const location = profile.vertexLocation?.trim();
    if (project && location) {
      return vertexApiBaseFromProjectAndLocation(project, location);
    }
    return profile.apiBase?.trim() || "";
  }

  if (profile.provider === "azure") {
    const resourceName = profile.azureResourceName?.trim();
    if (resourceName) {
      return azureApiBaseFromResourceName(resourceName);
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    throw new Error("Azure model is missing the azureResourceName configuration.");
  }

  if (profile.provider === "cloudflare-ai-gateway") {
    const accountId = profile.cloudflareAccountId?.trim();
    if (accountId) {
      return cloudflareAiGatewayApiBaseFromAccountId(accountId);
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    throw new Error(
      "Cloudflare AI Gateway model is missing the cloudflareAccountId configuration.",
    );
  }

  if (profile.provider && profile.provider !== "custom") {
    const providerSite = profile.providerSite ?? inferProviderSiteFromStoredApiBase(profile);
    return defaultApiBaseForTransport(
      profile.provider,
      resolveDesktopTransportKind(profile),
      providerSite,
      profile.alibabaWorkspaceId,
      profile.alibabaBillingMode,
      profile.stepfunBillingMode,
      profile.zAiBillingMode,
      profile.zhipuBillingMode,
    );
  }

  const trimmed = profile.apiBase?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_API_BASE;
}

export function resolveDesktopTransportKind(
  profile?: Pick<ModelProfileSnapshot, "provider" | "transportKind">,
): DesktopTransportKind {
  const requested = profile?.transportKind;
  if (requested) {
    if (
      (profile?.provider === "google" || profile?.provider === "google-vertex-ai") &&
      (requested === "open-responses" || requested === "anthropic")
    ) {
      return "openai-compatible";
    }
    if (
      profile?.provider === "azure" ||
      profile?.provider === "openai" ||
      profile?.provider === "deepseek"
    ) {
      return "open-responses";
    }
    return requested;
  }

  return profile?.provider === "anthropic"
    ? "anthropic"
    : profile?.provider === "minimax"
      ? "anthropic"
      : profile?.provider === "amazon-bedrock"
        ? "bedrock"
        : profile?.provider === "azure" ||
            profile?.provider === "openai" ||
            profile?.provider === "deepseek"
          ? "open-responses"
          : "openai-compatible";
}

export function defaultApiBaseForTransport(
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
  providerSite?: ModelProfileSnapshot["providerSite"],
  alibabaWorkspaceId?: string,
  alibabaBillingMode?: ModelProfileSnapshot["alibabaBillingMode"],
  stepfunBillingMode?: ModelProfileSnapshot["stepfunBillingMode"],
  zAiBillingMode?: ModelProfileSnapshot["zAiBillingMode"],
  zhipuBillingMode?: ModelProfileSnapshot["zhipuBillingMode"],
): string {
  if (!provider) {
    return DEFAULT_API_BASE;
  }

  return resolveProviderConnectApiBase(
    provider,
    transportKind ?? resolveDesktopTransportKind({ provider }),
    {
      ...(alibabaBillingMode === "token-plan" ? { billingMode: "token-plan" } : {}),
      ...(stepfunBillingMode === "step-plan" ? { stepfunBillingMode: "step-plan" } : {}),
      ...(zAiBillingMode === "glm-coding-plan" ? { zAiBillingMode: "glm-coding-plan" } : {}),
      ...(zhipuBillingMode === "glm-coding-plan" ? { zhipuBillingMode: "glm-coding-plan" } : {}),
      ...(alibabaBillingMode === "token-plan"
        ? {}
        : {
            ...(providerSite ? { site: providerSite } : {}),
            ...(alibabaWorkspaceId?.trim() ? { workspaceId: alibabaWorkspaceId.trim() } : {}),
          }),
    },
  );
}

export function reasoningProviderForTransport(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): DesktopModelProvider | undefined {
  if (transportKind === "anthropic") {
    return "anthropic";
  }

  if (transportKind === "open-responses" && provider === "openai") {
    return "openai";
  }

  return provider;
}

export function openAiCompatibleVendorFromProvider(
  provider?: DesktopModelProvider,
): Exclude<DesktopModelProvider, "anthropic" | "amazon-bedrock"> | undefined {
  return provider && provider !== "anthropic" && provider !== "amazon-bedrock"
    ? provider
    : undefined;
}

type AgentModelProfileFields = Pick<
  ModelProfileSnapshot,
  | "provider"
  | "transportKind"
  | "reasoningEffort"
  | "reasoningMode"
  | "supportedReasoningEfforts"
  | "thinkingEnabled"
  | "supportsThinkingType"
  | "supportsThinkingSwitch"
>;

function buildAgentModelReasoningContext(
  profile: AgentModelProfileFields | undefined,
  model: string,
): ModelReasoningEffortContext {
  return {
    ...(profile?.provider ? { provider: profile.provider } : {}),
    ...(profile?.transportKind ? { transportKind: profile.transportKind } : {}),
    ...(profile?.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: profile.supportedReasoningEfforts }
      : {}),
    ...(profile?.supportsThinkingType
      ? { supportsThinkingType: profile.supportsThinkingType }
      : {}),
    ...(profile?.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
    model,
  };
}

function resolveAgentOpenAiReasoningEffort(
  profile: AgentModelProfileFields | undefined,
  model: string,
  transportKind: NonNullable<ModelReasoningEffortContext["transportKind"]>,
) {
  const context = {
    ...buildAgentModelReasoningContext(profile, model),
    transportKind,
  };
  const thinkingEnabled = profile?.thinkingEnabled !== false;
  if (isXiaomiResponsesReasoningEffortContext(context) && profile?.thinkingEnabled === false) {
    return "none";
  }
  if (
    modelSupportsThinkingSwitch(context) &&
    shouldPinReasoningEffortToDefault(thinkingEnabled, context)
  ) {
    return undefined;
  }
  if (context.provider === "groq") {
    return resolveGroqTransportReasoningEffortForContext(profile?.reasoningEffort, context);
  }
  return resolveOpenAiTransportReasoningEffortForContext(profile?.reasoningEffort, context);
}

function resolveAgentOpenAiReasoningMode(
  profile: AgentModelProfileFields | undefined,
  model: string,
  transportKind: NonNullable<ModelReasoningEffortContext["transportKind"]>,
) {
  const context = {
    ...buildAgentModelReasoningContext(profile, model),
    transportKind,
  };
  return resolveOpenAiTransportReasoningModeForContext(profile?.reasoningMode, context);
}

function resolveAgentVendorExtendedThinking(
  profile: AgentModelProfileFields | undefined,
  model: string,
): boolean | undefined {
  const context = buildAgentModelReasoningContext(profile, model);
  if (!modelSupportsThinkingSwitch(context)) {
    return undefined;
  }
  return resolveVendorExtendedThinking(profile?.thinkingEnabled);
}

function resolveAgentAnthropicExplicitThinking(
  profile: AgentModelProfileFields | undefined,
  model: string,
): AnthropicTransportConfig["thinking"] | undefined {
  const context = buildAgentModelReasoningContext(profile, model);
  return resolveAnthropicExplicitThinkingConfig(profile?.thinkingEnabled, context);
}

export function buildPrimaryTransportConfig(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  workspaceRoot: string;
  agentMode?: DesktopAgentMode;
  bedrockCredentials?: BedrockProviderCredentials;
  googleVertexCredentials?: GoogleVertexProviderCredentials;
  profile?: Pick<
    ModelProfileSnapshot,
    | "provider"
    | "transportKind"
    | "capabilities"
    | "reasoningEffort"
    | "reasoningMode"
    | "supportedReasoningEfforts"
    | "thinkingEnabled"
    | "awsRegion"
    | "azureResourceName"
    | "cloudflareAccountId"
    | "cloudflareGatewayId"
    | "vertexProject"
    | "vertexLocation"
    | "supportsThinkingType"
    | "supportsThinkingSwitch"
  >;
}): LlmTransportConfig {
  const agentMode = input.agentMode ?? "agent";
  const transportKind = resolveDesktopTransportKind(input.profile);

  if (input.profile?.provider === "amazon-bedrock" && isBedrockMantleOpenAiModel(input.model)) {
    const region = input.profile.awsRegion?.trim();
    if (!region) {
      throw new Error("Amazon Bedrock model is missing the AWS region configuration.");
    }
    const bedrockCredentials = input.bedrockCredentials;
    const apiKey = input.apiKey.trim() || bedrockCredentials?.apiKey?.trim();
    const accessKeyId = bedrockCredentials?.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials?.secretAccessKey?.trim();
    const sessionToken = bedrockCredentials?.sessionToken?.trim();
    if (!apiKey && !(accessKeyId && secretAccessKey)) {
      throw new Error("Amazon Bedrock Mantle model requires a Bearer API Key or IAM credentials.");
    }
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        provider: "openai",
        transportKind: "open-responses",
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    const mantleBaseUrl = bedrockMantleApiBaseFromRegion(region);
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      llmVendor: "openai",
      model: input.model,
      baseUrl: mantleBaseUrl,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: "open-responses",
      apiKey: apiKey ?? "",
      model: input.model,
      baseUrl: mantleBaseUrl,
      workspaceRoot: input.workspaceRoot,
      agentMode,
      responsesProvider: "openai",
      llmVendor: "openai",
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(!apiKey && accessKeyId && secretAccessKey
        ? {
            bedrockMantleIam: {
              region,
              accessKeyId,
              secretAccessKey,
              ...(sessionToken ? { sessionToken } : {}),
            },
          }
        : {}),
    };
  }

  if (transportKind === "open-responses") {
    const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
    const normalizedReasoningEffort = resolveAgentOpenAiReasoningEffort(
      input.profile,
      input.model,
      "open-responses",
    );
    const normalizedReasoningMode = resolveAgentOpenAiReasoningMode(
      input.profile,
      input.model,
      "open-responses",
    );
    const responsesProvider: OpenResponsesSdkProvider | undefined =
      input.profile?.provider === "openai" || input.profile?.provider === "fireworks-ai"
        ? "openai"
        : input.profile?.provider === "xai"
          ? "xai"
          : input.profile?.provider === "vercel-ai-gateway" ||
              input.profile?.provider === "cloudflare-ai-gateway" ||
              input.profile?.provider === "openrouter"
            ? undefined
            : "open-responses-compatible";
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      ...(llmVendor ? { llmVendor } : {}),
      model: input.model,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });
    const vendorExtendedThinking = resolveAgentVendorExtendedThinking(input.profile, input.model);
    const cloudflareGatewayId = input.profile?.cloudflareGatewayId?.trim();

    return {
      transportKind: "open-responses",
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      agentMode,
      ...(responsesProvider ? { responsesProvider } : {}),
      ...(llmVendor ? { llmVendor } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(normalizedReasoningMode ? { reasoningMode: normalizedReasoningMode } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(vendorExtendedThinking === false ? { vendorExtendedThinking: false as const } : {}),
    };
  }

  if (transportKind === "anthropic") {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(
      input.profile?.supportedReasoningEfforts,
    );
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        ...(input.profile?.transportKind ? { transportKind: input.profile.transportKind } : {}),
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    const explicitThinking = resolveAgentAnthropicExplicitThinking(input.profile, input.model);
    const vendorExtendedThinking = resolveAgentVendorExtendedThinking(input.profile, input.model);
    const cloudflareGatewayId = input.profile?.cloudflareGatewayId?.trim();
    const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
    const meituanThinkingSwitch =
      llmVendor === "meituan" && input.profile?.supportsThinkingSwitch === true;
    return {
      transportKind: "anthropic",
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(llmVendor ? { llmVendor } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
      ...(!meituanThinkingSwitch && explicitThinking ? { thinking: explicitThinking } : {}),
      ...(input.profile?.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
      ...(vendorExtendedThinking === false ? { vendorExtendedThinking: false as const } : {}),
    };
  }

  if (transportKind === "bedrock") {
    const region = input.profile?.awsRegion?.trim();
    if (!region) {
      throw new Error("Amazon Bedrock model is missing the AWS region configuration.");
    }
    const bedrockCredentials = input.bedrockCredentials;
    const apiKey = input.apiKey.trim() || bedrockCredentials?.apiKey?.trim();
    const accessKeyId = bedrockCredentials?.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials?.secretAccessKey?.trim();
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        transportKind: "bedrock",
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    return {
      transportKind: "bedrock",
      model: input.model,
      region,
      ...(apiKey ? { apiKey } : {}),
      ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    };
  }

  const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
  const normalizedReasoningEffort = resolveAgentOpenAiReasoningEffort(
    input.profile,
    input.model,
    "openai-compatible",
  );
  const normalizedReasoningMode = resolveAgentOpenAiReasoningMode(
    input.profile,
    input.model,
    "openai-compatible",
  );
  const vendorExtendedThinking = resolveAgentVendorExtendedThinking(input.profile, input.model);
  const vertexCredentials = input.googleVertexCredentials;
  const vertexProject = input.profile?.vertexProject?.trim();
  const vertexLocation = input.profile?.vertexLocation?.trim();
  const vertexClientEmail = vertexCredentials?.clientEmail?.trim();
  const vertexPrivateKey = vertexCredentials?.privateKey?.trim();
  const cloudflareGatewayId = input.profile?.cloudflareGatewayId?.trim();
  return {
    apiKey: input.apiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    workspaceRoot: input.workspaceRoot,
    ...(llmVendor ? { llmVendor } : {}),
    ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    ...(input.profile?.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
    ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    ...(normalizedReasoningMode ? { reasoningMode: normalizedReasoningMode } : {}),
    ...(vendorExtendedThinking === false ? { vendorExtendedThinking: false as const } : {}),
    ...(input.profile?.supportsThinkingSwitch === true ? { supportsThinkingSwitch: true } : {}),
  };
}

/** Code completion uses a lightweight model; disabling the thinking policy is handled centrally by the agent-core transport-profile. */
export function buildCodeCompletionTransportConfig(
  input: Parameters<typeof buildPrimaryTransportConfig>[0],
): LlmTransportConfig {
  return applyCodeCompletionTransportProfile(buildPrimaryTransportConfig(input));
}

export function modelCapabilitiesFromConfig(
  capabilities: readonly DesktopModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes("languageModel") ? { languageModel: true } : {}),
    ...(capabilities.includes("image") ? { imageInput: true } : {}),
    ...(capabilities.includes("video") ? { videoInput: true } : {}),
    ...(capabilities.includes("imageGeneration") ? { imageGeneration: true } : {}),
  };
}

function normalizeAnthropicSupportedEfforts(
  efforts?: readonly string[],
): AnthropicTransportConfig["supportedEfforts"] {
  if (efforts === undefined) {
    return undefined;
  }

  return efforts.filter(
    (effort): effort is NonNullable<AnthropicTransportConfig["supportedEfforts"]>[number] =>
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "xhigh" ||
      effort === "max",
  );
}

export function supportsImageGeneration(model: {
  capabilities?: readonly DesktopModelCapability[];
}): boolean {
  return model.capabilities?.includes("imageGeneration") === true;
}

export function supportsVideoGeneration(model: {
  capabilities?: readonly DesktopModelCapability[];
}): boolean {
  return model.capabilities?.includes("videoGeneration") === true;
}

export function buildImageGenerationSubConfig(input: {
  profile: Pick<
    ModelProfileSnapshot,
    "name" | "apiBase" | "provider" | "capabilities" | "transportKind"
  >;
  apiKey: string;
  inferenceProvider?: string;
}) {
  const imageGenerationVendor = openAiCompatibleVendorFromProvider(input.profile.provider);
  return {
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
    ...(imageGenerationVendor ? { llmVendor: imageGenerationVendor } : {}),
    ...(input.profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
    ...(input.inferenceProvider ? { inferenceProvider: input.inferenceProvider } : {}),
  };
}

export function buildVideoGenerationSubConfig(input: {
  profile: Pick<
    ModelProfileSnapshot,
    "name" | "apiBase" | "provider" | "capabilities" | "transportKind"
  >;
  apiKey: string;
  inferenceProvider?: string;
}) {
  const videoGenerationVendor = openAiCompatibleVendorFromProvider(input.profile.provider);
  return {
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
    ...(videoGenerationVendor ? { llmVendor: videoGenerationVendor } : {}),
    ...(input.profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
    ...(input.inferenceProvider ? { inferenceProvider: input.inferenceProvider } : {}),
  };
}

export function buildMediaOnlyTransportConfig(
  toolName: DirectMediaTool,
  input: {
    profile: Pick<ModelProfileSnapshot, "name" | "apiBase" | "provider" | "capabilities">;
    apiKey: string;
  },
): LlmTransportConfig {
  const shell = {
    transportKind: "openai-compatible" as const,
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
  };

  if (toolName === "generate_image") {
    return {
      ...shell,
      imageGeneration: buildImageGenerationSubConfig(input),
    } as LlmTransportConfig;
  }

  return {
    ...shell,
    videoGeneration: buildVideoGenerationSubConfig(input),
  } as LlmTransportConfig;
}

function resolveMediaInferenceProvider(
  profile: ModelProfileSnapshot,
  catalogHints: readonly DesktopModelCatalogHint[] | undefined,
): string | undefined {
  return findModelCatalogEntry(profile, catalogHints)?.inferenceProvider;
}

export function attachVideoGenerationToTransportConfig(
  transportConfig: LlmTransportConfig,
  input: {
    profile?: ModelProfileSnapshot;
    apiKey?: string;
    catalogHints?: readonly DesktopModelCatalogHint[];
  },
): LlmTransportConfig {
  if (!input.profile || !input.apiKey || !supportsVideoGeneration(input.profile)) {
    return transportConfig;
  }
  if (transportConfig.transportKind === "anthropic") {
    return transportConfig;
  }

  return {
    ...transportConfig,
    videoGeneration: buildVideoGenerationSubConfig({
      profile: input.profile,
      apiKey: input.apiKey,
      inferenceProvider: resolveMediaInferenceProvider(input.profile, input.catalogHints),
    }),
  } as LlmTransportConfig;
}

export function attachImageGenerationToTransportConfig(
  transportConfig: LlmTransportConfig,
  input: {
    profile?: ModelProfileSnapshot;
    apiKey?: string;
    catalogHints?: readonly DesktopModelCatalogHint[];
  },
): LlmTransportConfig {
  if (!input.profile || !input.apiKey || !supportsImageGeneration(input.profile)) {
    return transportConfig;
  }
  if (transportConfig.transportKind === "anthropic") {
    return transportConfig;
  }

  return {
    ...transportConfig,
    imageGeneration: buildImageGenerationSubConfig({
      profile: input.profile,
      apiKey: input.apiKey,
      inferenceProvider: resolveMediaInferenceProvider(input.profile, input.catalogHints),
    }),
  } as LlmTransportConfig;
}

interface LoadedPreviewModelsResult {
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

export type { LoadedPreviewModelsResult };

export async function loadPreviewModelsForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  cloudflareAccountId?: string;
  forceRefresh: boolean;
}): Promise<LoadedPreviewModelsResult> {
  const cached = await readModelCatalogCache(
    input.apiBase,
    input.apiKey,
    input.provider,
    input.transportKind,
  );
  const now = Date.now();
  if (cached && isModelCatalogCacheFresh(cached, now, input.forceRefresh)) {
    return {
      modelIds: cached.modelIds,
      ...(cached.modelCatalog ? { modelCatalog: cached.modelCatalog } : {}),
      fromCache: true,
    };
  }

  const listedModels = await listProviderModels({
    provider: input.provider,
    transportKind: input.transportKind,
    baseUrl: input.apiBase,
    apiKey: input.apiKey,
    ...(input.awsRegion ? { awsRegion: input.awsRegion } : {}),
    ...(input.accessKeyId ? { accessKeyId: input.accessKeyId } : {}),
    ...(input.secretAccessKey ? { secretAccessKey: input.secretAccessKey } : {}),
    ...(input.vertexProject ? { vertexProject: input.vertexProject } : {}),
    ...(input.vertexLocation ? { vertexLocation: input.vertexLocation } : {}),
    ...(input.vertexClientEmail ? { vertexClientEmail: input.vertexClientEmail } : {}),
    ...(input.vertexPrivateKey ? { vertexPrivateKey: input.vertexPrivateKey } : {}),
    ...(input.cloudflareAccountId ? { cloudflareAccountId: input.cloudflareAccountId } : {}),
  });
  const modelCatalog = previewModelCatalogForProvider(
    input.provider,
    input.transportKind,
    listedModels,
  );
  const modelIds = listedModels.map((entry) => entry.id);
  await writeModelCatalogCache(
    input.apiBase,
    modelIds,
    input.apiKey,
    modelCatalog,
    input.provider,
    input.transportKind,
  );
  // The catalog cache file was updated; invalidate the snapshot-side in-memory memo so the next buildSnapshot re-reads the new catalog
  invalidateModelCatalogHintsMemo();
  return {
    modelIds,
    ...(modelCatalog ? { modelCatalog } : {}),
    fromCache: false,
  };
}

function previewModelCatalogForProvider(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
  listedModels: readonly ProviderListedModelEntry[],
): PreviewModelCatalogEntry[] | undefined {
  return previewModelCatalogForTransport({ provider, transportKind, listedModels });
}

export function previewCatalogMapForAddProviderRequest(
  request: AddProviderModelsRequest,
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): Map<string, PreviewModelCatalogEntry> {
  return previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: request.modelCatalog,
  });
}

export async function findCatalogEntryForModel(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  model: string;
}): Promise<PreviewModelCatalogEntry | undefined> {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  try {
    const preview = await loadPreviewModelsForTransport({
      provider: input.provider,
      transportKind: input.transportKind,
      apiBase: input.apiBase,
      apiKey: input.apiKey,
      forceRefresh: false,
    });
    return preview.modelCatalog?.find((entry) => entry.id === input.model);
  } catch {
    return undefined;
  }
}

export function resolveAddedModelCapabilities(input: {
  provider?: DesktopModelProvider;
  requestedCapabilities?: DesktopModelCapability[];
  catalogEntry?: PreviewModelCatalogEntry;
}): DesktopModelCapability[] | undefined {
  if (input.catalogEntry?.capabilities) {
    const merged = [...input.catalogEntry.capabilities];
    if (
      input.requestedCapabilities?.includes("imageGeneration") === true &&
      !merged.includes("imageGeneration")
    ) {
      merged.push("imageGeneration");
    }
    return merged;
  }

  if (input.requestedCapabilities) {
    return input.requestedCapabilities;
  }

  return input.provider === "custom" ? defaultCustomModelCapabilities() : undefined;
}
