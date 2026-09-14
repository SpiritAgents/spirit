import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { LlmStreamEvent } from "../ports.js";
import { clearMoonshotChatCompletionMessages } from "./moonshot-chat-completion-messages.js";
import { clearMoonshotVideoUploadCache } from "./moonshot-files.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

function sseResponse(chunks: Record<string, unknown>[]): Response {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
  return new Response(`${lines}data: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const STREAM_CHUNKS: Record<string, unknown>[] = [
  {
    id: "chatcmpl-kimi-code",
    object: "chat.completion.chunk",
    created: 0,
    model: "k3",
    choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
  },
  {
    id: "chatcmpl-kimi-code",
    object: "chat.completion.chunk",
    created: 0,
    model: "k3",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  },
];

async function runStreamingRound(
  llmVendor: "kimi-code" | "custom",
  capturedBodies: Record<string, unknown>[],
) {
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return sseResponse(STREAM_CHUNKS);
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const started = await transport.startToolAgentRoundStreaming(
      {
        apiKey: "test-key",
        model: "k3",
        baseUrl: "https://api.kimi.com/coding/v1",
        llmVendor,
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: "user", content: "hi" }], steps: 0 },
      [],
    );
    for await (const event of started.eventStream as AsyncIterable<LlmStreamEvent>) {
      assert.notEqual(event.kind, "error");
    }
    return await started.completion;
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
}

test("Kimi Code streaming chat completions request includes stream_options.include_usage", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  const completion = await runStreamingRound("kimi-code", capturedBodies);

  const chatCompletionBody = capturedBodies.at(-1);
  assert.ok(chatCompletionBody);
  assert.equal(chatCompletionBody.stream, true);
  assert.deepEqual(chatCompletionBody.stream_options, { include_usage: true });

  assert.equal(completion.kind, "success");
  if (completion.kind !== "success") {
    return;
  }
  assert.equal(completion.result.usage?.inputTokens, 10);
  assert.equal(completion.result.usage?.totalTokens, 12);
});

test("other openai-compatible vendors still omit stream_options.include_usage", async () => {
  const capturedBodies: Record<string, unknown>[] = [];
  const completion = await runStreamingRound("custom", capturedBodies);

  const chatCompletionBody = capturedBodies.at(-1);
  assert.ok(chatCompletionBody);
  assert.equal(chatCompletionBody.stream, true);
  assert.equal(chatCompletionBody.stream_options, undefined);

  assert.equal(completion.kind, "success");
});

interface CapturedRequest {
  url: string;
  body: Record<string, unknown> | undefined;
}

test("Kimi Code transport uploads local video and restores ms:// video_url via stash", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-kimi-code-video-e2e-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/files")) {
        captured.push({ url, body: undefined });
        return new Response(JSON.stringify({ id: "file_xyz789" }), { status: 200 });
      }
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
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "k3",
        baseUrl: "https://api.kimi.com/coding/v1",
        llmVendor: "kimi-code",
        workspaceRoot,
        modelCapabilities: { imageInput: true, videoInput: true },
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

    assert.equal(
      captured.some((entry) => entry.url === "https://api.kimi.com/coding/v1/files"),
      true,
    );
    const chatBody = captured.find((entry) =>
      JSON.stringify(entry.body?.messages ?? "").includes("video_url"),
    );
    assert.ok(chatBody);
    const messages = chatBody.body?.messages as Array<{
      content: Array<{ type: string; video_url?: { url: string } }>;
    }>;
    const videoPart = messages
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .find((part) => part.type === "video_url");
    assert.equal(videoPart?.video_url?.url, "ms://file_xyz789");
    assert.equal(JSON.stringify(chatBody.body).includes("data:video"), false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Kimi Code transport drops video_url without videoInput", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-kimi-code-video-off-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      captured.push({
        url,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const transport = new AiSdkOpenAiCompatibleTransport();
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "k3",
        baseUrl: "https://api.kimi.com/coding/v1",
        llmVendor: "kimi-code",
        workspaceRoot,
        modelCapabilities: { imageInput: true },
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

    assert.equal(
      captured.some((entry) => entry.url.includes("/files")),
      false,
    );
    const chatBody = captured.find((entry) => entry.body !== undefined);
    assert.ok(chatBody);
    assert.equal(JSON.stringify(chatBody.body?.messages ?? "").includes("video_url"), false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Kimi Code transport drops video_url when catalog capabilities are omitted", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-kimi-code-video-omitted-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      captured.push({
        url,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const transport = new AiSdkOpenAiCompatibleTransport();
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "k3",
        baseUrl: "https://api.kimi.com/coding/v1",
        llmVendor: "kimi-code",
        workspaceRoot,
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

    assert.equal(
      captured.some((entry) => entry.url.includes("/files")),
      false,
    );
    const chatBody = captured.find((entry) => entry.body !== undefined);
    assert.ok(chatBody);
    const wire = JSON.stringify(chatBody.body?.messages ?? "");
    assert.equal(wire.includes("video_url"), false);
    assert.equal(wire.includes(videoPath), false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
