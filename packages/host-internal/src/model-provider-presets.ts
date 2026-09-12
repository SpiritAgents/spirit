import rawImport from "./model-provider-presets.json" with { type: "json" };

/** Aligned with `config.json` / CLI `ModelProvider` lowercase strings (must stay consistent with `pickerOrder`). */
export type ModelProviderId =
  | "deepseek"
  | "xai"
  | "moonshot-ai"
  | "kimi-code"
  | "z-ai"
  | "zhipu-ai"
  | "minimax"
  | "xiaomi"
  | "siliconflow"
  | "stepfun"
  | "alibaba"
  | "anthropic"
  | "vercel-ai-gateway"
  | "cloudflare-ai-gateway"
  | "openrouter"
  | "fireworks-ai"
  | "together-ai"
  | "groq"
  | "deepinfra"
  | "hugging-face"
  | "baseten"
  | "openai"
  | "google"
  | "google-vertex-ai"
  | "volcengine"
  | "byteplus"
  | "meituan"
  | "tencent-tokenhub"
  | "mistral"
  | "cohere"
  | "azure"
  | "amazon-bedrock"
  | "custom";
export type PresetModelProviderId = Exclude<ModelProviderId, "custom">;

/** Aligned with Desktop `DesktopTransportKind` / openai-models `ProviderModelTransportKind`. */
export type ProviderModelTransportKind =
  | "openai-compatible"
  | "open-responses"
  | "anthropic"
  | "bedrock";

const PROVIDER_MODEL_TRANSPORT_KINDS: readonly ProviderModelTransportKind[] = [
  "openai-compatible",
  "open-responses",
  "anthropic",
  "bedrock",
];

const CANONICAL_PICKER_ORDER: readonly ModelProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "deepseek",
  "openrouter",
  "fireworks-ai",
  "together-ai",
  "groq",
  "deepinfra",
  "baseten",
  "hugging-face",
  "moonshot-ai",
  "kimi-code",
  "z-ai",
  "zhipu-ai",
  "alibaba",
  "minimax",
  "xiaomi",
  "siliconflow",
  "stepfun",
  "volcengine",
  "byteplus",
  "meituan",
  "tencent-tokenhub",
  "mistral",
  "cohere",
  "azure",
  "amazon-bedrock",
  "google-vertex-ai",
  "custom",
];

const MODEL_PROVIDER_ID_SET: ReadonlySet<ModelProviderId> = new Set(CANONICAL_PICKER_ORDER);
const PRESET_PROVIDER_PICKER_ORDER = CANONICAL_PICKER_ORDER.filter(
  (id): id is PresetModelProviderId => id !== "custom",
);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCanonicalPickerOrder(
  order: readonly string[],
): asserts order is typeof CANONICAL_PICKER_ORDER {
  if (
    order.length !== CANONICAL_PICKER_ORDER.length ||
    order.some((id, index) => id !== CANONICAL_PICKER_ORDER[index])
  ) {
    throw new Error(
      'model-provider-presets.json: pickerOrder must be exactly ["openai","anthropic","google","xai","vercel-ai-gateway","cloudflare-ai-gateway","deepseek","openrouter","fireworks-ai","together-ai","groq","deepinfra","baseten","hugging-face","moonshot-ai","kimi-code","z-ai","zhipu-ai","alibaba","minimax","xiaomi","siliconflow","stepfun","volcengine","byteplus","meituan","tencent-tokenhub","mistral","cohere","azure","amazon-bedrock","google-vertex-ai","custom"]',
    );
  }
}

type PresetApiBaseByTransport = Partial<
  Record<PresetModelProviderId, Partial<Record<ProviderModelTransportKind, string>>>
>;

/** Connect wizard site id (e.g. SiliconFlow's cn / intl). */
export type ProviderConnectSiteId = string;

export interface ProviderConnectSiteDefinition {
  labelKey: string;
  fallbackLabel: string;
  apiBase: string;
  requiresWorkspaceId?: boolean;
}

export interface ProviderConnectSiteOption {
  id: ProviderConnectSiteId;
  labelKey: string;
  fallbackLabel: string;
  requiresWorkspaceId?: boolean;
}

export interface ProviderSiteSelectionConfig {
  defaultSite: ProviderConnectSiteId;
  sites: Record<ProviderConnectSiteId, ProviderConnectSiteDefinition>;
}

