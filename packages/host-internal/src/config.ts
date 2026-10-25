import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonObject } from "@spiritagent/agent-core";
import type { FileUploadConfig } from "@spiritagent/agent-core/file-upload";
import { validateFileUploadConfig } from "@spiritagent/agent-core/file-upload";
import type { ModelServiceTier } from "@spiritagent/agent-core/model-service-tier";
import { MODEL_SERVICE_TIERS } from "@spiritagent/agent-core/model-service-tier";
import type { ProviderToolEntry } from "@spiritagent/agent-core/provider-tools";
import { validateProviderToolEntries } from "@spiritagent/agent-core/provider-tools";

export const SPIRIT_CONFIG_SCHEMA_VERSION = 1 as const;

export type SpiritConfigSchemaVersion = typeof SPIRIT_CONFIG_SCHEMA_VERSION;

export class SpiritConfigSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpiritConfigSchemaError";
  }
}

export interface ModelRef {
  providerId: string;
  name: string;
}

export type SpiritModelCapability =
  | "languageModel"
  | "image"
  | "audio"
  | "video"
  | "imageGeneration"
  | "videoGeneration";

export type SpiritModelReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "default";

export type SpiritModelReasoningMode = "standard" | "pro";

export type SpiritTransportKind = "openai-compatible" | "open-responses" | "anthropic" | "bedrock";

/** Literal wire patch merged into outbound requests (`thinkingSwitch` states, literal `serviceTiers`). */
export interface SpiritWirePatch {
  headers?: Record<string, string>;
  body?: JsonObject;
  /**
   * AI SDK providerOptions fragment (per upstream namespace) for surfaces that serialize call
   * providerOptions (the gateway v3 language-model protocol); ignored elsewhere.
   */
  providerOptions?: JsonObject;
}

/**
 * Declared wire encoding for a model thinking on/off switch (`thinkingSwitch`); absent = the
 * transport's default thinking encoding applies. Structurally identical to agent-core's
 * `ThinkingSwitchDeclaration`.
 */
export interface ThinkingSwitchDeclaration {
  on?: SpiritWirePatch;
  off?: SpiritWirePatch;
}

/** `serviceTiers`: either a list of public tier names or a literal tier → wire-patch map. */
export type SpiritServiceTiersDeclaration = ModelServiceTier[] | Record<string, SpiritWirePatch>;

export interface ProviderKeyringReference {
  service: string;
  account: string;
}

export interface ProviderCredentialSlot {
  value?: string;
  env?: string;
  keyring?: ProviderKeyringReference;
}

/** Transport-level `options` keyset; which keys are legal depends on transportKind × sdk. */
export interface ProviderOptions {
  awsRegion?: string;
  project?: string;
  location?: string;
  auth?: "aws-sigv4";
  storedState?: true;
  applyPatch?: true;
  /** openai-compatible: the upstream rejects function tools with a non-`none` reasoning effort. */
  toolsRejectReasoningEffort?: true;
  /** openai-compatible: byte cap on base64-encoded inline media payloads. */
  maxInlineMediaBytes?: number;
  /** open-responses: the endpoint honors OpenAI-style `reasoning.summary`; absent = never sent. */
  reasoningSummary?: true;
  /** open-responses: status value filled onto replayed input items that lack one. */
  defaultInputItemStatus?: string;
  /**
   * openai-compatible / open-responses: `anthropic/claude-*` model ids take OpenRouter's unified
   * reasoning shape (`{reasoning: {enabled, effort | max_tokens}}`) instead of `reasoning_effort`.
   */
  openRouterAnthropicReasoning?: true;
}

/**
 * Model-level fields that may also be declared flat on a provider entry as defaults for all of
 * its models; a model-level explicit declaration wins, absent means undeclared.
 */
