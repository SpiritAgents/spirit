import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { generateStepfunImage, mapStepfunImageSize } from "./stepfun-backend.js";

test("mapStepfunImageSize swaps dimensions for step-image-edit-2", () => {
  assert.equal(mapStepfunImageSize("step-image-edit-2", "1024x768"), "768x1024");
  assert.equal(mapStepfunImageSize("step-2x-large", "1024x768"), "1024x768");
});

test("mapStepfunImageSize returns trimmed custom size when pattern does not match", () => {
  assert.equal(mapStepfunImageSize("step-2x-large", " auto "), "auto");
});

test("generateStepfunImage posts to the configured site /v1/images/generations", async () => {
  const capturedUrls: string[] = [];
  setLlmFetchTransportOverrideForTests(async (input) => {
    capturedUrls.push(String(input));
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from([1, 2, 3, 4]).toString("base64") }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    await generateStepfunImage(
      { apiKey: "test-key", model: "step-1x-medium" },
      { prompt: "a red circle", size: "1024x1024" },
      async (request) => ({
        path: "/tmp/image.png",
        mimeType: request.mediaType,
        markdownRef: "spirit://generated/image/abc",
      }),
    );
    await generateStepfunImage(
      { apiKey: "test-key", model: "step-1x-medium", baseUrl: "https://api.stepfun.ai/v1" },
      { prompt: "a red circle", size: "1024x1024" },
      async (request) => ({
        path: "/tmp/image.png",
        mimeType: request.mediaType,
        markdownRef: "spirit://generated/image/abc",
      }),
    );
    assert.deepEqual(capturedUrls, [
      "https://api.stepfun.com/v1/images/generations",
      "https://api.stepfun.ai/v1/images/generations",
    ]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
