import assert from "node:assert/strict";
import { test } from "vitest";

import { parseModalModelEntriesPayload } from "./modal-models.js";
import { dedupeProviderListedModelEntries } from "./openai-models.js";

const DEPLOYED_MODELS = {
  object: "list",
  data: [
    {
      base_model_id: "deepseek-ai/DeepSeek-V4.1-Flash",
      context_length: 1048576,
      created: 1794031558,
      id: "example--ep-deepseek-v4-1-flash-server.us-west.modal.direct",
      input_modalities: ["text", "image"],
      interleaved: { field: "reasoning_content" },
      max_output_length: 1048576,
      name: "DeepSeek: DeepSeek V4.1 Flash",
      object: "model",
      output_modalities: ["text"],
      owned_by: "redacted",
      reasoning_options: [{ type: "effort", values: ["none", "low", "high", "xhigh", "max"] }],
      supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"],
      supported_sampling_parameters: ["temperature", "top_p", "stop", "max_tokens"],
    },
    {
      base_model_id: "zai-org/GLM-5.3",
      context_length: 1048576,
      created: 1794031581,
      id: "example--ep-glm-5-3-server.us-west.modal.direct",
      input_modalities: ["text"],
      interleaved: { field: "reasoning_content" },
      max_output_length: 1048576,
      name: "Z.AI: GLM 5.3",
      object: "model",
      output_modalities: ["text"],
      owned_by: "redacted",
      reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
      supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"],
      supported_sampling_parameters: ["temperature", "top_p", "stop", "max_tokens"],
    },
    {
      base_model_id: "moonshotai/Kimi-K3.1-Pro",
      context_length: 1048576,
      created: 1794031608,
      id: "example--ep-kimi-k3-1-pro-server.us-west.modal.direct",
      input_modalities: ["text", "image"],
      interleaved: { field: "reasoning_content" },
      max_output_length: 1048576,
      name: "MoonshotAI: Kimi K3.1 Pro",
      object: "model",
      output_modalities: ["text"],
      owned_by: "redacted",
      reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
      supported_features: ["tools", "json_mode", "structured_outputs", "reasoning"],
      supported_sampling_parameters: ["temperature", "top_p", "stop", "max_tokens"],
    },
  ],
};

test("modal parser accepts a valid empty Shared Endpoint catalog", () => {
  assert.deepEqual(parseModalModelEntriesPayload({ data: [], object: "list" }), []);
});

test("modal parser preserves deployment ids and exact API metadata", () => {
  const entries = dedupeProviderListedModelEntries(parseModalModelEntriesPayload(DEPLOYED_MODELS));
  assert.equal(entries.length, 3);

  assert.deepEqual(entries[0], {
    id: "example--ep-deepseek-v4-1-flash-server.us-west.modal.direct",
    baseModelId: "deepseek-ai/DeepSeek-V4.1-Flash",
    displayName: "DeepSeek: DeepSeek V4.1 Flash",
    contextLength: 1048576,
    outputLimit: 1048576,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    supportsImageInput: true,
    supportedFeatures: ["tools", "json_mode", "structured_outputs", "reasoning"],
    supportedSamplingParameters: ["temperature", "top_p", "stop", "max_tokens"],
    supportedReasoningEfforts: ["none", "low", "high", "xhigh", "max"],
    supportsReasoning: true,
    reasoningField: "reasoning_content",
  });
  assert.deepEqual(entries[1], {
    id: "example--ep-glm-5-3-server.us-west.modal.direct",
    baseModelId: "zai-org/GLM-5.3",
    displayName: "Z.AI: GLM 5.3",
    contextLength: 1048576,
    outputLimit: 1048576,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedFeatures: ["tools", "json_mode", "structured_outputs", "reasoning"],
    supportedSamplingParameters: ["temperature", "top_p", "stop", "max_tokens"],
    supportedReasoningEfforts: ["low", "high", "max"],
    supportsReasoning: true,
    reasoningField: "reasoning_content",
  });
  assert.equal(entries[2]?.id, "example--ep-kimi-k3-1-pro-server.us-west.modal.direct");
  assert.equal(entries[2]?.baseModelId, "moonshotai/Kimi-K3.1-Pro");
  assert.deepEqual(entries[2]?.inputModalities, ["text", "image"]);
  assert.equal(entries[2]?.supportsImageInput, true);
  assert.deepEqual(entries[2]?.supportedReasoningEfforts, ["low", "high", "max"]);
});

test("modal parser ignores malformed entries without synthesizing metadata", () => {
  assert.deepEqual(parseModalModelEntriesPayload({ data: null }), []);
  assert.deepEqual(
    parseModalModelEntriesPayload({
      data: [
        null,
        { id: " " },
        {
          id: "example--ep-custom-server.us-west.modal.direct",
          input_modalities: ["video", "video", ""],
          reasoning_options: [{ type: "effort", values: [] }],
        },
      ],
    }),
    [
      {
        id: "example--ep-custom-server.us-west.modal.direct",
        inputModalities: ["video"],
        supportsVideoInput: true,
      },
    ],
  );
});
