import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "../ports.js";
import { providerToolParametersMap, validateProviderToolArguments } from "./validate.js";

const SEARCH_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    query: { type: "string" },
    max_results: { type: "integer", minimum: 1, maximum: 50 },
    verbose: { type: "boolean" },
    threshold: { type: "number" },
    tags: { type: "array" },
    filter: { type: "object" },
  },
  required: ["query"],
  additionalProperties: false,
};

test("validateProviderToolArguments passes through without a declared schema", () => {
  assert.equal(validateProviderToolArguments("web_search", "not json", undefined), undefined);
});

test("validateProviderToolArguments accepts valid arguments", () => {
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({
        query: "q",
        max_results: 1,
        verbose: false,
        threshold: 0.5,
        tags: [],
        filter: {},
      }),
      SEARCH_SCHEMA,
    ),
    undefined,
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", max_results: 50 }),
      SEARCH_SCHEMA,
    ),
    undefined,
  );
});

test("validateProviderToolArguments rejects invalid JSON and non-object arguments", () => {
  assert.match(
    validateProviderToolArguments("web_search", "{oops", SEARCH_SCHEMA) ?? "",
    /arguments are not valid JSON/,
  );
  assert.match(
    validateProviderToolArguments("web_search", "[1]", SEARCH_SCHEMA) ?? "",
    /arguments must be a JSON object/,
  );
});

test("validateProviderToolArguments rejects missing required arguments", () => {
  assert.equal(
    validateProviderToolArguments("web_search", "{}", SEARCH_SCHEMA),
    'web_search: missing required argument "query".',
  );
});

test("validateProviderToolArguments rejects unknown keys when additionalProperties is false", () => {
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", extra: 1 }),
      SEARCH_SCHEMA,
    ),
    'web_search: unknown argument "extra".',
  );
  const openSchema: JsonObject = { type: "object", properties: { query: { type: "string" } } };
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", extra: 1 }),
      openSchema,
    ),
    undefined,
  );
});

test("validateProviderToolArguments checks declared types", () => {
  assert.equal(
    validateProviderToolArguments("web_search", JSON.stringify({ query: 1 }), SEARCH_SCHEMA),
    'web_search: argument "query" must be a string.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", max_results: 1.5 }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "max_results" must be an integer.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", threshold: "high" }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "threshold" must be a number.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", verbose: "yes" }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "verbose" must be a boolean.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", tags: "x" }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "tags" must be an array.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", filter: [] }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "filter" must be an object.',
  );
});

test("validateProviderToolArguments enforces integer ranges without clamping", () => {
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", max_results: 0 }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "max_results" must be >= 1.',
  );
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "q", max_results: 51 }),
      SEARCH_SCHEMA,
    ),
    'web_search: argument "max_results" must be <= 50.',
  );
  const rangeOnly: JsonObject = { type: "object", properties: { n: { minimum: 2 } } };
  assert.equal(
    validateProviderToolArguments("t", JSON.stringify({ n: 1 }), rangeOnly),
    't: argument "n" must be >= 2.',
  );
});

test("validateProviderToolArguments is permissive for unsupported schema features", () => {
  const schema: JsonObject = {
    type: "object",
    properties: {
      query: { type: "string", enum: ["a", "b"], minLength: 3 },
      filter: { type: "object", properties: { country: { type: "integer" } } },
    },
  };
  assert.equal(
    validateProviderToolArguments(
      "web_search",
      JSON.stringify({ query: "c", filter: { country: "us" } }),
      schema,
    ),
    undefined,
  );
});

test("providerToolParametersMap indexes schemas by function name, first declaration wins", () => {
  const first: JsonObject = { type: "object", properties: { query: { type: "string" } } };
  const map = providerToolParametersMap([
    { type: "function", function: { name: "web_search", parameters: first } },
    { type: "web_search_20250305", name: "web_search" },
    { type: "function", function: { name: "no_schema" } },
    { type: "function", function: { name: "web_search", parameters: { type: "object" } } },
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("web_search"), first);
});
