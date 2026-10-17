import { validateFileUploadConfig } from "../file-upload/config.js";
import type { LlmTransportKind } from "../llm-provider-shared.js";
import { validateProviderToolEntries } from "../provider-tools/types.js";
import rawManifest from "./provider-presets.json" with { type: "json" };
import type {
  CustomProviderPreset,
  ProviderPreset,
  ProviderPresetBillingPlan,
  ProviderPresetCatalog,
  ProviderPresetManifest,
  ProviderPresetSite,
  ProviderPresetSiteSelection,
} from "./types.js";

export class ProviderPresetLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPresetLoadError";
  }
}

const TRANSPORT_KINDS: ReadonlySet<string> = new Set([
  "openai-compatible",
  "open-responses",
  "anthropic",
  "bedrock",
]);

const CREDENTIAL_KINDS: ReadonlySet<string> = new Set(["apiKey", "bedrock", "vertex"]);

const SOURCE = "provider-presets.json";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ProviderPresetLoadError(`${SOURCE}: ${message}`);
}

function readRequiredString(record: UnknownRecord, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${context} requires a non-empty "${key}" string.`);
  }
  return value;
}

function readOptionalString(
  record: UnknownRecord,
  key: string,
  context: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${context}: "${key}" must be a non-empty string when present.`);
  }
  return value;
}

function readTransportKind(value: unknown, context: string): LlmTransportKind {
  if (typeof value !== "string" || !TRANSPORT_KINDS.has(value)) {
    fail(`${context} must be one of: ${[...TRANSPORT_KINDS].join(", ")}.`);
  }
  return value as LlmTransportKind;
}

function readTransports(
  value: unknown,
  context: string,
): Partial<Record<LlmTransportKind, string>> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    fail(`${context} must be a non-empty object of transport kind to apiBase.`);
  }
  const transports: Partial<Record<LlmTransportKind, string>> = {};
  for (const [kind, base] of Object.entries(value)) {
    if (!TRANSPORT_KINDS.has(kind)) {
      fail(`${context}: unknown transport kind ${JSON.stringify(kind)}.`);
    }
    if (typeof base !== "string" || base.trim().length === 0) {
      fail(`${context}.${kind} must be a non-empty apiBase string.`);
    }
    transports[kind as LlmTransportKind] = base;
  }
  return transports;
}

function readSites(value: unknown, context: string): ProviderPresetSiteSelection {
  if (!isRecord(value)) {
    fail(`${context} must be an object.`);
  }
  const defaultSite = readRequiredString(value, "default", context);
  const itemsRaw = value["items"];
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    fail(`${context}.items must be a non-empty array.`);
  }
  const seen = new Set<string>();
  const items = itemsRaw.map((itemRaw, index): ProviderPresetSite => {
    const itemContext = `${context}.items[${index}]`;
    if (!isRecord(itemRaw)) {
      fail(`${itemContext} must be an object.`);
    }
    const id = readRequiredString(itemRaw, "id", itemContext);
    if (seen.has(id)) {
      fail(`${itemContext}: duplicate site id ${JSON.stringify(id)}.`);
    }
    seen.add(id);
    const label = readRequiredString(itemRaw, "label", itemContext);
    const apiBase = readOptionalString(itemRaw, "apiBase", itemContext);
    const transports =
      itemRaw["transports"] === undefined
        ? undefined
        : readTransports(itemRaw["transports"], `${itemContext}.transports`);
    if (apiBase === undefined && transports === undefined) {
      fail(`${itemContext} requires "apiBase" or "transports".`);
    }
    if (itemRaw["requiresWorkspaceId"] !== undefined && itemRaw["requiresWorkspaceId"] !== true) {
      fail(`${itemContext}: "requiresWorkspaceId" must be true when present.`);
    }
    return {
      id,
      label,
      ...(apiBase !== undefined ? { apiBase } : {}),
      ...(transports !== undefined ? { transports } : {}),
      ...(itemRaw["requiresWorkspaceId"] === true ? { requiresWorkspaceId: true } : {}),
    };
  });
  if (!seen.has(defaultSite)) {
    fail(`${context}.default ${JSON.stringify(defaultSite)} must exist in items.`);
  }
  return { default: defaultSite, items };
}

