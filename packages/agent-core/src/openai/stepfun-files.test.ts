import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "vitest";

import { FormData as UndiciFormData } from "undici";

import { configureLlmClientVersion, setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import {
  clearStepfunVideoUploadCache,
  normalizeStepfunFilesApiBase,
  uploadStepfunVideoFile,
} from "./stepfun-files.js";

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("normalizeStepfunFilesApiBase uses the openai-compatible and Step Plan roots", () => {
  assert.equal(normalizeStepfunFilesApiBase(undefined), "https://api.stepfun.com/v1");
  assert.equal(
    normalizeStepfunFilesApiBase("https://api.stepfun.com/v1"),
    "https://api.stepfun.com/v1",
  );
  assert.equal(
    normalizeStepfunFilesApiBase("https://api.stepfun.com/step_plan/v1"),
    "https://api.stepfun.com/step_plan/v1",
  );
  assert.equal(
    normalizeStepfunFilesApiBase("https://api.stepfun.com/step_plan/v1/"),
    "https://api.stepfun.com/step_plan/v1",
  );
});

test("uploadStepfunVideoFile posts multipart with purpose=storage and returns stepfile url", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-stepfun-upload-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let capturedUrl = "";
  let capturedBody: FormData | undefined;
  let uploadCalls = 0;

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearStepfunVideoUploadCache();
    configureLlmClientVersion("1.2.3");
    setLlmFetchTransportOverrideForTests(async (input, init) => {
      uploadCalls += 1;
      capturedUrl = String(input);
      capturedBody = init?.body as FormData;
      return new Response(JSON.stringify({ id: "file-step-abc" }), { status: 200 });
    });

    const url = await uploadStepfunVideoFile(
      { apiKey: "test-key", baseUrl: "https://api.stepfun.com/v1" },
      videoPath,
    );

    assert.equal(url, "stepfile://file-step-abc");
    assert.equal(capturedUrl, "https://api.stepfun.com/v1/files");
    assert.ok(capturedBody instanceof UndiciFormData);
    assert.equal(capturedBody.get("purpose"), "storage");
    assert.ok(capturedBody.get("file"));

    const cached = await uploadStepfunVideoFile(
      { apiKey: "test-key", baseUrl: "https://api.stepfun.com/v1" },
      videoPath,
    );
    assert.equal(cached, "stepfile://file-step-abc");
    assert.equal(uploadCalls, 1);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    configureLlmClientVersion("0.1.0");
    clearStepfunVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("uploadStepfunVideoFile posts to the Step Plan files root", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-core-stepfun-step-plan-"));
  const videoPath = join(workspaceRoot, "clip.mp4");
  let capturedUrl = "";

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearStepfunVideoUploadCache();
    setLlmFetchTransportOverrideForTests(async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ id: "file-step-plan" }), { status: 200 });
    });

    const url = await uploadStepfunVideoFile(
      { apiKey: "test-key", baseUrl: "https://api.stepfun.com/step_plan/v1" },
      videoPath,
    );

    assert.equal(url, "stepfile://file-step-plan");
    assert.equal(capturedUrl, "https://api.stepfun.com/step_plan/v1/files");
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearStepfunVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
