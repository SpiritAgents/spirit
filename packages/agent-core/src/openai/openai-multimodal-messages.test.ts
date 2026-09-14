import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { createLlmMessageContentFromTextAndImages, createLlmVideoContentPart } from "../ports.js";
import { clearMoonshotVideoUploadCache } from "./moonshot-files.js";
import {
  llmMessageToOpenAiMessage,
  resolveMoonshotVideoUrlsInOpenAiMessages,
} from "./openai-multimodal-messages.js";
import { resolveXiaomiVideoUrlsInOpenAiMessages } from "./xiaomi-video-messages.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("llmMessageToOpenAiMessage serializes video parts as video_url with local path", () => {
  const assetRoot = "/workspace";
  const message = llmMessageToOpenAiMessage(
    {
      role: "user",
      content: createLlmMessageContentFromTextAndImages("describe", [], ["clip.mp4"]),
    },
    assetRoot,
  );

  assert.deepEqual(message, {
    role: "user",
    content: [
      { type: "text", text: "describe" },
      {
        type: "video_url",
        video_url: {
          url: resolve(assetRoot, "clip.mp4").replace(/\\/g, "/"),
        },
      },
    ],
  });
});

test("resolveMoonshotVideoUrlsInOpenAiMessages uploads local video_url references", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-moonshot-resolve-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();

    setLlmFetchTransportOverrideForTests(
      async () => new Response(JSON.stringify({ id: "file-uploaded" }), { status: 200 }),
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

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.moonshot.cn/v1",
        model: "kimi-k2.5",
        llmVendor: "moonshot-ai",
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, "ms://file-uploaded");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveMoonshotVideoUrlsInOpenAiMessages uploads Kimi Code local video_url references", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-kimi-code-resolve-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let uploadCount = 0;
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();

    setLlmFetchTransportOverrideForTests(async (input) => {
      uploadCount += 1;
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      assert.equal(url, "https://api.kimi.com/coding/v1/files");
      return new Response(JSON.stringify({ id: "file_xyz789" }), { status: 200 });
    });

    const messages = [
      llmMessageToOpenAiMessage(
        {
          role: "user",
          content: [createLlmVideoContentPart(videoPath)],
        },
        workspaceRoot,
      ),
    ];

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        model: "k3",
        llmVendor: "kimi-code",
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, "ms://file_xyz789");
    assert.equal(uploadCount, 1);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveMoonshotVideoUrlsInOpenAiMessages skips Kimi Code upload without videoInput", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-kimi-code-resolve-off-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let uploadCount = 0;
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async () => {
      uploadCount += 1;
      return new Response(JSON.stringify({ id: "file_xyz789" }), { status: 200 });
    });

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

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        model: "k3",
        llmVendor: "kimi-code",
        modelCapabilities: {},
      },
      messages,
      workspaceRoot,
    );

    assert.equal(JSON.stringify(messages), before);
    assert.equal(uploadCount, 0);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveMoonshotVideoUrlsInOpenAiMessages leaves Kimi Code remote video URLs unchanged", async () => {
  let uploadCount = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    uploadCount += 1;
    return new Response(JSON.stringify({ id: "file_xyz789" }), { status: 200 });
  });

  const messages = [
    {
      role: "user",
      content: [
        { type: "video_url", video_url: { url: "ms://file_already" } },
        { type: "video_url", video_url: { url: "https://example.com/video.mp4" } },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
      ],
    },
  ];

  try {
    await resolveMoonshotVideoUrlsInOpenAiMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        model: "k3",
        llmVendor: "kimi-code",
        modelCapabilities: { videoInput: true },
      },
      messages,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, "ms://file_already");
    assert.equal(content[1]?.video_url.url, "https://example.com/video.mp4");
    assert.equal(content[2]?.video_url.url, "data:video/mp4;base64,AAAA");
    assert.equal(uploadCount, 0);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("resolveXiaomiVideoUrlsInOpenAiMessages embeds local video as data URL base64", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-xiaomi-resolve-"));
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

    resolveXiaomiVideoUrlsInOpenAiMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2.5",
        llmVendor: "xiaomi",
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const url =
      (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]?.video_url
        .url ?? "";
    assert.match(url, /^data:video\/mp4;base64,/);
    assert.equal(url.slice("data:video/mp4;base64,".length), MINIMAL_MP4_HEADER.toString("base64"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
