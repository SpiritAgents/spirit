import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { createLlmMessageContentFromTextAndImages, createLlmVideoContentPart } from "../ports.js";
import { clearDeclaredFileUploadCacheForTests } from "../file-upload/uploader.js";
import {
  llmMessageToOpenAiMessage,
  resolveDeclaredVideoInputsInMessages,
} from "./openai-multimodal-messages.js";

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

test("resolveDeclaredVideoInputsInMessages uploads local video_url references via fileUpload", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-declared-upload-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearDeclaredFileUploadCacheForTests();

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

    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.moonshot.cn/v1",
        modelCapabilities: { videoInput: true },
        fileUpload: {
          path: "/files",
          purpose: { video: "video" },
          refTemplate: "ms://{id}",
        },
      },
      messages,
      workspaceRoot,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, "ms://file-uploaded");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearDeclaredFileUploadCacheForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveDeclaredVideoInputsInMessages joins the upload path onto the declared apiBase", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-kimi-code-resolve-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let uploadCount = 0;
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearDeclaredFileUploadCacheForTests();

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

    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        modelCapabilities: { videoInput: true },
        fileUpload: {
          path: "/files",
          purpose: { video: "video" },
          refTemplate: "ms://{id}",
        },
      },
      messages,
      workspaceRoot,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, "ms://file_xyz789");
    assert.equal(uploadCount, 1);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearDeclaredFileUploadCacheForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveDeclaredVideoInputsInMessages skips the upload without a videoInput declaration", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-kimi-code-resolve-off-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let uploadCount = 0;
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearDeclaredFileUploadCacheForTests();
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

    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        modelCapabilities: {},
        fileUpload: {
          path: "/files",
          purpose: { video: "video" },
          refTemplate: "ms://{id}",
        },
      },
      messages,
      workspaceRoot,
    );

    assert.equal(JSON.stringify(messages), before);
    assert.equal(uploadCount, 0);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearDeclaredFileUploadCacheForTests();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolveDeclaredVideoInputsInMessages leaves referenced/remote/data video URLs untouched", async () => {
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
    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/v1",
        modelCapabilities: { videoInput: true },
        fileUpload: {
          path: "/files",
          purpose: { video: "video" },
          refTemplate: "ms://{id}",
        },
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

test("resolveDeclaredVideoInputsInMessages embeds local video as base64 without a fileUpload declaration", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-inline-video-"));
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

    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.xiaomimimo.com/v1",
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

test("resolveDeclaredVideoInputsInMessages inlines when the purpose map does not cover video", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-inline-purpose-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let uploadCount = 0;
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
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

    await resolveDeclaredVideoInputsInMessages(
      {
        apiKey: "test-key",
        baseUrl: "https://api.minimax.io/anthropic/v1",
        modelCapabilities: { videoInput: true },
        fileUpload: {
          url: "https://api.minimax.io/v1/files/upload",
          purpose: { image: "image_understanding" },
          idPath: "file.file_id",
          refTemplate: "mm_file://{id}",
        },
      },
      messages,
      workspaceRoot,
    );

    const url =
      (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]?.video_url
        .url ?? "";
    assert.match(url, /^data:video\/mp4;base64,/);
    assert.equal(uploadCount, 0);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
