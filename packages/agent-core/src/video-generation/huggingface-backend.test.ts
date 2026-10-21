import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveVideoGenerationBackend } from "./router.js";

test("resolveVideoGenerationBackend routes hugging-face vendor and api base", () => {
  assert.equal(
    resolveVideoGenerationBackend({
      apiKey: "hf_test",
      model: "tencent/HunyuanVideo",
      videoApi: "huggingface-inference",
      baseUrl: "https://router.huggingface.co/v1",
    }).id,
    "huggingface-inference",
  );
});
