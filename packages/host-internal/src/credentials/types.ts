import type { JsonObject } from "@spiritagent/agent-core";
import type { FileUploadConfig } from "@spiritagent/agent-core/file-upload";
import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";
import type { MaterializeProviderPresetInput } from "@spiritagent/agent-core/provider-presets";
import type { ProviderToolEntry } from "@spiritagent/agent-core/provider-tools";

import type {
  ModelEntry,
  ModelRef,
  ProviderCredentialSlot,
  ProviderKeyringReference,
  ProviderOptions,
  SpiritModelCapability,
  SpiritModelReasoningEffort,
  SpiritModelReasoningMode,
  SpiritServiceTiersDeclaration,
  SpiritTransportKind,
  ThinkingSwitchDeclaration,
} from "../config.js";

/**
 * Resolved profile for host transports: the provider entry's connection fields and credential
 * channel declarations plus the effective (post-inheritance) model fields from
 * `resolveModelEntry`. Vendor-free: every field is a wire fact or a mechanism name.
 */
export interface SpiritModelProfile {
  providerId: string;
  ref: ModelRef;
  name: string;
  apiBase: string;
  transportKind?: SpiritTransportKind;
  sdk?: string;
  headers?: Record<string, string>;
  body?: JsonObject;
  options?: ProviderOptions;
  providerTools?: ProviderToolEntry[];
  fileUpload?: FileUploadConfig;
  imageApi?: string;
  videoApi?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyKeyring?: ProviderKeyringReference;
  credentials?: Record<string, ProviderCredentialSlot>;
  capabilities?: SpiritModelCapability[];
  contextLength?: number;
  outputLimit?: number;
  reasoningEffort?: SpiritModelReasoningEffort;
  supportedReasoningEfforts?: SpiritModelReasoningEffort[];
  reasoningMode?: SpiritModelReasoningMode;
  supportedReasoningModes?: SpiritModelReasoningMode[];
  supportsThinkingType?: "only";
  supportsThinkingSwitch?: boolean;
  thinkingSwitch?: ThinkingSwitchDeclaration;
  serviceTiers?: SpiritServiceTiersDeclaration;
  serviceTier?: ModelServiceTier;
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

/** Result collected by a connect/reconnect wizard flow before persistence. */
export interface ProviderSetupResult {
  /** Preset materialization input (preset id, transport, site, billing plan, endpoint override). */
  materialize: MaterializeProviderPresetInput;
  /** Wizard-owned transport options written onto the entry (e.g. `{ awsRegion }` for bedrock). */
  options?: ProviderOptions;
  /**
   * Internal-keyring secret writes: credentials slot name -> secret; the `apiKey` slot writes
   * account `provider::{id}`, other slots write `provider::{id}::{slot}`. Blank values are skipped.
   */
  credentials?: Record<string, string>;
  /** Wizard/catalog-known models upserted by name; user-added models survive the merge. */
  models?: ModelEntry[];
  /** Model activated after the merge; defaults to the first of `models` when present. */
  activeModel?: ModelRef;
}
