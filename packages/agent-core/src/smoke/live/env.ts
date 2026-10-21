import type { AnthropicTransportConfig } from "../../anthropic/anthropic-compat.js";
import type { BedrockTransportConfig } from "../../bedrock/bedrock-compat.js";
import type { OpenAiTransportConfig } from "../../openai/openai-compat.js";

import { requireEnv } from "../shared/env.js";

export const LIVE_SMOKE_GATE_ENV = "SPIRIT_AGENT_ALLOW_LIVE_SMOKE";

export function shouldRunLiveSmoke(): boolean {
  if (process.env[LIVE_SMOKE_GATE_ENV] === "1") {
    return true;
  }

  console.log(`${LIVE_SMOKE_GATE_ENV}=1 is not set, skipping live smoke.`);
  return false;
}

export function createLiveOpenAiCompatibleSmokeConfig(): OpenAiTransportConfig {
  const apiKey = requireEnv("OPENAI_API_KEY", "SPIRIT_API_KEY");
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const baseUrl = process.env.OPENAI_BASE_URL ?? process.env.SPIRIT_API_BASE;

  return {
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function createLiveAnthropicSmokeConfig(): AnthropicTransportConfig {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const model = requireEnv("ANTHROPIC_MODEL");
  const baseUrl = requireEnv("ANTHROPIC_BASE_URL");

  return {
    transportKind: "anthropic",
    apiKey,
    model,
    baseUrl,
  };
}

export function createLiveBedrockSmokeConfig(): BedrockTransportConfig {
  const region = requireEnv("AWS_REGION", "AWS_DEFAULT_REGION");
  const model = requireEnv("BEDROCK_MODEL", "AWS_BEDROCK_MODEL");
  const apiKey = process.env.AWS_BEDROCK_API_KEY?.trim() || process.env.BEDROCK_API_KEY?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const baseUrl = process.env.BEDROCK_BASE_URL?.trim() || process.env.AWS_BEDROCK_BASE_URL?.trim();

  if (!apiKey && !(accessKeyId && secretAccessKey)) {
    throw new Error(
      "Bedrock live smoke requires AWS_BEDROCK_API_KEY/BEDROCK_API_KEY, or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.",
    );
  }

  return {
    transportKind: "bedrock",
    model,
    region,
    ...(apiKey ? { apiKey } : {}),
    ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
}
