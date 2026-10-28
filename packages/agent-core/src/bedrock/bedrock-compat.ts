import type { FileUploadConfig } from "../file-upload/uploader.js";
import { normalizeModelEffort } from "../model-effort.js";
import type { ModelReasoningMode } from "../reasoning-effort.js";
import { resolveThinkingSwitchWirePatch } from "../thinking-switch.js";
import type { JsonObject, JsonValue } from "../ports.js";
import type { ProviderToolEntry } from "../provider-tools/types.js";
import { cloneJsonValue, isJsonObject } from "../tool-agent.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
  ThinkingSwitchDeclaration,
  ThinkingCapabilities,
  TransportRequestProfile,
} from "../llm-provider-shared.js";

/** Bedrock reasoning effort; `default` means no `reasoningConfig` is injected. */
export type BedrockReasoningEffort =
  | "default"
  | "minimal"
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface BedrockTransportConfig extends LlmWebToolExposure {
  transportKind: "bedrock";
  model: string;
  /** AWS region (e.g. `us-east-1`); from the host `awsRegion`. */
  region: string;
  /** Bearer API Key; mutually exclusive with IAM credentials, API Key takes precedence. */
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Temporary credentials; the first UI version may not expose this, type reserved. */
  sessionToken?: string;
  /** Custom Bedrock endpoint / proxy. */
  baseUrl?: string;
  compactModel?: string;
  workspaceRoot?: string;
  modelCapabilities?: LlmModelCapabilities;
  reasoningEffort?: BedrockReasoningEffort;
  supportedReasoningEfforts?: readonly BedrockReasoningEffort[];
  effortSemantics?: "output";
  effort?: BedrockReasoningEffort;
  supportedEfforts?: readonly BedrockReasoningEffort[];
  thinkingCapabilities?: ThinkingCapabilities;
  /** Policy profile for lightweight non-Agent requests such as code completion; defaults to agent-path behavior. */
  transportRequestProfile?: TransportRequestProfile;
  /** Literal extra headers merged into every outbound request; explicit declarations win on conflicts. */
  headers?: Record<string, string>;
  /** Literal fields merged unconditionally into every request body top level; escape hatch, prefer structured declarations. */
  body?: JsonObject;
  /** Declared provider tools; injected, recognized, and executed purely by declaration. */
  providerTools?: ProviderToolEntry[];
  /** Declared generic upload channel; absent = media inputs use the transport's inline path. */
  fileUpload?: FileUploadConfig;
  /** Transport option namespace (e.g. `awsRegion`); the valid key set is defined by transportKind × sdk, unknown keys are rejected. */
  options?: Record<string, unknown>;
  /** Declared output token limit for the model. */
  outputLimit?: number;
  /** Declared reasoning mode; `"standard"` or absent sends nothing on the wire. */
  reasoningMode?: ModelReasoningMode;
  /** Declared reasoning mode set; the picker and validation source for `reasoningMode`. */
  supportedReasoningModes?: readonly ModelReasoningMode[];
  /** Declared wire encoding of the thinking on/off switch; absent = transport default encoding. */
  thinkingSwitch?: ThinkingSwitchDeclaration;
  /** User thinking-switch state: `false` encodes thinking off as Converse `reasoningConfig: {type: "disabled"}`. */
  vendorExtendedThinking?: boolean;
}

export interface BedrockRequestTrace extends JsonObject {
  kind: "bedrock_sdk_converse";
  stepIndex: number;
  model: string;
  stream: boolean;
  region: string;
  messages: JsonValue[];
  tools?: JsonValue[];
  providerOptions?: JsonValue;
}

export function bedrockApiBaseFromRegion(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (!normalized) {
    return "https://bedrock.us-east-1.amazonaws.com";
  }
  return `https://bedrock.${normalized}.amazonaws.com`;
}

export function isAmazonNovaBedrockModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("amazon.nova") || normalized.includes("us.amazon.nova");
}

export function isAnthropicClaudeBedrockModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("anthropic.claude") || normalized.includes(".anthropic.claude");
}

export function isDeepSeekReasoningBedrockModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("deepseek.r1");
}

