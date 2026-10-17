import assert from "node:assert/strict";
import { test } from "vitest";

import { lookupModelKnowledge, MODEL_KNOWLEDGE_SOURCES } from "./records.js";

const CLAUDE_5_FULL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GPT56_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const GPT56_MODES = ["standard", "pro"];
const MUSE_BASE_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
const ANTHROPIC_OFF_DISABLED = { body: { thinking: { type: "disabled" } } };
const THINKING_TYPE_SWITCH = {
  on: { body: { thinking: { type: "enabled" } } },
  off: ANTHROPIC_OFF_DISABLED,
};
const MUSE_EFFORTS_WITH_MAX = [...MUSE_BASE_EFFORTS, "max"];

test("registry bundles every family file in deterministic alphabetical order", () => {
  assert.deepEqual(
    MODEL_KNOWLEDGE_SOURCES.map((entry) => entry.source),
    [
      "anthropic-claude.json",
      "deepseek.json",
      "google-gemini.json",
      "meta-muse.json",
      "minimax.json",
      "moonshot-kimi.json",
      "openai-gpt.json",
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

test("claude opus 5.x resolves adaptive thinking with full efforts across id forms", () => {
  const opus5 = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive", display: "summarized" } } },
      off: ANTHROPIC_OFF_DISABLED,
    },
  };
  assert.deepEqual(lookupModelKnowledge("claude-opus-5.5"), opus5);
  assert.deepEqual(lookupModelKnowledge("anthropic/claude-opus-5.5"), opus5);
  assert.deepEqual(lookupModelKnowledge("anthropic.claude-opus-5-5-v1"), opus5);
  assert.deepEqual(lookupModelKnowledge("claude-sonnet-5"), {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: ANTHROPIC_OFF_DISABLED,
    },
  });
});

test("claude fable/mythos 5 are always-on thinking without a switch", () => {
  // Always-on: only the on encoding is declared (adaptive + summarized display).
  const expected = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    supportsThinkingType: "only",
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive", display: "summarized" } } },
    },
  };
  assert.deepEqual(lookupModelKnowledge("claude-fable-5"), expected);
  assert.deepEqual(lookupModelKnowledge("anthropic/claude-mythos-5"), expected);
});

test("claude opus 4.8/4.7 beat the legacy opus-4 record (record order priority)", () => {
  const expected = {
    supportedReasoningEfforts: CLAUDE_5_FULL_EFFORTS,
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive", display: "summarized" } } },
      off: ANTHROPIC_OFF_DISABLED,
    },
  };
  assert.deepEqual(lookupModelKnowledge("claude-opus-4.8"), expected);
  assert.deepEqual(lookupModelKnowledge("claude-opus-4-7"), expected);
});

test("claude 4.6 adaptive families expose their reduced effort ladders", () => {
  const adaptive = {
    on: { body: { thinking: { type: "adaptive" } } },
    off: ANTHROPIC_OFF_DISABLED,
  };
  assert.deepEqual(lookupModelKnowledge("claude-opus-4.6"), {
    supportedReasoningEfforts: ["low", "medium", "high", "max"],
    supportsThinkingSwitch: true,
    thinkingSwitch: adaptive,
  });
  assert.deepEqual(lookupModelKnowledge("anthropic/claude-sonnet-4.6"), {
    supportedReasoningEfforts: ["low", "medium", "high"],
    supportsThinkingSwitch: true,
    thinkingSwitch: adaptive,
  });
});

test("legacy claude models are budget thinking: switch without effort levels", () => {
  const expected = {
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "enabled", budget_tokens: 12000 } } },
      off: ANTHROPIC_OFF_DISABLED,
    },
  };
  for (const model of [
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-haiku-4.5",
    "claude-opus-4-1",
    "claude-opus-4",
    "claude-sonnet-4",
  ]) {
    assert.deepEqual(lookupModelKnowledge(model), expected, model);
  }
});

test("gpt-5.6+ exposes the extended effort ladder and pro mode; gpt-5.5 does not", () => {
  const expected = {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
  };
  assert.deepEqual(lookupModelKnowledge("gpt-5.6-sol"), expected);
  assert.deepEqual(lookupModelKnowledge("openai/gpt-5.6-terra"), expected);
  assert.deepEqual(lookupModelKnowledge("gpt-6"), expected);
  assert.equal(lookupModelKnowledge("gpt-5.5"), undefined);
  assert.equal(lookupModelKnowledge("gpt-5.4"), undefined);
});