type ProviderSiteSelectionByProvider = Partial<
  Record<PresetModelProviderId, ProviderSiteSelectionConfig>
>;

export type AlibabaBillingMode = "token-plan";

export type StepfunBillingMode = "step-plan";

export type GlmCodingPlanBillingMode = "glm-coding-plan";

export interface AlibabaTokenPlanConfig {
  compatibleApiBase: string;
  docUrl: string;
}

export interface StepfunStepPlanConfig {
  compatibleApiBase: string;
  docUrl: string;
}

export interface GlmCodingPlanConfig {
  compatibleApiBase: string;
  docUrl: string;
}

export interface ResolveProviderConnectApiBaseOptions {
  site?: ProviderConnectSiteId;
  workspaceId?: string;
  customApiBaseTrimmed?: string;
  /** Alibaba Token Plan: fixed cn-beijing endpoint; site/workspace are ignored. */
  billingMode?: AlibabaBillingMode;
  /** StepFun Step Plan: step_plan path on the selected site host. */
  stepfunBillingMode?: StepfunBillingMode;
  /** Z.ai GLM Coding Plan: fixed coding/paas endpoint. */
  zAiBillingMode?: GlmCodingPlanBillingMode;
  /** Zhipu AI GLM Coding Plan: fixed coding/paas endpoint. */
  zhipuBillingMode?: GlmCodingPlanBillingMode;
}

export interface ProviderPickerLabel {
  labelKey: string;
  fallbackLabel: string;
}

export interface ProviderPickerRow extends ProviderPickerLabel {
  id: ModelProviderId;
}

interface ParsedModelProviderPresets {
  defaultCustomApiBase: string;
  presetApiBaseByProvider: Record<
    | "deepseek"
    | "xai"
    | "moonshot-ai"
    | "kimi-code"
    | "z-ai"
    | "zhipu-ai"
    | "minimax"
    | "xiaomi"
    | "siliconflow"
    | "stepfun"
    | "alibaba"
    | "anthropic"
    | "vercel-ai-gateway"
    | "cloudflare-ai-gateway"
    | "openrouter"
    | "fireworks-ai"
    | "together-ai"
    | "groq"
    | "deepinfra"
    | "hugging-face"
    | "baseten"
    | "openai"
    | "google"
    | "google-vertex-ai"
    | "volcengine"
    | "byteplus"
    | "meituan"
    | "tencent-tokenhub"
    | "mistral"
    | "cohere"
    | "azure"
    | "amazon-bedrock",
    string
  >;
  presetApiBaseByTransport: PresetApiBaseByTransport;
  providerSiteSelection: ProviderSiteSelectionByProvider;
  alibabaTokenPlan: AlibabaTokenPlanConfig;
  stepfunStepPlan: StepfunStepPlanConfig;
  zAiGlmCodingPlan: GlmCodingPlanConfig;
  zhipuAiGlmCodingPlan: GlmCodingPlanConfig;
  pickerOrder: readonly ModelProviderId[];
  pickerLabels: Record<ModelProviderId, ProviderPickerLabel>;
}

function requireStringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`model-provider-presets.json: missing or invalid string field "${key}"`);
  }
  return value;
}

function isProviderModelTransportKind(value: unknown): value is ProviderModelTransportKind {
  return (
    typeof value === "string" &&
    (PROVIDER_MODEL_TRANSPORT_KINDS as readonly string[]).includes(value)
  );
}

function parsePresetApiBaseByTransport(data: unknown): PresetApiBaseByTransport {
  if (!isJsonRecord(data)) {
    return {};
  }

  const result: PresetApiBaseByTransport = {};

  for (const [providerKey, transportMapRaw] of Object.entries(data)) {
    if (!isPresetModelProviderId(providerKey)) {
      throw new Error(
        `model-provider-presets.json: presetApiBaseByTransport.${providerKey} is not a preset provider id`,
      );
    }
    if (!isJsonRecord(transportMapRaw)) {
      throw new Error(
        `model-provider-presets.json: presetApiBaseByTransport.${providerKey} must be an object`,
      );
    }

    const transportMap: Partial<Record<ProviderModelTransportKind, string>> = {};
    for (const [transportKey, baseUrl] of Object.entries(transportMapRaw)) {
      if (!isProviderModelTransportKind(transportKey)) {
        throw new Error(
          `model-provider-presets.json: presetApiBaseByTransport.${providerKey}.${transportKey} is not a valid transport kind`,
        );
      }
      if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
        throw new Error(
          `model-provider-presets.json: presetApiBaseByTransport.${providerKey}.${transportKey} must be a non-empty string`,
        );
      }
      transportMap[transportKey] = baseUrl;
    }

    result[providerKey] = transportMap;
  }

  return result;
}

