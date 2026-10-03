import type { JsonObject, JsonValue } from "../ports.js";
import { cloneJsonValue } from "../tool-agent.js";
import type {
  LlmModelCapabilities,
  LlmWebToolExposure,
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
  /** Policy profile for lightweight non-Agent requests such as code completion; defaults to agent-path behavior. */
  transportRequestProfile?: TransportRequestProfile;
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
  config: Pick<BedrockTransportConfig, "model" | "reasoningEffort">,
): Record<string, JsonObject> {
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