test("gpt-6-astra rejects none and offers ultrafast; gpt-6.1-sol keeps none", () => {
  assert.deepEqual(lookupModelKnowledge("gpt-6-astra"), {
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
  });
  assert.deepEqual(lookupModelKnowledge("openai/gpt-6.1-sol"), {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
    serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
  });
});

test("bedrock mantle gpt ids hit the generic gpt-5.6+ record without astra/ultrafast specifics", () => {
  assert.deepEqual(lookupModelKnowledge("openai.gpt-6-astra"), {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
  });
  assert.deepEqual(lookupModelKnowledge("openai.gpt-5.6"), {
    supportedReasoningEfforts: GPT56_EFFORTS,
    supportedReasoningModes: GPT56_MODES,
  });
});

test("gemini 2.5 pro withholds none while 2.5 flash keeps it", () => {
  const withoutNone = { supportedReasoningEfforts: ["low", "medium", "high"] };
  assert.deepEqual(lookupModelKnowledge("gemini-2.5-pro"), withoutNone);
  assert.deepEqual(lookupModelKnowledge("google/gemini-2.5-pro-preview"), withoutNone);
  const withNone = { supportedReasoningEfforts: ["none", "low", "medium", "high"] };
  assert.deepEqual(lookupModelKnowledge("gemini-2.5-flash"), withNone);
  assert.deepEqual(lookupModelKnowledge("google/gemini-2.5-flash-lite"), withNone);
  assert.equal(lookupModelKnowledge("google/imagen-4"), undefined);
});

test("gemini 3+ flash accepts minimal except 3.7/3.8 (record order priority)", () => {
  assert.deepEqual(lookupModelKnowledge("google/gemini-3.5-flash"), {
    supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
  });
  assert.deepEqual(lookupModelKnowledge("gemini-4-flash"), {
    supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
  });
  const levelOnly = { supportedReasoningEfforts: ["low", "medium", "high"] };
  assert.deepEqual(lookupModelKnowledge("gemini-3.7-flash-lite"), levelOnly);
  assert.deepEqual(lookupModelKnowledge("google/gemini-3.8-flash-batch"), levelOnly);
  assert.deepEqual(lookupModelKnowledge("google/gemini-3.1-pro-preview"), levelOnly);
  assert.deepEqual(lookupModelKnowledge("google/gemini-4-argon"), levelOnly);
});

test("muse spark 1.3 has max while 1.3-contributor and earlier sparks omit it", () => {
  const withMax = { supportedReasoningEfforts: MUSE_EFFORTS_WITH_MAX };
  const base = { supportedReasoningEfforts: MUSE_BASE_EFFORTS };
  assert.deepEqual(lookupModelKnowledge("muse-spark-1.3"), withMax);
  assert.deepEqual(lookupModelKnowledge("meta/muse-spark-1.3"), withMax);
  assert.deepEqual(lookupModelKnowledge("muse-spark-2"), withMax);
  assert.deepEqual(lookupModelKnowledge("muse-spark-1.3-contributor"), base);
  assert.deepEqual(lookupModelKnowledge("meta-ai/muse-spark-1.3-contributor-preview"), base);
  assert.deepEqual(lookupModelKnowledge("muse-spark-1.2"), base);
  assert.deepEqual(lookupModelKnowledge("muse-spark-1.2-contributor"), base);
  assert.equal(lookupModelKnowledge("meta/llama-4-scout"), undefined);
});

test("muse wonder always has max, including contributor builds", () => {
  const withMax = { supportedReasoningEfforts: MUSE_EFFORTS_WITH_MAX };
  assert.deepEqual(lookupModelKnowledge("muse-wonder-1.0"), withMax);
  assert.deepEqual(lookupModelKnowledge("meta/muse-wonder-1.0"), withMax);
  assert.deepEqual(lookupModelKnowledge("muse-wonder-1.0-contributor"), withMax);
});

