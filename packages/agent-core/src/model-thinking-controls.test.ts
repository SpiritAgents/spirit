import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isAnthropicClaudeAdaptiveThinkingModel,
  isAnthropicClaudeBudgetThinkingModel,
  isDeepSeekReasoningOnlyModel,
  modelEffortControlLabelKind,
  modelShowsReasoningEffortControl,
  modelSupportsReasoningEffortWhileThinking,
  modelSupportsThinkingSwitch,
  modelUsesReasoningEffortPrimaryControl,
  resolveAnthropicExplicitThinkingConfig,
  resolveVendorExtendedThinking,
  shouldPinReasoningEffortToDefault,
} from "./model-thinking-controls.js";

test("DeepSeek V4 supports thinking switch and effort while thinking", () => {
  for (const model of ["deepseek-v4-pro", "deepseek-v4-flash-vision-exp"] as const) {
    const context = {
      provider: "deepseek" as const,
      model,
      transportKind: "openai-compatible" as const,
    };
    assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
    assert.equal(modelSupportsThinkingSwitch(context), true);
    assert.equal(modelSupportsReasoningEffortWhileThinking(context), true);
    assert.equal(shouldPinReasoningEffortToDefault(true, context), false);
    assert.equal(modelShowsReasoningEffortControl(context, true), true);
    assert.equal(modelShowsReasoningEffortControl(context, false), false);
  }
});

