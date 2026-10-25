import type {
  AnthropicTransportConfig,
  JsonObject,
  LlmModelCapabilities,
  LlmTransportConfig,
} from "@spiritagent/agent-core";
import type { FileUploadConfig } from "@spiritagent/agent-core/file-upload";
import type { ProviderToolEntry } from "@spiritagent/agent-core/provider-tools";

import {
  GOOGLE_VERTEX_SDK_PACKAGE_NAME,
  isEmptyModelRef,
  resolveProviderSdkPackageName,
  resolveProviderTransportKind,
  type ModelRef,
  type SpiritModelCapability,
  type SpiritModelReasoningEffort,
  type SpiritModelReasoningMode,
  type ThinkingSwitchDeclaration,
} from "./config.js";
import type { SpiritServiceTiersDeclaration } from "./config.js";
import {
  loadActiveModelProfile,
  loadModelProfile,
  loadSpiritConfig,
  resolveAgentsProviderToolsExposure,
  resolveAgentsWebFetchExposure,
  resolveProfileCredentialSlot,
  resolveStoredApiKeyForProfile,
} from "./credentials/index.js";
import type { SpiritModelProfile } from "./credentials/types.js";

export interface ResolveTransportContext {
  workspaceRoot: string;
  spiritDataDir: string;
  modelRef?: ModelRef;
}

function modelCapabilitiesFromConfig(
  capabilities: readonly SpiritModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes("languageModel") ? { languageModel: true } : {}),
    ...(capabilities.includes("image") ? { imageInput: true } : {}),
    ...(capabilities.includes("audio") ? { audioInput: true } : {}),
    ...(capabilities.includes("video") ? { videoInput: true } : {}),
    ...(capabilities.includes("imageGeneration") ? { imageGeneration: true } : {}),
  };
}

type WireReasoningEffort = "minimal" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

/** `"default"` / absent means "send no reasoning parameter"; declared values pass through verbatim. */
function declaredReasoningEffort(
  effort: SpiritModelReasoningEffort | undefined,
): WireReasoningEffort | undefined {
  return effort === undefined || effort === "default" ? undefined : effort;
}

const ANTHROPIC_EFFORT_TOKENS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** The Anthropic protocol's effort enum has no none/minimal/default; those send nothing. */
function anthropicEffort(
  effort: SpiritModelReasoningEffort | undefined,
): AnthropicTransportConfig["effort"] {
  const declared = declaredReasoningEffort(effort);
  return declared !== undefined && ANTHROPIC_EFFORT_TOKENS.has(declared)
    ? (declared as AnthropicTransportConfig["effort"])
    : undefined;
}

function anthropicSupportedEfforts(
  efforts: readonly SpiritModelReasoningEffort[] | undefined,
): AnthropicTransportConfig["supportedEfforts"] {
  if (efforts === undefined) {
    return undefined;
  }
  return efforts.filter(
    (effort): effort is NonNullable<AnthropicTransportConfig["supportedEfforts"]>[number] =>
      ANTHROPIC_EFFORT_TOKENS.has(effort),
  );
}

/** Declaration fields carried verbatim onto transport configs; every member is optional. */
interface TransportDeclarationFields {
  sdk?: string;
  serviceTiers?: SpiritServiceTiersDeclaration;
  headers?: Record<string, string>;
  body?: JsonObject;
  providerTools?: ProviderToolEntry[];
  fileUpload?: FileUploadConfig;
  options?: Record<string, unknown>;
  outputLimit?: number;
  reasoningMode?: SpiritModelReasoningMode;
  supportedReasoningModes?: SpiritModelReasoningMode[];
  thinkingSwitch?: ThinkingSwitchDeclaration;
}

