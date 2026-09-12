import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { createLlmImageContentPart } from "../ports.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { clearMoonshotChatCompletionMessages } from "./moonshot-chat-completion-messages.js";
import { llmMessageToOpenAiMessage } from "./openai-multimodal-messages.js";
import { clearStepfunVideoUploadCache } from "./stepfun-files.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

interface CapturedRequest {
  url: string;
  body: Record<string, unknown> | undefined;
}

test("StepFun transport uploads local video and restores stepfile video_url via stash", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-stepfun-video-e2e-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearStepfunVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes("/files")) {
        captured.push({ url, body: undefined });
        return new Response(JSON.stringify({ id: "file-step-abc" }), { status: 200 });
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
        model: "step-3.7-flash",
        baseUrl: "https://api.stepfun.com/v1",
        llmVendor: "stepfun",
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
      captured.some((entry) => entry.url === "https://api.stepfun.com/v1/files"),
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
    assert.equal(videoPart?.video_url?.url, "stepfile://file-step-abc");
    assert.equal(JSON.stringify(chatBody.body).includes("data:video"), false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    clearStepfunVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("StepFun transport sends local images as image_url data URLs without Files upload", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-stepfun-image-e2e-"));
  const imagePath = join(workspaceRoot, "shot.png");
  const captured: CapturedRequest[] = [];
  try {
    await writeFile(imagePath, MINIMAL_PNG);
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

    const converted = llmMessageToOpenAiMessage(
      {
        role: "user",
        content: [
          { type: "text", text: "describe the image" },
          createLlmImageContentPart(imagePath),
        ],
      },
      workspaceRoot,
    );

    const transport = new AiSdkOpenAiCompatibleTransport();
    const result = await transport.startToolAgentRound(
      {
        apiKey: "test-key",
        model: "step-3.7-flash",
        baseUrl: "https://api.stepfun.com/v1",
        llmVendor: "stepfun",
        workspaceRoot,
        modelCapabilities: { imageInput: true, videoInput: true },
      },
      { messages: [converted], steps: 0 },
      [],
    );
    assert.equal(result.kind, "success");

    assert.equal(
      captured.some((entry) => entry.url.includes("/files")),
      false,
    );
    const chatBody = captured.find((entry) =>
      JSON.stringify(entry.body?.messages ?? "").includes("image_url"),
    );
    assert.ok(chatBody);
    const wire = JSON.stringify(chatBody.body);
    assert.match(wire, /data:image\/png;base64,/);
    assert.equal(wire.includes("stepfile://"), false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
