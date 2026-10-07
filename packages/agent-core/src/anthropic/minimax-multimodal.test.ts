import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isMinimaxAnthropicConfig,
  mapMinimaxAnthropicImageContentPart,
  parseDataUrlToAnthropicImageSource,
} from "./minimax-multimodal.js";

test("isMinimaxAnthropicConfig matches minimax anthropic base URLs", () => {
  assert.equal(
    isMinimaxAnthropicConfig({ llmVendor: "minimax", baseUrl: "https://example.com/v1" }),
    true,
  );
  assert.equal(isMinimaxAnthropicConfig({ baseUrl: "https://api.minimax.io/anthropic/v1" }), true);
  assert.equal(isMinimaxAnthropicConfig({ baseUrl: "https://api.minimax.cn/anthropic/v1" }), true);
  assert.equal(isMinimaxAnthropicConfig({ baseUrl: "https://api.anthropic.com/v1" }), false);
});

test("parseDataUrlToAnthropicImageSource splits base64 data URLs", () => {
  assert.deepEqual(parseDataUrlToAnthropicImageSource("data:image/png;base64,QUJD"), {
    type: "base64",
    media_type: "image/png",
    data: "QUJD",
  });
  assert.equal(parseDataUrlToAnthropicImageSource("https://example.com/a.png"), undefined);
});

test("mapMinimaxAnthropicImageContentPart maps base64 and public URLs", () => {
  assert.deepEqual(mapMinimaxAnthropicImageContentPart("data:image/jpeg;base64,abc"), {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: "abc",
    },
  });
  assert.deepEqual(mapMinimaxAnthropicImageContentPart("https://cdn.example.com/a.png"), {
    type: "image",
    source: {
      type: "url",
      url: "https://cdn.example.com/a.png",
    },
  });
});