export function parseProviderSiteSelection(data: unknown): ProviderSiteSelectionByProvider {
  if (data === undefined) {
    return {};
  }
  if (!isJsonRecord(data)) {
    throw new Error("model-provider-presets.json: providerSiteSelection must be an object");
  }

  const result: ProviderSiteSelectionByProvider = {};

  for (const [providerKey, selectionRaw] of Object.entries(data)) {
    if (!isPresetModelProviderId(providerKey)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey} is not a preset provider id`,
      );
    }
    if (!isJsonRecord(selectionRaw)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey} must be an object`,
      );
    }

    const defaultSite = requireStringField(selectionRaw, "defaultSite");
    const sitesRaw = selectionRaw.sites;
    if (!isJsonRecord(sitesRaw) || Object.keys(sitesRaw).length === 0) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey}.sites must be a non-empty object`,
      );
    }

    const sites: Record<ProviderConnectSiteId, ProviderConnectSiteDefinition> = {};
    for (const [siteId, siteRaw] of Object.entries(sitesRaw)) {
      if (!isJsonRecord(siteRaw)) {
        throw new Error(
          `model-provider-presets.json: providerSiteSelection.${providerKey}.sites.${siteId} must be an object`,
        );
      }
      sites[siteId] = {
        labelKey: requireStringField(siteRaw, "labelKey"),
        fallbackLabel: requireStringField(siteRaw, "fallbackLabel"),
        apiBase: requireStringField(siteRaw, "apiBase"),
        ...(siteRaw.requiresWorkspaceId === true ? { requiresWorkspaceId: true } : {}),
      };
    }

    if (!(defaultSite in sites)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey}.defaultSite must exist in sites`,
      );
    }

    result[providerKey] = { defaultSite, sites };
  }

  return result;
}

function parseAlibabaTokenPlanConfig(data: unknown): AlibabaTokenPlanConfig {
  if (!isJsonRecord(data)) {
    throw new Error("model-provider-presets.json: alibabaTokenPlan must be an object");
  }
  return {
    compatibleApiBase: requireStringField(data, "compatibleApiBase"),
    docUrl: requireStringField(data, "docUrl"),
  };
}

function parseStepfunStepPlanConfig(data: unknown): StepfunStepPlanConfig {
  if (!isJsonRecord(data)) {
    throw new Error("model-provider-presets.json: stepfunStepPlan must be an object");
  }
  return {
    compatibleApiBase: requireStringField(data, "compatibleApiBase"),
    docUrl: requireStringField(data, "docUrl"),
  };
}

function parseGlmCodingPlanConfig(data: unknown, fieldName: string): GlmCodingPlanConfig {
  if (!isJsonRecord(data)) {
    throw new Error(`model-provider-presets.json: ${fieldName} must be an object`);
  }
  return {
    compatibleApiBase: requireStringField(data, "compatibleApiBase"),
    docUrl: requireStringField(data, "docUrl"),
  };
}

function parsePickerLabel(data: unknown, id: ModelProviderId): ProviderPickerLabel {
  if (!isJsonRecord(data)) {
    throw new Error(`model-provider-presets.json: pickerLabels.${id} must be an object`);
  }
  const labelKey = requireStringField(data, "labelKey");
  const fallbackLabel = requireStringField(data, "fallbackLabel");
  return { labelKey, fallbackLabel };
}

