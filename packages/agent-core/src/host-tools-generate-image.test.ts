import assert from "node:assert/strict";

import { test } from "vitest";

import { buildBuiltinHostToolDefinitions } from "./host-tools.js";

test("generate_image exposes optional provider-neutral generation and editing parameters", () => {
  const definitions = buildBuiltinHostToolDefinitions({
    shellDisplayName: "Shell",
    commandParameterDescription: "Command",
  });
  const definition = definitions.find(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "function" in item &&
      (item.function as { name?: string }).name === "generate_image",
  ) as { function: { parameters: { properties: Record<string, unknown> } } };
  assert.ok(definition);
  assert.deepEqual(Object.keys(definition.function.parameters.properties).sort(), [
    "count",
    "output_format",
    "prompt",
    "reasoning_strength",
    "reference_images",
    "response_format",
    "size",
  ]);
});
