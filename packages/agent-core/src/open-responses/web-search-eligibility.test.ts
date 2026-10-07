import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildProviderWebSearchPromptSection,
  resolveProviderWebSearchMode,
  shouldUseProviderWebSearch,
  XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED,
} from "./web-search-eligibility.js";

test("resolveProviderWebSearchMode excludes moonshot-ai chat", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "openai-compatible",
      apiKey: "k",
      model: "kimi-k2.5",
      llmVendor: "moonshot-ai",
    }),
    undefined,
  );
});

test("resolveProviderWebSearchMode openai official responses", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "gpt-5.4",
      llmVendor: "openai",
      responsesProvider: "openai",
    }),
    "openai-sdk-web-search",
  );
});

test("resolveProviderWebSearchMode xai when enabled", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "grok-4",
      llmVendor: "xai",
      responsesProvider: "xai",
    }),
    XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED ? "xai-sdk-web-search" : undefined,
  );
});

test("resolveProviderWebSearchMode enables vercel gateway open-responses", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
    }),
    "gateway-sdk-web-search",
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
    }),
    true,
  );
});

test("resolveProviderWebSearchMode alibaba open-responses", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "qwen3-max",
      llmVendor: "alibaba",
    }),
    "alibaba-responses-built-in-tools",
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "open-responses",
      apiKey: "k",
      model: "qwen3-max",
      llmVendor: "alibaba",
    }),
    true,
  );
});

test("resolveProviderWebSearchMode deepseek open-responses", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "deepseek-v4-flash",
      llmVendor: "deepseek",
    }),
    "deepseek-responses-built-in-tools",
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "open-responses",
      apiKey: "k",
      model: "deepseek-v4-pro",
      llmVendor: "deepseek",
    }),
    true,
  );
});

test("resolveProviderWebSearchMode excludes Bedrock Mantle openai.gpt models", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      llmVendor: "openai",
      responsesProvider: "openai",
    }),
    undefined,
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai.gpt-5.5",
      baseUrl: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
      llmVendor: "openai",
      responsesProvider: "openai",
    }),
    false,
  );
});

test("resolveProviderWebSearchMode excludes openrouter", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai/gpt-4o",
      llmVendor: "openrouter",
    }),
    undefined,
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai/gpt-4o",
      llmVendor: "openrouter",
    }),
    false,
  );
});

test("resolveProviderWebSearchMode excludes openai-compatible openai vendor", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      apiKey: "k",
      model: "gpt-4.1",
      llmVendor: "openai",
    }),
    undefined,
  );
});

test("buildProviderWebSearchPromptSection is not injected into system message", () => {
  assert.equal(
    buildProviderWebSearchPromptSection({
      transportKind: "open-responses",
      apiKey: "k",
      model: "gpt-5.4",
      llmVendor: "openai",
      responsesProvider: "openai",
    }),
    undefined,
  );
  assert.equal(
    buildProviderWebSearchPromptSection({
      transportKind: "open-responses",
      apiKey: "k",
      model: "grok-4",
      llmVendor: "xai",
      responsesProvider: "xai",
    }),
    undefined,
  );
});

test("buildProviderWebSearchPromptSection omits alibaba", () => {
  assert.equal(
    buildProviderWebSearchPromptSection({
      transportKind: "open-responses",
      apiKey: "k",
      model: "qwen3-max",
      llmVendor: "alibaba",
    }),
    undefined,
  );
});

test("resolveProviderWebSearchMode enables minimax anthropic server tools", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: "anthropic",
      apiKey: "k",
      model: "MiniMax-M3",
      baseUrl: "https://api.minimax.cn/anthropic/v1",
      llmVendor: "minimax",
    }),
    "minimax-server-tools-web-search",
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: "anthropic",
      apiKey: "k",
      model: "MiniMax-M3",
      baseUrl: "https://api.minimax.cn/anthropic/v1",
      llmVendor: "minimax",
    }),
    true,
  );
});

test("resolveProviderWebSearchMode excludes minimax openai-compatible chat", () => {
  assert.equal(
    resolveProviderWebSearchMode({
      apiKey: "k",
      model: "MiniMax-M3",
      llmVendor: "minimax",
    }),
    undefined,
  );
});

test("webSearchEnabled=false suppresses every provider web search mode", () => {
  const cases: Array<Parameters<typeof resolveProviderWebSearchMode>[0]> = [
    {
      transportKind: "open-responses",
      apiKey: "k",
      model: "gpt-5.4",
      llmVendor: "openai",
      responsesProvider: "openai",
    },
    {
      transportKind: "open-responses",
      apiKey: "k",
      model: "grok-4",
      llmVendor: "xai",
      responsesProvider: "xai",
    },
    {
      transportKind: "open-responses",
      apiKey: "k",
      model: "openai/gpt-5.4",
      llmVendor: "vercel-ai-gateway",
    },
    {
      transportKind: "open-responses",
      apiKey: "k",
      model: "qwen3-max",
      llmVendor: "alibaba",
    },
    {
      transportKind: "open-responses",
      apiKey: "k",
      model: "deepseek-v4-pro",
      llmVendor: "deepseek",
    },
    {
      transportKind: "anthropic",
      apiKey: "k",
      model: "MiniMax-M3",
      baseUrl: "https://api.minimax.cn/anthropic/v1",
      llmVendor: "minimax",
    },
  ];
  for (const base of cases) {
    assert.equal(resolveProviderWebSearchMode({ ...base, webSearchEnabled: false }), undefined);
    assert.equal(shouldUseProviderWebSearch({ ...base, webSearchEnabled: false }), false);
  }
});

test("webSearchEnabled=false suppresses alibaba chat completions web search only", () => {
  const alibabaChat = {
    apiKey: "k",
    model: "qwen3-max",
    llmVendor: "alibaba",
  } as const;
  assert.equal(shouldUseProviderWebSearch(alibabaChat), true);
  assert.equal(shouldUseProviderWebSearch({ ...alibabaChat, webSearchEnabled: false }), false);
});