function parseModelProviderPresetsJson(data: unknown): ParsedModelProviderPresets {
  if (!isJsonRecord(data)) {
    throw new Error("model-provider-presets.json: root must be a JSON object");
  }

  const pickerOrderRaw = data.pickerOrder;
  if (!Array.isArray(pickerOrderRaw)) {
    throw new Error("model-provider-presets.json: pickerOrder must be an array");
  }
  if (!pickerOrderRaw.every((id): id is string => typeof id === "string")) {
    throw new Error("model-provider-presets.json: pickerOrder must be an array of strings");
  }
  assertCanonicalPickerOrder(pickerOrderRaw);
  const pickerOrder = pickerOrderRaw as readonly ModelProviderId[];

  const presetRaw = data.presetApiBaseByProvider;
  if (!isJsonRecord(presetRaw)) {
    throw new Error("model-provider-presets.json: presetApiBaseByProvider must be an object");
  }
  const presetApiBaseByProvider = {
    deepseek: requireStringField(presetRaw, "deepseek"),
    xai: requireStringField(presetRaw, "xai"),
    "moonshot-ai": requireStringField(presetRaw, "moonshot-ai"),
    "kimi-code": requireStringField(presetRaw, "kimi-code"),
    "z-ai": requireStringField(presetRaw, "z-ai"),
    "zhipu-ai": requireStringField(presetRaw, "zhipu-ai"),
    minimax: requireStringField(presetRaw, "minimax"),
    xiaomi: requireStringField(presetRaw, "xiaomi"),
    siliconflow: requireStringField(presetRaw, "siliconflow"),
    stepfun: requireStringField(presetRaw, "stepfun"),
    alibaba: requireStringField(presetRaw, "alibaba"),
    anthropic: requireStringField(presetRaw, "anthropic"),
    "vercel-ai-gateway": requireStringField(presetRaw, "vercel-ai-gateway"),
    "cloudflare-ai-gateway": requireStringField(presetRaw, "cloudflare-ai-gateway"),
    openrouter: requireStringField(presetRaw, "openrouter"),
    "fireworks-ai": requireStringField(presetRaw, "fireworks-ai"),
    "together-ai": requireStringField(presetRaw, "together-ai"),
    groq: requireStringField(presetRaw, "groq"),
    deepinfra: requireStringField(presetRaw, "deepinfra"),
    "hugging-face": requireStringField(presetRaw, "hugging-face"),
    baseten: requireStringField(presetRaw, "baseten"),
    openai: requireStringField(presetRaw, "openai"),
    google: requireStringField(presetRaw, "google"),
    "google-vertex-ai": requireStringField(presetRaw, "google-vertex-ai"),
    volcengine: requireStringField(presetRaw, "volcengine"),
    byteplus: requireStringField(presetRaw, "byteplus"),
    meituan: requireStringField(presetRaw, "meituan"),
    "tencent-tokenhub": requireStringField(presetRaw, "tencent-tokenhub"),
    mistral: requireStringField(presetRaw, "mistral"),
    cohere: requireStringField(presetRaw, "cohere"),
    azure: requireStringField(presetRaw, "azure"),
    "amazon-bedrock": requireStringField(presetRaw, "amazon-bedrock"),
  };

  const labelsRaw = data.pickerLabels;
  if (!isJsonRecord(labelsRaw)) {
    throw new Error("model-provider-presets.json: pickerLabels must be an object");
  }
  const pickerLabels: Partial<Record<ModelProviderId, ProviderPickerLabel>> = {};
  for (const id of pickerOrder) {
    const label = labelsRaw[id];
    pickerLabels[id] = parsePickerLabel(label, id);
  }

  const defaultCustomApiBase = requireStringField(data, "defaultCustomApiBase");

  const presetApiBaseByTransportRaw = data.presetApiBaseByTransport;
  const presetApiBaseByTransport =
    presetApiBaseByTransportRaw === undefined
      ? {}
      : parsePresetApiBaseByTransport(presetApiBaseByTransportRaw);

  const providerSiteSelection = parseProviderSiteSelection(data.providerSiteSelection);
  const alibabaTokenPlan = parseAlibabaTokenPlanConfig(data.alibabaTokenPlan);
  const stepfunStepPlan = parseStepfunStepPlanConfig(data.stepfunStepPlan);
  const zAiGlmCodingPlan = parseGlmCodingPlanConfig(data.zAiGlmCodingPlan, "zAiGlmCodingPlan");
  const zhipuAiGlmCodingPlan = parseGlmCodingPlanConfig(
    data.zhipuAiGlmCodingPlan,
    "zhipuAiGlmCodingPlan",
  );

  return {
    defaultCustomApiBase,
    presetApiBaseByProvider,
    presetApiBaseByTransport,
    providerSiteSelection,
    alibabaTokenPlan,
    stepfunStepPlan,
    zAiGlmCodingPlan,
    zhipuAiGlmCodingPlan,
    pickerOrder,
    pickerLabels: pickerLabels as Record<ModelProviderId, ProviderPickerLabel>,
  };
}

const raw = parseModelProviderPresetsJson(rawImport as unknown);

