import assert from "node:assert/strict";
import { test } from "vitest";

import { lookupModelKnowledge, MODEL_KNOWLEDGE_SOURCES } from "./records.js";

const CLAUDE_5_FULL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GPT56_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const GPT56_MODES = ["standard", "pro"];
const MUSE_BASE_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
const ANTHROPIC_OFF_DISABLED = {
  body: { thinking: { type: "disabled" } },
  providerOptions: { anthropic: { thinking: { type: "disabled" } } },
};
const CLAUDE_ALWAYS_ON_THINKING = {
  supported: true,
  types: { adaptive: true, betweenTools: false, disabled: false, enabled: false },
};
const CLAUDE_ADAPTIVE_THINKING = {
  supported: true,
  types: { adaptive: true, betweenTools: false, disabled: true, enabled: false },
};
const CLAUDE_BETWEEN_TOOLS_THINKING = {
  supported: true,
  types: { adaptive: true, betweenTools: true, disabled: false, enabled: false },
};
const CLAUDE_DEPRECATED_BUDGET_THINKING = {
  supported: true,
  types: { adaptive: true, betweenTools: false, disabled: true, enabled: true },
};
const CLAUDE_BUDGET_THINKING = {
  supported: true,
  types: { adaptive: false, betweenTools: false, disabled: true, enabled: true },
};
const THINKING_TYPE_SWITCH = {
  on: { body: { thinking: { type: "enabled" } } },
  off: { body: { thinking: { type: "disabled" } } },
};
/** The chat-body encoding plus the gateway v3 providerOptions encoding for one upstream namespace. */
function thinkingTypeSwitchWithGateway(namespace: string) {
  return {
    on: {
      ...THINKING_TYPE_SWITCH.on,
      providerOptions: { [namespace]: { thinking: { type: "enabled" } } },
    },
    off: {
      ...THINKING_TYPE_SWITCH.off,
      providerOptions: { [namespace]: { thinking: { type: "disabled" } } },
    },
  };
}
const MUSE_EFFORTS_WITH_MAX = [...MUSE_BASE_EFFORTS, "max"];
/** Gemini service tier literal declaration shared by every gemini record (default → standard on the wire). */
const GEMINI_SERVICE_TIERS = {
  default: { body: { serviceTier: "standard" } },
  flex: { body: { serviceTier: "flex" } },
  priority: { body: { serviceTier: "priority" } },
};

test("registry bundles every family file in deterministic alphabetical order", () => {
  assert.deepEqual(
    MODEL_KNOWLEDGE_SOURCES.map((entry) => entry.source),
    [
      "amazon-nova.json",
      "anthropic-claude.json",
      "deepseek.json",
      "google-gemini.json",
      "meta-muse.json",
      "minimax.json",
      "moonshot-kimi.json",
      "openai-gpt.json",
      "xai-grok.json",
      "xiaomi.json",
      "zai-glm.json",
    ],
  );
  for (const entry of MODEL_KNOWLEDGE_SOURCES) {
    assert.ok(entry.records.length > 0, entry.source);
  }
});

test("declare payloads only use config declaration keys", () => {
  const allowedKeys = new Set([
    "supportedReasoningEfforts",
    "reasoningEffort",
    "effortSemantics",
    "supportedEfforts",
    "defaultEffort",
    "thinkingCapabilities",
    "supportedReasoningModes",
    "supportsThinkingType",
    "supportsThinkingSwitch",
    "thinkingSwitch",
    "serviceTiers",
  ]);
  for (const entry of MODEL_KNOWLEDGE_SOURCES) {
    for (const record of entry.records) {
      for (const key of Object.keys(record.declare)) {
        assert.ok(allowedKeys.has(key), `${entry.source} ${record.match}: unexpected key ${key}`);
      }
    }
  }
});

function expectClaudeDeclaration(
  actual: unknown,
  expected: Record<string, unknown>,
  message?: string,
): void {
  if ((actual as Record<string, unknown> | undefined)?.effortSemantics !== "output") {
    assert.deepEqual(actual, expected, message);
    return;
  }
  const { supportedReasoningEfforts: legacyEfforts, ...rest } = expected;
  assert.deepEqual(
    actual,
    {
      effortSemantics: "output",
      ...(legacyEfforts !== undefined ? { supportedEfforts: legacyEfforts } : {}),
      ...rest,
    },
    message,
  );
}

