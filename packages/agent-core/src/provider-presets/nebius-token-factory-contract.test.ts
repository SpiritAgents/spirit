import assert from "node:assert/strict";

import { test } from "vitest";

import { findProviderPreset } from "./loader.js";
import { materializeProviderPreset } from "./materialize.js";

test("Nebius declares neither hosted search nor generation or upload backends", () => {
  for (const transportKind of ["openai-compatible", "open-responses"] as const) {
    const entry = materializeProviderPreset({
      presetId: "nebius-token-factory",
      transportKind,
    });
    assert.equal(entry.providerTools, undefined);
    assert.equal(entry.imageApi, undefined);
    assert.equal(entry.videoApi, undefined);
    assert.equal(entry.fileUpload, undefined);
    assert.equal(entry.body, undefined);
    assert.equal(entry.thinkingSwitch, undefined);
  }
  assert.deepEqual(findProviderPreset("nebius-token-factory")?.catalog, {
    parser: "nebius-token-factory-models",
    endpoint: "/models?verbose=true",
  });
});
