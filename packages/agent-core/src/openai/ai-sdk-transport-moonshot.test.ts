import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

test("Moonshot official provider fetch sends kimi-k3 reasoning_effort without thinking", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBodies.push(body);
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "kimi-k3",
        baseUrl: "https://api.moonshot.cn/v1",
        sdk: "@ai-sdk/moonshotai",
        reasoningEffort: "max",
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hi" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    const chatCompletionBody = capturedBodies.at(-1);
    assert.ok(chatCompletionBody);
    assert.equal(chatCompletionBody.reasoning_effort, "max");
    assert.equal(chatCompletionBody.thinking, undefined);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Moonshot official provider fetch sends native video_url and reasoning_effort", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBodies.push(body);
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "kimi-k2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        sdk: "@ai-sdk/moonshotai",
        reasoningEffort: "low",
        workspaceRoot: process.cwd(),
        modelCapabilities: { videoInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe the video" },
              { type: "video_url", video_url: { url: "ms://file-abc" } },
            ],
          },
        ],
        steps: 0,
      },
      [],
    );

    assert.equal(result.kind, "success");
    const chatCompletionBody = capturedBodies.find(
      (body) => Array.isArray(body.messages) && JSON.stringify(body.messages).includes("video_url"),
    );
    assert.ok(chatCompletionBody);
    assert.equal(chatCompletionBody.reasoning_effort, "low");
    const messages = chatCompletionBody.messages as Array<{
      content: Array<{ type: string; video_url?: { url: string } }>;
    }>;
    const videoPart = messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === "video_url");
    assert.equal(videoPart?.video_url?.url, "ms://file-abc");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Moonshot transport uses the declared sdk adapter and its base URL", async () => {
  let capturedUrl = "";
  setLlmFetchTransportOverrideForTests(async (input) => {
    capturedUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : "request";
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "kimi-k2.5",
        baseUrl: "https://api.moonshot.cn/v1",
        sdk: "@ai-sdk/moonshotai",
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hi" }], steps: 0 },
      [],
    );

    assert.equal(result.kind, "success");
    assert.match(capturedUrl, /api\.moonshot\.cn\/v1/);
    const trace = result.kind === "success" ? result.result.requestTrace[0] : undefined;
    assert.equal(
      trace && typeof trace === "object" && !Array.isArray(trace) ? trace.kind : undefined,
      "openai_sdk_chat_completions",
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("Moonshot code-completion profile merges the declared thinking off patch without reasoning_effort", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: '{"ok":true}',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const config = applyCodeCompletionTransportProfile({
      apiKey: "test-key",
      model: "kimi-k2.5",
      baseUrl: "https://api.moonshot.cn/v1",
      sdk: "@ai-sdk/moonshotai",
      reasoningEffort: "high",
      supportsThinkingSwitch: true,
      thinkingSwitch: {
        on: { body: { thinking: { type: "enabled" } } },
        off: { body: { thinking: { type: "disabled" } } },
      },
      workspaceRoot: process.cwd(),
    }) as import("./openai-compat.js").OpenAiTransportConfig;

    await transport.createJsonSchemaCompletion(config, {
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      schemaName: "test",
      userPrompt: "reply",
    });

    assert.deepEqual(capturedBody?.thinking, { type: "disabled" });
    assert.equal(capturedBody?.reasoning_effort, undefined);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