export interface ModelInheritableFields {
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

export interface ModelEntry extends ModelInheritableFields {
  name: string;
  /**
   * User's thinking on/off state (user state, not a capability declaration); meaningful only when
   * `supportsThinkingSwitch` is declared — setting it otherwise is a schema error. Absent = on.
   * Model-level only; never inherited from the provider entry.
   */
  thinkingEnabled?: boolean;
}

export interface ProviderEntry extends ModelInheritableFields {
  id: string;
  label?: string;
  apiBase: string;
  transportKind?: SpiritTransportKind;
  sdk?: string;
  headers?: Record<string, string>;
  body?: JsonObject;
  providerTools?: ProviderToolEntry[];
  fileUpload?: FileUploadConfig;
  imageApi?: string;
  videoApi?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyKeyring?: ProviderKeyringReference;
  credentials?: Record<string, ProviderCredentialSlot>;
  options?: ProviderOptions;
  models: ModelEntry[];
}

export interface SpiritConfigCore {
  schemaVersion: SpiritConfigSchemaVersion;
  providers: ProviderEntry[];
  activeModel: ModelRef;
  imageGenerationModel?: ModelRef;
  videoGenerationModel?: ModelRef;
  secondaryLanguageModel?: ModelRef;
}

/** Unrelated top-level config.json fields (`permission`, `agents`, `webHost`, …) pass through. */
export interface SpiritConfigFile extends SpiritConfigCore {
  [key: string]: unknown;
}

/**
 * SDK adapter packages bundled with the app (the `@ai-sdk/*` dependencies of agent-core);
 * declaring any other package name is a fail-fast config error.
 */
export const KNOWN_SDK_PACKAGE_NAMES: readonly string[] = [
  "@ai-sdk/alibaba",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/anthropic",
  "@ai-sdk/azure",
  "@ai-sdk/baseten",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/deepseek",
  "@ai-sdk/fireworks",
  "@ai-sdk/gateway",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/groq",
  "@ai-sdk/huggingface",
  "@ai-sdk/minimax",
  "@ai-sdk/moonshotai",
  "@ai-sdk/open-responses",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/togetherai",
  "@ai-sdk/xai",
];

const KNOWN_SDK_PACKAGE_NAME_SET: ReadonlySet<string> = new Set(KNOWN_SDK_PACKAGE_NAMES);

const DEFAULT_SDK_BY_TRANSPORT_KIND: Record<SpiritTransportKind, string | undefined> = {
  "openai-compatible": "@ai-sdk/openai-compatible",
  "open-responses": "@ai-sdk/open-responses",
  anthropic: "@ai-sdk/anthropic",
  // bedrock is a self-hosted implementation; there is no adapter package to default to.
  bedrock: undefined,
};

/** The Google Vertex SDK adapter package: its credential shape adds the `clientEmail` / `privateKey` slots and the `project` / `location` options. */
export const GOOGLE_VERTEX_SDK_PACKAGE_NAME = "@ai-sdk/google-vertex";

const CAPABILITY_TOKENS: ReadonlySet<string> = new Set([
  "languageModel",
  "image",
  "audio",
  "video",
  "imageGeneration",
  "videoGeneration",
]);

const REASONING_EFFORT_TOKENS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "default",
]);

const REASONING_MODE_TOKENS: ReadonlySet<string> = new Set(["standard", "pro"]);

const TRANSPORT_KIND_TOKENS: ReadonlySet<string> = new Set([
  "openai-compatible",
  "open-responses",
  "anthropic",
  "bedrock",
]);

const SERVICE_TIER_TOKENS: ReadonlySet<string> = new Set(MODEL_SERVICE_TIERS);

const MODEL_INHERITABLE_KEYS = [
  "capabilities",
  "contextLength",
  "outputLimit",
  "reasoningEffort",
  "supportedReasoningEfforts",
  "reasoningMode",
  "supportedReasoningModes",
  "supportsThinkingType",
  "supportsThinkingSwitch",
  "thinkingSwitch",
  "serviceTiers",
  "serviceTier",
] as const;

const MODEL_ENTRY_KEYS: ReadonlySet<string> = new Set([
  "name",
  "thinkingEnabled",
  ...MODEL_INHERITABLE_KEYS,
]);

const PROVIDER_ENTRY_KEYS: ReadonlySet<string> = new Set([
  "id",
  "label",
  "apiBase",
  "transportKind",
  "sdk",
  "headers",
  "body",
  "providerTools",
  "fileUpload",
  "imageApi",
  "videoApi",
  "apiKey",
  "apiKeyEnv",
  "apiKeyKeyring",
  "credentials",
  "options",
  "models",
  ...MODEL_INHERITABLE_KEYS,
]);

const WIRE_PATCH_KEYS: ReadonlySet<string> = new Set(["headers", "body", "providerOptions"]);
const THINKING_SWITCH_KEYS: ReadonlySet<string> = new Set(["on", "off"]);
const KEYRING_REFERENCE_KEYS: ReadonlySet<string> = new Set(["service", "account"]);
const CREDENTIAL_SLOT_VALUE_KEYS: ReadonlySet<string> = new Set(["value", "env", "keyring"]);
const FILE_UPLOAD_KEYS: ReadonlySet<string> = new Set([
  "path",
  "url",
  "purpose",
  "idPath",
  "refTemplate",
  "maxBytes",
]);

