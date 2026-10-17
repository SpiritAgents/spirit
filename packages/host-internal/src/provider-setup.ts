import { cloudflareAiGatewayApiBaseFromAccountId } from "@spiritagent/agent-core/cloudflare-ai-gateway-resource";

import {
  resolveProviderConnectApiBase,
  type ModelProviderId,
  type ProviderModelTransportKind,
} from "./model-provider-presets.js";

const DEFAULT_API_BASE = "https://api.openai.com/v1";

/**
 * Shared provider → transport-kind resolution used by host setup flows and
 * by `resolveTransportConfig` when building a runtime transport from the
 * stored model profile.
 */
export function resolveSetupTransportKind(
  provider: ModelProviderId,
  requested?: ProviderModelTransportKind,
): ProviderModelTransportKind {
  if (requested) {
    if (
      (provider === "google" || provider === "google-vertex-ai") &&
      (requested === "open-responses" || requested === "anthropic")
    ) {
      return "openai-compatible";
    }
    if (provider === "azure" || provider === "openai") {
      return "open-responses";
    }
    return requested;
  }

  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "minimax") {
    return "anthropic";
  }
  if (provider === "amazon-bedrock") {
    return "bedrock";
  }
  if (provider === "azure" || provider === "openai") {
    return "open-responses";
  }
  return "openai-compatible";
}

export function resolveProfileApiBase(profile: {
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  apiBase?: string;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: "token-plan" | undefined;
  stepfunBillingMode?: "step-plan" | undefined;
  zAiBillingMode?: "glm-coding-plan" | undefined;
  zhipuBillingMode?: "glm-coding-plan" | undefined;
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): string {
  if (profile.provider === "amazon-bedrock") {
    const region = profile.awsRegion?.trim();
    if (region) {
      return resolveProviderConnectApiBase("amazon-bedrock", "bedrock");
    }
  }

  if (profile.provider === "google-vertex-ai") {
    const project = profile.vertexProject?.trim();
    const location = profile.vertexLocation?.trim();
    if (project && location) {
      return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`;
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    return "";
  }

  if (profile.provider === "azure") {
    const resourceName = profile.azureResourceName?.trim();
    if (resourceName) {
      return `https://${resourceName}.openai.azure.com/openai/v1`;
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    throw new Error("Azure model is missing azureResourceName.");
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
    throw new Error("Cloudflare AI Gateway model is missing cloudflareAccountId.");
  }

  if (profile.provider && profile.provider !== "custom") {
    const transportKind = resolveSetupTransportKind(profile.provider, profile.transportKind);
    return resolveProviderConnectApiBase(profile.provider, transportKind, {
      ...(profile.alibabaBillingMode === "token-plan" ? { billingMode: "token-plan" } : {}),
      ...(profile.stepfunBillingMode === "step-plan" ? { stepfunBillingMode: "step-plan" } : {}),
      ...(profile.zAiBillingMode === "glm-coding-plan"
        ? { zAiBillingMode: "glm-coding-plan" }
        : {}),
      ...(profile.zhipuBillingMode === "glm-coding-plan"
        ? { zhipuBillingMode: "glm-coding-plan" }
        : {}),
      ...(profile.providerSite ? { site: profile.providerSite } : {}),
      ...(profile.alibabaWorkspaceId?.trim()
        ? { workspaceId: profile.alibabaWorkspaceId.trim() }
        : {}),
    });
  }

  const trimmed = profile.apiBase?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_API_BASE;
}
