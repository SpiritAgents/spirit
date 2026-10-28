import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkBedrockTransport } from "./ai-sdk-transport.js";
import type { BedrockTransportConfig } from "./bedrock-compat.js";

async function runRound(config: BedrockTransportConfig): Promise<Record<string, unknown>> {
  const bodies: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        metrics: { latencyMs: 1 },
        output: { message: { role: "assistant", content: [{ text: "BEDROCK_OK" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    const completion = await new AiSdkBedrockTransport().startToolAgentRound(
      config,
      { messages: [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(completion.kind, "success");
    return bodies[0]!;
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

function outputConfig(
  model: string,
  thinkingSwitch: BedrockTransportConfig["thinkingSwitch"],
  effort?: "low" | "medium" | "high" | "xhigh" | "max",
): BedrockTransportConfig {
  return {
    transportKind: "bedrock",
    model,
    region: "us-east-1",
    apiKey: "test-key",
    effortSemantics: "output",
    ...(effort !== undefined ? { effort } : {}),
    ...(thinkingSwitch !== undefined ? { thinkingSwitch } : {}),
  };
}

test("Bedrock sends adaptive thinking and output_config.effort without effort-derived budgets", async () => {
  const body = await runRound(
    outputConfig(
      "us.anthropic.claude-opus-4-8-v1:0",
      {
        defaultState: "on",
        on: { body: { thinking: { type: "adaptive", display: "summarized" } } },
        off: "omit",
      },
      "high",
    ),
  );
  assert.deepEqual(body.additionalModelRequestFields, {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" },
  });
  assert.equal(JSON.stringify(body).includes("budget"), false);
});

test("Bedrock keeps the fixed Opus 4.5 budget alongside output effort", async () => {
  const body = await runRound({
    ...outputConfig(
      "us.anthropic.claude-opus-4-5-20251101-v1:0",
      {
        defaultState: "off",
        on: { body: { thinking: { type: "enabled", budget_tokens: 12000 } } },
        off: "omit",
      },
      "medium",
    ),
    vendorExtendedThinking: true,
  });
  assert.deepEqual(body.additionalModelRequestFields, {
    thinking: { type: "enabled", budget_tokens: 12000 },
    output_config: { effort: "medium" },
  });
  const inferenceConfig = body.inferenceConfig as Record<string, unknown>;
  assert.ok((inferenceConfig.maxTokens as number) > 12000);
});

test("Bedrock sends between_tools and resolves blocked off states from the selected effort", async () => {
  const betweenTools = await runRound({
    ...outputConfig(
      "us.anthropic.claude-sonnet-5-5-v1:0",
      {
        defaultState: "on",
        offBlockedEfforts: ["xhigh", "max"],
        on: { body: { thinking: { type: "adaptive" } } },
        off: { body: { thinking: { type: "between_tools" } } },
      },
      "medium",
    ),
    vendorExtendedThinking: false,
  });
  assert.deepEqual(betweenTools.additionalModelRequestFields, {
    thinking: { type: "between_tools" },
    output_config: { effort: "medium" },
  });

  const blocked = await runRound({
    ...outputConfig(
      "us.anthropic.claude-sonnet-5-5-v1:0",
      {
        defaultState: "on",
        offBlockedEfforts: ["max"],
        on: { body: { thinking: { type: "adaptive" } } },
        off: { body: { thinking: { type: "between_tools" } } },
      },
      "max",
    ),
    vendorExtendedThinking: false,
  });
  assert.deepEqual(blocked.additionalModelRequestFields, {
    thinking: { type: "adaptive" },
    output_config: { effort: "max" },
  });
});
