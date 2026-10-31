import { product } from "@spiritagent/product";
import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { resolveVideoGenerationBackend } from "./router.js";
import { resolveTogetherVideoApiBase, TogetherVideosBackend } from "./together-videos-backend.js";

test("resolveTogetherVideoApiBase rewrites /v1 apiBase to /v2", () => {
  assert.equal(
    resolveTogetherVideoApiBase("https://api.together.ai/v1"),
    "https://api.together.ai/v2",
  );
  assert.equal(
    resolveTogetherVideoApiBase("https://api.together.xyz/v1/"),
    "https://api.together.xyz/v2",
  );
  assert.throws(() => resolveTogetherVideoApiBase(undefined), /requires a baseUrl/);
});

test("resolveVideoGenerationBackend routes by the declared videoApi shape", () => {
  assert.equal(
    resolveVideoGenerationBackend({
      apiKey: "test-key",
      model: "org/example-video-model",
      videoApi: "together-videos",
      baseUrl: "https://api.together.ai/v1",
    }).id,
    "together-videos",
  );
});

test("TogetherVideosBackend create/poll/download success path", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/videos") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.model, "org/example-video-model");
      assert.equal(body.prompt, "a cat walks");
      assert.equal(body.seconds, "5");
      assert.equal(body.ratio, "16:9");
      return new Response(JSON.stringify({ id: "vid_123" }), { status: 200 });
    }
    if (url.endsWith("/videos/vid_123")) {
      return new Response(
        JSON.stringify({
          id: "vid_123",
          status: "completed",
          outputs: { cost: 1, video_url: "https://cdn.example/video.mp4" },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected LLM fetch: ${url}`);
  });

  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(`DOWNLOAD ${url}`);
    assert.equal(url, "https://cdn.example/video.mp4");
    return new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    });
  }) as typeof fetch;

  try {
    const backend = new TogetherVideosBackend();
    const output = await backend.generate(
      {
        apiKey: "test-key",
        model: "org/example-video-model",
        baseUrl: "https://api.together.ai/v1",
        videoApi: "together-videos",
      },
      {
        prompt: "a cat walks",
        duration: 5,
        aspectRatio: "16:9",
      },
      async (request) => ({
        path: "/tmp/video.mp4",
        mimeType: request.mediaType,
        markdownRef: `${product.urlProtocol}://generated/video/abc`,
      }),
    );

    assert.match(output.summaryText ?? "", /generated video/i);
    assert.deepEqual(calls, [
      "POST https://api.together.ai/v2/videos",
      "GET https://api.together.ai/v2/videos/vid_123",
      "DOWNLOAD https://cdn.example/video.mp4",
    ]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    globalThis.fetch = originalFetch;
  }
});

test("TogetherVideosBackend surfaces failed status message", async () => {
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/videos") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "vid_fail" }), { status: 200 });
    }
    if (url.endsWith("/videos/vid_fail")) {
      return new Response(
        JSON.stringify({
          id: "vid_fail",
          status: "failed",
          error: { message: "safety filter" },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected LLM fetch: ${url}`);
  });

  try {
    const backend = new TogetherVideosBackend();
    await assert.rejects(
      () =>
        backend.generate(
          {
            apiKey: "test-key",
            model: "org/example-video-model",
            baseUrl: "https://api.together.ai/v1",
            videoApi: "together-videos",
          },
          { prompt: "bad prompt" },
          async () => {
            throw new Error("should not save");
          },
        ),
      /safety filter/,
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