function transportDeclarationFields(
  profile: SpiritModelProfile,
  options?: { includeSdk?: boolean },
): TransportDeclarationFields {
  const includeSdk = options?.includeSdk !== false;
  return {
    ...(includeSdk && profile.sdk !== undefined ? { sdk: profile.sdk } : {}),
    ...(profile.headers !== undefined ? { headers: profile.headers } : {}),
    ...(profile.body !== undefined ? { body: profile.body } : {}),
    ...(profile.providerTools !== undefined ? { providerTools: profile.providerTools } : {}),
    ...(profile.fileUpload !== undefined ? { fileUpload: profile.fileUpload } : {}),
    ...(profile.options !== undefined ? { options: { ...profile.options } } : {}),
    ...(profile.outputLimit !== undefined ? { outputLimit: profile.outputLimit } : {}),
    ...(profile.reasoningMode !== undefined ? { reasoningMode: profile.reasoningMode } : {}),
    ...(profile.supportedReasoningModes !== undefined
      ? { supportedReasoningModes: profile.supportedReasoningModes }
      : {}),
    ...(profile.thinkingSwitch !== undefined ? { thinkingSwitch: profile.thinkingSwitch } : {}),
    ...(profile.serviceTiers !== undefined ? { serviceTiers: profile.serviceTiers } : {}),
  };
}

const BEDROCK_MANTLE_HOST_PATTERN = /^bedrock-mantle\.([a-z0-9-]+)\.api\.aws$/i;

/**
 * SigV4 signing region for `options.auth: "aws-sigv4"` (Bedrock Mantle): the wizard materializes
 * the region into the apiBase host, so the runtime parses it back off the URL.
 */
function bedrockMantleRegionFromApiBase(apiBase: string): string | undefined {
  try {
    return BEDROCK_MANTLE_HOST_PATTERN.exec(new URL(apiBase).hostname)?.[1];
  } catch {
    return undefined;
  }
}

