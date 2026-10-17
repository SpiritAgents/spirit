import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildSdkProviderWebSearchStopWhen,
  filterPendingHostToolCalls,
  findLatestProviderBuiltinToolRoundInState,
  formatProviderBuiltinToolResultContent,
  persistProviderBuiltinToolRoundToState,
  resolveAiSdkStreamAssistantText,
  shouldResumeStreamingAfterProviderSearch,
  shouldUseGatewaySdkProviderWebSearchStreamPatch,
  shouldUseSdkProviderWebSearchMultiStep,
} from "./sdk-provider-web-search-loop.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test",
  model: "deepseek/deepseek-v4-pro",
  llmVendor: "vercel-ai-gateway",
};

const openAiConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test",
  model: "gpt-5.4",
  llmVendor: "openai",
  sdk: "@ai-sdk/openai",
};

test("shouldUseSdkProviderWebSearchMultiStep matches gateway and openai", () => {
  assert.equal(shouldUseSdkProviderWebSearchMultiStep(gatewayConfig), true);
  assert.equal(shouldUseSdkProviderWebSearchMultiStep(openAiConfig), true);
});

test("shouldUseGatewaySdkProviderWebSearchStreamPatch is gateway-only", () => {
  assert.equal(shouldUseGatewaySdkProviderWebSearchStreamPatch(gatewayConfig), true);
  assert.equal(shouldUseGatewaySdkProviderWebSearchStreamPatch(openAiConfig), false);
});

test("buildSdkProviderWebSearchStopWhen returns stop condition for gateway", () => {
  assert.ok(buildSdkProviderWebSearchStopWhen(gatewayConfig));
});

test("resolveAiSdkStreamAssistantText merges streamed preamble with final SDK step text", async () => {
  const resolved = await resolveAiSdkStreamAssistantText(
    {
      text: Promise.resolve("Final answer."),
      steps: Promise.resolve([{ text: "Searching now." }, { text: "Final answer." }]),
    },
    "Searching now.",
  );
  assert.equal(resolved.text, "Searching now.\n\nFinal answer.");
  assert.equal(resolved.finalStepText, "Final answer.");
});

test("shouldResumeStreamingAfterProviderSearch when only preamble streamed", () => {
  assert.equal(
    shouldResumeStreamingAfterProviderSearch(
      gatewayConfig,
      new Set(["call_search"]),
      0,
      "Searching now.",
      { text: "Searching now.", finalStepText: "Searching now.", sdkStepCount: 1 },
    ),
    true,
  );
  assert.equal(
    shouldResumeStreamingAfterProviderSearch(
      gatewayConfig,
      new Set(["call_search"]),
      0,
      "Latest models include Example.",
      {
        text: "Latest models include Example.",
        finalStepText: "Latest models include Example.",
        sdkStepCount: 2,
      },
    ),
    false,
  );
});

test("shouldResumeStreamingAfterProviderSearch skips when post-tool text already streamed", () => {
  assert.equal(
    shouldResumeStreamingAfterProviderSearch(
      gatewayConfig,
      new Set(["call_search"]),
      0,
      "Searching now.\n\nLatest models include Example.",
      {
        text: "Searching now.\n\nLatest models include Example.",
        finalStepText: "Searching now.\n\nLatest models include Example.",
        sdkStepCount: 1,
      },
      true,
    ),
    false,
  );
});

test("shouldResumeStreamingAfterProviderSearch skips when single-step metadata already has full answer", () => {
  assert.equal(
    shouldResumeStreamingAfterProviderSearch(
      gatewayConfig,
      new Set(["call_search"]),
      0,
      "Searching now.",
      {
        text: "Searching now.\n\nLatest models include Example.",
        finalStepText: "Searching now.\n\nLatest models include Example.",
        sdkStepCount: 1,
      },
    ),
    false,
  );
});

test("shouldResumeStreamingAfterProviderSearch is disabled for non-gateway providers", () => {
  assert.equal(
    shouldResumeStreamingAfterProviderSearch(
      openAiConfig,
      new Set(["call_search"]),
      0,
      "Searching now.",
      { text: "Searching now.", finalStepText: "Searching now.", sdkStepCount: 1 },
    ),
    false,
  );
});

test("persistProviderBuiltinToolRoundToState writes assistant tool_calls and tool results", () => {
  const state = { messages: [{ role: "user", content: "search" }], steps: 0 };
  persistProviderBuiltinToolRoundToState(
    state,
    {
      role: "assistant",
      content: "Searching now.",
      tool_calls: [
        {
          id: "call_search",
          type: "function",
          function: { name: "web_search", arguments: '{"query":"latest models"}' },
        },
      ],
    },
    new Map([
      [
        "call_search",
        {
          toolCallId: "call_search",
          toolName: "web_search",
          argumentsJson: '{"query":"latest models"}',
          output: {
            results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
            id: "search-1",
          },
        },
      ],
    ]),
    new Set(["call_search"]),
  );

  assert.equal(state.messages.length, 3);
  assert.equal(state.messages.at(-1)?.role, "tool");
  assert.match(
    formatProviderBuiltinToolResultContent("web_search", {
      results: [{ title: "Example", url: "https://example.com", snippet: "hello" }],
    }),
    /Example/,
  );
});

test("findLatestProviderBuiltinToolRoundInState returns assistant tool_calls and tool results", () => {
  const round = findLatestProviderBuiltinToolRoundInState({
    messages: [
      { role: "user", content: "search" },
      {
        role: "assistant",
        content: "Searching now.",
        tool_calls: [
          {
            id: "call_search",
            type: "function",
            function: { name: "web_search", arguments: '{"query":"latest models"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_search",
        content: "[web_search]\n1. Example",
      },
    ],
    steps: 1,
  });

  assert.deepEqual(round?.calls, [
    {
      id: "call_search",
      name: "web_search",
      argumentsJson: '{"query":"latest models"}',
    },
  ]);
  assert.equal(round?.toolResults.length, 1);
  assert.match(round?.toolResults[0]?.content ?? "", /Example/);
});

test("filterPendingHostToolCalls drops executed provider builtins only", () => {
  const calls = [
    { id: "call_search", name: "web_search", argumentsJson: '{"query":"x"}' },
    { id: "call_grep", name: "grep", argumentsJson: '{"query":"y"}' },
  ];
  const pending = filterPendingHostToolCalls(calls, new Set(["call_search"]));
  assert.deepEqual(pending, [calls[1]]);
});