test("claude opus 5.x resolves adaptive thinking with full efforts across id forms", () => {
  const opus55 = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "medium",
    thinkingCapabilities: CLAUDE_ALWAYS_ON_THINKING,
    supportsThinkingType: "only",
    supportsThinkingSwitch: false,
    thinkingSwitch: {
      defaultState: "on",
      on: {
        body: { thinking: { type: "adaptive" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
      },
    },
  };
  expectClaudeDeclaration(lookupModelKnowledge("claude-opus-5.5"), opus55);
  expectClaudeDeclaration(lookupModelKnowledge("anthropic/claude-opus-5.5"), opus55);
  expectClaudeDeclaration(lookupModelKnowledge("anthropic.claude-opus-5-5-v1"), opus55);
  // Bedrock regional inference-profile prefixes resolve to the same record.
  expectClaudeDeclaration(lookupModelKnowledge("us.anthropic.claude-opus-5-5-v1"), opus55);
  expectClaudeDeclaration(lookupModelKnowledge("global.anthropic.claude-opus-5-5-v1"), opus55);

  const opus5 = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_ADAPTIVE_THINKING,
    supportsThinkingSwitch: true,
    serviceTiers: ["fast"],
    thinkingSwitch: {
      defaultState: "on",
      offBlockedEfforts: ["xhigh", "max"],
      on: {
        body: { thinking: { type: "adaptive", display: "summarized" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
      },
      off: ANTHROPIC_OFF_DISABLED,
    },
  };
  expectClaudeDeclaration(lookupModelKnowledge("claude-opus-5"), opus5);
  expectClaudeDeclaration(lookupModelKnowledge("claude-sonnet-5"), {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_ADAPTIVE_THINKING,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      defaultState: "on",
      on: {
        body: { thinking: { type: "adaptive" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
      },
      off: ANTHROPIC_OFF_DISABLED,
    },
  });
});

test("claude fable/mythos 5 are always-on thinking without a switch", () => {
  // Always-on: only the on encoding is declared (adaptive + summarized display).
  const expected = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_ALWAYS_ON_THINKING,
    supportsThinkingType: "only",
    supportsThinkingSwitch: false,
    thinkingSwitch: {
      defaultState: "on",
      on: {
        body: { thinking: { type: "adaptive", display: "summarized" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
      },
    },
  };
  expectClaudeDeclaration(lookupModelKnowledge("claude-fable-5"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("anthropic/claude-mythos-5"), expected);
});

test("claude opus 4.8/4.7 beat the legacy opus-4 record (record order priority)", () => {
  const shared = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_ADAPTIVE_THINKING,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      defaultState: "off",
      on: {
        body: { thinking: { type: "adaptive", display: "summarized" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
      },
      off: "omit",
    },
  };
  // Opus 4.8 additionally declares the native Fast tier; 4.7 does not have it.
  expectClaudeDeclaration(lookupModelKnowledge("claude-opus-4.8"), {
    ...shared,
    serviceTiers: ["fast"],
  });
  expectClaudeDeclaration(lookupModelKnowledge("claude-opus-4-7"), shared);
});

test("claude 4.6 adaptive families expose their reduced effort ladders", () => {
  const adaptive = {
    defaultState: "off",
    on: {
      body: { thinking: { type: "adaptive" } },
      providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
    },
    off: "omit",
  };
  expectClaudeDeclaration(lookupModelKnowledge("claude-opus-4.6"), {
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_DEPRECATED_BUDGET_THINKING,
    supportsThinkingSwitch: true,
    thinkingSwitch: adaptive,
  });
  expectClaudeDeclaration(lookupModelKnowledge("anthropic/claude-sonnet-4.6"), {
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_DEPRECATED_BUDGET_THINKING,
    supportsThinkingSwitch: true,
    thinkingSwitch: adaptive,
  });
});

test("legacy claude models are budget thinking: switch without effort levels", () => {
  const expected = {
    supportedReasoningEfforts: [],
    thinkingCapabilities: CLAUDE_BUDGET_THINKING,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      defaultState: "off",
      on: {
        body: { thinking: { type: "enabled", budget_tokens: 12000 } },
        providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
      },
      off: "omit",
    },
  };
  for (const id of ["claude-opus-4-5", "us.anthropic.claude-opus-4-5-v1"]) {
    expectClaudeDeclaration(
      lookupModelKnowledge(id),
      {
        supportedReasoningEfforts: ["low", "medium", "high"],
        defaultEffort: "high",
        thinkingCapabilities: CLAUDE_BUDGET_THINKING,
        supportsThinkingSwitch: true,
        thinkingSwitch: {
          defaultState: "off",
          on: {
            body: { thinking: { type: "enabled", budget_tokens: 12000 } },
            providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
          },
          off: "omit",
        },
      },
      id,
    );
  }
  for (const model of [
    "claude-sonnet-4-5",
    "claude-haiku-4.5",
    "claude-opus-4-1",
    "claude-opus-4",
    "claude-sonnet-4",
    // Bedrock ids, including regional inference-profile prefixes.
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  ]) {
    expectClaudeDeclaration(lookupModelKnowledge(model), expected, model);
  }
});

test("claude 5.5, preview, and opus 4.5 records carry exact defaults and off encodings", () => {
  const adaptive = {
    body: { thinking: { type: "adaptive" } },
    providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
  };
  const budget = {
    body: { thinking: { type: "enabled", budget_tokens: 12000 } },
    providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 12000 } } },
  };
  const cases = [
    {
      id: "claude-opus-5.5",
      expected: {
        supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
        defaultEffort: "medium",
        thinkingCapabilities: CLAUDE_ALWAYS_ON_THINKING,
        supportsThinkingType: "only",
        supportsThinkingSwitch: false,
        thinkingSwitch: { defaultState: "on", on: adaptive },
      },
    },
    {
      id: "claude-sonnet-5.5",
      expected: {
        supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
        defaultEffort: "high",
        thinkingCapabilities: CLAUDE_BETWEEN_TOOLS_THINKING,
        supportsThinkingSwitch: true,
        thinkingSwitch: {
          defaultState: "on",
          offBlockedEfforts: ["xhigh", "max"],
          on: adaptive,
          off: {
            body: { thinking: { type: "between_tools" } },
            providerOptions: { anthropic: { thinking: { type: "between_tools" } } },
          },
        },
      },
    },
    {
      id: "claude-haiku-5.5",
      expected: {
        supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
        defaultEffort: "medium",
        thinkingCapabilities: CLAUDE_ADAPTIVE_THINKING,
        supportsThinkingSwitch: true,
        thinkingSwitch: {
          defaultState: "on",
          offBlockedEfforts: ["xhigh", "max"],
          on: adaptive,
          off: ANTHROPIC_OFF_DISABLED,
        },
      },
    },
    {
      id: "claude-mythos-preview",
      expected: {
        supportedReasoningEfforts: ["low", "medium", "high", "max"],
        defaultEffort: "high",
        thinkingCapabilities: {
          supported: true,
          types: { adaptive: true, betweenTools: false, disabled: false, enabled: true },
        },
        supportsThinkingType: "only",
        supportsThinkingSwitch: false,
        thinkingSwitch: { defaultState: "on", on: adaptive },
      },
    },
    {
      id: "claude-opus-4.5",
      expected: {
        supportedReasoningEfforts: ["low", "medium", "high"],
        defaultEffort: "high",
        thinkingCapabilities: CLAUDE_BUDGET_THINKING,
        supportsThinkingSwitch: true,
        thinkingSwitch: { defaultState: "off", on: budget, off: "omit" },
      },
    },
  ];

  for (const { id, expected } of cases) {
    expectClaudeDeclaration(lookupModelKnowledge(id), expected, id);
  }
});

test("claude route suffixes and snapshots resolve to their base records", () => {
  const expected = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    defaultEffort: "high",
    thinkingCapabilities: CLAUDE_ADAPTIVE_THINKING,
    supportsThinkingSwitch: true,
    serviceTiers: ["fast"],
    thinkingSwitch: {
      defaultState: "off",
      on: {
        body: { thinking: { type: "adaptive", display: "summarized" } },
        providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
      },
      off: "omit",
    },
  };
  for (const id of [
    "claude-opus-4.8",
    "claude-opus-4.8-20261001",
    "anthropic/claude-opus-4.8 (Fast)",
    "anthropic/claude-opus-4.8 (Batch)",
    "us.anthropic.claude-opus-4-8-v1",
  ]) {
    expectClaudeDeclaration(lookupModelKnowledge(id), expected, id);
  }

  const sonnet55 = lookupModelKnowledge("us.anthropic.claude-sonnet-5-5-v1") as {
    thinkingSwitch?: {
      off?: { body?: { thinking?: { type?: string } } };
      offBlockedEfforts?: string[];
    };
  };
  assert.equal(sonnet55?.thinkingSwitch?.off?.body?.thinking?.type, "between_tools");
  assert.deepEqual(sonnet55?.thinkingSwitch?.offBlockedEfforts, ["xhigh", "max"]);
});