export const ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE: string =
  raw.alibabaTokenPlan.compatibleApiBase;
export const ALIBABA_TOKEN_PLAN_DOC_URL: string = raw.alibabaTokenPlan.docUrl;
export const STEPFUN_STEP_PLAN_COMPATIBLE_API_BASE: string = raw.stepfunStepPlan.compatibleApiBase;
export const STEPFUN_STEP_PLAN_DOC_URL: string = raw.stepfunStepPlan.docUrl;
export const Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: string =
  raw.zAiGlmCodingPlan.compatibleApiBase;
export const Z_AI_GLM_CODING_PLAN_DOC_URL: string = raw.zAiGlmCodingPlan.docUrl;
export const ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: string =
  raw.zhipuAiGlmCodingPlan.compatibleApiBase;
export const ZHIPU_AI_GLM_CODING_PLAN_DOC_URL: string = raw.zhipuAiGlmCodingPlan.docUrl;

export const DEFAULT_CUSTOM_API_BASE: string = raw.defaultCustomApiBase;

const deepseekBase = raw.presetApiBaseByProvider.deepseek;
const xaiBase = raw.presetApiBaseByProvider.xai;
const moonshotAiBase = raw.presetApiBaseByProvider["moonshot-ai"];
const kimiCodeBase = raw.presetApiBaseByProvider["kimi-code"];
const zAiBase = raw.presetApiBaseByProvider["z-ai"];
const zhipuAiBase = raw.presetApiBaseByProvider["zhipu-ai"];
const minimaxBase = raw.presetApiBaseByProvider.minimax;
const xiaomiBase = raw.presetApiBaseByProvider.xiaomi;
const siliconflowBase = raw.presetApiBaseByProvider.siliconflow;
const stepfunBase = raw.presetApiBaseByProvider.stepfun;
const alibabaBase = raw.presetApiBaseByProvider.alibaba;
const anthropicBase = raw.presetApiBaseByProvider.anthropic;
const vercelAiGatewayBase = raw.presetApiBaseByProvider["vercel-ai-gateway"];
const cloudflareAiGatewayBase = raw.presetApiBaseByProvider["cloudflare-ai-gateway"];
const openrouterBase = raw.presetApiBaseByProvider.openrouter;
const fireworksAiBase = raw.presetApiBaseByProvider["fireworks-ai"];
const togetherAiBase = raw.presetApiBaseByProvider["together-ai"];
const groqBase = raw.presetApiBaseByProvider.groq;
const deepinfraBase = raw.presetApiBaseByProvider.deepinfra;
const huggingFaceBase = raw.presetApiBaseByProvider["hugging-face"];
const basetenBase = raw.presetApiBaseByProvider.baseten;
const openaiBase = raw.presetApiBaseByProvider.openai;
const googleBase = raw.presetApiBaseByProvider.google;
const googleVertexAiBase = raw.presetApiBaseByProvider["google-vertex-ai"];
const volcengineBase = raw.presetApiBaseByProvider.volcengine;
const byteplusBase = raw.presetApiBaseByProvider.byteplus;
const meituanBase = raw.presetApiBaseByProvider.meituan;
const tencentTokenhubBase = raw.presetApiBaseByProvider["tencent-tokenhub"];
const mistralBase = raw.presetApiBaseByProvider.mistral;
const cohereBase = raw.presetApiBaseByProvider.cohere;
const azureBase = raw.presetApiBaseByProvider.azure;
const amazonBedrockBase = raw.presetApiBaseByProvider["amazon-bedrock"];

export const PROVIDER_PRESET_API_BASE = {
  deepseek: deepseekBase,
  xai: xaiBase,
  "moonshot-ai": moonshotAiBase,
  "kimi-code": kimiCodeBase,
  "z-ai": zAiBase,
  "zhipu-ai": zhipuAiBase,
  minimax: minimaxBase,
  xiaomi: xiaomiBase,
  siliconflow: siliconflowBase,
  stepfun: stepfunBase,
  alibaba: alibabaBase,
  anthropic: anthropicBase,
  "vercel-ai-gateway": vercelAiGatewayBase,
  "cloudflare-ai-gateway": cloudflareAiGatewayBase,
  openrouter: openrouterBase,
  "fireworks-ai": fireworksAiBase,
  "together-ai": togetherAiBase,
  groq: groqBase,
  deepinfra: deepinfraBase,
  "hugging-face": huggingFaceBase,
  baseten: basetenBase,
  openai: openaiBase,
  google: googleBase,
  "google-vertex-ai": googleVertexAiBase,
  volcengine: volcengineBase,
  byteplus: byteplusBase,
  meituan: meituanBase,
  "tencent-tokenhub": tencentTokenhubBase,
  mistral: mistralBase,
  cohere: cohereBase,
  azure: azureBase,
  "amazon-bedrock": amazonBedrockBase,
} as const satisfies Record<Exclude<ModelProviderId, "custom">, string>;

