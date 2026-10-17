import assert from "node:assert/strict";
import { test } from "vitest";

import { createResponsesStoredStateAwareFetch } from "./responses-stored-state-fetch.js";
import { runWithResponsesStoredStateRequestContext } from "./responses-incremental-input.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

// Generic Open Responses endpoints opt into server-side stored state via `options.storedState`.
const alibabaResponsesConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test-key",
  model: "qwen3-max",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  options: { storedState: true },
};

// The Ark input-item status patch is a legacy quirk still keyed on the legacy vendor field; the
// stored-state injection it rides on is declared via `options.storedState`.
const volcengineResponsesConfig: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test-key",
  model: "doubao-seed-1-8-251228",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  llmVendor: "volcengine",
  options: { storedState: true },
};

test("volcengine responses fetch injects completed status on input items", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  const fetch = createResponsesStoredStateAwareFetch(volcengineResponsesConfig, baseFetch);
  await fetch("https://example.com/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: volcengineResponsesConfig.model,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "ok",
        },
      ],
    }),
  });

  const input = capturedBody?.input as Array<Record<string, unknown>>;
  assert.equal(input[0]?.status, "completed");
  assert.equal(input[1]?.status, "completed");
});

for (const [label, config] of [
  ["alibaba", alibabaResponsesConfig],
  ["volcengine", volcengineResponsesConfig],
] as const) {
  test(`${label} responses fetch injects store and previous_response_id`, async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const baseFetch: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response("{}", { status: 200 });
    };

    const fetch = createResponsesStoredStateAwareFetch(config, baseFetch);
    await runWithResponsesStoredStateRequestContext(`resp_${label}_prev`, async () => {
      await fetch("https://example.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({
          model: config.model,
          input: [{ role: "user", content: "hi" }],
        }),
      });
    });

    assert.equal(capturedBody?.store, true);
    assert.equal(capturedBody?.previous_response_id, `resp_${label}_prev`);
  });
}
