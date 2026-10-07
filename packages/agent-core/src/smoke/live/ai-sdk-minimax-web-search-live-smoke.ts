import { execSync } from "node:child_process";

import { AiSdkAnthropicTransport } from "../../anthropic/ai-sdk-transport.js";
import type { AnthropicTransportConfig } from "../../anthropic/anthropic-compat.js";
import {
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from "../../open-responses/responses-built-in-tools.js";
import type { LlmStreamEvent } from "../../ports.js";
import { startOpenAiToolAgentState } from "../../openai/tool-agent-helpers.js";

import { printSmokeSection } from "../shared/print.js";
import { shouldRunLiveSmoke } from "./env.js";

function resolveMinimaxApiKey(): string | undefined {
  const fromEnv = process.env.MINIMAX_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const value = execSync(
      'security find-generic-password -s Spirit -a "group::minimax" -w 2>/dev/null',
      { encoding: "utf8" },
    ).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function createLiveMinimaxWebSearchSmokeConfig(apiKey: string): AnthropicTransportConfig {
  return {
    transportKind: "anthropic",
    apiKey,
    model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3",
    baseUrl: process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.cn/anthropic/v1",
    llmVendor: "minimax",
  };
}

async function collectStreamEvents(
  stream: AsyncIterable<LlmStreamEvent>,
): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function main(): Promise<void> {
  if (!shouldRunLiveSmoke()) {
    return;
  }

  const apiKey = resolveMinimaxApiKey();
  if (!apiKey) {
    console.log(
      "MINIMAX_API_KEY or Spirit Keychain credentials not found, skipping minimax web_search live smoke.",
    );
    return;
  }

  const config = createLiveMinimaxWebSearchSmokeConfig(apiKey);
  const transport = new AiSdkAnthropicTransport();
  const state = startOpenAiToolAgentState(
    [],
    "You MUST use web_search. Search the web for Shanghai weather today and reply in one English sentence.",
    process.cwd(),
    [],
    [],
    config.model,
  );

  const started = await transport.startToolAgentRoundStreaming(config, state, []);
  const events = await collectStreamEvents(started.eventStream);
  const completion = await started.completion;

  printSmokeSection("live minimax web_search smoke", {
    model: config.model,
    baseUrl: config.baseUrl,
    completionKind: completion.kind,
    previewCount: events.filter((event) => event.kind === "streaming-tool-preview").length,
  });

  if (completion.kind !== "success") {
    throw new Error(`minimax web_search live smoke failed: ${completion.error}`);
  }

  if (completion.result.step.kind === "tool-calls") {
    throw new Error("minimax web_search live smoke should not enter host tool-calls.");
  }

  const webSearchPreviews = events.filter(
    (event): event is Extract<LlmStreamEvent, { kind: "streaming-tool-preview" }> =>
      event.kind === "streaming-tool-preview" && event.toolName === "web_search",
  );
  if (webSearchPreviews.length === 0) {
    throw new Error(
      "minimax web_search live smoke did not receive a web_search streaming-tool-preview.",
    );
  }

  const succeededPreview = webSearchPreviews.find(
    (event) =>
      resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(event.argumentsJson) === "succeeded",
  );
  if (!succeededPreview) {
    throw new Error("minimax web_search live smoke did not receive a succeeded terminal card.");
  }

  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(succeededPreview.argumentsJson);
  if (!ui?.sourceCount || ui.sourceCount < 1) {
    throw new Error("minimax web_search live smoke terminal card is missing the source count.");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`live minimax web_search smoke failed: ${message}`);
  process.exitCode = 1;
});
