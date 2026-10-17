import type { FileUploadConfig } from "../file-upload/uploader.js";
import type { LlmTransportKind } from "../llm-provider-shared.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import {
  listUnresolvedApiBaseTemplateKeys,
  ProviderPresetApiBaseError,
  resolvePresetApiBase,
} from "./api-base.js";
import { CUSTOM_PROVIDER_PRESET, findProviderPreset } from "./loader.js";
import type { JsonObject } from "../ports.js";
import type { ThinkingSwitchDeclaration } from "../llm-provider-shared.js";
import type { ProviderPresetCredentialKind } from "./types.js";

export class ProviderPresetMaterializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPresetMaterializeError";
  }
}

/** The wizard-only pseudo preset id for a fully custom connection. */
export const CUSTOM_PROVIDER_PRESET_ID = "custom";

/** Config default: `transportKind` is omitted from materialized entries when it equals this. */
export const DEFAULT_PROVIDER_TRANSPORT_KIND: LlmTransportKind = "openai-compatible";

/**
 * SDK adapter fallback when the wizard materializes a non-default transport: a preset's `sdk`
 * names the adapter of its default transport; the alternates use the transport's generic adapter
 * (bedrock is a self-held implementation with no adapter).
 */
const FALLBACK_SDK_BY_TRANSPORT_KIND: Record<LlmTransportKind, string | undefined> = {
  "openai-compatible": "@ai-sdk/openai-compatible",
  "open-responses": "@ai-sdk/open-responses",
  anthropic: "@ai-sdk/anthropic",
  bedrock: undefined,
};

export function fallbackSdkPackageName(transportKind: LlmTransportKind): string | undefined {
  return FALLBACK_SDK_BY_TRANSPORT_KIND[transportKind];
}

export interface MaterializeProviderPresetInput {
  /** A preset id from the manifest, or `"custom"`. */
  presetId: string;
  /** Defaults to the preset's `defaultTransport`. */
  transportKind?: LlmTransportKind;
  siteId?: string;
  /** Shorthand for the `{workspaceId}` template value of Alibaba MaaS sites. */
  workspaceId?: string;
  billingPlanId?: string;
  /** Custom connections: the label also slugifies into the entry id. */
  label?: string;
  /** User-entered endpoint (custom connections, or wizard-computed bases). */
  apiBaseOverride?: string;
  /** `{placeholder}` substitutions for templated bases (`{resourceName}`, `{accountId}`, …). */
  templateValues?: Record<string, string>;
  /**
   * The credential form the wizard collected. `"apiKey"` on a preset whose default credential
   * kind differs (e.g. Vertex) selects the preset's `expressApiBase` when it declares one.
   */
  credentialKind?: ProviderPresetCredentialKind;
}

/**
 * The wizard-time write shape: a config `providers[]` entry (structurally compatible with the
 * host-internal schema's provider entry; agent-core must not import the host package).
 * Credential channels (`apiKey*` / `credentials`) are written by the caller from the wizard's
 * key flow, not by this materializer.
 */
export interface MaterializedProviderEntry {
  id: string;
  label?: string;
  apiBase: string;
  transportKind?: LlmTransportKind;
  sdk?: string;
  providerTools?: ProviderToolEntry[];
  fileUpload?: FileUploadConfig;
  body?: JsonObject;
  thinkingSwitch?: ThinkingSwitchDeclaration;
  imageApi?: string;
  videoApi?: string;
  options?: Record<string, unknown>;
  models: [];
}

/** Custom provider id from a display label; falls back to `"custom-group"` (then `"custom"` when no label). */
export function slugifyCustomProviderLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "custom-group";
}

function assertNoUnresolvedTemplate(apiBase: string, presetId: string): void {
  const unresolved = listUnresolvedApiBaseTemplateKeys(apiBase);
  if (unresolved.length > 0) {
    throw new ProviderPresetApiBaseError(
      `Provider preset "${presetId}" apiBase has unresolved placeholders: ${[...new Set(unresolved)].join(", ")}.`,
    );
  }
}

function materializeCustomPreset(input: MaterializeProviderPresetInput): MaterializedProviderEntry {
  const apiBase = input.apiBaseOverride?.trim() || CUSTOM_PROVIDER_PRESET.defaultApiBase;
  const label = input.label?.trim();
  const transportKind = input.transportKind;
  return {
    id: label ? slugifyCustomProviderLabel(label) : CUSTOM_PROVIDER_PRESET_ID,
    ...(label ? { label } : {}),
    apiBase,
    ...(transportKind !== undefined && transportKind !== DEFAULT_PROVIDER_TRANSPORT_KIND
      ? { transportKind }
      : {}),
    models: [],
  };
}

/** Materializes a preset (or the custom pseudo preset) into a config `providers[]` entry. */
export function materializeProviderPreset(
  input: MaterializeProviderPresetInput,
): MaterializedProviderEntry {
  if (input.presetId === CUSTOM_PROVIDER_PRESET_ID) {
    return materializeCustomPreset(input);
  }

  const preset = findProviderPreset(input.presetId);
  if (!preset) {
    throw new ProviderPresetMaterializeError(`Unknown provider preset "${input.presetId}".`);
  }

  const transportKind = input.transportKind ?? preset.defaultTransport;
  const apiBaseOverride = input.apiBaseOverride?.trim();
  // Plain-apiKey credential form on a non-apiKey preset (e.g. Vertex Express) uses the express base.
  const expressApiBase =
    input.credentialKind === "apiKey" && preset.credentials.kind !== "apiKey"
      ? preset.expressApiBase?.trim() || undefined
      : undefined;
  const apiBase =
    apiBaseOverride ||
    expressApiBase ||
    resolvePresetApiBase(preset, {
      transportKind,
      ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
      ...(input.billingPlanId !== undefined ? { billingPlanId: input.billingPlanId } : {}),
      templateValues: {
        ...input.templateValues,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      },
    });
  assertNoUnresolvedTemplate(apiBase, preset.id);

  const sdk =
    transportKind === preset.defaultTransport ? preset.sdk : fallbackSdkPackageName(transportKind);

  return {
    id: preset.id,
    label: input.label?.trim() || preset.label,
    apiBase,
    ...(transportKind !== DEFAULT_PROVIDER_TRANSPORT_KIND ? { transportKind } : {}),
    ...(sdk !== undefined ? { sdk } : {}),
    ...(preset.providerTools !== undefined
      ? { providerTools: structuredClone(preset.providerTools) }
      : {}),
    ...(preset.fileUpload !== undefined ? { fileUpload: structuredClone(preset.fileUpload) } : {}),
    ...(preset.body !== undefined ? { body: structuredClone(preset.body) } : {}),
    ...(preset.thinkingSwitch !== undefined
      ? { thinkingSwitch: structuredClone(preset.thinkingSwitch) }
      : {}),
    ...(preset.imageApi !== undefined ? { imageApi: preset.imageApi } : {}),
    ...(preset.videoApi !== undefined ? { videoApi: preset.videoApi } : {}),
    models: [],
  };
}
