import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { product } from "@spiritagent/product";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "../llm-fetch.js";
import type { GeneratedImageSaveRequest } from "../ports.js";
import { generateMetaImage } from "./meta-backend.js";

function saveImage(ids: { next: number }) {
  return async (request: GeneratedImageSaveRequest) => {
    const id = `image-${ids.next++}`;
    return {
      path: `/tmp/${id}`,
      mimeType: request.mediaType,
      markdownRef: `${product.urlProtocol}://generated/image/${id}`,
    };
  };
}

test("meta-images generates and saves multiple b64 images without moderation", async () => {
  let requestBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    assert.equal(String(input), "https://meta.test/v1/images/generations");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        created: 1,
        output_format: "png",
        data: [
          { b64_json: Buffer.from([1, 2, 3]).toString("base64") },
          { b64_json: Buffer.from([4, 5, 6]).toString("base64") },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const ids = { next: 1 };
    const result = await generateMetaImage(
      {
        apiKey: "test-key",
        model: "muse-image-1.0",
        baseUrl: "https://meta.test/v1",
      },
      {
        prompt: "Two abstract studies",
        size: "1024x768",
        count: 2,
        outputFormat: "png",
        reasoningStrength: "low",
      },
      saveImage(ids),
    );
    assert.deepEqual(requestBody, {
      model: "muse-image-1.0",
      prompt: "Two abstract studies",
      n: 2,
      size: "1024x768",
      response_format: "b64_json",
      output_format: "png",
      reasoning_strength: "low",
    });
    assert.equal("moderation" in requestBody!, false);
    assert.equal(result.content.filter((part) => part.type === "image").length, 2);
    assert.equal(result.summaryText.match(/\[generated image\]/g)?.length, 2);
    assert.match(result.summaryText, /image-1/);
    assert.match(result.summaryText, /image-2/);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test("meta-images edits local, remote, and file-id references and downloads URL results", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-meta-image-"));
  const requestedUrls: string[] = [];
  let requestBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === "https://meta.test/v1/images/edits") {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          created: 1,
          output_format: "webp",
          data: [{ url: "https://cdn.test/generated/result.webp" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://cdn.test/generated/result.webp") {
      return new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });

  try {
    const referencePath = join(root, "reference.png");
    await writeFile(referencePath, new Uint8Array([1, 2, 3]));
    const ids = { next: 3 };
    const result = await generateMetaImage(
      {
        apiKey: "test-key",
        model: "muse-image-1.0",
        baseUrl: "https://meta.test/v1",
      },
      {
        prompt: "Combine the references",
        size: "768x1024",
        responseFormat: "url",
        reasoningStrength: "high",
        referenceImages: [
          { path: referencePath, mediaType: "image/png" },
          { url: "https://images.example/reference.png" },
          { fileId: "file_reference" },
        ],
      },
      saveImage(ids),
    );
    assert.deepEqual(requestedUrls, [
      "https://meta.test/v1/images/edits",
      "https://cdn.test/generated/result.webp",
    ]);
    const images = requestBody?.images as Array<Record<string, unknown>>;
    assert.match(String(images[0]?.image_url), /^data:image\/png;base64,/);
    assert.deepEqual(images[1], { image_url: "https://images.example/reference.png" });
    assert.deepEqual(images[2], { file_id: "file_reference" });
    assert.equal(requestBody?.response_format, "url");
    assert.equal(requestBody?.reasoning_strength, "high");
    assert.equal("moderation" in requestBody!, false);
    assert.match(result.summaryText, /image\/webp/);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("meta-images validates count, size, and reference limits before requests", async () => {
  const config = {
    apiKey: "test-key",
    model: "muse-image-1.0",
    baseUrl: "https://meta.test/v1",
  };
  const save = saveImage({ next: 1 });
  await assert.rejects(
    generateMetaImage(config, { prompt: "x", size: "1024x1024", count: 11 }, save),
    /between 1 and 10/,
  );
  await assert.rejects(
    generateMetaImage(config, { prompt: "x", size: "square" }, save),
    /WxH aspect-ratio/,
  );
  await assert.rejects(
    generateMetaImage(
      config,
      {
        prompt: "x",
        size: "1024x1024",
        referenceImages: Array.from({ length: 11 }, () => ({ fileId: "file_x" })),
      },
      save,
    ),
    /between 1 and 10 reference images/,
  );
});