const pickerLabels = raw.pickerLabels;

/** Settings page etc.: show provider options in a fixed order. */
export const PROVIDER_PICKER_ROWS: ProviderPickerRow[] = raw.pickerOrder.map((id) => ({
  id,
  ...pickerLabels[id],
}));

/** Grouping and ordering follow `pickerOrder`. */
export const MODEL_PROVIDER_PICKER_ORDER: readonly ModelProviderId[] = CANONICAL_PICKER_ORDER;
export const PRESET_MODEL_PROVIDER_PICKER_ORDER: readonly PresetModelProviderId[] =
  PRESET_PROVIDER_PICKER_ORDER;

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === "string" && MODEL_PROVIDER_ID_SET.has(value as ModelProviderId);
}

export function parseModelProviderId(value: unknown): ModelProviderId | undefined {
  return isModelProviderId(value) ? value : undefined;
}

export function isPresetModelProviderId(value: unknown): value is PresetModelProviderId {
  return (
    typeof value === "string" &&
    value !== "custom" &&
    MODEL_PROVIDER_ID_SET.has(value as ModelProviderId)
  );
}

export function parsePresetModelProviderId(value: unknown): PresetModelProviderId | undefined {
  return isPresetModelProviderId(value) ? value : undefined;
}

export function partitionModelsByProvider<Model extends { provider?: ModelProviderId }>(
  models: readonly Model[],
  provider: ModelProviderId,
): { matched: Model[]; unmatched: Model[] } {
  const matched: Model[] = [];
  const unmatched: Model[] = [];

  for (const model of models) {
    if (model.provider === provider) {
      matched.push(model);
    } else {
      unmatched.push(model);
    }
  }

  return { matched, unmatched };
}

function normalizeResolveProviderConnectApiBaseOptions(
  options?: ResolveProviderConnectApiBaseOptions | string,
): ResolveProviderConnectApiBaseOptions {
  if (typeof options === "string") {
    return { customApiBaseTrimmed: options };
  }
  return options ?? {};
}

export function providerSupportsSiteSelection(provider: ModelProviderId): boolean {
  if (provider === "custom") {
    return false;
  }
  return raw.providerSiteSelection[provider] !== undefined;
}

export function defaultProviderConnectSite(
  provider: ModelProviderId,
): ProviderConnectSiteId | undefined {
  if (provider === "custom") {
    return undefined;
  }
  return raw.providerSiteSelection[provider]?.defaultSite;
}

export function listProviderConnectSiteOptions(
  provider: ModelProviderId,
): ProviderConnectSiteOption[] {
  if (provider === "custom") {
    return [];
  }
  const selection = raw.providerSiteSelection[provider];
  if (!selection) {
    return [];
  }
  return Object.entries(selection.sites).map(([id, site]) => ({
    id,
    labelKey: site.labelKey,
    fallbackLabel: site.fallbackLabel,
    ...(site.requiresWorkspaceId ? { requiresWorkspaceId: true } : {}),
  }));
}

const PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER = "{workspaceId}";

function siteDefinitionRequiresWorkspaceId(site: ProviderConnectSiteDefinition): boolean {
  return (
    site.requiresWorkspaceId === true ||
    site.apiBase.includes(PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER)
  );
}

export function providerConnectSiteRequiresWorkspaceId(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
): boolean {
  if (provider === "custom") {
    return false;
  }
  const selection = raw.providerSiteSelection[provider];
  const siteDef = selection?.sites[site];
  return siteDef !== undefined && siteDefinitionRequiresWorkspaceId(siteDef);
}

function applyWorkspaceIdToProviderSiteApiBase(apiBase: string, workspaceId: string): string {
  return apiBase.replaceAll(PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER, workspaceId.trim());
}

