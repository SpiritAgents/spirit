/**
 * Compatibility shim over `@spiritagent/agent-core/provider-presets`: the preset manifest and the
 * apiBase resolver live in agent-core (`provider-presets.json` + `resolvePresetApiBase`); this
 * module keeps the legacy exported API surface (wizard helpers, picker rows, billing-plan
 * constants) stable for current consumers until the runtime flip to the v1 config.
 */
import {
  CUSTOM_PROVIDER_PRESET,
  findProviderPreset,
  listProviderPresets,
  resolvePresetApiBase,
} from "@spiritagent/agent-core/provider-presets";
import type {
  ProviderPreset,
  ProviderPresetBillingPlan,
  ProviderPresetSite,
} from "@spiritagent/agent-core/provider-presets";

/** Aligned with `config.json` / CLI `ModelProvider` lowercase strings; validated against the preset manifest at module load. */
const MODEL_PROVIDER_IDS = [
  "deepseek",
  "xai",
  "moonshot-ai",
  "kimi-code",
  "z-ai",
  "zhipu-ai",
  "minimax",
  "xiaomi",
  "siliconflow",
  "stepfun",
  "alibaba",
  "anthropic",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "openrouter",
  "fireworks-ai",
  "together-ai",
  "groq",
  "deepinfra",
  "hugging-face",
  "baseten",
  "openai",
  "google",
  "google-vertex-ai",
  "volcengine",
  "byteplus",
  "meituan",
  "tencent-tokenhub",
  "mistral",
  "cohere",
  "azure",
  "amazon-bedrock",
  "custom",
] as const;
export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];
export type PresetModelProviderId = Exclude<ModelProviderId, "custom">;

/** Aligned with Desktop `DesktopTransportKind` / agent-core `LlmTransportKind`. */
export type ProviderModelTransportKind =
  | "openai-compatible"
  | "open-responses"
  | "anthropic"
  | "bedrock";

const MODEL_PROVIDER_ID_SET: ReadonlySet<string> = new Set(MODEL_PROVIDER_IDS);

/** Connect wizard site id (e.g. SiliconFlow's cn / intl). */
export type ProviderConnectSiteId = string;

export interface ProviderConnectSiteOption {
  id: ProviderConnectSiteId;
  labelKey: string;
  fallbackLabel: string;
  requiresWorkspaceId?: boolean;
}

export type AlibabaBillingMode = "token-plan";

export type StepfunBillingMode = "step-plan";

export type GlmCodingPlanBillingMode = "glm-coding-plan";

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

function requirePresetModelProviderId(id: string): PresetModelProviderId {
  if (!isPresetModelProviderId(id)) {
    throw new Error(`provider-presets.json: "${id}" is not a known preset provider id`);
  }
  return id;
}

function presetFor(provider: PresetModelProviderId): ProviderPreset {
  const preset = findProviderPreset(provider);
  if (!preset) {
    throw new Error(`provider-presets.json: missing preset "${provider}"`);
  }
  return preset;
}

/** Picker order is the manifest array order. */
export const PRESET_MODEL_PROVIDER_PICKER_ORDER: readonly PresetModelProviderId[] =
  listProviderPresets().map((preset) => requirePresetModelProviderId(preset.id));

for (const id of MODEL_PROVIDER_IDS) {
  if (id !== "custom" && !findProviderPreset(id)) {
    throw new Error(`provider-presets.json: missing preset "${id}"`);
  }
}

/** Grouping and ordering follow the manifest array order; `custom` is the wizard-only last row. */
export const MODEL_PROVIDER_PICKER_ORDER: readonly ModelProviderId[] = [
  ...PRESET_MODEL_PROVIDER_PICKER_ORDER,
  "custom",
];

/**
 * Legacy display placeholders: the old flat preset bases carried `YOUR_*` sentinel text shown in
 * wizard default endpoints; the manifest now carries `{placeholder}` templates. This shim keeps
 * resolving the old literals until the runtime flip (the v1 materializer substitutes real values).
 */
const LEGACY_TEMPLATE_VALUES: Record<string, string> = {
  resourceName: "YOUR_RESOURCE_NAME",
  accountId: "YOUR_ACCOUNT_ID",
  awsRegion: "us-east-1",
  project: "YOUR_PROJECT_ID",
  location: "us-central1",
};

function resolvePresetBase(
  preset: ProviderPreset,
  transportKind?: ProviderModelTransportKind,
): string {
  return resolvePresetApiBase(preset, {
    ...(transportKind !== undefined ? { transportKind } : {}),
    templateValues: LEGACY_TEMPLATE_VALUES,
  });
}

export const PROVIDER_PRESET_API_BASE: Record<PresetModelProviderId, string> = Object.fromEntries(
  listProviderPresets().map((preset) => [preset.id, resolvePresetBase(preset)]),
) as Record<PresetModelProviderId, string>;

