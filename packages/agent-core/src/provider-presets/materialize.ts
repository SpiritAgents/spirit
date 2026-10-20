import type { FileUploadConfig } from "../file-upload/uploader.js";
import type { LlmTransportKind } from "../llm-provider-shared.js";
import { resolveProviderEndpointUrl } from "../provider-tools/resolve.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import {
  listUnresolvedApiBaseTemplateKeys,
  ProviderPresetApiBaseError,
  resolvePresetApiBase,
} from "./api-base.js";
import { CUSTOM_PROVIDER_PRESET, findProviderPreset } from "./loader.js";
import type { JsonObject } from "../ports.js";
import type { ThinkingSwitchDeclaration } from "../llm-provider-shared.js";
import type { ProviderPreset, ProviderPresetCredentialKind } from "./types.js";

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

/**
 * Transport scope of the mechanism `options` keys a preset may template. A preset entry declares
 * the template flat (e.g. an open-responses continuation convention), but the wizard may
 * materialize a different transport of the same provider; keys scoped to another transport are
 * dropped here so the written entry always passes the config schema's transportKind-scoped keyset.
 * Keys without a known scope pass through verbatim — deep value validation is the config load's
 * fail-fast job.
 */
const PRESET_OPTIONS_TRANSPORT_SCOPE: Record<string, LlmTransportKind> = {
  toolsRejectReasoningEffort: "openai-compatible",
  maxInlineMediaBytes: "openai-compatible",
  echoServerToolCalls: "open-responses",
  defaultInputItemStatus: "open-responses",
  applyPatch: "open-responses",
  reasoningSummary: "open-responses",
};

function materializePresetOptions(
  presetOptions: JsonObject,
  transportKind: LlmTransportKind,
): JsonObject | undefined {
  const scoped = Object.fromEntries(
    Object.entries(presetOptions).filter(([key]) => {
      const scope = PRESET_OPTIONS_TRANSPORT_SCOPE[key];
      return scope === undefined || scope === transportKind;
    }),
  );
  return Object.keys(scoped).length > 0 ? scoped : undefined;
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

/**
 * Host-executed helper endpoints (tool executes, file uploads) live on the provider's
 * openai-compatible root; when the wizard picked another transport, bake the absolute URL so the
 * runtime never joins the path against the chat transport's base. Returns undefined when the
 * selected transport is openai-compatible (relative paths join against the chat base at runtime).
 */
function openAiCompatibleRootForBaking(
  preset: ProviderPreset,
  input: MaterializeProviderPresetInput,
): string | undefined {
  const transportKind = input.transportKind ?? preset.defaultTransport;
  if (transportKind === "openai-compatible") {
    return undefined;
  }
  return resolvePresetApiBase(preset, {
    transportKind: "openai-compatible",
    ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
    ...(input.billingPlanId !== undefined ? { billingPlanId: input.billingPlanId } : {}),
    templateValues: {
      ...input.templateValues,
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    },
  });
}

function materializeProviderTools(
  entries: ProviderToolEntry[],
  openAiCompatibleRoot: string | undefined,
): ProviderToolEntry[] {
  const cloned = structuredClone(entries);
  if (openAiCompatibleRoot === undefined) {
    return cloned;
  }
  for (const entry of cloned) {
    const execute = entry.execute;
    if (execute?.path !== undefined && execute.url === undefined) {
      execute.url = resolveProviderEndpointUrl(openAiCompatibleRoot, { path: execute.path });
      delete execute.path;
    }
  }
  return cloned;
}

function materializeFileUpload(
  fileUpload: FileUploadConfig,
  openAiCompatibleRoot: string | undefined,
): FileUploadConfig {
  const cloned = structuredClone(fileUpload);
  if (openAiCompatibleRoot !== undefined && cloned.path !== undefined && cloned.url === undefined) {
    cloned.url = resolveProviderEndpointUrl(openAiCompatibleRoot, { path: cloned.path });
    delete cloned.path;
  }
  return cloned;
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
  const options =
    preset.options !== undefined
      ? materializePresetOptions(preset.options, transportKind)
      : undefined;
  // A site can pin its own upload channel (e.g. a region-pinned upload host).
  const siteId = input.siteId ?? preset.sites?.default;
  const fileUpload =
    preset.sites?.items.find((item) => item.id === siteId)?.fileUpload ?? preset.fileUpload;
  const openAiCompatibleRoot = openAiCompatibleRootForBaking(preset, input);

  return {
    id: preset.id,
    label: input.label?.trim() || preset.label,
    apiBase,
    ...(transportKind !== DEFAULT_PROVIDER_TRANSPORT_KIND ? { transportKind } : {}),
    ...(sdk !== undefined ? { sdk } : {}),
    ...(preset.providerTools !== undefined
      ? { providerTools: materializeProviderTools(preset.providerTools, openAiCompatibleRoot) }
      : {}),
    ...(fileUpload !== undefined
      ? { fileUpload: materializeFileUpload(fileUpload, openAiCompatibleRoot) }
      : {}),
    ...(preset.body !== undefined ? { body: structuredClone(preset.body) } : {}),
    ...(preset.thinkingSwitch !== undefined
      ? { thinkingSwitch: structuredClone(preset.thinkingSwitch) }
      : {}),
    ...(options !== undefined ? { options: structuredClone(options) } : {}),
    ...(preset.imageApi !== undefined ? { imageApi: preset.imageApi } : {}),
    ...(preset.videoApi !== undefined ? { videoApi: preset.videoApi } : {}),
    models: [],
  };
}
