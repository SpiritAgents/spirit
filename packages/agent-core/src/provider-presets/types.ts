import type { FileUploadConfig } from "../file-upload/uploader.js";
import type { LlmTransportKind, ThinkingSwitchDeclaration } from "../llm-provider-shared.js";
import type { JsonObject } from "../ports.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";

/** One selectable site of a preset provider; `apiBase` or per-transport `transports` bases. */
export interface ProviderPresetSite {
  id: string;
  /** Fallback display label; i18n key mapping lives in the apps. */
  label: string;
  /** Single base used for every transport. */
  apiBase?: string;
  /** Per-transport bases; a missing transport falls back to the provider default transport slot. */
  transports?: Partial<Record<LlmTransportKind, string>>;
  /** The base templates carry a `{workspaceId}` placeholder the wizard must fill. */
  requiresWorkspaceId?: boolean;
}

export interface ProviderPresetSiteSelection {
  default: string;
  items: ProviderPresetSite[];
}

/** Wizard billing-plan option; selecting it materializes the final `apiBase`, the id never enters config. */
export interface ProviderPresetBillingPlan {
  id: string;
  label?: string;
  /** Fixed base for every transport. */
  apiBase?: string;
  /** Per-transport bases when the plan endpoint varies by transport. */
  transports?: Partial<Record<LlmTransportKind, string>>;
  docUrl?: string;
}

/** Wizard credential form driver: which credential shape the connect flow collects. */
export type ProviderPresetCredentialKind = "apiKey" | "bedrock" | "vertex";

export interface ProviderPresetCredentials {
  kind: ProviderPresetCredentialKind;
}

/** Model catalog descriptor: a parser named by API shape and the listing endpoint. */
export interface ProviderPresetCatalog {
  parser: string;
  /** Joined onto the materialized `apiBase`; absolute URLs are used as-is. Absent when the listing is not HTTP-off-the-base (e.g. Bedrock). */
  endpoint?: string;
}

/** One built-in provider preset; array order in the manifest is picker order. */
export interface ProviderPreset {
  id: string;
  label: string;
  defaultTransport: LlmTransportKind;
  /** Explicit SDK adapter npm package name; absent for the self-held bedrock transport. */
  sdk?: string;
  transports: Partial<Record<LlmTransportKind, string>>;
  sites?: ProviderPresetSiteSelection;
  billingPlans?: ProviderPresetBillingPlan[];
  credentials: ProviderPresetCredentials;
  /** Materialization templates copied verbatim into the config `providers[]` entry. */
  providerTools?: ProviderToolEntry[];
  fileUpload?: FileUploadConfig;
  /** Provider-level literal body merge template (e.g. kimi-code's `stream_options.include_usage`). */
  body?: JsonObject;
  /** Provider-level thinking on/off wire encoding template (e.g. Meituan LongCat's `thinking.type`). */
  thinkingSwitch?: ThinkingSwitchDeclaration;
  imageApi?: string;
  videoApi?: string;
  catalog?: ProviderPresetCatalog;
  /** apiKey-only express connect base (e.g. Vertex Express), used when the wizard picks the plain apiKey credential form for a preset whose default credential kind differs. */
  expressApiBase?: string;
}

export interface CustomProviderPreset {
  defaultApiBase: string;
}

export interface ProviderPresetManifest {
  custom: CustomProviderPreset;
  providers: ProviderPreset[];
}
