import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { AiSdkOpenAiCompatibleTransport } from "./ai-sdk-transport.js";
import { clearVideoPassthroughMessages } from "./video-message-stash.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("Nebius Chat emits image_url and video_url without unverified controls", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-nebius-chat-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
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

    const result = await new AiSdkOpenAiCompatibleTransport().startToolAgentRound(
      {
        apiKey: "test-key",
        model: "example/multimodal-chat",
        baseUrl: "http://127.0.0.1:19091/v1",
        sdk: "@ai-sdk/openai-compatible",
        workspaceRoot,
        modelCapabilities: { languageModel: true, imageInput: true, videoInput: true },
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Inspect both attachments." },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAEC" } },
              { type: "video_url", video_url: { url: videoPath } },
            ],
          },
        ],
        steps: 0,
      },
      [],
    );
    assert.equal(result.kind, "success");
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.url, "http://127.0.0.1:19091/v1/chat/completions");
    const body = captured[0]!.body;
    const content = (body.messages as Array<{ content: unknown[] }>)[0]?.content ?? [];
    const image = content.find((part) => (part as { type?: string }).type === "image_url") as
      | { image_url?: { url?: string } }
      | undefined;
    const video = content.find((part) => (part as { type?: string }).type === "video_url") as
      | { video_url?: { url?: string } }
      | undefined;
    assert.equal(image?.image_url?.url, "data:image/png;base64,AAEC");
    assert.equal(
      video?.video_url?.url,
      `data:video/mp4;base64,${MINIMAL_MP4_HEADER.toString("base64")}`,
    );
    assert.equal("reasoning_effort" in body, false);
    assert.equal("service_tier" in body, false);
    assert.equal("web_search" in body, false);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearVideoPassthroughMessages();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
