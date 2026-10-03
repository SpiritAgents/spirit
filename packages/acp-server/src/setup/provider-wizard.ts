import type {
  ModelEntryV2,
  ModelProviderId,
  ProviderGroupV2,
  ProviderModelTransportKind,
} from "@spiritagent/host-internal";
import {
  defaultPresetProviderGroupId,
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
  listProviderConnectSiteOptions,
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
  resolveProfileApiBase,
  resolveSetupTransportKind,
} from "@spiritagent/host-internal";

import type { ProviderSetupResult, SpiritModelProfile } from "@spiritagent/host-internal";

export { resolveProfileApiBase, resolveSetupTransportKind };

export function validateModelName(modelName: string): string | undefined {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return "Model name is required.";
  }
  return undefined;
}

export function validateApiKeyRequired(
  provider: ModelProviderId,
  apiKey: string,
): string | undefined {
  if (provider === "amazon-bedrock" || provider === "google-vertex-ai" || provider === "custom") {
    return undefined;
  }
  if (!apiKey.trim()) {
    return "API key is required for this provider.";
  }
  return undefined;
}

export function validateBedrockCredentials(input: {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  awsRegion?: string;
}): string | undefined {
  if (!input.awsRegion?.trim()) {
    return "AWS region is required for Amazon Bedrock.";
  }
  const hasApiKey = Boolean(input.apiKey?.trim());
  const hasIam = Boolean(input.accessKeyId?.trim() && input.secretAccessKey?.trim());
  if (!hasApiKey && !hasIam) {
    return "Provide either a Bedrock API key or IAM access key credentials.";
  }
  return undefined;
}

