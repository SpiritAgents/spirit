import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { createLlmVideoContentPart } from "../ports.js";
import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { llmMessageToOpenAiMessage } from "./openai-multimodal-messages.js";
import { clearStepfunVideoUploadCache } from "./stepfun-files.js";
import { resolveStepfunVideoUrlsInOpenAiMessages } from "./stepfun-video-messages.js";
import type { OpenAiTransportConfig } from "./openai-compat.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

function stepfunConfig(
  capabilities: OpenAiTransportConfig["modelCapabilities"],
): OpenAiTransportConfig {
  return {
    apiKey: "test-key",
    baseUrl: "https://api.stepfun.com/v1",
    model: "step-3.7-flash",
    llmVendor: "stepfun",
    modelCapabilities: capabilities,
  };
}

test("resolveStepfunVideoUrlsInOpenAiMessages uploads local video as stepfile reference", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-stepfun-video-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearStepfunVideoUploadCache();
    setLlmFetchTransportOverrideForTests(
      async () => new Response(JSON.stringify({ id: "file-step-abc" }), { status: 200 }),
    );

    const messages = [
      llmMessageToOpenAiMessage(
        {
          role: "user",
          content: [createLlmVideoContentPart(videoPath)],
        },
        workspaceRoot,
      ),
    ];

    await resolveStepfunVideoUrlsInOpenAiMessages(
      stepfunConfig({ videoInput: true }),
      messages,
      workspaceRoot,
    );

    const url =
      (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]?.video_url
        .url ?? "";
    assert.equal(url, "stepfile://file-step-abc");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearStepfunVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveStepfunVideoUrlsInOpenAiMessages leaves public https and stepfile URLs unchanged", async () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "video_url", video_url: { url: "https://example.com/video.mp4" } },
        { type: "video_url", video_url: { url: "stepfile://file-already" } },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
      ],
    },
  ];

  await resolveStepfunVideoUrlsInOpenAiMessages(stepfunConfig({ videoInput: true }), messages);

  const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
  assert.equal(content[0]?.video_url.url, "https://example.com/video.mp4");
  assert.equal(content[1]?.video_url.url, "stepfile://file-already");
  assert.equal(content[2]?.video_url.url, "data:video/mp4;base64,AAAA");
});

test("resolveStepfunVideoUrlsInOpenAiMessages skips other vendors", async () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "video_url", video_url: { url: "/tmp/local-clip.mp4" } }],
    },
  ];

  await resolveStepfunVideoUrlsInOpenAiMessages(
    { ...stepfunConfig({ videoInput: true }), llmVendor: "xiaomi" },
    messages,
  );

  const url = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]
    ?.video_url.url;
  assert.equal(url, "/tmp/local-clip.mp4");
});

test("resolveStepfunVideoUrlsInOpenAiMessages skips when video input capability is off", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-stepfun-video-off-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

    const messages = [
      llmMessageToOpenAiMessage(
        {
          role: "user",
          content: [createLlmVideoContentPart(videoPath)],
        },
        workspaceRoot,
      ),
    ];
    const before = JSON.stringify(messages);

    await resolveStepfunVideoUrlsInOpenAiMessages(stepfunConfig({}), messages, workspaceRoot);

    assert.equal(JSON.stringify(messages), before);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
