import {
  resolveOpenResponsesReasoningSummary,
  type AnthropicTransportConfig,
  type LlmModelCapabilities,
  type LlmTransportConfig,
  type OpenResponsesSdkProvider,
} from "@spiritagent/agent-core";
import {
  resolveAnthropicTransportReasoningEffortForContext,
  resolveGroqTransportReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
} from "@spiritagent/agent-core/reasoning-effort";

import { bedrockMantleApiBaseFromRegion, isBedrockMantleOpenAiModel } from "./bedrock-mantle.js";
import type { ModelProviderId } from "./model-provider-presets.js";
import {
  loadActiveModelProfile,
  loadModelProfile,
  readBedrockCredentials,
  readGoogleVertexCredentials,
  resolveStoredApiKeyForProfile,
} from "./credentials/index.js";
import type { SpiritModelCapability, SpiritModelProfile } from "./credentials/types.js";
import { isEmptyModelRef, type ModelRef } from "./config-v2.js";
import { resolveProfileApiBase, resolveSetupTransportKind } from "./provider-setup.js";

export interface ResolveTransportContext {
  workspaceRoot: string;
  spiritDataDir: string;
  modelRef?: ModelRef;
}

function modelCapabilitiesFromConfig(
  capabilities: readonly SpiritModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes("chat") ? { chat: true } : {}),
    ...(capabilities.includes("image") ? { imageInput: true } : {}),
    ...(capabilities.includes("video") ? { videoInput: true } : {}),
    ...(capabilities.includes("imageGeneration") ? { imageGeneration: true } : {}),
  };
}

function openAiCompatibleVendorFromProvider(
  provider?: ModelProviderId,
): Exclude<ModelProviderId, "anthropic" | "amazon-bedrock"> | undefined {
  return provider && provider !== "anthropic" && provider !== "amazon-bedrock"
    ? provider
    : undefined;
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

function buildTransportFromProfile(
  profile: SpiritModelProfile,
  apiKey: string,
  workspaceRoot: string,
): LlmTransportConfig {
  const baseUrl = resolveProfileApiBase(profile);
  const transportKind = resolveSetupTransportKind(
    profile.provider ?? "custom",
    profile.transportKind,
  );
  const model = profile.name;

  if (profile.provider === "amazon-bedrock" && isBedrockMantleOpenAiModel(model)) {
    const region = profile.awsRegion?.trim();
    if (!region) {
      throw new Error("Amazon Bedrock model is missing AWS region configuration.");
    }
    const bedrockCredentials = readBedrockCredentials("amazon-bedrock", profile.groupId);
    const resolvedApiKey = apiKey.trim() || bedrockCredentials.apiKey?.trim() || "";
    const accessKeyId = bedrockCredentials.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials.secretAccessKey?.trim();
    if (!resolvedApiKey && !(accessKeyId && secretAccessKey)) {
      throw new Error("Amazon Bedrock Mantle requires a Bearer API key or IAM credentials.");
    }
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        provider: "openai",
        transportKind: "open-responses",
        model,
      },
    );
    const mantleBaseUrl = bedrockMantleApiBaseFromRegion(region);
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      llmVendor: "openai",
      model,
      baseUrl: mantleBaseUrl,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: "open-responses",
      apiKey: resolvedApiKey,
      model,
      baseUrl: mantleBaseUrl,
      workspaceRoot,
      agentMode: "agent",
      responsesProvider: "openai",
      llmVendor: "openai",
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(!resolvedApiKey && accessKeyId && secretAccessKey
        ? {
            bedrockMantleIam: {
              region,
              accessKeyId,
              secretAccessKey,
            },
          }
        : {}),
    };
  }

  if (transportKind === "open-responses") {
    const llmVendor = openAiCompatibleVendorFromProvider(profile.provider);
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        transportKind: "open-responses",
        model,
      },
    );
    const responsesProvider: OpenResponsesSdkProvider | undefined =
      profile.provider === "openai"
        ? "openai"
        : profile.provider === "xai"
          ? "xai"
          : profile.provider === "vercel-ai-gateway" ||
              profile.provider === "cloudflare-ai-gateway" ||
              profile.provider === "openrouter"
            ? undefined
            : "open-responses-compatible";
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      ...(llmVendor ? { llmVendor } : {}),
      model,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });
    const cloudflareGatewayId = profile.cloudflareGatewayId?.trim();

    return {
      transportKind: "open-responses",
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      agentMode: "agent",
      ...(responsesProvider ? { responsesProvider } : {}),
      ...(llmVendor ? { llmVendor } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
    };
  }

  if (transportKind === "anthropic") {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(
      profile.supportedReasoningEfforts,
    );
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        ...(profile.transportKind ? { transportKind: profile.transportKind } : {}),
        model,
      },
    );
    const cloudflareGatewayId = profile.cloudflareGatewayId?.trim();
    const llmVendor = openAiCompatibleVendorFromProvider(profile.provider);
    return {
      transportKind: "anthropic",
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      ...(llmVendor ? { llmVendor } : {}),
      ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
    };
  }

  if (transportKind === "bedrock") {
    const region = profile.awsRegion?.trim();
    if (!region) {
      throw new Error("Amazon Bedrock model is missing AWS region configuration.");
    }
    const bedrockCredentials = readBedrockCredentials("amazon-bedrock", profile.groupId);
    const resolvedApiKey = apiKey.trim() || bedrockCredentials.apiKey?.trim() || "";
    const accessKeyId = bedrockCredentials.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials.secretAccessKey?.trim();
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        transportKind: "bedrock",
        model,
      },
    );
    return {
      transportKind: "bedrock",
      model,
      region,
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
      ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      baseUrl,
      workspaceRoot,
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    };
  }

  const llmVendor = openAiCompatibleVendorFromProvider(profile.provider);
  const reasoningEffortContext = {
    ...(profile.provider ? { provider: profile.provider } : {}),
    ...(profile.transportKind ? { transportKind: profile.transportKind } : {}),
    model,
  };
  const normalizedReasoningEffort =
    profile.provider === "groq"
      ? resolveGroqTransportReasoningEffortForContext(
          profile.reasoningEffort,
          reasoningEffortContext,
        )
      : resolveOpenAiTransportReasoningEffortForContext(
          profile.reasoningEffort,
          reasoningEffortContext,
        );
  const vertexCredentials =
    profile.provider === "google-vertex-ai"
      ? readGoogleVertexCredentials("google-vertex-ai", profile.groupId)
      : undefined;
  const vertexProject = profile.vertexProject?.trim();
  const vertexLocation = profile.vertexLocation?.trim();
  const vertexClientEmail = vertexCredentials?.clientEmail?.trim();
  const vertexPrivateKey = vertexCredentials?.privateKey?.trim();
  const cloudflareGatewayId = profile.cloudflareGatewayId?.trim();

  return {
    transportKind: "openai-compatible",
    apiKey,
    model,
    baseUrl,
    workspaceRoot,
    ...(llmVendor ? { llmVendor } : {}),
    ...(cloudflareGatewayId ? { cloudflareGatewayId } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    ...(profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
      : {}),
    ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
  };
}