const TRANSPORT_OPTION_KEYS: Record<SpiritTransportKind, readonly string[]> = {
  "openai-compatible": [
    "toolsRejectReasoningEffort",
    "maxInlineMediaBytes",
    "openRouterAnthropicReasoning",
  ],
  "open-responses": [
    "auth",
    "storedState",
    "applyPatch",
    "reasoningSummary",
    "defaultInputItemStatus",
    "openRouterAnthropicReasoning",
  ],
  anthropic: [],
  bedrock: ["awsRegion"],
};

const GOOGLE_VERTEX_OPTION_KEYS = ["project", "location"] as const;

type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  record: UnknownRecord,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SpiritConfigSchemaError(`${context}: unknown key ${JSON.stringify(key)}.`);
    }
  }
}

function readRequiredNonBlankString(record: UnknownRecord, key: string, context: string): void {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SpiritConfigSchemaError(
      `${context}: ${JSON.stringify(key)} must be a non-empty string.`,
    );
  }
}

function validateOptionalString(record: UnknownRecord, key: string, context: string): void {
  const value = record[key];
  if (value !== undefined && typeof value !== "string") {
    throw new SpiritConfigSchemaError(`${context}: ${JSON.stringify(key)} must be a string.`);
  }
}

function validateEnumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  context: string,
  key: string,
): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new SpiritConfigSchemaError(
      `${context}: ${JSON.stringify(key)} must be one of: ${[...allowed].join(", ")}.`,
    );
  }
}

function validateEnumArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  context: string,
  key: string,
): void {
  if (!Array.isArray(value)) {
    throw new SpiritConfigSchemaError(`${context}: ${JSON.stringify(key)} must be an array.`);
  }
  for (const item of value) {
    validateEnumValue(item, allowed, context, key);
  }
}

function validatePositiveNumber(value: unknown, context: string, key: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SpiritConfigSchemaError(
      `${context}: ${JSON.stringify(key)} must be a positive number.`,
    );
  }
}

function validateStringMap(value: unknown, context: string): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context} must be an object of string values.`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new SpiritConfigSchemaError(`${context}: ${JSON.stringify(key)} must be a string.`);
    }
  }
}

function validateWirePatch(value: unknown, context: string): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context} must be an object.`);
  }
  rejectUnknownKeys(value, WIRE_PATCH_KEYS, context);
  if (value["body"] !== undefined && !isPlainObject(value["body"])) {
    throw new SpiritConfigSchemaError(`${context}: "body" must be an object.`);
  }
  if (value["providerOptions"] !== undefined && !isPlainObject(value["providerOptions"])) {
    throw new SpiritConfigSchemaError(`${context}: "providerOptions" must be an object.`);
  }
  if (value["headers"] !== undefined) {
    validateStringMap(value["headers"], `${context}.headers`);
  }
}