export function resolveProviderConnectSiteApiBase(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
  workspaceId?: string,
): string | undefined {
  if (provider === "custom") {
    return undefined;
  }
  const selection = raw.providerSiteSelection[provider];
  if (!selection) {
    return undefined;
  }
  const siteDef = selection.sites[site];
  if (!siteDef) {
    return undefined;
  }
  if (siteDefinitionRequiresWorkspaceId(siteDef)) {
    const trimmedWorkspaceId = workspaceId?.trim();
    if (!trimmedWorkspaceId) {
      throw new Error(`Provider site "${site}" requires a workspace ID.`);
    }
    return applyWorkspaceIdToProviderSiteApiBase(siteDef.apiBase, trimmedWorkspaceId);
  }
  return siteDef.apiBase;
}

export function isProviderConnectSiteId(
  provider: ModelProviderId,
  site: unknown,
): site is ProviderConnectSiteId {
  if (typeof site !== "string" || site.trim() === "") {
    return false;
  }
  if (provider === "custom") {
    return false;
  }
  const selection = raw.providerSiteSelection[provider];
  return selection !== undefined && site in selection.sites;
}

function resolveTransportApiBaseForProviderSite(
  provider: PresetModelProviderId,
  transportKind: ProviderModelTransportKind,
  siteBase: string,
): string | undefined {
  const transportBases = raw.presetApiBaseByTransport[provider];
  if (!transportBases) {
    return undefined;
  }

  const transportBase = transportBases[transportKind];
  if (!transportBase) {
    return undefined;
  }

  if (transportKind === "openai-compatible") {
    return siteBase;
  }

  try {
    const siteUrl = new URL(siteBase);
    const transportUrl = new URL(transportBase);
    if (siteUrl.origin === transportUrl.origin) {
      return transportBase;
    }
    const pathname = transportUrl.pathname === "/" ? "" : transportUrl.pathname;
    return `${siteUrl.origin}${pathname}`;
  } catch {
    return undefined;
  }
}

/** StepFun Step Plan: step_plan path on the selected site host; no site keeps the .com fallback. */
export function resolveStepfunStepPlanConnectApiBase(
  transportKind: ProviderModelTransportKind,
  site?: ProviderConnectSiteId,
): string {
  const origin = resolveStepfunStepPlanOrigin(site);
  if (transportKind === "anthropic") {
    return `${origin}/step_plan`;
  }
  return `${origin}/step_plan/v1`;
}

function resolveStepfunStepPlanOrigin(site?: ProviderConnectSiteId): string {
  const standardBase = site ? resolveProviderConnectSiteApiBase("stepfun", site) : undefined;
  if (standardBase) {
    try {
      return new URL(standardBase).origin;
    } catch {
      // Invalid configured site base; fall back to the China Step Plan host.
    }
  }
  return new URL(STEPFUN_STEP_PLAN_COMPATIBLE_API_BASE).origin;
}

/** Z.ai GLM Coding Plan: fixed coding/paas OpenAI-compatible endpoint. */
export function resolveZAiGlmCodingPlanConnectApiBase(): string {
  return Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE;
}

/** Zhipu AI GLM Coding Plan: fixed coding/paas OpenAI-compatible endpoint. */
export function resolveZhipuAiGlmCodingPlanConnectApiBase(): string {
  return ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE;
}

/** Alibaba Token Plan: fixed cn-beijing compatible base; Anthropic / Open Responses derived by transport. */
export function resolveAlibabaTokenPlanConnectApiBase(
  transportKind: ProviderModelTransportKind,
): string {
  const siteBase = ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE;
  const transportAdjusted = resolveTransportApiBaseForProviderSite(
    "alibaba",
    transportKind,
    siteBase,
  );
  return transportAdjusted ?? siteBase;
}