export const DEFAULT_CUSTOM_API_BASE: string = CUSTOM_PROVIDER_PRESET.defaultApiBase;

function camelCaseProviderId(id: string): string {
  return id
    .split("-")
    .map((part, index) =>
      index === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join("");
}

/** Historical picker i18n keys follow `providers.<camelCaseId>`; deepinfra is the one irregular key. */
function providerPickerLabelKey(id: ModelProviderId): string {
  if (id === "deepinfra") {
    return "providers.deepInfra";
  }
  return `providers.${camelCaseProviderId(id)}`;
}

/** Settings page etc.: show provider options in a fixed order. */
export const PROVIDER_PICKER_ROWS: ProviderPickerRow[] = MODEL_PROVIDER_PICKER_ORDER.map((id) => ({
  id,
  labelKey: providerPickerLabelKey(id),
  fallbackLabel: id === "custom" ? "Custom" : presetFor(id).label,
}));

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === "string" && MODEL_PROVIDER_ID_SET.has(value);
}

export function parseModelProviderId(value: unknown): ModelProviderId | undefined {
  return isModelProviderId(value) ? value : undefined;
}

export function isPresetModelProviderId(value: unknown): value is PresetModelProviderId {
  return isModelProviderId(value) && value !== "custom";
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

function findConnectSite(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
): { preset: ProviderPreset; site: ProviderPresetSite } | undefined {
  if (provider === "custom") {
    return undefined;
  }
  const preset = findProviderPreset(provider);
  const siteDef = preset?.sites?.items.find((item) => item.id === site);
  if (!preset || !siteDef) {
    return undefined;
  }
  return { preset, site: siteDef };
}

export function providerSupportsSiteSelection(provider: ModelProviderId): boolean {
  if (provider === "custom") {
    return false;
  }
  return findProviderPreset(provider)?.sites !== undefined;
}

export function defaultProviderConnectSite(
  provider: ModelProviderId,
): ProviderConnectSiteId | undefined {
  if (provider === "custom") {
    return undefined;
  }
  return findProviderPreset(provider)?.sites?.default;
}

/** Historical site i18n keys follow `providers.<camelCaseProviderId>Site.<siteId>`. */
function siteLabelKey(provider: ModelProviderId, site: ProviderConnectSiteId): string {
  return `providers.${camelCaseProviderId(provider)}Site.${site}`;
}

export function listProviderConnectSiteOptions(
  provider: ModelProviderId,
): ProviderConnectSiteOption[] {
  if (provider === "custom") {
    return [];
  }
  const selection = findProviderPreset(provider)?.sites;
  if (!selection) {
    return [];
  }
  return selection.items.map((site) => ({
    id: site.id,
    labelKey: siteLabelKey(provider, site.id),
    fallbackLabel: site.label,
    ...(siteRequiresWorkspaceId(site) ? { requiresWorkspaceId: true } : {}),
  }));
}

const PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER = "{workspaceId}";

function siteRequiresWorkspaceId(site: ProviderPresetSite): boolean {
  if (site.requiresWorkspaceId === true) {
    return true;
  }
  const bases = [site.apiBase, ...Object.values(site.transports ?? {})];
  return bases.some((base) => base?.includes(PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER));
}

export function providerConnectSiteRequiresWorkspaceId(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
): boolean {
  const found = findConnectSite(provider, site);
  return found !== undefined && siteRequiresWorkspaceId(found.site);
}

function resolveConnectSiteApiBase(
  preset: ProviderPreset,
  site: ProviderPresetSite,
  transportKind: ProviderModelTransportKind | undefined,
  workspaceId?: string,
): string {
  if (siteRequiresWorkspaceId(site)) {
    const trimmedWorkspaceId = workspaceId?.trim();
    if (!trimmedWorkspaceId) {
      throw new Error(`Provider site "${site.id}" requires a workspace ID.`);
    }
    return resolvePresetApiBase(preset, {
      ...(transportKind !== undefined ? { transportKind } : {}),
      siteId: site.id,
      templateValues: { ...LEGACY_TEMPLATE_VALUES, workspaceId: trimmedWorkspaceId },
    });
  }
  return resolvePresetApiBase(preset, {
    ...(transportKind !== undefined ? { transportKind } : {}),
    siteId: site.id,
    templateValues: LEGACY_TEMPLATE_VALUES,
  });
}

export function resolveProviderConnectSiteApiBase(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
  workspaceId?: string,
): string | undefined {
  const found = findConnectSite(provider, site);
  if (!found) {
    return undefined;
  }
  // The legacy single site base is the site's openai-compatible slot (or its only base).
  return resolveConnectSiteApiBase(found.preset, found.site, "openai-compatible", workspaceId);
}

export function isProviderConnectSiteId(
  provider: ModelProviderId,
  site: unknown,
): site is ProviderConnectSiteId {
  if (typeof site !== "string" || site.trim() === "") {
    return false;
  }
  return findConnectSite(provider, site) !== undefined;
}

function requireBillingPlan(
  provider: PresetModelProviderId,
  planId: string,
): ProviderPresetBillingPlan {
  const plan = presetFor(provider).billingPlans?.find((entry) => entry.id === planId);
  if (!plan) {
    throw new Error(`provider-presets.json: preset "${provider}" has no billing plan "${planId}"`);
  }
  return plan;
}

function billingPlanBase(provider: PresetModelProviderId, planId: string): string {
  const preset = presetFor(provider);
  const plan = requireBillingPlan(provider, planId);
  const base = plan.apiBase ?? plan.transports?.[preset.defaultTransport];
  if (!base) {
    throw new Error(`provider-presets.json: billing plan "${planId}" of "${provider}" has no base`);
  }
  return base;
}

function billingPlanDocUrl(provider: PresetModelProviderId, planId: string): string {
  const docUrl = requireBillingPlan(provider, planId).docUrl;
  if (!docUrl) {
    throw new Error(
      `provider-presets.json: billing plan "${planId}" of "${provider}" has no docUrl`,
    );
  }
  return docUrl;
}

export const ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE: string = billingPlanBase(
  "alibaba",
  "token-plan",
);
export const ALIBABA_TOKEN_PLAN_DOC_URL: string = billingPlanDocUrl("alibaba", "token-plan");
export const STEPFUN_STEP_PLAN_COMPATIBLE_API_BASE: string = billingPlanBase(
  "stepfun",
  "step-plan",
);
export const STEPFUN_STEP_PLAN_DOC_URL: string = billingPlanDocUrl("stepfun", "step-plan");
export const Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: string = billingPlanBase(
  "z-ai",
  "glm-coding-plan",
);
export const Z_AI_GLM_CODING_PLAN_DOC_URL: string = billingPlanDocUrl("z-ai", "glm-coding-plan");
export const ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE: string = billingPlanBase(
  "zhipu-ai",
  "glm-coding-plan",
);
export const ZHIPU_AI_GLM_CODING_PLAN_DOC_URL: string = billingPlanDocUrl(
  "zhipu-ai",
  "glm-coding-plan",
);

/**
 * StepFun Step Plan: the plan pins its own per-transport bases in the manifest; the selected site
 * no longer influences them (the manifest data hosts the plan on the China endpoint).
 */
export function resolveStepfunStepPlanConnectApiBase(
  transportKind: ProviderModelTransportKind,
  _site?: ProviderConnectSiteId,
): string {
  return resolvePresetApiBase(presetFor("stepfun"), { transportKind, billingPlanId: "step-plan" });
}

/** Z.ai GLM Coding Plan: fixed coding/paas OpenAI-compatible endpoint. */
export function resolveZAiGlmCodingPlanConnectApiBase(): string {
  return Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE;
}

/** Zhipu AI GLM Coding Plan: fixed coding/paas OpenAI-compatible endpoint. */
export function resolveZhipuAiGlmCodingPlanConnectApiBase(): string {
  return ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE;
}

/** Alibaba Token Plan: fixed cn-beijing compatible base; Anthropic / Open Responses read their own plan slots. */
export function resolveAlibabaTokenPlanConnectApiBase(
  transportKind: ProviderModelTransportKind,
): string {
  return resolvePresetApiBase(presetFor("alibaba"), { transportKind, billingPlanId: "token-plan" });
}

export function resolveConnectApiBase(
  provider: ModelProviderId,
  customApiBaseTrimmed: string,
): string {
  if (provider === "custom") {
    return customApiBaseTrimmed.trim();
  }
  return PROVIDER_PRESET_API_BASE[provider];
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

  const preset = presetFor(provider);

  const billingPlanId =
    provider === "alibaba" && billingMode === "token-plan"
      ? "token-plan"
      : provider === "stepfun" && stepfunBillingMode === "step-plan"
        ? "step-plan"
        : provider === "z-ai" && zAiBillingMode === "glm-coding-plan"
          ? "glm-coding-plan"
          : provider === "zhipu-ai" && zhipuBillingMode === "glm-coding-plan"
            ? "glm-coding-plan"
            : undefined;

  if (billingPlanId !== undefined) {
    return resolvePresetApiBase(preset, { transportKind, billingPlanId });
  }

  if (site) {
    const found = findConnectSite(provider, site);
    if (found) {
      return resolveConnectSiteApiBase(found.preset, found.site, transportKind, workspaceId);
    }
  }

  return resolvePresetBase(preset, transportKind);
}