function validateThinkingSwitch(value: unknown, context: string): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context}: "thinkingSwitch" must be an object.`);
  }
  rejectUnknownKeys(value, THINKING_SWITCH_KEYS, `${context}.thinkingSwitch`);
  if (value["on"] !== undefined) {
    validateWirePatch(value["on"], `${context}.thinkingSwitch.on`);
  }
  if (value["off"] !== undefined) {
    validateWirePatch(value["off"], `${context}.thinkingSwitch.off`);
  }
}

function validateServiceTiers(value: unknown, context: string): void {
  if (Array.isArray(value)) {
    for (const tier of value) {
      validateEnumValue(tier, SERVICE_TIER_TOKENS, context, "serviceTiers");
    }
    return;
  }
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(
      `${context}: "serviceTiers" must be an array of tier names or a map of tier wire declarations.`,
    );
  }
  for (const [tier, declaration] of Object.entries(value)) {
    if (!SERVICE_TIER_TOKENS.has(tier)) {
      throw new SpiritConfigSchemaError(
        `${context}: unknown service tier ${JSON.stringify(tier)}; allowed: ${[...SERVICE_TIER_TOKENS].join(", ")}.`,
      );
    }
    validateWirePatch(declaration, `${context}.serviceTiers.${tier}`);
  }
}

function validateInheritableFields(record: UnknownRecord, context: string): void {
  if (record["capabilities"] !== undefined) {
    validateEnumArray(record["capabilities"], CAPABILITY_TOKENS, context, "capabilities");
  }
  if (record["contextLength"] !== undefined) {
    validatePositiveNumber(record["contextLength"], context, "contextLength");
  }
  if (record["outputLimit"] !== undefined) {
    validatePositiveNumber(record["outputLimit"], context, "outputLimit");
  }
  if (record["reasoningEffort"] !== undefined) {
    validateEnumValue(
      record["reasoningEffort"],
      REASONING_EFFORT_TOKENS,
      context,
      "reasoningEffort",
    );
  }
  if (record["supportedReasoningEfforts"] !== undefined) {
    validateEnumArray(
      record["supportedReasoningEfforts"],
      REASONING_EFFORT_TOKENS,
      context,
      "supportedReasoningEfforts",
    );
  }
  if (record["reasoningMode"] !== undefined) {
    validateEnumValue(record["reasoningMode"], REASONING_MODE_TOKENS, context, "reasoningMode");
  }
  if (record["supportedReasoningModes"] !== undefined) {
    validateEnumArray(
      record["supportedReasoningModes"],
      REASONING_MODE_TOKENS,
      context,
      "supportedReasoningModes",
    );
  }
  if (record["supportsThinkingType"] !== undefined && record["supportsThinkingType"] !== "only") {
    throw new SpiritConfigSchemaError(`${context}: "supportsThinkingType" must be "only".`);
  }
  if (
    record["supportsThinkingSwitch"] !== undefined &&
    typeof record["supportsThinkingSwitch"] !== "boolean"
  ) {
    throw new SpiritConfigSchemaError(`${context}: "supportsThinkingSwitch" must be a boolean.`);
  }
  if (record["thinkingSwitch"] !== undefined) {
    validateThinkingSwitch(record["thinkingSwitch"], context);
  }
  if (record["serviceTiers"] !== undefined) {
    validateServiceTiers(record["serviceTiers"], context);
  }
  if (record["serviceTier"] !== undefined) {
    validateEnumValue(record["serviceTier"], SERVICE_TIER_TOKENS, context, "serviceTier");
  }
}

function mergeRawInheritableFields(provider: UnknownRecord, model: UnknownRecord): UnknownRecord {
  const merged: UnknownRecord = {};
  for (const key of MODEL_INHERITABLE_KEYS) {
    const value = model[key] ?? provider[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function validateServiceTierRule(record: UnknownRecord, context: string): void {
  const tier = record["serviceTier"];
  if (tier === undefined) {
    return;
  }
  const tiers = record["serviceTiers"];
  if (tiers === undefined) {
    throw new SpiritConfigSchemaError(
      `${context}: "serviceTier" is set but no "serviceTiers" are declared.`,
    );
  }
  const declared: readonly unknown[] = Array.isArray(tiers)
    ? tiers
    : isPlainObject(tiers)
      ? Object.keys(tiers)
      : [];
  if (!declared.includes(tier)) {
    throw new SpiritConfigSchemaError(
      `${context}: "serviceTier" ${JSON.stringify(tier)} is not in the declared "serviceTiers".`,
    );
  }
}

function validateReasoningRules(record: UnknownRecord, context: string): void {
  const effort = record["reasoningEffort"];
  // "default" means "send nothing" and is always allowed, matching the spec's own examples.
  if (effort !== undefined && effort !== "default") {
    const supported = record["supportedReasoningEfforts"];
    if (Array.isArray(supported) && !supported.includes(effort)) {
      throw new SpiritConfigSchemaError(
        `${context}: "reasoningEffort" ${JSON.stringify(effort)} is not in the declared "supportedReasoningEfforts".`,
      );
    }
  }
  const mode = record["reasoningMode"];
  if (mode !== undefined) {
    const supported = record["supportedReasoningModes"];
    if (Array.isArray(supported) && !supported.includes(mode)) {
      throw new SpiritConfigSchemaError(
        `${context}: "reasoningMode" ${JSON.stringify(mode)} is not in the declared "supportedReasoningModes".`,
      );
    }
  }
}

export function resolveProviderTransportKind(
  provider: Pick<ProviderEntry, "transportKind">,
): SpiritTransportKind {
  return provider.transportKind ?? "openai-compatible";
}

export function defaultSdkPackageName(transportKind: SpiritTransportKind): string | undefined {
  return DEFAULT_SDK_BY_TRANSPORT_KIND[transportKind];
}

export function resolveProviderSdkPackageName(
  provider: Pick<ProviderEntry, "transportKind" | "sdk">,
): string | undefined {
  return provider.sdk ?? defaultSdkPackageName(resolveProviderTransportKind(provider));
}

/**
 * Valid `credentials` slot names for a mechanism combination: `apiKey` plus transport/sdk slots.
 * `options.auth: "aws-sigv4"` signs requests with IAM credentials, adding the IAM slots.
 */
export function providerCredentialSlotNames(
  transportKind: SpiritTransportKind,
  sdk: string | undefined,
  options?: Pick<ProviderOptions, "auth">,
): string[] {
  const slots = ["apiKey"];
  if (transportKind === "bedrock" || options?.auth === "aws-sigv4") {
    slots.push("accessKeyId", "secretAccessKey");
  }
  if (sdk === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
    slots.push("clientEmail", "privateKey");
  }
  return slots;
}

function validateKeyringReference(value: unknown, context: string): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context} must be an object with "service" and "account".`);
  }
  rejectUnknownKeys(value, KEYRING_REFERENCE_KEYS, context);
  readRequiredNonBlankString(value, "service", context);
  readRequiredNonBlankString(value, "account", context);
}

