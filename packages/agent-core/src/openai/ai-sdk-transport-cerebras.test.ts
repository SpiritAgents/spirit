import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { JsonValue } from "../ports.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";
import { llmMessageToOpenAiMessage } from "./openai-multimodal-messages.js";

const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function runCerebrasChatRound(
  overrides: Partial<OpenAiTransportConfig> = {},
  requestOptions: {
    messages?: JsonValue[];
    fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response | undefined>;
  } = {},
) {
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  setLlmFetchTransportOverrideForTests(async (fetchInput, init) => {
    captured.push({
      url:
        typeof fetchInput === "string"
          ? fetchInput
          : fetchInput instanceof URL
            ? fetchInput.toString()
            : fetchInput.url,
      ...(init !== undefined ? { init } : {}),
    });
    const customResponse = await requestOptions.fetchImpl?.(fetchInput, init);
    if (customResponse !== undefined) {
      return customResponse;
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const result = await new AiSdkOpenAiCompatibleTransport().startToolAgentRound(
      {
        apiKey: "test-key",
        model: "gpt-oss-120b",
        baseUrl: "https://api.cerebras.ai/v1",
        sdk: "@ai-sdk/cerebras",
        workspaceRoot: process.cwd(),
        ...overrides,
      },
      { messages: requestOptions.messages ?? [{ role: "user", content: "hello" }], steps: 0 },
      [],
    );
    assert.equal(result.kind, "success");
    const request = [...captured].reverse().find((entry) => entry.init?.body !== undefined);
    const body = JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
    return { captured, body };
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

test("Cerebras uses the official SDK chat endpoint and request serialization", async () => {
  const { captured, body } = await runCerebrasChatRound({
    outputLimit: 1024,
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, "https://api.cerebras.ai/v1/chat/completions");
  assert.equal(body.model, "gpt-oss-120b");
  assert.equal(body.max_completion_tokens, 1024);
  assert.equal("max_tokens" in body, false);
  assert.equal("reasoning_effort" in body, false);
  const headers = new Headers(captured[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-key");
});

test("Cerebras Qwen Thinking off sends reasoning_effort none", async () => {
  const { body } = await runCerebrasChatRound({
    model: "qwen-3.8-27b",
    supportsThinkingSwitch: true,
    vendorExtendedThinking: false,
    thinkingSwitch: { off: { body: { reasoning_effort: "none" } } },
  });
  assert.equal(body.reasoning_effort, "none");
});

test("Cerebras Qwen Thinking on leaves the provider default unchanged", async () => {
  const { body } = await runCerebrasChatRound({
    model: "qwen-3.8-27b",
    supportsThinkingSwitch: true,
    vendorExtendedThinking: true,
    thinkingSwitch: { off: { body: { reasoning_effort: "none" } } },
  });
  assert.equal("reasoning_effort" in body, false);
});

test("Cerebras local images remain base64 data URLs through the official SDK", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-cerebras-image-"));
  try {
    const imagePath = join(workspaceRoot, "pixel.png");
    await writeFile(imagePath, MINIMAL_PNG);
    const converted = llmMessageToOpenAiMessage(
      {
        role: "user",
        content: [
          { type: "text", text: "describe the image" },
          { type: "image", path: imagePath },
        ],
      },
      workspaceRoot,
    );
    const { body } = await runCerebrasChatRound(
      {
        model: "qwen-3.8-27b",
        modelCapabilities: { imageInput: true },
        options: { inlineImageInput: true },
        workspaceRoot,
      },
      { messages: [converted] },
    );
    const wire = JSON.stringify(body);
    assert.match(wire, /data:image\/png;base64,/);
    assert.equal(wire.includes("file_id"), false);
    assert.equal(wire.includes("file://"), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Cerebras downloads supported remote images and sends only base64 upstream", async () => {
  const remoteUrl = "https://images.example.test/pixel.png";
  const { captured, body } = await runCerebrasChatRound(
    {
      model: "qwen-3.8-27b",
      modelCapabilities: { imageInput: true },
      options: { inlineImageInput: true },
    },
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe the image" },
            { type: "image_url", image_url: { url: remoteUrl } },
          ],
        },
      ],
      fetchImpl: async (input) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === remoteUrl) {
          return new Response(MINIMAL_PNG, {
            status: 200,
            headers: { "Content-Type": "image/png" },
          });
        }
        return undefined;
      },
    },
  );
  assert.equal(captured[0]?.url, remoteUrl);
  const wire = JSON.stringify(body);
  assert.equal(wire.includes(`data:image/png;base64,${MINIMAL_PNG.toString("base64")}`), true);
  assert.equal(wire.includes(remoteUrl), false);
  assert.equal(wire.includes("file_id"), false);
});

test("Cerebras rejects file-id image inputs before any upstream request", async () => {
  await assert.rejects(
    runCerebrasChatRound(
      {
        model: "qwen-3.8-27b",
        modelCapabilities: { imageInput: true },
        options: { inlineImageInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { file_id: "file-redacted" } }],
          },
        ],
      },
    ),
    /file IDs are not supported/,
  );
});

test("Cerebras capability trimming never sends video input", async () => {
  const { body } = await runCerebrasChatRound(
    {
      model: "qwen-3.8-27b",
      modelCapabilities: { imageInput: true },
      options: { inlineImageInput: true },
    },
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe the supported image" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
            {
              type: "video_url",
              video_url: { url: "https://media.example.test/clip.mp4" },
            },
          ],
        },
      ],
    },
  );
  const wire = JSON.stringify(body);
  assert.equal(wire.includes("image_url"), true);
  assert.equal(wire.includes("video_url"), false);
  assert.equal(wire.includes("clip.mp4"), false);
});