test("DeepSeek non-V4 has no thinking switch or reasoning effort control", () => {
  const context = {
    provider: "deepseek" as const,
    model: "deepseek-chat",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test("Z.ai shows reasoning effort when thinking enabled", () => {
  const context = {
    provider: "z-ai" as const,
    model: "glm-4.7",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(true, context), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
});

test("DeepSeek R1 has no thinking switch", () => {
  const context = {
    provider: "deepseek" as const,
    model: "deepseek-r1",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(isDeepSeekReasoningOnlyModel(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Kimi Code kimi-for-coding uses reasoning effort primary control only", () => {
  const context = {
    provider: "kimi-code" as const,
    model: "kimi-for-coding",
    transportKind: "openai-compatible" as const,
    supportsThinkingType: "only" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
});

test("Moonshot kimi-k2 uses reasoning effort primary control only", () => {
  const context = {
    provider: "moonshot-ai" as const,
    model: "kimi-k2",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Moonshot kimi-k2.5 supports thinking switch and effort when thinking enabled", () => {
  const context = {
    provider: "moonshot-ai" as const,
    model: "kimi-k2.5",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
});

test("Meituan LongCat supports thinking switch only when catalog marks supportsThinkingSwitch", () => {
  const withSwitch = {
    provider: "meituan" as const,
    model: "LongCat-2.0",
    transportKind: "openai-compatible" as const,
    supportsThinkingSwitch: true as const,
  };
  assert.equal(modelSupportsThinkingSwitch(withSwitch), true);
  assert.equal(modelShowsReasoningEffortControl(withSwitch, true), true);
  assert.equal(modelShowsReasoningEffortControl(withSwitch, false), false);

  const withoutSwitch = {
    provider: "meituan" as const,
    model: "LongCat-Vision",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(withoutSwitch), false);
});

test("Moonshot kimi-k2.7-code uses reasoning effort primary control only", () => {
  const context = {
    provider: "moonshot-ai" as const,
    model: "kimi-k2.7-code",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test("Moonshot kimi-k3 uses reasoning effort primary control only", () => {
  const context = {
    provider: "moonshot-ai" as const,
    model: "kimi-k3",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test("Moonshot moonshot-v1 uses reasoning effort primary control only", () => {
  const context = {
    provider: "moonshot-ai" as const,
    model: "moonshot-v1-8k",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Gateway Moonshot kimi-k2.5 supports thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "moonshotai/kimi-k2.5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test("Gateway Xiaomi mimo-v2.5 supports thinking switch on chat transport", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "xiaomi/mimo-v2.5",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
});

test("Gateway Xiaomi mimo-v2.5 uses reasoning effort primary control on responses transport", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "xiaomi/mimo-v2.5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), false);
});

test("direct Xiaomi mimo-v2.5 uses reasoning effort primary control on responses transport", () => {
  const context = {
    provider: "xiaomi" as const,
    model: "mimo-v2.5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test("Gateway Xiaomi mimo-v2-flash has no thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "xiaomi/mimo-v2-flash",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Gateway Z.ai glm-4.7 supports thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "zai/glm-4.7",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test("Gateway Z.ai glm-4 has no thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "zai/glm-4",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("direct MiniMax M3 supports thinking switch", () => {
  const context = {
    provider: "minimax" as const,
    model: "MiniMax-M3",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test("direct MiniMax M2.5 has no thinking switch", () => {
  const context = {
    provider: "minimax" as const,
    model: "MiniMax-M2.5",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Gateway MiniMax M3 supports thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "minimax/minimax-m3",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test("Gateway MiniMax M2.5 has no thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "minimax/MiniMax-M2.5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("TokenHub hy3 supports thinking switch", () => {
  const context = {
    provider: "tencent-tokenhub" as const,
    model: "hy3",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test("TokenHub minimax-m2.5 has no thinking switch via global model match", () => {
  const context = {
    provider: "tencent-tokenhub" as const,
    model: "minimax-m2.5",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("TokenHub glm-5 has thinking switch but no reasoning effort control", () => {
  const context = {
    provider: "tencent-tokenhub" as const,
    model: "glm-5",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
});

test("TokenHub hy3 shows reasoning effort when thinking enabled", () => {
  const context = {
    provider: "tencent-tokenhub" as const,
    model: "hy3",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test("OpenAI uses reasoning effort primary control only", () => {
  const context = {
    provider: "openai" as const,
    model: "gpt-5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Fireworks aggregated provider exposes reasoning effort for all models", () => {
  const context = {
    provider: "fireworks-ai" as const,
    model: "accounts/fireworks/models/deepseek-v4-flash",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test("Gateway OpenAI slug uses reasoning effort primary control", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "openai/gpt-5.5",
    transportKind: "open-responses" as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(modelEffortControlLabelKind(context), "reasoningEffort");
});

test("Gateway Claude Fable 5 shows effort without thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-fable-5",
    transportKind: "open-responses" as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(modelEffortControlLabelKind(context), "effort");
});

test("Gateway Claude Sonnet 5 supports thinking switch and full effort levels", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-sonnet-5",
    transportKind: "open-responses" as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, context), {
    type: "disabled",
  });
});

test("resolveAnthropicExplicitThinkingConfig ignores disabled for always-on Claude Fable 5", () => {
  const context = {
    provider: "anthropic" as const,
    model: "claude-fable-5",
    transportKind: "anthropic" as const,
  };
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, context), {
    type: "adaptive",
    display: "summarized",
  });
});

test("Gateway Claude adaptive supports thinking switch and effort label", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-opus-4-8",
    transportKind: "open-responses" as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), true);
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), false);
  assert.equal(modelEffortControlLabelKind(context), "effort");
});

test("Gateway Claude legacy budget supports thinking switch without effort control", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-opus-4-5",
    transportKind: "open-responses" as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), false);
  assert.equal(isAnthropicClaudeBudgetThinkingModel(context), true);
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
  assert.equal(modelEffortControlLabelKind(context), "reasoningEffort");
});

test("Gateway Claude without extended thinking stays hidden", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-3-5-sonnet",
    transportKind: "open-responses" as const,
  };
  assert.equal(isAnthropicClaudeBudgetThinkingModel(context), false);
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Gateway DeepSeek non-V4 has no thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "deepseek/deepseek-v3",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
});

test("Gateway DeepSeek V3.2 has no thinking switch", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "deepseek/deepseek-v3.2",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test("Gateway DeepSeek V4 shows reasoning effort when thinking enabled", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "deepseek/deepseek-v4-pro",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test("resolveAnthropicExplicitThinkingConfig maps adaptive and disabled", () => {
  const adaptiveContext = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-opus-4-8",
    transportKind: "open-responses" as const,
  };
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(undefined, adaptiveContext), {
    type: "adaptive",
    display: "summarized",
  });
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(true, adaptiveContext), {
    type: "adaptive",
    display: "summarized",
  });
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, adaptiveContext), {
    type: "disabled",
  });
});

test("resolveAnthropicExplicitThinkingConfig maps budget disabled only", () => {
  const context = {
    provider: "vercel-ai-gateway" as const,
    model: "anthropic/claude-opus-4-5",
    transportKind: "open-responses" as const,
  };
  assert.equal(resolveAnthropicExplicitThinkingConfig(undefined, context), undefined);
  assert.equal(resolveAnthropicExplicitThinkingConfig(true, context), undefined);
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, context), {
    type: "disabled",
  });
});

test("resolveVendorExtendedThinking maps enabled default to undefined wire omission", () => {
  assert.equal(resolveVendorExtendedThinking(undefined), undefined);
  assert.equal(resolveVendorExtendedThinking(true), undefined);
  assert.equal(resolveVendorExtendedThinking(false), false);
});

test("Groq reasoning models use reasoning effort primary control", () => {
  const context = {
    provider: "groq" as const,
    model: "qwen/qwen3.6-27b",
    transportKind: "openai-compatible" as const,
    supportedEfforts: ["none", "default"],
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test("Muse models keep reasoning effort and hide the thinking switch on every route", () => {
  const gateway = {
    provider: "vercel-ai-gateway" as const,
    model: "meta/muse-spark-1.3",
    transportKind: "open-responses" as const,
    supportsThinkingSwitch: true as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(gateway), true);
  assert.equal(modelSupportsThinkingSwitch(gateway), false);
  assert.equal(modelShowsReasoningEffortControl(gateway, false), true);
  assert.equal(shouldPinReasoningEffortToDefault(false, gateway), false);

  const custom = {
    provider: "custom" as const,
    model: "muse-wonder-1.0",
    transportKind: "openai-compatible" as const,
  };
  assert.equal(modelSupportsThinkingSwitch(custom), false);
  assert.equal(modelShowsReasoningEffortControl(custom, undefined), true);
});