test("claude 4.7+ and 5.x never declare budget-based thinking", () => {
  for (const id of [
    "claude-opus-4.7",
    "claude-opus-4.8",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-5.5",
    "claude-sonnet-5.5",
    "claude-haiku-5.5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-mythos-preview",
  ]) {
    const declaration = lookupModelKnowledge(id) as {
      thinkingSwitch?: { on?: { body?: { thinking?: Record<string, unknown> } } };
    };
    const thinking = declaration.thinkingSwitch?.on?.body?.thinking;
    assert.equal(thinking?.type, "adaptive", id);
    assert.equal("budget_tokens" in thinking, false, id);
  }
});

test("bedrock nova ids declare the low/medium/high reasoningConfig ladder", () => {
  const expected = { supportedReasoningEfforts: ["low", "medium", "high"] };
  expectClaudeDeclaration(lookupModelKnowledge("amazon.nova-premier-v1:0"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("us.amazon.nova-premier-v1:0"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("eu.amazon.nova-2-lite-v1:0"), expected);
  assert.equal(lookupModelKnowledge("amazon.titan-text-express-v1"), undefined);
});

test("gpt-5.6+ exposes the extended effort ladder and pro mode", () => {
  const expected = {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast"],
  };
  expectClaudeDeclaration(lookupModelKnowledge("gpt-5.6-sol"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("openai/gpt-5.6-terra"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("gpt-6"), expected);
});

test("pre-5.6 OpenAI reasoning models resolve exact effort and tier declarations", () => {
  const noneThroughXhigh = ["none", "low", "medium", "high", "xhigh"];
  const mediumThroughXhigh = ["medium", "high", "xhigh"];
  const minimalThroughHigh = ["minimal", "low", "medium", "high"];
  const autoDefault = ["auto", "default"];
  const withFlex = [...autoDefault, "flex"];
  const withFlexFast = [...withFlex, "fast"];
  const withLimitedFast = {
    auto: { body: { service_tier: "auto" } },
    default: { body: { service_tier: "default" } },
    flex: { body: { service_tier: "flex" } },
    fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
  };
  const cases = [
    { id: "gpt-5.5-pro", efforts: mediumThroughXhigh, tiers: withFlex },
    { id: "gpt-5.5", efforts: noneThroughXhigh, tiers: withLimitedFast },
    { id: "gpt-5.4-pro", efforts: mediumThroughXhigh, tiers: withFlex },
    { id: "gpt-5.4-mini", efforts: noneThroughXhigh, tiers: withLimitedFast },
    { id: "gpt-5.4-nano", efforts: noneThroughXhigh, tiers: withFlex },
    { id: "gpt-5.4", efforts: noneThroughXhigh, tiers: withLimitedFast },
    { id: "gpt-5.3-codex", efforts: ["low", "medium", "high", "xhigh"], tiers: autoDefault },
    { id: "gpt-5.2-pro", efforts: mediumThroughXhigh, tiers: autoDefault },
    { id: "gpt-5.2", efforts: noneThroughXhigh, tiers: withFlexFast },
    { id: "gpt-5.1", efforts: ["none", "low", "medium", "high"], tiers: withFlexFast },
    { id: "gpt-5-pro", efforts: ["high"], tiers: autoDefault },
    { id: "gpt-5-mini", efforts: minimalThroughHigh, tiers: withFlexFast },
    { id: "gpt-5-nano", efforts: minimalThroughHigh, tiers: withFlex },
    { id: "gpt-5", efforts: minimalThroughHigh, tiers: withFlexFast },
    { id: "o3", efforts: ["low", "medium", "high"], tiers: withFlexFast },
  ];

  for (const { id, efforts, tiers } of cases) {
    for (const modelId of [id, `openai/${id}`, `${id}-2026-01-15`]) {
      assert.deepEqual(
        lookupModelKnowledge(modelId),
        { supportedReasoningEfforts: efforts, serviceTiers: tiers },
        modelId,
      );
    }
  }
});

test("OpenAI non-reasoning models declare only their service tiers", () => {
  const autoDefault = ["auto", "default"];
  const withFast = [...autoDefault, "fast"];
  const cases = [
    { ids: ["o3-pro", "openai/o3-pro", "o3-pro-2026-01-15"], tiers: autoDefault },
    { ids: ["gpt-4.1", "openai/gpt-4.1", "gpt-4.1-2026-01-15"], tiers: withFast },
    {
      ids: ["gpt-4.1-mini", "openai/gpt-4.1-mini", "gpt-4.1-mini-2026-01-15"],
      tiers: withFast,
    },
    {
      ids: ["gpt-4o-mini", "openai/gpt-4o-mini", "gpt-4o-mini-2026-01-15"],
      tiers: withFast,
    },
    {
      ids: ["gpt-4o", "openai/gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20"],
      tiers: withFast,
    },
    { ids: ["chat-latest", "openai/chat-latest"], tiers: autoDefault },
  ];

  for (const { ids, tiers } of cases) {
    for (const modelId of ids) {
      expectClaudeDeclaration(lookupModelKnowledge(modelId), { serviceTiers: tiers }, modelId);
    }
  }
});

test("OpenAI knowledge does not infer effort for non-reasoning or unavailable models", () => {
  for (const modelId of [
    "o3-pro",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "chat-latest",
  ]) {
    assert.equal(lookupModelKnowledge(modelId)?.["supportedReasoningEfforts"], undefined, modelId);
  }

  for (const modelId of [
    "o1",
    "o3-mini",
    "o4-mini",
    "gpt-5.1-codex",
    "gpt-5.1-codex-max",
    "gpt-5-codex",
    "gpt-5.5-codex",
    "gpt-4.1-nano",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-2024-05-13",
    "gpt-3.5-turbo",
  ]) {
    assert.equal(lookupModelKnowledge(modelId), undefined, modelId);
  }
});

test("gpt-6-astra rejects none and offers ultrafast; gpt-6.1-sol keeps none", () => {
  expectClaudeDeclaration(lookupModelKnowledge("gpt-6-astra"), {
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
  });
  expectClaudeDeclaration(lookupModelKnowledge("openai/gpt-6.1-sol"), {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
  });
});

test("bedrock mantle gpt ids hit the generic gpt-5.6+ record without astra/ultrafast specifics", () => {
  const expected = {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast"],
  };
  expectClaudeDeclaration(lookupModelKnowledge("openai.gpt-6-astra"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("openai.gpt-5.6"), expected);
});

test("gemini 2.5 pro withholds none while 2.5 flash keeps it", () => {
  const withoutNone = {
    supportedReasoningEfforts: ["low", "medium", "high"],
    serviceTiers: GEMINI_SERVICE_TIERS,
  };
  expectClaudeDeclaration(lookupModelKnowledge("gemini-2.5-pro"), withoutNone);
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-2.5-pro-preview"), withoutNone);
  const withNone = {
    supportedReasoningEfforts: ["none", "low", "medium", "high"],
    serviceTiers: GEMINI_SERVICE_TIERS,
  };
  expectClaudeDeclaration(lookupModelKnowledge("gemini-2.5-flash"), withNone);
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-2.5-flash-lite"), withNone);
  assert.equal(lookupModelKnowledge("google/imagen-4"), undefined);
});

test("gemini 3+ flash accepts minimal except 3.7/3.8 (record order priority)", () => {
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-3.5-flash"), {
    supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
    serviceTiers: GEMINI_SERVICE_TIERS,
  });
  expectClaudeDeclaration(lookupModelKnowledge("gemini-4-flash"), {
    supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
    serviceTiers: GEMINI_SERVICE_TIERS,
  });
  const levelOnly = {
    supportedReasoningEfforts: ["low", "medium", "high"],
    serviceTiers: GEMINI_SERVICE_TIERS,
  };
  expectClaudeDeclaration(lookupModelKnowledge("gemini-3.7-flash-lite"), levelOnly);
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-3.8-flash-batch"), levelOnly);
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-3.1-pro-preview"), levelOnly);
  expectClaudeDeclaration(lookupModelKnowledge("google/gemini-4-argon"), levelOnly);
});

test("muse spark 1.3 has max while 1.3-contributor and earlier sparks omit it", () => {
  const withMax = { supportedReasoningEfforts: MUSE_EFFORTS_WITH_MAX };
  const base = { supportedReasoningEfforts: MUSE_BASE_EFFORTS };
  expectClaudeDeclaration(lookupModelKnowledge("muse-spark-1.3"), withMax);
  expectClaudeDeclaration(lookupModelKnowledge("meta/muse-spark-1.3"), withMax);
  expectClaudeDeclaration(lookupModelKnowledge("muse-spark-2"), withMax);
  expectClaudeDeclaration(lookupModelKnowledge("muse-spark-1.3-contributor"), base);
  expectClaudeDeclaration(lookupModelKnowledge("meta-ai/muse-spark-1.3-contributor-preview"), base);
  expectClaudeDeclaration(lookupModelKnowledge("muse-spark-1.2"), base);
  expectClaudeDeclaration(lookupModelKnowledge("muse-spark-1.2-contributor"), base);
  assert.equal(lookupModelKnowledge("meta/llama-4-scout"), undefined);
});

test("muse wonder always has max, including contributor builds", () => {
  const withMax = { supportedReasoningEfforts: MUSE_EFFORTS_WITH_MAX };
  expectClaudeDeclaration(lookupModelKnowledge("muse-wonder-1.0"), withMax);
  expectClaudeDeclaration(lookupModelKnowledge("meta/muse-wonder-1.0"), withMax);
  expectClaudeDeclaration(lookupModelKnowledge("muse-wonder-1.0-contributor"), withMax);
});

test("kimi k3 and k3.1 pro are thinking-only with fixed low/high/max efforts", () => {
  const expected = {
    supportedReasoningEfforts: ["low", "high", "max"],
    supportsThinkingType: "only",
  };
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k3"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("moonshotai/kimi-k3"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k3.1-pro"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k3.1-pro-highspeed"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("moonshotai/kimi-k3.1-pro-highspeed"), expected);
});

test("kimi k2.5/k2.6 support the switch; k2.7-code and unknown versions use specific defaults", () => {
  const switchDeclaration = {
    supportsThinkingSwitch: true,
    thinkingSwitch: thinkingTypeSwitchWithGateway("moonshotai"),
  };
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k2.5"), switchDeclaration);
  expectClaudeDeclaration(lookupModelKnowledge("moonshotai/kimi-k2.6"), switchDeclaration);
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k2.7-code"), {});
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k2.7-code-highspeed"), {});

  const unknownVersionDefault = {
    supportedReasoningEfforts: ["low", "high", "max"],
    supportsThinkingType: "only",
  };
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k2.7"), unknownVersionDefault);
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k2.8-preview"), unknownVersionDefault);
  expectClaudeDeclaration(lookupModelKnowledge("kimi-k4"), unknownVersionDefault);
  assert.equal(lookupModelKnowledge("kimi-k2"), undefined);
  assert.equal(lookupModelKnowledge("moonshot-v1-8k"), undefined);
});

test("deepseek v4 is a thinking switch with high/max efforts; r1/reasoner are thinking-only", () => {
  const v4 = {
    supportedReasoningEfforts: ["high", "max"],
    supportsThinkingSwitch: true,
    thinkingSwitch: thinkingTypeSwitchWithGateway("deepseek"),
  };
  expectClaudeDeclaration(lookupModelKnowledge("deepseek-v4-pro"), v4);
  expectClaudeDeclaration(lookupModelKnowledge("deepseek/deepseek-v4-flash-vision-exp"), v4);
  expectClaudeDeclaration(lookupModelKnowledge("deepseek-r1"), { supportsThinkingType: "only" });
  expectClaudeDeclaration(lookupModelKnowledge("deepseek-reasoner"), {
    supportsThinkingType: "only",
  });
  assert.equal(lookupModelKnowledge("deepseek-chat"), undefined);
  assert.equal(lookupModelKnowledge("deepseek-v3.2"), undefined);
});

test("bedrock deepseek.r1 ids are thinking-only with the budgetTokens effort ladder", () => {
  const expected = {
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsThinkingType: "only",
  };
  expectClaudeDeclaration(lookupModelKnowledge("deepseek.r1-v1:0"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("us.deepseek.r1-v1:0"), expected);
});

test("minimax m2.5/m2.7 are thinking-only; m3 supports the switch", () => {
  expectClaudeDeclaration(lookupModelKnowledge("minimax-m2.5"), { supportsThinkingType: "only" });
  expectClaudeDeclaration(lookupModelKnowledge("minimax-m2.7"), { supportsThinkingType: "only" });
  const m3 = {
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: {
        body: { thinking: { type: "adaptive" } },
        providerOptions: { minimax: { thinking: { type: "adaptive" } } },
      },
      off: {
        body: { thinking: { type: "disabled" } },
        providerOptions: { minimax: { thinking: { type: "disabled" } } },
      },
    },
  };
  expectClaudeDeclaration(lookupModelKnowledge("minimax/MiniMax-M3"), m3);
  expectClaudeDeclaration(lookupModelKnowledge("minimax/minimax-m3"), m3);
});

test("glm-4.5+ supports the thinking switch; glm-4 does not", () => {
  const expected = {
    supportsThinkingSwitch: true,
    thinkingSwitch: thinkingTypeSwitchWithGateway("zai"),
  };
  expectClaudeDeclaration(lookupModelKnowledge("glm-4.5"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("zai/glm-4.7"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("glm-5.2"), expected);
  assert.equal(lookupModelKnowledge("glm-4"), undefined);
});

test("mimo v-series supports the thinking switch except mimo-v2-flash", () => {
  const expected = { supportsThinkingSwitch: true, thinkingSwitch: THINKING_TYPE_SWITCH };
  expectClaudeDeclaration(lookupModelKnowledge("mimo-v2.5"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("xiaomi/mimo-v2.5-pro"), expected);
  assert.equal(lookupModelKnowledge("mimo-v2-flash"), undefined);
  assert.equal(lookupModelKnowledge("mimo-v2-flash-8b"), undefined);
});

test("grok models declare the default/priority tier ladder", () => {
  const expected = { serviceTiers: ["default", "priority"] };
  expectClaudeDeclaration(lookupModelKnowledge("grok-4.3"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("x-ai/grok-4.20-reasoning"), expected);
  expectClaudeDeclaration(lookupModelKnowledge("spacexai/grok-4.5"), expected);
});

test("unknown models produce no declarations (safe default)", () => {
  assert.equal(lookupModelKnowledge("qwen3.8-max"), undefined);
  assert.equal(lookupModelKnowledge("gpt-5.5-codex"), undefined);
  assert.equal(lookupModelKnowledge("my-lab-llm"), undefined);
});
