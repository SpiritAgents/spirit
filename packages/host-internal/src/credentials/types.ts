import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";

import type {
  ModelEntryV2,
  ModelRef,
  ProviderGroupV2,
  SpiritConfigSchemaVersion,
  SpiritModelCapabilityV2,
  SpiritModelReasoningEffortV2,
} from "../config-v2.js";
import type { ModelProviderId, ProviderModelTransportKind } from "../model-provider-presets.js";

export type SpiritModelCapability = SpiritModelCapabilityV2;
export type SpiritModelReasoningEffort = SpiritModelReasoningEffortV2;

/** Resolved profile for host transports (group connect fields + model entry). */
export interface SpiritModelProfile {
  groupId: string;
  ref: ModelRef;
  name: string;
  apiBase: string;
  reasoningEffort?: SpiritModelReasoningEffort;
  supportedReasoningEfforts?: SpiritModelReasoningEffort[];
  capabilities?: SpiritModelCapability[];
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  alibabaBillingMode?: ProviderGroupV2["alibabaBillingMode"];
  stepfunBillingMode?: ProviderGroupV2["stepfunBillingMode"];
  zAiBillingMode?: ProviderGroupV2["zAiBillingMode"];
  zhipuBillingMode?: ProviderGroupV2["zhipuBillingMode"];
  awsRegion?: string;
  azureResourceName?: string;
  cloudflareAccountId?: string;
  cloudflareGatewayId?: string;
  vertexProject?: string;
  vertexLocation?: string;
  contextLength?: number;
  /** Per-model service tier preference (see `ModelEntryV2.serviceTier`). */
  serviceTier?: ModelServiceTier;
  /** Aggregator upstream identity fact (see `ModelEntryV2.upstreamProvider`). */
  upstreamProvider?: string;
}

/** Action a single permission rule applies when its pattern matches. */
export type PermissionRuleAction = "allow" | "ask" | "deny";

/** Rules of one permission domain: pattern (map key) -> action. */
export type PermissionDomainRules = Record<string, PermissionRuleAction>;

/**
 * Three-state permission allowlist stored in `config.json` under `permission`.
 * Domains may grow later (edit, web_fetch, MCP, ...); unknown domains are
 * ignored with a lint warning at load time.
 */
export interface PermissionConfig {
  shell?: PermissionDomainRules;
  read_file?: PermissionDomainRules;
}

/** Minimal `config.json` fields read/written by hosts; other Desktop fields are preserved on merge. */
export interface SpiritConfigFile {
  schemaVersion: SpiritConfigSchemaVersion;
  providerGroups: ProviderGroupV2[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
  permission?: PermissionConfig;
  [key: string]: unknown;
}

export type { ModelEntryV2, ModelRef, ProviderGroupV2 };

export interface BedrockSetupCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface GoogleVertexSetupCredentials {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
}

/** Result collected by a setup flow before persistence. */
export interface ProviderSetupResult {
  groupId: string;
  model: ModelEntryV2;
  providerScope: ModelProviderId;
  group: Omit<ProviderGroupV2, "models">;
  apiKey?: string;
  bedrock?: BedrockSetupCredentials;
  vertex?: GoogleVertexSetupCredentials;
}
