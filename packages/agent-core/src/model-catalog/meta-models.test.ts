import assert from "node:assert/strict";

import { test } from "vitest";

import { parseMetaModelEntriesPayload } from "./openai-models.js";

test("meta parser enriches the sparse Muse catalog and excludes non-selector roles", () => {
  const entries = parseMetaModelEntriesPayload({
    object: "list",
    data: [
      { id: "muse-wonder-1.0", object: "model", created: 1, owned_by: "meta" },
      { id: "muse-spark-1.3", object: "model", created: 2, owned_by: "meta" },
      {
        id: "muse-spark-1.3-contributor",
        object: "model",
        created: 3,
        owned_by: "meta",
      },
      { id: "muse-spark-1.2", object: "model", created: 4, owned_by: "meta" },
      {
        id: "muse-spark-1.2-contributor",
        object: "model",
        created: 5,
        owned_by: "meta",
      },
      { id: "muse-spark-1.1", object: "model", created: 6, owned_by: "meta" },
      {
        id: "muse-spark-1.1-contributor",
        object: "model",
        created: 7,
        owned_by: "meta",
      },
      { id: "muse-image-1.0", object: "model", created: 8, owned_by: "meta" },
      {
        id: "muse-voice-transcribe-1.0",
        object: "model",
        created: 9,
        owned_by: "meta",
      },
      { id: "sam-3.1", object: "model", created: 10, owned_by: "meta" },
    ],
  });

  assert.deepEqual(
    entries.map((entry) => entry.id),
    [
      "muse-wonder-1.0",
      "muse-spark-1.3",
      "muse-spark-1.3-contributor",
      "muse-spark-1.2",
      "muse-spark-1.2-contributor",
      "muse-spark-1.1",
      "muse-image-1.0",
    ],
  );
  const wonder = entries[0]!;
  assert.equal(wonder.displayName, "Muse Wonder 1.0");
  assert.equal(wonder.contextLength, 1_048_576);
  assert.equal(wonder.supportsImageInput, true);
  assert.equal(wonder.supportsAudioInput, true);
  assert.equal(wonder.supportsDocumentInput, true);
  assert.equal(wonder.supportsVideoInput, true);
  assert.equal(wonder.supportsThinkingSwitch, false);
  assert.equal(wonder.dataPolicy, "standard");
  assert.deepEqual(wonder.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);

  const spark = entries[1]!;
  assert.equal(spark.audioInputSupport, "partial");
  assert.deepEqual(spark.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const contributor = entries[2]!;
  assert.equal(contributor.dataPolicy, "contributor");
  assert.equal(contributor.audioInputSupport, "partial");
  assert.deepEqual(contributor.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.equal(entries[5]!.audioInputSupport, undefined);
  assert.deepEqual(entries[5]!.supportedReasoningEfforts, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);

  assert.deepEqual(entries[6], {
    id: "muse-image-1.0",
    displayName: "Muse Image 1.0",
    description: "Generates and edits images with Meta's Muse Image model.",
    supportsImageGeneration: true,
    pricing: { imagePerUnitUsd: "0.01" },
  });
});

test("meta parser tolerates empty and malformed sparse listings", () => {
  assert.deepEqual(parseMetaModelEntriesPayload({ data: [] }), []);
  assert.deepEqual(parseMetaModelEntriesPayload({ data: [{ id: "unknown-model" }] }), []);
  assert.deepEqual(parseMetaModelEntriesPayload({ data: [{ id: 42 }, null] }), []);
  assert.deepEqual(parseMetaModelEntriesPayload(null), []);
});
