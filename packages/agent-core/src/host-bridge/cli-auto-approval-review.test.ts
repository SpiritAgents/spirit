import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { OpenAiTransportConfig } from "../openai/openai-compat.js";
import { createCliAutoApprovalReviewer } from "./cli-auto-approval-review.js";

test("CLI auto approval review uses the supplied config provider id", async () => {
  const config: OpenAiTransportConfig = {
    apiKey: "test-key",
    model: "kimi-k3",
    baseUrl: "https://api.moonshot.cn/v1",
    sdk: "@ai-sdk/moonshotai",
    workspaceRoot: process.cwd(),
  };
  const requestBodies: Array<Record<string, unknown>> = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"allow":true,"reason":"safe"}',
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const review = createCliAutoApprovalReviewer(config, "moonshot-ai");
    const result = await review({
      toolName: "shell",
      argumentsJson: '{"command":"echo hi"}',
      hostApprovalContext: {
        kind: "tool",
        request: { kind: "shell", command: "echo hi", terminal: "zsh" },
      },
    });
    assert.deepEqual(result, { allow: true, reason: "safe" });
    const messages = requestBodies[0]?.messages;
    assert.ok(messages);
    const serializedMessages = JSON.stringify(messages);
    assert.match(serializedMessages, /The user's model is kimi-k3 from moonshot-ai\./);
    assert.doesNotMatch(serializedMessages, /@ai-sdk\/moonshotai/);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