function buildTransportFromProfile(
  profile: SpiritModelProfile,
  apiKey: string,
  workspaceRoot: string,
): LlmTransportConfig {
  const baseUrl = profile.apiBase;
  const transportKind = resolveProviderTransportKind(profile);
  const model = profile.name;
  const declarations = transportDeclarationFields(profile, {
    // bedrock is a self-held implementation; there is no SDK adapter to declare.
    includeSdk: transportKind !== "bedrock",
  });
  const capabilities =
    profile.capabilities !== undefined
      ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
      : {};
  const reasoningEffort = declaredReasoningEffort(profile.reasoningEffort);

  if (transportKind === "bedrock") {
    const region = profile.options?.awsRegion?.trim();
    if (!region) {
      throw new Error("Amazon Bedrock model is missing AWS region configuration.");
    }
    const accessKeyId = resolveProfileCredentialSlot(profile, "accessKeyId");
    const secretAccessKey = resolveProfileCredentialSlot(profile, "secretAccessKey");
    const trimmedKey = apiKey.trim();
    return {
      transportKind: "bedrock",
      model,
      region,
      ...(trimmedKey ? { apiKey: trimmedKey } : {}),
      ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      baseUrl,
      workspaceRoot,
      ...capabilities,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(profile.supportedReasoningEfforts !== undefined
        ? { supportedReasoningEfforts: profile.supportedReasoningEfforts }
        : {}),
      ...(profile.thinkingEnabled === false ? { vendorExtendedThinking: false } : {}),
      ...declarations,
    };
  }

  if (transportKind === "open-responses") {
    const sigv4 = profile.options?.auth === "aws-sigv4";
    let bedrockMantleIam:
      | { region: string; accessKeyId: string; secretAccessKey: string }
      | undefined;
    if (sigv4 && !apiKey.trim()) {
      const accessKeyId = resolveProfileCredentialSlot(profile, "accessKeyId");
      const secretAccessKey = resolveProfileCredentialSlot(profile, "secretAccessKey");
      if (!accessKeyId || !secretAccessKey) {
        throw new Error("Amazon Bedrock Mantle requires a Bearer API key or IAM credentials.");
      }
      const region = bedrockMantleRegionFromApiBase(baseUrl);
      if (!region) {
        throw new Error(
          "Amazon Bedrock Mantle apiBase does not carry an AWS region (expected a bedrock-mantle.<region>.api.aws host).",
        );
      }
      bedrockMantleIam = { region, accessKeyId, secretAccessKey };
    }
    return {
      transportKind: "open-responses",
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      agentMode: "agent",
      ...(profile.serviceTier !== undefined ? { serviceTier: profile.serviceTier } : {}),
      ...capabilities,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(bedrockMantleIam !== undefined ? { bedrockMantleIam } : {}),
      ...declarations,
    };
  }

  if (transportKind === "anthropic") {
    const supportedEfforts = anthropicSupportedEfforts(profile.supportedReasoningEfforts);
    const effort = anthropicEffort(profile.reasoningEffort);
    return {
      transportKind: "anthropic",
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      ...(profile.serviceTier !== undefined ? { serviceTier: profile.serviceTier } : {}),
      ...capabilities,
      ...(supportedEfforts !== undefined ? { supportedEfforts } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(profile.supportsThinkingSwitch !== undefined
        ? { supportsThinkingSwitch: profile.supportsThinkingSwitch }
        : {}),
      ...(profile.thinkingEnabled === false ? { vendorExtendedThinking: false } : {}),
      ...declarations,
    };
  }

  const vertexSdk = resolveProviderSdkPackageName(profile) === GOOGLE_VERTEX_SDK_PACKAGE_NAME;
  const vertexClientEmail = vertexSdk
    ? resolveProfileCredentialSlot(profile, "clientEmail")
    : undefined;
  const vertexPrivateKey = vertexSdk
    ? resolveProfileCredentialSlot(profile, "privateKey")
    : undefined;
  const vertex = vertexSdk
    ? {
        ...(profile.options?.project?.trim()
          ? { vertexProject: profile.options.project.trim() }
          : {}),
        ...(profile.options?.location?.trim()
          ? { vertexLocation: profile.options.location.trim() }
          : {}),
        ...(vertexClientEmail ? { vertexClientEmail } : {}),
        ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
      }
    : {};

  return {
    transportKind: "openai-compatible",
    apiKey,
    model,
    baseUrl,
    workspaceRoot,
    ...(profile.serviceTier !== undefined ? { serviceTier: profile.serviceTier } : {}),
    ...capabilities,
    ...vertex,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(profile.supportsThinkingSwitch !== undefined
      ? { supportsThinkingSwitch: profile.supportsThinkingSwitch }
      : {}),
    ...(profile.thinkingEnabled === false ? { vendorExtendedThinking: false } : {}),
    ...declarations,
  };
}

export const NO_ACTIVE_MODEL_ERROR = "No active model configured. Run provider setup first.";

export type ResolveTransportResult =
  | {
      ok: true;
      /** Selected config provider id for host-facing identity, kept out of the wire transport config. */
      providerId: string;
      config: LlmTransportConfig;
    }
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

function declaresKeyChannel(profile: SpiritModelProfile): boolean {
  return (
    profile.apiKey !== undefined ||
    profile.apiKeyEnv !== undefined ||
    profile.apiKeyKeyring !== undefined ||
    profile.credentials !== undefined
  );
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
  if (!apiKey.trim()) {
    const transportKind = resolveProviderTransportKind(profile);
    const sigv4 = transportKind === "open-responses" && profile.options?.auth === "aws-sigv4";
    if (resolveProviderSdkPackageName(profile) === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
      const clientEmail = resolveProfileCredentialSlot(profile, "clientEmail");
      const privateKey = resolveProfileCredentialSlot(profile, "privateKey");
      if (!clientEmail || !privateKey) {
        return {
          ok: false,
          error: `No Vertex credentials found for model "${profile.name}". Run setup again.`,
        };
      }
    } else if (transportKind === "bedrock" || sigv4) {
      // IAM-capable mechanisms authenticate without a Bearer key; the builder validates the slots.
    } else if (declaresKeyChannel(profile)) {
      // A declared channel (apiKey / apiKeyEnv / apiKeyKeyring / credentials) that resolves to
      // nothing is a setup error. An entry declaring no channel at all is an unauthenticated
      // endpoint (schema variant: local/self-hosted) and proceeds with an empty key.
      return {
        ok: false,
        error: `No API key found for model "${profile.name}". Run setup again.`,
      };
    }
  }

  const config = buildTransportFromProfile(profile, apiKey, context.workspaceRoot);
  // Stamp the user's opt-outs (agents.providerTools / agents.webFetch in config.json) so every
  // agent-core exposure gate can read them off the transport config; only an explicit false is
  // stamped.
  const fullConfig = loadSpiritConfig(context.spiritDataDir);
  const providerTools = resolveAgentsProviderToolsExposure(fullConfig);
  const webFetch = resolveAgentsWebFetchExposure(fullConfig);
  return {
    ok: true,
    providerId: profile.providerId,
    config: {
      ...config,
      ...(providerTools.providerToolsEnabled ? {} : { providerToolsEnabled: false }),
      ...(webFetch.webFetchEnabled ? {} : { webFetchEnabled: false }),
    },
  };
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