export function resolveConnectApiBase(
  provider: ModelProviderId,
  customApiBaseTrimmed: string,
): string {
  switch (provider) {
    case "deepseek":
      return PROVIDER_PRESET_API_BASE.deepseek;
    case "xai":
      return PROVIDER_PRESET_API_BASE.xai;
    case "moonshot-ai":
      return PROVIDER_PRESET_API_BASE["moonshot-ai"];
    case "kimi-code":
      return PROVIDER_PRESET_API_BASE["kimi-code"];
    case "z-ai":
      return PROVIDER_PRESET_API_BASE["z-ai"];
    case "zhipu-ai":
      return PROVIDER_PRESET_API_BASE["zhipu-ai"];
    case "minimax":
      return PROVIDER_PRESET_API_BASE.minimax;
    case "xiaomi":
      return PROVIDER_PRESET_API_BASE.xiaomi;
    case "siliconflow":
      return PROVIDER_PRESET_API_BASE.siliconflow;
    case "stepfun":
      return PROVIDER_PRESET_API_BASE.stepfun;
    case "alibaba":
      return PROVIDER_PRESET_API_BASE.alibaba;
    case "anthropic":
      return PROVIDER_PRESET_API_BASE.anthropic;
    case "vercel-ai-gateway":
      return PROVIDER_PRESET_API_BASE["vercel-ai-gateway"];
    case "cloudflare-ai-gateway":
      return PROVIDER_PRESET_API_BASE["cloudflare-ai-gateway"];
    case "openrouter":
      return PROVIDER_PRESET_API_BASE.openrouter;
    case "fireworks-ai":
      return PROVIDER_PRESET_API_BASE["fireworks-ai"];
    case "together-ai":
      return PROVIDER_PRESET_API_BASE["together-ai"];
    case "groq":
      return PROVIDER_PRESET_API_BASE.groq;
    case "deepinfra":
      return PROVIDER_PRESET_API_BASE.deepinfra;
    case "hugging-face":
      return PROVIDER_PRESET_API_BASE["hugging-face"];
    case "baseten":
      return PROVIDER_PRESET_API_BASE.baseten;
    case "openai":
      return PROVIDER_PRESET_API_BASE.openai;
    case "google":
      return PROVIDER_PRESET_API_BASE.google;
    case "google-vertex-ai":
      return PROVIDER_PRESET_API_BASE["google-vertex-ai"];
    case "volcengine":
      return PROVIDER_PRESET_API_BASE.volcengine;
    case "byteplus":
      return PROVIDER_PRESET_API_BASE.byteplus;
    case "meituan":
      return PROVIDER_PRESET_API_BASE.meituan;
    case "tencent-tokenhub":
      return PROVIDER_PRESET_API_BASE["tencent-tokenhub"];
    case "mistral":
      return PROVIDER_PRESET_API_BASE.mistral;
    case "cohere":
      return PROVIDER_PRESET_API_BASE.cohere;
    case "azure":
      return PROVIDER_PRESET_API_BASE.azure;
    case "amazon-bedrock":
      return PROVIDER_PRESET_API_BASE["amazon-bedrock"];
    case "custom": {
      return customApiBaseTrimmed.trim();
    }
  }
}

/**
 * Connect wizard: resolve the default endpoint from the preset provider and API type (when the user has not provided an endpoint override).
 */
export function resolveProviderConnectApiBase(
  provider: ModelProviderId,
  transportKind: ProviderModelTransportKind,
  options?: ResolveProviderConnectApiBaseOptions | string,
): string {
  const {
    site,
    workspaceId,
    customApiBaseTrimmed = "",
    billingMode,
    stepfunBillingMode,
    zAiBillingMode,
    zhipuBillingMode,
  } = normalizeResolveProviderConnectApiBaseOptions(options);

  if (provider === "custom") {
    return customApiBaseTrimmed.trim();
  }

  if (provider === "alibaba" && billingMode === "token-plan") {
    return resolveAlibabaTokenPlanConnectApiBase(transportKind);
  }

  if (provider === "stepfun" && stepfunBillingMode === "step-plan") {
    return resolveStepfunStepPlanConnectApiBase(transportKind, site);
  }

  if (provider === "z-ai" && zAiBillingMode === "glm-coding-plan") {
    return resolveZAiGlmCodingPlanConnectApiBase();
  }

  if (provider === "zhipu-ai" && zhipuBillingMode === "glm-coding-plan") {
    return resolveZhipuAiGlmCodingPlanConnectApiBase();
  }

  const siteBase = site
    ? resolveProviderConnectSiteApiBase(provider, site, workspaceId)
    : undefined;
  if (siteBase) {
    const transportAdjusted = resolveTransportApiBaseForProviderSite(
      provider as PresetModelProviderId,
      transportKind,
      siteBase,
    );
    return transportAdjusted ?? siteBase;
  }

  if (provider === "openai") {
    return PROVIDER_PRESET_API_BASE.openai;
  }

  const transportBases = raw.presetApiBaseByTransport[provider as PresetModelProviderId];
  const transportBase = transportBases?.[transportKind];
  if (transportBase) {
    return transportBase;
  }

  return resolveConnectApiBase(provider, customApiBaseTrimmed);
}