function readBillingPlans(value: unknown, context: string): ProviderPresetBillingPlan[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${context} must be a non-empty array.`);
  }
  const seen = new Set<string>();
  return value.map((planRaw, index): ProviderPresetBillingPlan => {
    const planContext = `${context}[${index}]`;
    if (!isRecord(planRaw)) {
      fail(`${planContext} must be an object.`);
    }
    const id = readRequiredString(planRaw, "id", planContext);
    if (seen.has(id)) {
      fail(`${planContext}: duplicate billing plan id ${JSON.stringify(id)}.`);
    }
    seen.add(id);
    const label = readOptionalString(planRaw, "label", planContext);
    const docUrl = readOptionalString(planRaw, "docUrl", planContext);
    const apiBase = readOptionalString(planRaw, "apiBase", planContext);
    const transports =
      planRaw["transports"] === undefined
        ? undefined
        : readTransports(planRaw["transports"], `${planContext}.transports`);
    if (apiBase === undefined && transports === undefined) {
      fail(`${planContext} requires "apiBase" or "transports".`);
    }
    return {
      id,
      ...(label !== undefined ? { label } : {}),
      ...(apiBase !== undefined ? { apiBase } : {}),
      ...(transports !== undefined ? { transports } : {}),
      ...(docUrl !== undefined ? { docUrl } : {}),
    };
  });
}

function readCatalog(value: unknown, context: string): ProviderPresetCatalog {
  if (!isRecord(value)) {
    fail(`${context} must be an object.`);
  }
  const parser = readRequiredString(value, "parser", context);
  const endpoint = readOptionalString(value, "endpoint", context);
  return { parser, ...(endpoint !== undefined ? { endpoint } : {}) };
}

function readProviderPreset(value: unknown, index: number): ProviderPreset {
  const context = `${SOURCE} providers[${index}]`;
  if (!isRecord(value)) {
    fail(`${context} must be an object.`);
  }
  const id = readRequiredString(value, "id", context);
  const label = readRequiredString(value, "label", context);
  const defaultTransport = readTransportKind(
    value["defaultTransport"],
    `${context}.defaultTransport`,
  );
  const sdk = readOptionalString(value, "sdk", context);
  const transports = readTransports(value["transports"], `${context}.transports`);
  if (transports[defaultTransport] === undefined) {
    fail(
      `${context}.transports must contain the default transport ${JSON.stringify(defaultTransport)}.`,
    );
  }
  const sites =
    value["sites"] === undefined ? undefined : readSites(value["sites"], `${context}.sites`);
  const billingPlans =
    value["billingPlans"] === undefined
      ? undefined
      : readBillingPlans(value["billingPlans"], `${context}.billingPlans`);
  const credentialsRaw = value["credentials"];
  if (!isRecord(credentialsRaw)) {
    fail(`${context}.credentials must be an object.`);
  }
  const credentialKind = credentialsRaw["kind"];
  if (typeof credentialKind !== "string" || !CREDENTIAL_KINDS.has(credentialKind)) {
    fail(`${context}.credentials.kind must be one of: ${[...CREDENTIAL_KINDS].join(", ")}.`);
  }
  let providerTools: ProviderPreset["providerTools"];
  if (value["providerTools"] !== undefined) {
    try {
      providerTools = validateProviderToolEntries(
        value["providerTools"],
        `${context}.providerTools`,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  let fileUpload: ProviderPreset["fileUpload"];
  if (value["fileUpload"] !== undefined) {
    try {
      fileUpload = validateFileUploadConfig(value["fileUpload"]);
    } catch (error) {
      fail(`${context}.fileUpload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const imageApi = readOptionalString(value, "imageApi", context);
  const videoApi = readOptionalString(value, "videoApi", context);
  const expressApiBase = readOptionalString(value, "expressApiBase", context);
  const catalog =
    value["catalog"] === undefined
      ? undefined
      : readCatalog(value["catalog"], `${context}.catalog`);
  return {
    id,
    label,
    defaultTransport,
    ...(sdk !== undefined ? { sdk } : {}),
    transports,
    ...(sites !== undefined ? { sites } : {}),
    ...(billingPlans !== undefined ? { billingPlans } : {}),
    credentials: { kind: credentialKind as ProviderPreset["credentials"]["kind"] },
    ...(providerTools !== undefined ? { providerTools } : {}),
    ...(fileUpload !== undefined ? { fileUpload } : {}),
    ...(imageApi !== undefined ? { imageApi } : {}),
    ...(videoApi !== undefined ? { videoApi } : {}),
    ...(expressApiBase !== undefined ? { expressApiBase } : {}),
    ...(catalog !== undefined ? { catalog } : {}),
  };
}

function readCustomPreset(value: unknown): CustomProviderPreset {
  if (!isRecord(value)) {
    fail(`"custom" must be an object.`);
  }
  return { defaultApiBase: readRequiredString(value, "defaultApiBase", "custom") };
}

/** Validates the manifest fail-fast and returns it typed; any malformed entry fails the whole load. */
export function loadProviderPresetManifest(data: unknown): ProviderPresetManifest {
  if (!isRecord(data)) {
    fail(`root must be an object with "custom" and "providers".`);
  }
  const custom = readCustomPreset(data["custom"]);
  const providersRaw = data["providers"];
  if (!Array.isArray(providersRaw)) {
    fail(`"providers" must be an array.`);
  }
  const seen = new Set<string>();
  const providers = providersRaw.map((entry, index) => {
    const preset = readProviderPreset(entry, index);
    if (seen.has(preset.id)) {
      fail(`duplicate provider id ${JSON.stringify(preset.id)}.`);
    }
    seen.add(preset.id);
    return preset;
  });
  return { custom, providers };
}

/** The bundled built-in manifest, validated at module load. */
export const PROVIDER_PRESET_MANIFEST: ProviderPresetManifest = loadProviderPresetManifest(
  rawManifest as unknown,
);

export const CUSTOM_PROVIDER_PRESET: CustomProviderPreset = PROVIDER_PRESET_MANIFEST.custom;

/** Picker order is the manifest array order. */
export function listProviderPresets(): readonly ProviderPreset[] {
  return PROVIDER_PRESET_MANIFEST.providers;
}

export function findProviderPreset(id: string): ProviderPreset | undefined {
  const normalized = id.trim();
  return PROVIDER_PRESET_MANIFEST.providers.find((preset) => preset.id === normalized);
}
