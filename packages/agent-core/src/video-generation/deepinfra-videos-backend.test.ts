import { product } from "@spiritagent/product";
import assert from "node:assert/strict";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import { resolveVideoGenerationBackend } from "./router.js";
import {
  DeepInfraVideosBackend,
  resolveDeepInfraVideoApiBase,
} from "./deepinfra-videos-backend.js";

test("resolveDeepInfraVideoApiBase strips the /openai suffix and falls back to /v1", () => {
  assert.equal(
    resolveDeepInfraVideoApiBase("https://api.deepinfra.com/v1/openai"),
    "https://api.deepinfra.com/v1",
  );
  assert.equal(
    resolveDeepInfraVideoApiBase("https://api.deepinfra.com/v1/openai/"),
    "https://api.deepinfra.com/v1",
  );
  assert.equal(
    resolveDeepInfraVideoApiBase("http://127.0.0.1:18080/v1"),
    "http://127.0.0.1:18080/v1",
  );
  assert.throws(() => resolveDeepInfraVideoApiBase(undefined), /requires a baseUrl/);
});

test("resolveVideoGenerationBackend routes by the declared videoApi shape", () => {
  assert.equal(
    resolveVideoGenerationBackend({
      apiKey: "test-key",
      model: "org/example-video-model",
      videoApi: "deepinfra-videos",
      baseUrl: "https://api.deepinfra.com/v1/openai",
    }).id,
    "deepinfra-videos",
  );
  assert.throws(
    () =>
      resolveVideoGenerationBackend({
        apiKey: "test-key",
        model: "org/example-video-model",
        videoApi: "no-such-shape",
        baseUrl: "https://api.deepinfra.com/v1/openai",
      }),
    /Unknown videoApi/,
  );
  assert.throws(
    () =>
      resolveVideoGenerationBackend({
        apiKey: "test-key",
        model: "org/example-video-model",
        baseUrl: "https://api.deepinfra.com/v1/openai",
      }),
    /no videoApi/,
  );
});

test("DeepInfraVideosBackend create/poll/download success path", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/videos") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.model, "org/example-video-model");
      assert.equal(body.prompt, "a cat walks");
      assert.equal(body.seconds, 5);
      assert.equal(body.aspect_ratio, "16:9");
      assert.equal(body.size, "1080p");
      return new Response(JSON.stringify({ id: "vid_123", status: "queued" }), { status: 200 });
    }
    if (url.endsWith("/videos/vid_123")) {
      return new Response(
        JSON.stringify({
          id: "vid_123",
          status: "completed",
          data: [{ video_url: "https://cdn.example/video.mp4" }],
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
    const backend = new DeepInfraVideosBackend();
    const output = await backend.generate(
      {
        apiKey: "test-key",
        model: "org/example-video-model",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        videoApi: "deepinfra-videos",
      },
      {
        prompt: "a cat walks",
        duration: 5,
        aspectRatio: "16:9",
        resolution: "1080p",
      },
      async (request) => ({
        path: "/tmp/video.mp4",
        mimeType: request.mediaType,
        markdownRef: `${product.urlProtocol}://generated/video/abc`,
      }),
    );

    assert.match(output.summaryText ?? "", /generated video/i);
    assert.deepEqual(calls, [
      "POST https://api.deepinfra.com/v1/videos",
      "GET https://api.deepinfra.com/v1/videos/vid_123",
      "DOWNLOAD https://cdn.example/video.mp4",
    ]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    globalThis.fetch = originalFetch;
  }
});

test("DeepInfraVideosBackend accepts url/output_url result fields", async () => {
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/videos") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "vid_alt" }), { status: 200 });
    }
    if (url.endsWith("/videos/vid_alt")) {
      return new Response(
        JSON.stringify({
          id: "vid_alt",
          status: "succeeded",
          data: [{ output_url: "https://cdn.example/alt.mp4" }],
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected LLM fetch: ${url}`);
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(Uint8Array.from([9, 9]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    })) as typeof fetch;

  try {
    const backend = new DeepInfraVideosBackend();
    const output = await backend.generate(
      {
        apiKey: "test-key",
        model: "org/example-video-model",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        videoApi: "deepinfra-videos",
      },
      { prompt: "alt result fields" },
      async (request) => ({
        path: "/tmp/video-alt.mp4",
        mimeType: request.mediaType,
        markdownRef: `${product.urlProtocol}://generated/video/def`,
      }),
    );
    assert.match(output.summaryText ?? "", /generated video/i);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    globalThis.fetch = originalFetch;
  }
});

test("DeepInfraVideosBackend surfaces failed status message", async () => {
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
          error: "safety filter",
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected LLM fetch: ${url}`);
  });

  try {
    const backend = new DeepInfraVideosBackend();
    await assert.rejects(
      () =>
        backend.generate(
          {
            apiKey: "test-key",
            model: "org/example-video-model",
            baseUrl: "https://api.deepinfra.com/v1/openai",
            videoApi: "deepinfra-videos",
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