export function bedrockSupportsReasoningConfig(model: string): boolean {
  return (
    isAnthropicClaudeBedrockModel(model) ||
    isAmazonNovaBedrockModel(model) ||
    isDeepSeekReasoningBedrockModel(model)
  );
}

export function bedrockReasoningConfigFromEffort(
  model: string,
  effort: BedrockReasoningEffort | undefined,
): JsonObject | undefined {
  if (effort === undefined || effort === "default" || effort === "none" || effort === "minimal") {
    return undefined;
  }

  if (!bedrockSupportsReasoningConfig(model)) {
    return undefined;
  }

  if (isAmazonNovaBedrockModel(model)) {
    const maxReasoningEffort =
      effort === "low"
        ? "low"
        : effort === "high" || effort === "xhigh" || effort === "max"
          ? "high"
          : "medium";
    return {
      type: "enabled",
      maxReasoningEffort,
    };
  }

  const budgetTokens =
    effort === "low"
      ? 1_024
      : effort === "medium"
        ? 4_096
        : effort === "high"
          ? 12_000
          : effort === "xhigh" || effort === "max"
            ? 32_000
            : 8_192;

  return {
    type: "enabled",
    budgetTokens,
  };
}

export function buildBedrockProviderOptions(
  config: Pick<
    BedrockTransportConfig,
    | "model"
    | "reasoningEffort"
    | "effortSemantics"
    | "effort"
    | "thinkingSwitch"
    | "vendorExtendedThinking"
  >,
): Record<string, JsonObject> {
  if (config.effortSemantics === "output") {
    const effort = normalizeModelEffort(config.effort);
    const thinkingPatch = resolveThinkingSwitchWirePatch({
      ...(config.vendorExtendedThinking !== undefined
        ? { vendorExtendedThinking: config.vendorExtendedThinking }
        : {}),
      ...(config.thinkingSwitch !== undefined ? { thinkingSwitch: config.thinkingSwitch } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
    const additionalModelRequestFields: JsonObject = {};
    const thinkingValue = thinkingPatch === "omit" ? undefined : thinkingPatch?.body?.thinking;
    const thinking = isJsonObject(thinkingValue) ? thinkingValue : undefined;
    const budgetTokens =
      thinking?.type === "enabled" && typeof thinking.budget_tokens === "number"
        ? thinking.budget_tokens
        : undefined;
    const bedrock: JsonObject = {};
    if (budgetTokens !== undefined) {
      // The SDK serializes the declared budget and reserves room for it in inferenceConfig.maxTokens.
      bedrock["reasoningConfig"] = { type: "enabled", budgetTokens };
    } else if (thinking !== undefined) {
      additionalModelRequestFields["thinking"] = cloneJsonValue(thinking);
    }
    if (effort !== undefined) {
      additionalModelRequestFields["output_config"] = { effort };
    }
    if (Object.keys(additionalModelRequestFields).length > 0) {
      bedrock["additionalModelRequestFields"] = additionalModelRequestFields;
    }
    return Object.keys(bedrock).length > 0 ? { bedrock } : {};
  }

  // The user off state is Converse's public off encoding; it wins over any effort-derived
  // config, mirroring the Anthropic transport's default `{thinking: {type: "disabled"}}`.
  // Models outside the reasoningConfig whitelist take no reasoning parameter at all.
  if (config.vendorExtendedThinking === false) {
    if (!bedrockSupportsReasoningConfig(config.model)) {
      return {};
    }
    return {
      bedrock: {
        reasoningConfig: { type: "disabled" },
      },
    };
  }

  const reasoningConfig = bedrockReasoningConfigFromEffort(config.model, config.reasoningEffort);
  if (reasoningConfig === undefined) {
    return {};
  }

  return {
    bedrock: {
      reasoningConfig,
    },
  };
}

export function buildBedrockRequestTrace(
  config: BedrockTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const providerOptions = buildBedrockProviderOptions(config);
  const trace: BedrockRequestTrace = {
    kind: "bedrock_sdk_converse",
    stepIndex,
    model: config.model,
    stream,
    region: config.region,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0 ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) } : {}),
    ...(Object.keys(providerOptions.bedrock ?? {}).length > 0
      ? { providerOptions: providerOptions as JsonValue }
      : {}),
  };

  return [trace];
}