export function validateVertexCredentials(input: {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): string | undefined {
  if (!input.vertexProject?.trim() || !input.vertexLocation?.trim()) {
    return "GCP project ID and location are required for Google Vertex AI.";
  }
  const hasApiKey = Boolean(input.apiKey?.trim());
  const hasSa = Boolean(input.clientEmail?.trim() && input.privateKey?.trim());
  if (!hasApiKey && !hasSa) {
    return "Provide either a Vertex API key or a service account email and private key.";
  }
  return undefined;
}

export function validateAzureSetup(input: {
  azureResourceName?: string;
  apiKey?: string;
  modelName?: string;
}): string | undefined {
  if (!input.azureResourceName?.trim()) {
    return "Azure resource name is required.";
  }
  if (!input.apiKey?.trim()) {
    return "Azure API key is required.";
  }
  if (!input.modelName?.trim()) {
    return "Azure deployment name is required.";
  }
  return undefined;
}

export function validateCloudflareSetup(input: {
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  apiKey?: string;
}): string | undefined {
  const accountId = input.cloudflareAccountId?.trim();
  if (!accountId) {
    return "Cloudflare Account ID is required.";
  }
  if (!isValidCloudflareAccountId(accountId)) {
    return "Cloudflare Account ID must be a 32-character hexadecimal string.";
  }
  const gatewayId = input.cloudflareGatewayId?.trim();
  if (!gatewayId) {
    return "Cloudflare Gateway ID is required.";
  }
  if (!isValidCloudflareGatewayId(gatewayId)) {
    return "Cloudflare Gateway ID is invalid.";
  }
  if (!input.apiKey?.trim()) {
    return "Cloudflare API token is required.";
  }
  return undefined;
}

export function validateCustomSetup(input: {
  apiBase?: string;
  apiKey?: string;
  modelName?: string;
}): string | undefined {
  if (!input.apiBase?.trim()) {
    return "API base URL is required for custom providers.";
  }
  if (!input.apiKey?.trim()) {
    return "API key is required for custom providers.";
  }
  if (!input.modelName?.trim()) {
    return "Model name is required.";
  }
  return undefined;
}

export function buildSetupProfile(input: {
  provider: ModelProviderId;
  modelName: string;
  groupId?: string;
  transportKind?: ProviderModelTransportKind;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  apiBaseOverride?: string;
}): SpiritModelProfile {
  const groupId = input.groupId?.trim() || defaultPresetProviderGroupId(input.provider);
  const name = input.modelName.trim();
  const ref = { groupId, name };
  const transportKind = resolveSetupTransportKind(input.provider, input.transportKind);
  const profile: SpiritModelProfile = {
    groupId,
    ref,
    name,
    apiBase: input.apiBaseOverride?.trim() || "",
    reasoningEffort: "medium",
    capabilities: ["languageModel", "image"],
    provider: input.provider === "custom" ? "custom" : input.provider,
    transportKind,
  };
  if (input.providerSite) {
    profile.providerSite = input.providerSite;
  }
  if (input.alibabaWorkspaceId?.trim()) {
    profile.alibabaWorkspaceId = input.alibabaWorkspaceId.trim();
  }
  if (input.awsRegion?.trim()) {
    profile.awsRegion = input.awsRegion.trim();
  }
  if (input.azureResourceName?.trim()) {
    profile.azureResourceName = input.azureResourceName.trim();
  }
  if (input.cloudflareAccountId?.trim()) {
    profile.cloudflareAccountId = input.cloudflareAccountId.trim();
  }
  if (input.cloudflareGatewayId?.trim()) {
    profile.cloudflareGatewayId = input.cloudflareGatewayId.trim();
  }
  if (input.vertexProject?.trim()) {
    profile.vertexProject = input.vertexProject.trim();
  }
  if (input.vertexLocation?.trim()) {
    profile.vertexLocation = input.vertexLocation.trim();
  }
  if (input.apiBaseOverride?.trim()) {
    profile.apiBase = input.apiBaseOverride.trim();
  } else {
    profile.apiBase = resolveProfileApiBase(profile);
  }
  return profile;
}

export function buildProviderSetupResult(input: {
  provider: ModelProviderId;
  modelName: string;
  groupId?: string;
  transportKind?: ProviderModelTransportKind;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  apiBaseOverride?: string;
}): Pick<ProviderSetupResult, "groupId" | "group" | "model" | "providerScope"> {
  const profile = buildSetupProfile(input);
  const group: Omit<ProviderGroupV2, "models"> = {
    id: profile.groupId,
    provider: profile.provider ?? "custom",
    apiBase: profile.apiBase,
    ...(profile.transportKind ? { transportKind: profile.transportKind } : {}),
    ...(profile.providerSite ? { providerSite: profile.providerSite } : {}),
    ...(profile.alibabaWorkspaceId ? { alibabaWorkspaceId: profile.alibabaWorkspaceId } : {}),
    ...(profile.awsRegion ? { awsRegion: profile.awsRegion } : {}),
    ...(profile.azureResourceName ? { azureResourceName: profile.azureResourceName } : {}),
    ...(profile.vertexProject ? { vertexProject: profile.vertexProject } : {}),
    ...(profile.vertexLocation ? { vertexLocation: profile.vertexLocation } : {}),
  };
  const model: ModelEntryV2 = {
    name: profile.name,
    reasoningEffort: profile.reasoningEffort ?? "medium",
    ...(profile.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: profile.supportedReasoningEfforts }
      : {}),
    ...(profile.capabilities !== undefined ? { capabilities: profile.capabilities } : {}),
    ...(profile.contextLength !== undefined ? { contextLength: profile.contextLength } : {}),
  };
  return {
    groupId: profile.groupId,
    group,
    model,
    providerScope: input.provider,
  };
}

export function providerNeedsSiteSelection(provider: ModelProviderId): boolean {
  return providerSupportsSiteSelection(provider);
}

export function listSiteOptions(provider: ModelProviderId): Array<{ value: string; name: string }> {
  return listProviderConnectSiteOptions(provider).map((site) => ({
    value: site.id,
    name: site.fallbackLabel,
  }));
}

export function siteNeedsWorkspaceId(provider: ModelProviderId, siteId: string): boolean {
  return providerConnectSiteRequiresWorkspaceId(provider, siteId);
}
