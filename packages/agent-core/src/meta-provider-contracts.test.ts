import assert from "node:assert/strict";

import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "./llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./openai/ai-sdk-transport.js";
import { AiSdkOpenResponsesTransport } from "./open-responses/ai-sdk-transport.js";
import { AiSdkAnthropicTransport } from "./anthropic/ai-sdk-transport.js";
import type { JsonObject } from "./ports.js";

const schema: JsonObject = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

const completionRequest = {
  userPrompt: "Return a structured answer.",
  schemaName: "answer",
  schema,
  includeToolAgentHostPrompt: false,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Meta Chat sends reasoning_effort and no hosted search tool", async () => {
  let body: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    assert.equal(String(input), "https://meta.test/v1/chat/completions");
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "chat_meta",
      object: "chat.completion",
      created: 1,
      model: "muse-spark-1.3-contributor",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"answer":"ok"}' },
          finish_reason: "stop",
        },
      ],
    });
  });
  try {
    const result = await new AiSdkOpenAiCompatibleTransport().createJsonSchemaCompletion(
      {
        transportKind: "openai-compatible",
        apiKey: "test-key",
        model: "muse-spark-1.3-contributor",
        baseUrl: "https://meta.test/v1",
        sdk: "@ai-sdk/openai-compatible",
        reasoningEffort: "xhigh",
        providerTools: [],
        options: { chatMediaValidation: true },
      },
      completionRequest,
    );
    assert.deepEqual(result.output, { answer: "ok" });
    assert.equal(body?.reasoning_effort, "xhigh");
    assert.equal(body?.tools, undefined);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Meta Messages sends the native output effort on the local loopback contract", async () => {
  let body: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    assert.equal(String(input), "https://meta.test/v1/messages");
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      id: "msg_meta",
      type: "message",
      role: "assistant",
      model: "muse-spark-1.3",
      content: [{ type: "tool_use", id: "toolu_meta", name: "json", input: { answer: "ok" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  try {
    const result = await new AiSdkAnthropicTransport().createJsonSchemaCompletion(
      {
        transportKind: "anthropic",
        apiKey: "test-key",
        model: "muse-spark-1.3",
        baseUrl: "https://meta.test/v1",
        sdk: "@ai-sdk/anthropic",
        effortSemantics: "output",
        effort: "xhigh",
      },
      completionRequest,
    );
    assert.deepEqual(result.output, { answer: "ok" });
    assert.deepEqual(body?.output_config, { effort: "xhigh" });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Meta Messages rejects audio and PDF parts instead of silently dropping them", () => {
  const transport = new AiSdkAnthropicTransport();
  for (const type of ["audio", "document"] as const) {
    assert.throws(
      () =>
        transport.llmHistoryAsApiMessages([
          { role: "user", content: [{ type, path: type === "audio" ? "voice.mp3" : "paper.pdf" }] },
        ]),
      /require a Responses connection with file upload support/,
    );
  }
});

test("Meta Responses surfaces ZDR file-upload rejection without hiding the upstream reason", async () => {
  setLlmFetchTransportOverrideForTests(async () =>
    jsonResponse(
      {
        error: {
          message: "Zero data retention does not support file uploads.",
          type: "invalid_request_error",
        },
      },
      400,
    ),
  );
  try {
    await assert.rejects(
      new AiSdkOpenResponsesTransport().createJsonSchemaCompletion(
        {
          transportKind: "open-responses",
          apiKey: "test-key",
          model: "muse-spark-1.3",
          baseUrl: "https://meta.test/v1",
          sdk: "@ai-sdk/openai",
          store: false,
          options: { responsesFileUpload: true, reasoningSummary: true },
          fileUpload: {
            path: "/files",
            purpose: "user_data",
            refTemplate: "{id}",
          },
        },
        completionRequest,
      ),
      /Zero data retention does not support file uploads/,
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
