import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { configureLlmClientVersion, setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import {
  clearMinimaxVideoUploadCache,
  normalizeMinimaxFilesApiBase,
  uploadMinimaxVideoFile,
} from "./minimax-files.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("normalizeMinimaxFilesApiBase strips anthropic suffix", () => {
  assert.equal(
    normalizeMinimaxFilesApiBase("https://api.minimax.io/anthropic/v1"),
    "https://api.minimax.io/v1",
  );
  assert.equal(
    normalizeMinimaxFilesApiBase("https://api.minimaxi.com/anthropic/v1"),
    "https://api.minimaxi.com/v1",
  );
  assert.equal(
    normalizeMinimaxFilesApiBase("https://api.minimax.io/v1"),
    "https://api.minimax.io/v1",
  );
});

test("uploadMinimaxVideoFile posts multipart with purpose=video_understanding and returns mm_file url", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-minimax-upload-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let capturedUrl = "";
  let capturedBody: FormData | undefined;

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMinimaxVideoUploadCache();
    configureLlmClientVersion("1.2.3");
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      capturedUrl = String(input);
      capturedBody = init?.body as FormData;
      return new Response(
        JSON.stringify({
          file: {
            file_id: 413560385741067,
            bytes: MINIMAL_MP4_HEADER.length,
            created_at: 1782521293,
            filename: "clip.mp4",
            purpose: "video_understanding",
          },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200 },
      );
    });

    const url = await uploadMinimaxVideoFile(
      { apiKey: "test-key", baseUrl: "https://api.minimax.io/anthropic/v1" },
      videoPath,
    );

    assert.equal(url, "mm_file://413560385741067");
    assert.equal(capturedUrl, "https://api.minimax.io/v1/files/upload");
    assert.equal(capturedBody?.get("purpose"), "video_understanding");
    assert.ok(capturedBody?.get("file"));

    const cached = await uploadMinimaxVideoFile(
      { apiKey: "test-key", baseUrl: "https://api.minimax.io/anthropic/v1" },
      videoPath,
    );
    assert.equal(cached, "mm_file://413560385741067");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    configureLlmClientVersion("0.1.0");
    clearMinimaxVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