test("kimi k3 is thinking-only with fixed low/high/max efforts", () => {
  const expected = {
    supportedReasoningEfforts: ["low", "high", "max"],
    supportsThinkingType: "only",
  };
  assert.deepEqual(lookupModelKnowledge("kimi-k3"), expected);
  assert.deepEqual(lookupModelKnowledge("moonshotai/kimi-k3"), expected);
});

test("kimi k2.5+ supports the thinking switch; k2.7-code shadows to an empty declare", () => {
  const expected = { supportsThinkingSwitch: true, thinkingSwitch: THINKING_TYPE_SWITCH };
  assert.deepEqual(lookupModelKnowledge("kimi-k2.5"), expected);
  assert.deepEqual(lookupModelKnowledge("moonshotai/kimi-k2.6"), expected);
  assert.deepEqual(lookupModelKnowledge("kimi-k2.7"), expected);
  assert.deepEqual(lookupModelKnowledge("kimi-k2.7-code"), {});
  assert.deepEqual(lookupModelKnowledge("kimi-k2.7-code-highspeed"), {});
  assert.equal(lookupModelKnowledge("kimi-k2"), undefined);
  assert.equal(lookupModelKnowledge("moonshot-v1-8k"), undefined);
});

test("deepseek v4 is a thinking switch with high/max efforts; r1/reasoner are thinking-only", () => {
  const v4 = {
    supportedReasoningEfforts: ["high", "max"],
    supportsThinkingSwitch: true,
    thinkingSwitch: THINKING_TYPE_SWITCH,
  };
  assert.deepEqual(lookupModelKnowledge("deepseek-v4-pro"), v4);
  assert.deepEqual(lookupModelKnowledge("deepseek/deepseek-v4-flash-vision-exp"), v4);
  assert.deepEqual(lookupModelKnowledge("deepseek-r1"), { supportsThinkingType: "only" });
  assert.deepEqual(lookupModelKnowledge("deepseek-reasoner"), { supportsThinkingType: "only" });
  assert.equal(lookupModelKnowledge("deepseek-chat"), undefined);
  assert.equal(lookupModelKnowledge("deepseek-v3.2"), undefined);
});

test("minimax m2.5/m2.7 are thinking-only; m3 supports the switch", () => {
  assert.deepEqual(lookupModelKnowledge("minimax-m2.5"), { supportsThinkingType: "only" });
  assert.deepEqual(lookupModelKnowledge("minimax-m2.7"), { supportsThinkingType: "only" });
  const m3 = {
    supportsThinkingSwitch: true,
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: ANTHROPIC_OFF_DISABLED,
    },
  };
  assert.deepEqual(lookupModelKnowledge("minimax/MiniMax-M3"), m3);
  assert.deepEqual(lookupModelKnowledge("minimax/minimax-m3"), m3);
});

test("glm-4.5+ supports the thinking switch; glm-4 does not", () => {
  const expected = { supportsThinkingSwitch: true, thinkingSwitch: THINKING_TYPE_SWITCH };
  assert.deepEqual(lookupModelKnowledge("glm-4.5"), expected);
  assert.deepEqual(lookupModelKnowledge("zai/glm-4.7"), expected);
  assert.deepEqual(lookupModelKnowledge("glm-5.2"), expected);
  assert.equal(lookupModelKnowledge("glm-4"), undefined);
});

test("mimo v-series supports the thinking switch except mimo-v2-flash", () => {
  const expected = { supportsThinkingSwitch: true, thinkingSwitch: THINKING_TYPE_SWITCH };
  assert.deepEqual(lookupModelKnowledge("mimo-v2.5"), expected);
  assert.deepEqual(lookupModelKnowledge("xiaomi/mimo-v2.5-pro"), expected);
  assert.equal(lookupModelKnowledge("mimo-v2-flash"), undefined);
  assert.equal(lookupModelKnowledge("mimo-v2-flash-8b"), undefined);
});

test("unknown models produce no declarations (safe default)", () => {
  assert.equal(lookupModelKnowledge("qwen3.8-max"), undefined);
  assert.equal(lookupModelKnowledge("gpt-5.5"), undefined);
  assert.equal(lookupModelKnowledge("my-lab-llm"), undefined);
});