function validateProviderOptions(
  value: unknown,
  transportKind: SpiritTransportKind,
  sdk: string | undefined,
  context: string,
): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context}: "options" must be an object.`);
  }
  const allowed = new Set<string>(TRANSPORT_OPTION_KEYS[transportKind]);
  if (sdk === GOOGLE_VERTEX_SDK_PACKAGE_NAME) {
    for (const key of GOOGLE_VERTEX_OPTION_KEYS) {
      allowed.add(key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new SpiritConfigSchemaError(
        `${context}: unknown "options" key ${JSON.stringify(key)} for transportKind ${JSON.stringify(transportKind)}${sdk === undefined ? "" : ` and sdk ${JSON.stringify(sdk)}`}.`,
      );
    }
  }
  for (const key of ["awsRegion", "project", "location", "defaultInputItemStatus"] as const) {
    const entry = value[key];
    if (entry !== undefined && (typeof entry !== "string" || entry.trim().length === 0)) {
      throw new SpiritConfigSchemaError(`${context}: "options.${key}" must be a non-empty string.`);
    }
  }
  if (value["auth"] !== undefined && value["auth"] !== "aws-sigv4") {
    throw new SpiritConfigSchemaError(`${context}: "options.auth" must be "aws-sigv4".`);
  }
  for (const key of [
    "storedState",
    "applyPatch",
    "toolsRejectReasoningEffort",
    "reasoningSummary",
    "openRouterAnthropicReasoning",
  ] as const) {
    if (value[key] !== undefined && value[key] !== true) {
      throw new SpiritConfigSchemaError(
        `${context}: "options.${key}" must be true; omit the key otherwise.`,
      );
    }
  }
  const maxInlineMediaBytes = value["maxInlineMediaBytes"];
  if (
    maxInlineMediaBytes !== undefined &&
    (typeof maxInlineMediaBytes !== "number" ||
      !Number.isInteger(maxInlineMediaBytes) ||
      maxInlineMediaBytes <= 0)
  ) {
    throw new SpiritConfigSchemaError(
      `${context}: "options.maxInlineMediaBytes" must be a positive integer.`,
    );
  }
}

function validateCredentials(
  value: unknown,
  transportKind: SpiritTransportKind,
  sdk: string | undefined,
  options: ProviderOptions | undefined,
  hasFlatKeyChannel: boolean,
  context: string,
): void {
  if (!isPlainObject(value)) {
    throw new SpiritConfigSchemaError(`${context}: "credentials" must be an object.`);
  }
  const slots = new Set(providerCredentialSlotNames(transportKind, sdk, options));
  for (const [slot, slotValue] of Object.entries(value)) {
    if (!slots.has(slot)) {
      throw new SpiritConfigSchemaError(
        `${context}: unknown credentials slot ${JSON.stringify(slot)} for transportKind ${JSON.stringify(transportKind)}${sdk === undefined ? "" : ` and sdk ${JSON.stringify(sdk)}`}; allowed: ${[...slots].join(", ")}.`,
      );
    }
    const slotContext = `${context}.credentials.${slot}`;
    if (!isPlainObject(slotValue)) {
      throw new SpiritConfigSchemaError(`${slotContext} must be an object.`);
    }
    rejectUnknownKeys(slotValue, CREDENTIAL_SLOT_VALUE_KEYS, slotContext);
    validateOptionalString(slotValue, "value", slotContext);
    validateOptionalString(slotValue, "env", slotContext);
    if (slotValue["keyring"] !== undefined) {
      validateKeyringReference(slotValue["keyring"], `${slotContext}.keyring`);
    }
  }
  if (hasFlatKeyChannel && "apiKey" in value) {
    throw new SpiritConfigSchemaError(
      `${context}: flat "apiKey" / "apiKeyEnv" / "apiKeyKeyring" keys cannot coexist with "credentials.apiKey".`,
    );
  }
}

function validateModelEntry(model: unknown, context: string): void {
  if (!isPlainObject(model)) {
    throw new SpiritConfigSchemaError(`${context} must be an object.`);
  }
  rejectUnknownKeys(model, MODEL_ENTRY_KEYS, context);
  readRequiredNonBlankString(model, "name", context);
  validateInheritableFields(model, context);
  if (model["thinkingEnabled"] !== undefined && typeof model["thinkingEnabled"] !== "boolean") {
    throw new SpiritConfigSchemaError(`${context}: "thinkingEnabled" must be a boolean.`);
  }
}

function validateThinkingEnabledRule(
  model: UnknownRecord,
  effective: UnknownRecord,
  context: string,
): void {
  if (model["thinkingEnabled"] === undefined) {
    return;
  }
  if (effective["supportsThinkingSwitch"] !== true) {
    throw new SpiritConfigSchemaError(
      `${context}: "thinkingEnabled" is set but "supportsThinkingSwitch" is not declared.`,
    );
  }
}

function validateProviderEntry(entry: unknown, context: string): void {
  if (!isPlainObject(entry)) {
    throw new SpiritConfigSchemaError(`${context} must be an object.`);
  }
  rejectUnknownKeys(entry, PROVIDER_ENTRY_KEYS, context);
  readRequiredNonBlankString(entry, "id", context);
  readRequiredNonBlankString(entry, "apiBase", context);

  const transportKindValue = entry["transportKind"];
  if (transportKindValue !== undefined) {
    validateEnumValue(transportKindValue, TRANSPORT_KIND_TOKENS, context, "transportKind");
  }
  const transportKind = (transportKindValue ?? "openai-compatible") as SpiritTransportKind;

  const sdkValue = entry["sdk"];
  if (sdkValue !== undefined) {
    if (typeof sdkValue !== "string" || sdkValue.trim().length === 0) {
      throw new SpiritConfigSchemaError(
        `${context}: "sdk" must be a full npm package name string.`,
      );
    }
    if (!KNOWN_SDK_PACKAGE_NAME_SET.has(sdkValue)) {
      throw new SpiritConfigSchemaError(
        `${context}: unknown "sdk" ${JSON.stringify(sdkValue)}; only bundled adapter packages are allowed.`,
      );
    }
  }
  const sdk = typeof sdkValue === "string" ? sdkValue : undefined;

  validateOptionalString(entry, "label", context);
  validateOptionalString(entry, "imageApi", context);
  validateOptionalString(entry, "videoApi", context);
  validateOptionalString(entry, "apiKey", context);
  validateOptionalString(entry, "apiKeyEnv", context);
  if (entry["apiKeyKeyring"] !== undefined) {
    validateKeyringReference(entry["apiKeyKeyring"], `${context}.apiKeyKeyring`);
  }
  if (entry["headers"] !== undefined) {
    validateStringMap(entry["headers"], `${context}.headers`);
  }
  if (entry["body"] !== undefined && !isPlainObject(entry["body"])) {
    throw new SpiritConfigSchemaError(`${context}: "body" must be an object.`);
  }
  if (entry["providerTools"] !== undefined) {
    try {
      validateProviderToolEntries(entry["providerTools"], `${context}.providerTools`);
    } catch (error) {
      throw new SpiritConfigSchemaError(error instanceof Error ? error.message : String(error));
    }
  }
  if (entry["fileUpload"] !== undefined) {
    if (!isPlainObject(entry["fileUpload"])) {
      throw new SpiritConfigSchemaError(`${context}: "fileUpload" must be an object.`);
    }
    rejectUnknownKeys(entry["fileUpload"], FILE_UPLOAD_KEYS, `${context}.fileUpload`);
    try {
      validateFileUploadConfig(entry["fileUpload"]);
    } catch (error) {
      throw new SpiritConfigSchemaError(error instanceof Error ? error.message : String(error));
    }
  }
  if (entry["options"] !== undefined) {
    validateProviderOptions(entry["options"], transportKind, sdk, context);
  }
  const hasFlatKeyChannel =
    entry["apiKey"] !== undefined ||
    entry["apiKeyEnv"] !== undefined ||
    entry["apiKeyKeyring"] !== undefined;
  if (entry["credentials"] !== undefined) {
    validateCredentials(
      entry["credentials"],
      transportKind,
      sdk,
      entry["options"] as ProviderOptions | undefined,
      hasFlatKeyChannel,
      context,
    );
  }

  validateInheritableFields(entry, context);
  validateServiceTierRule(mergeRawInheritableFields(entry, {}), context);
  validateReasoningRules(mergeRawInheritableFields(entry, {}), context);

  const models = entry["models"];
  if (!Array.isArray(models)) {
    throw new SpiritConfigSchemaError(`${context}: "models" must be an array.`);
  }
  models.forEach((model, index) => {
    const modelContext = `${context}.models[${index}]`;
    validateModelEntry(model, modelContext);
    const effective = mergeRawInheritableFields(entry, model);
    validateServiceTierRule(effective, modelContext);
    validateReasoningRules(effective, modelContext);
    validateThinkingEnabledRule(model as UnknownRecord, effective, modelContext);
  });
}

export function assertSpiritConfigSchemaVersion(raw: unknown): void {
  const version = isPlainObject(raw) ? raw["schemaVersion"] : undefined;
  if (version !== SPIRIT_CONFIG_SCHEMA_VERSION) {
    throw new SpiritConfigSchemaError(
      `config.json must be schemaVersion ${SPIRIT_CONFIG_SCHEMA_VERSION}; delete the old config and reconnect a provider.`,
    );
  }
}

export function emptyModelRef(): ModelRef {
  return { providerId: "", name: "" };
}

export function isEmptyModelRef(ref: ModelRef | undefined): boolean {
  return !ref?.providerId?.trim() || !ref?.name?.trim();
}

export function modelRefKey(ref: ModelRef): string {
  return `${ref.providerId}::${ref.name}`;
}

export function modelRefsEqual(a: ModelRef | undefined, b: ModelRef | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.providerId === b.providerId && a.name === b.name;
}

export function parseModelRef(value: unknown): ModelRef | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const providerId = typeof value["providerId"] === "string" ? value["providerId"].trim() : "";
  const name = typeof value["name"] === "string" ? value["name"].trim() : "";
  if (!providerId || !name) {
    return undefined;
  }
  return { providerId, name };
}

export function findProviderEntry(
  providers: readonly ProviderEntry[],
  providerId: string,
): ProviderEntry | undefined {
  const normalized = providerId.trim();
  if (!normalized) {
    return undefined;
  }
  return providers.find((provider) => provider.id === normalized);
}

export function findModelEntry(provider: ProviderEntry, name: string): ModelEntry | undefined {
  const normalized = name.trim();
  if (!normalized) {
    return undefined;
  }
  return provider.models.find((model) => model.name === normalized);
}

export function findModelByRef(
  providers: readonly ProviderEntry[],
  ref: ModelRef | undefined,
): { provider: ProviderEntry; model: ModelEntry } | undefined {
  if (!ref || isEmptyModelRef(ref)) {
    return undefined;
  }
  const provider = findProviderEntry(providers, ref.providerId);
  if (!provider) {
    return undefined;
  }
  const model = findModelEntry(provider, ref.name);
  if (!model) {
    return undefined;
  }
  return { provider, model };
}

export function modelExistsInProvider(
  providers: readonly ProviderEntry[],
  providerId: string,
  name: string,
): boolean {
  const provider = findProviderEntry(providers, providerId);
  if (!provider) {
    return false;
  }
  return findModelEntry(provider, name) !== undefined;
}

export function listAllModelRefs(providers: readonly ProviderEntry[]): ModelRef[] {
  const refs: ModelRef[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      refs.push({ providerId: provider.id, name: model.name });
    }
  }
  return refs;
}

/**
 * Effective model entry: provider-level flat declarations are the defaults, model-level explicit
 * declarations win. Connection-level fields (apiBase, sdk, keys, headers, …) never inherit.
 */
export function resolveModelEntry(
  provider: ProviderEntry,
  modelName: string,
): ModelEntry | undefined {
  const model = findModelEntry(provider, modelName);
  if (!model) {
    return undefined;
  }
  const resolved: ModelEntry = { name: model.name };
  if (model.thinkingEnabled !== undefined) {
    resolved.thinkingEnabled = model.thinkingEnabled;
  }
  const capabilities = model.capabilities ?? provider.capabilities;
  if (capabilities !== undefined) {
    resolved.capabilities = capabilities;
  }
  const contextLength = model.contextLength ?? provider.contextLength;
  if (contextLength !== undefined) {
    resolved.contextLength = contextLength;
  }
  const outputLimit = model.outputLimit ?? provider.outputLimit;
  if (outputLimit !== undefined) {
    resolved.outputLimit = outputLimit;
  }
  const reasoningEffort = model.reasoningEffort ?? provider.reasoningEffort;
  if (reasoningEffort !== undefined) {
    resolved.reasoningEffort = reasoningEffort;
  }
  const supportedReasoningEfforts =
    model.supportedReasoningEfforts ?? provider.supportedReasoningEfforts;
  if (supportedReasoningEfforts !== undefined) {
    resolved.supportedReasoningEfforts = supportedReasoningEfforts;
  }
  const reasoningMode = model.reasoningMode ?? provider.reasoningMode;
  if (reasoningMode !== undefined) {
    resolved.reasoningMode = reasoningMode;
  }
  const supportedReasoningModes = model.supportedReasoningModes ?? provider.supportedReasoningModes;
  if (supportedReasoningModes !== undefined) {
    resolved.supportedReasoningModes = supportedReasoningModes;
  }
  const supportsThinkingType = model.supportsThinkingType ?? provider.supportsThinkingType;
  if (supportsThinkingType !== undefined) {
    resolved.supportsThinkingType = supportsThinkingType;
  }
  const supportsThinkingSwitch = model.supportsThinkingSwitch ?? provider.supportsThinkingSwitch;
  if (supportsThinkingSwitch !== undefined) {
    resolved.supportsThinkingSwitch = supportsThinkingSwitch;
  }
  const thinkingSwitch = model.thinkingSwitch ?? provider.thinkingSwitch;
  if (thinkingSwitch !== undefined) {
    resolved.thinkingSwitch = thinkingSwitch;
  }
  const serviceTiers = model.serviceTiers ?? provider.serviceTiers;
  if (serviceTiers !== undefined) {
    resolved.serviceTiers = serviceTiers;
  }
  const serviceTier = model.serviceTier ?? provider.serviceTier;
  if (serviceTier !== undefined) {
    resolved.serviceTier = serviceTier;
  }
  return resolved;
}

export function resolveModelByRef(
  providers: readonly ProviderEntry[],
  ref: ModelRef | undefined,
): { provider: ProviderEntry; model: ModelEntry } | undefined {
  if (!ref || isEmptyModelRef(ref)) {
    return undefined;
  }
  const provider = findProviderEntry(providers, ref.providerId);
  if (!provider) {
    return undefined;
  }
  const model = resolveModelEntry(provider, ref.name);
  if (!model) {
    return undefined;
  }
  return { provider, model };
}

/** Fail-fast validation of the whole config.json model/provider section; returns it typed. */
export function validateSpiritConfig(raw: unknown): SpiritConfigFile {
  assertSpiritConfigSchemaVersion(raw);
  const record = raw as UnknownRecord;
  const providers = record["providers"];
  if (!Array.isArray(providers)) {
    throw new SpiritConfigSchemaError(`config.json: "providers" must be an array.`);
  }
  providers.forEach((entry, index) => validateProviderEntry(entry, `providers[${index}]`));
  const seenIds = new Set<string>();
  for (const entry of providers as ProviderEntry[]) {
    if (seenIds.has(entry.id)) {
      throw new SpiritConfigSchemaError(
        `providers: duplicate provider id ${JSON.stringify(entry.id)}.`,
      );
    }
    seenIds.add(entry.id);
  }
  const activeModel = parseModelRef(record["activeModel"]) ?? emptyModelRef();
  const imageGenerationModel = parseModelRef(record["imageGenerationModel"]);
  const videoGenerationModel = parseModelRef(record["videoGenerationModel"]);
  const secondaryLanguageModel = parseModelRef(record["secondaryLanguageModel"]);
  return {
    ...record,
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: providers as ProviderEntry[],
    activeModel,
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(videoGenerationModel ? { videoGenerationModel } : {}),
    ...(secondaryLanguageModel ? { secondaryLanguageModel } : {}),
  };
}

const CONFIG_FILE_NAME = "config.json";

export function loadSpiritConfig(spiritDataDir: string): SpiritConfigFile | undefined {
  const filePath = join(spiritDataDir, CONFIG_FILE_NAME);
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return validateSpiritConfig(parsed);
  } catch {
    return undefined;
  }
}

export async function saveSpiritConfig(
  spiritDataDir: string,
  config: SpiritConfigFile,
): Promise<void> {
  const filePath = join(spiritDataDir, CONFIG_FILE_NAME);
  await mkdir(spiritDataDir, { recursive: true });
  const payload: SpiritConfigFile = {
    ...config,
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
