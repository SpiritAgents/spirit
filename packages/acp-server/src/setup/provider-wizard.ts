import {
  CUSTOM_PROVIDER_PRESET_ID,
  findProviderPreset,
  materializeProviderPreset,
  type MaterializeProviderPresetInput,
} from "@spiritagent/agent-core/provider-presets";
import type {
  ModelEntry,
  ProviderOptions,
  ProviderSetupResult,
  SpiritTransportKind,
} from "@spiritagent/host-internal";
import {
  isValidCloudflareAccountId,
  isValidCloudflareGatewayId,
} from "@spiritagent/host-internal/cloudflare-ai-gateway-resource";

export function validateModelName(modelName: string): string | undefined {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return "Model name is required.";
  }
  return undefined;
}

export function validateApiKeyRequired(provider: string, apiKey: string): string | undefined {
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

/** Wizard form fields collected by the terminal setup flow (preset id + materialization inputs). */
export interface WizardSetupInput {
  provider: string;
  modelName: string;
  siteId?: string;
  workspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  apiBaseOverride?: string;
}

/** The wizard's materialization input: site/workspace/template values resolve to the final apiBase. */
export function buildMaterializeInput(input: WizardSetupInput): MaterializeProviderPresetInput {
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
    presetId: input.provider,
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.workspaceId?.trim() ? { workspaceId: input.workspaceId.trim() } : {}),
    ...(input.apiBaseOverride?.trim() ? { apiBaseOverride: input.apiBaseOverride.trim() } : {}),
    ...(Object.keys(templateValues).length > 0 ? { templateValues } : {}),
  };
}

/** The apiBase the wizard would persist for the given inputs (prompt-time preview/listing). */
export function resolveWizardApiBase(input: WizardSetupInput): string {
  return materializeProviderPreset(buildMaterializeInput(input)).apiBase;
}

/** The default transport of a preset (`openai-compatible` for custom/unknown ids). */
export function resolveSetupTransportKind(provider: string): SpiritTransportKind {
  if (provider === CUSTOM_PROVIDER_PRESET_ID) {
    return "openai-compatible";
  }
  return findProviderPreset(provider)?.defaultTransport ?? "openai-compatible";
}

/** Wizard-owned transport options (Bedrock region / Vertex project+location). */
function buildSetupOptions(input: WizardSetupInput): ProviderOptions | undefined {
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

/**
 * Builds the setup payload for host-internal `saveProviderSetup`: materialization input, wizard
 * transport options, the first model entry, and the active model ref. Credential secrets are
 * attached by the caller (`credentials`).
 */
export function buildProviderSetupResult(input: WizardSetupInput): ProviderSetupResult {
  const name = input.modelName.trim();
  const materialize = buildMaterializeInput(input);
  const providerId = materializeProviderPreset(materialize).id;
  const model: ModelEntry = {
    name,
    capabilities: ["languageModel", "image"],
  };
  const options = buildSetupOptions(input);
  return {
    materialize,
    ...(options ? { options } : {}),
    models: [model],
    activeModel: { providerId, name },
  };
}

export function providerNeedsSiteSelection(provider: string): boolean {
  if (provider === CUSTOM_PROVIDER_PRESET_ID) {
    return false;
  }
  return findProviderPreset(provider)?.sites !== undefined;
}

export function listSiteOptions(provider: string): Array<{ value: string; name: string }> {
  const preset = provider === CUSTOM_PROVIDER_PRESET_ID ? undefined : findProviderPreset(provider);
  return (preset?.sites?.items ?? []).map((site) => ({
    value: site.id,
    name: site.label,
  }));
}

export function siteNeedsWorkspaceId(provider: string, siteId: string): boolean {
  const preset = provider === CUSTOM_PROVIDER_PRESET_ID ? undefined : findProviderPreset(provider);
  return preset?.sites?.items.find((site) => site.id === siteId)?.requiresWorkspaceId === true;
}
