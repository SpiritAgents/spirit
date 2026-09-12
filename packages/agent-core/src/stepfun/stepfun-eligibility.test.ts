import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isStepfunManagedWebSearchToolCall,
  shouldUseStepfunWebSearch,
} from "./stepfun-eligibility.js";
import { buildStepfunWebSearchToolDefinition } from "./stepfun-web-search-tool.js";

test("shouldUseStepfunWebSearch matches stepfun vendor and api base", () => {
  assert.equal(
    shouldUseStepfunWebSearch({
      apiKey: "k",
      model: "step-3.7-flash",
      llmVendor: "stepfun",
    }),
    true,
  );
  assert.equal(
    shouldUseStepfunWebSearch({
      transportKind: "anthropic",
      apiKey: "k",
      model: "step-3.7-flash",
      baseUrl: "https://api.stepfun.com",
    }),
    true,
  );
  assert.equal(
    shouldUseStepfunWebSearch({
      transportKind: "anthropic",
      apiKey: "k",
      model: "step-3.7-flash",
      baseUrl: "https://api.stepfun.ai",
    }),
    true,
  );
  assert.equal(
    shouldUseStepfunWebSearch({
      transportKind: "openai-compatible",
      apiKey: "k",
      model: "kimi-k2.5",
      llmVendor: "moonshot-ai",
    }),
    false,
  );
});

test("isStepfunManagedWebSearchToolCall matches web_search only when eligible", () => {
  const config = {
    apiKey: "k",
    model: "step-3.7-flash",
    llmVendor: "stepfun" as const,
  };
  assert.equal(isStepfunManagedWebSearchToolCall("web_search", config), true);
  assert.equal(isStepfunManagedWebSearchToolCall("read_file", config), false);
});

test("buildStepfunWebSearchToolDefinition exposes query and optional max_results", () => {
  const definition = buildStepfunWebSearchToolDefinition() as {
    function: {
      name: string;
      parameters: { properties: Record<string, unknown>; required: string[] };
    };
  };
  assert.equal(definition.function.name, "web_search");
  assert.deepEqual(definition.function.parameters.required, ["query"]);
  assert.ok(definition.function.parameters.properties.query);
  const maxResults = definition.function.parameters.properties.max_results as {
    minimum: number;
    maximum: number;
  };
  assert.ok(maxResults);
  assert.equal(maxResults.minimum, 1);
  assert.equal(maxResults.maximum, 20);
  assert.equal(definition.function.parameters.properties.category, undefined);
});
