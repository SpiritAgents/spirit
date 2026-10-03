import { product } from "@spiritagent/product";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { clearMoonshotChatCompletionMessages } from "./moonshot-chat-completion-messages.js";
import { applyCodeCompletionTransportProfile } from "../code-completion/transport-profile.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

async function runDeepInfraChatRound(
  overrides: Partial<OpenAiTransportConfig> = {},
): Promise<CapturedRequest[]> {
  const captured: CapturedRequest[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    captured.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
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
        model: "acme/chat-model",
        llmVendor: "deepinfra",
        workspaceRoot: process.cwd(),
        ...overrides,
      },
      { messages: [{ role: "user", content: "ping" }], steps: 0 },
      [],
    );
    assert.equal(result.kind, "success");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
  return captured;
}

test("DeepInfra transport strips the connect /openai suffix for the SDK baseURL", async () => {
  const captured = await runDeepInfraChatRound({ baseUrl: "https://api.deepinfra.com/v1/openai" });
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, "https://api.deepinfra.com/v1/openai/chat/completions");
});

test("DeepInfra transport appends /openai for custom base roots without the suffix", async () => {
  const captured = await runDeepInfraChatRound({ baseUrl: "http://127.0.0.1:18080/v1" });
  assert.equal(captured[0]?.url, "http://127.0.0.1:18080/v1/openai/chat/completions");
});

test("DeepInfra transport falls back to the official base URL when baseUrl is missing", async () => {
  const captured = await runDeepInfraChatRound();
  assert.equal(captured[0]?.url, "https://api.deepinfra.com/v1/openai/chat/completions");
});

test("DeepInfra transport injects flat reasoning_effort into chat completions", async () => {
  const captured = await runDeepInfraChatRound({
    baseUrl: "https://api.deepinfra.com/v1/openai",
    reasoningEffort: "low",
  });
  assert.equal(captured[0]?.body.reasoning_effort, "low");
});

test("DeepInfra transport omits reasoning_effort when effort is default", async () => {
  const captured = await runDeepInfraChatRound({
    baseUrl: "https://api.deepinfra.com/v1/openai",
    reasoningEffort: "default",
  });
  assert.equal("reasoning_effort" in captured[0]!.body, false);
});

test("DeepInfra transport injects reasoning.enabled=false when thinking is disabled", async () => {
  // When thinking is disabled, the host pins effort to default (shouldPinReasoningEffortToDefault),
  // so reasoning_effort is not injected here; only reasoning.enabled=false is injected.
  const captured = await runDeepInfraChatRound({
    baseUrl: "https://api.deepinfra.com/v1/openai",
    reasoningEffort: "default",
    vendorExtendedThinking: false,
  });
  assert.deepEqual(captured[0]?.body.reasoning, { enabled: false });
  assert.equal("reasoning_effort" in captured[0]!.body, false);
});

test("DeepInfra code-completion profile omits reasoning_effort and disables reasoning", async () => {
  const captured = await runDeepInfraChatRound(
    applyCodeCompletionTransportProfile({
      apiKey: "test-key",
      model: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      baseUrl: "https://api.deepinfra.com/v1/openai",
      llmVendor: "deepinfra",
      reasoningEffort: "medium",
      workspaceRoot: process.cwd(),
    }) as OpenAiTransportConfig,
  );
  assert.deepEqual(captured[0]?.body.reasoning, { enabled: false });
  assert.equal("reasoning_effort" in captured[0]!.body, false);
});

test("DeepInfra image generation reuses openai-compatible branch with preset /openai base", async () => {
  const capturedUrls: string[] = [];
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    capturedUrls.push(url);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.model, "black-forest-labs/FLUX-1-schnell");
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from([1, 2, 3, 4]).toString("base64") }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    await transport.generateImage(
      {
        apiKey: "test-key",
        model: "deepseek-ai/DeepSeek-V3",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        llmVendor: "deepinfra",
        imageGeneration: {
          apiKey: "test-key",
          model: "black-forest-labs/FLUX-1-schnell",
          baseUrl: "https://api.deepinfra.com/v1/openai",
          llmVendor: "deepinfra",
        },
      },
      { prompt: "a red circle", size: "1024x1024" },
      async (request) => ({
        path: "/tmp/image.png",
        mimeType: request.mediaType,
        markdownRef: `${product.urlProtocol}://generated/image/abc`,
      }),
    );

    assert.deepEqual(capturedUrls, ["https://api.deepinfra.com/v1/openai/images/generations"]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("DeepInfra transport embeds local video input via stash restore", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-deepinfra-video-e2e-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      captured.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const transport = new AiSdkOpenAiCompatibleTransport();
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "acme/video-chat",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        llmVendor: "deepinfra",
        workspaceRoot,
        modelCapabilities: { videoInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe the video" },
              { type: "video_url", video_url: { url: videoPath } },
            ],
          },
        ],
        steps: 0,
      },
      [],
    );
    assert.equal(result.kind, "success");

    const chatBody = captured.find((entry) =>
      JSON.stringify(entry.body.messages ?? "").includes("video_url"),
    );
    assert.ok(chatBody);
    const messages = chatBody.body.messages as Array<{
      content: Array<{ type: string; video_url?: { url: string } }>;
    }>;
    const videoPart = messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === "video_url");
    const videoUrl = videoPart?.video_url?.url ?? "";
    assert.match(videoUrl, /^data:video\/mp4;base64,/);
    assert.equal(
      videoUrl.slice("data:video/mp4;base64,".length),
      MINIMAL_MP4_HEADER.toString("base64"),
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