export const NO_ACTIVE_MODEL_ERROR = "No active model configured. Run provider setup first.";

export type ResolveTransportResult =
  | { ok: true; config: LlmTransportConfig }
  | { ok: false; error: string };

/**
 * Placeholder transport so CLI/Desktop can boot without a model. Turns must
 * still fail with the unresolved setup error rather than calling the LLM.
 */
export function unconfiguredTransportConfig(workspaceRoot: string): LlmTransportConfig {
  return {
    transportKind: "openai-compatible",
    apiKey: "",
    model: "",
    workspaceRoot,
  };
}

/**
 * Resolves LLM transport from shared Spirit config + keyring without throwing
 * for expected setup gaps (no model, missing key). Unexpected profile errors
 * from `buildTransportFromProfile` still throw.
 */
export function tryResolveTransportConfig(
  context: ResolveTransportContext,
): ResolveTransportResult {
  const modelRef =
    context.modelRef && !isEmptyModelRef(context.modelRef) ? context.modelRef : undefined;
  const profile = modelRef
    ? loadModelProfile(context.spiritDataDir, modelRef)
    : loadActiveModelProfile(context.spiritDataDir);
  if (!profile) {
    return { ok: false, error: NO_ACTIVE_MODEL_ERROR };
  }

  const apiKey = resolveStoredApiKeyForProfile(profile) ?? "";
  if (!apiKey.trim() && profile.provider === "google-vertex-ai") {
    const vertex = readGoogleVertexCredentials("google-vertex-ai", profile.groupId);
    const hasVertex = Boolean(
      vertex.apiKey?.trim() || (vertex.clientEmail?.trim() && vertex.privateKey?.trim()),
    );
    if (!hasVertex) {
      return {
        ok: false,
        error: `No Vertex credentials found for model "${profile.name}". Run setup again.`,
      };
    }
  } else if (
    !apiKey.trim() &&
    profile.provider !== "amazon-bedrock" &&
    profile.provider !== "custom"
  ) {
    return {
      ok: false,
      error: `No API key found for model "${profile.name}". Run setup again.`,
    };
  }

  return { ok: true, config: buildTransportFromProfile(profile, apiKey, context.workspaceRoot) };
}

/**
 * Resolves LLM transport from shared Spirit config + keyring. Hosts call this
 * in-process so secrets never cross an IPC/WS boundary.
 */
export function resolveTransportConfig(context: ResolveTransportContext): LlmTransportConfig {
  const result = tryResolveTransportConfig(context);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.config;
}
