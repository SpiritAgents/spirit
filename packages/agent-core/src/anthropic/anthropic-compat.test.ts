import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildAnthropicProviderOptions,
  resolveAnthropicThinkingConfig,
} from "./anthropic-compat.js";

test("resolveAnthropicThinkingConfig sends nothing by default (upstream default applies)", () => {
  assert.equal(resolveAnthropicThinkingConfig({}), undefined);
});

test("resolveAnthropicThinkingConfig disables thinking for the code-completion profile", () => {
  assert.deepEqual(resolveAnthropicThinkingConfig({ transportRequestProfile: "code-completion" }), {
    type: "disabled",
  });
});

test("resolveAnthropicThinkingConfig encodes the user-off state as the protocol disabled", () => {
  assert.deepEqual(resolveAnthropicThinkingConfig({ vendorExtendedThinking: false }), {
    type: "disabled",
  });
});

test("buildAnthropicProviderOptions emits disabled thinking for the code-completion profile", () => {
  assert.deepEqual(buildAnthropicProviderOptions({ transportRequestProfile: "code-completion" }), {
    anthropic: {
      thinking: { type: "disabled" },
      toolStreaming: true,
    },
  });
});

test("buildAnthropicProviderOptions omits thinking by default", () => {
  assert.deepEqual(buildAnthropicProviderOptions({}), {
    anthropic: {
      toolStreaming: true,
    },
  });
});

test("buildAnthropicProviderOptions passes the declared effort through verbatim", () => {
  assert.deepEqual(buildAnthropicProviderOptions({ effort: "high" }), {
    anthropic: {
      effort: "high",
      toolStreaming: true,
    },
  });
});

test("buildAnthropicProviderOptions maps the fast tier onto the native speed parameter", () => {
  const options = buildAnthropicProviderOptions({ serviceTier: "fast" });
  assert.equal(options.anthropic?.speed, "fast");
});

test("buildAnthropicProviderOptions passes through protocol options", () => {
  assert.deepEqual(
    buildAnthropicProviderOptions({
      sendReasoning: false,
      disableParallelToolUse: true,
      structuredOutputMode: "jsonTool",
    }),
    {
      anthropic: {
        toolStreaming: true,
        sendReasoning: false,
        disableParallelToolUse: true,
        structuredOutputMode: "jsonTool",
      },
    },
  );
});
