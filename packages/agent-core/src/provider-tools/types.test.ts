import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isOpenAiFunctionToolEntry,
  ProviderToolConfigError,
  readJsonDotPathValue,
  validateProviderToolEntries,
  validateProviderToolEntry,
} from "./types.js";

test("validateProviderToolEntry accepts body-only, tools-only, and toolsFrom-only entries", () => {
  assert.deepEqual(validateProviderToolEntry({ body: { enable_search: true } }), {
    body: { enable_search: true },
  });
  assert.deepEqual(
    validateProviderToolEntry({ tools: [{ type: "function", function: { name: "t" } }] }),
    {
      tools: [{ type: "function", function: { name: "t" } }],
    },
  );
  assert.deepEqual(validateProviderToolEntry({ toolsFrom: { path: "/tools" } }), {
    toolsFrom: { path: "/tools" },
  });
});

test("validateProviderToolEntry accepts tools and toolsFrom together with execute", () => {
  const entry = {
    label: "Web Search",
    tools: [{ type: "moonshot_formula", formula_uri: "moonshot/web-search:latest" }],
    toolsFrom: { path: "/formulas/moonshot/web-search:latest/tools", listPath: "tools" },
    execute: {
      path: "/formulas/moonshot/web-search:latest/fibers",
      body: { name: "{toolName}", arguments: "{argumentsJson}" },
      statusPath: "status",
      okValue: "succeeded",
      errorPath: ["error", "context.error", "context.output"],
      resultPath: ["context.encrypted_output", "context.output"],
    },
    ui: { expand: false },
  };
  assert.deepEqual(validateProviderToolEntry(entry), entry);
});

test("validateProviderToolEntry accepts execute with resultsPath + fields", () => {
  const entry = {
    tools: [{ type: "function", function: { name: "web_search" } }],
    execute: {
      path: "/search",
      body: { text_query: "{arg.query}" },
      resultsPath: "search_results",
      fields: {
        title: "title",
        url: "url",
        site: "site_name",
        time: "date",
        snippet: "snippet",
        content: "content",
      },
    },
  };
  assert.deepEqual(validateProviderToolEntry(entry), entry);
});

test("validateProviderToolEntry rejects a non-object entry and unknown keys", () => {
  assert.throws(() => validateProviderToolEntry("nope"), ProviderToolConfigError);
  assert.throws(() => validateProviderToolEntry({ body: {}, bogus: 1 }), /unknown key "bogus"/);
});

test("validateProviderToolEntry rejects an entry with none of tools/toolsFrom/body", () => {
  assert.throws(
    () => validateProviderToolEntry({ label: "Web Search" }),
    /at least one of "tools", "toolsFrom", or "body"/,
  );
});

test("validateProviderToolEntry rejects execute without tools or toolsFrom", () => {
  assert.throws(
    () =>
      validateProviderToolEntry({ body: { enable_search: true }, execute: { path: "/search" } }),
    /"execute" requires "tools" or "toolsFrom"/,
  );
});

test("validateProviderToolEntry rejects toolsFrom without path/url and with unknown keys", () => {
  assert.throws(
    () => validateProviderToolEntry({ toolsFrom: { listPath: "tools" } }),
    /"toolsFrom" requires at least one of "path" or "url"/,
  );
  assert.throws(
    () => validateProviderToolEntry({ toolsFrom: { path: "/tools", extra: 1 } }),
    /unknown key "extra"/,
  );
});

test("validateProviderToolEntry rejects execute without path/url", () => {
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "web_search" } }],
        execute: { body: {} },
      }),
    /"execute" requires at least one of "path" or "url"/,
  );
});

test("validateProviderToolEntry rejects fields slots outside the fixed set", () => {
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "web_search" } }],
        execute: {
          path: "/search",
          resultsPath: "results",
          fields: { title: "title", score: "score" },
        },
      }),
    /unknown "execute.fields" slot "score"/,
  );
});

test("validateProviderToolEntry requires resultsPath and fields to appear together", () => {
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "web_search" } }],
        execute: { path: "/search", resultsPath: "results" },
      }),
    /"resultsPath" and "fields" must be declared together/,
  );
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "web_search" } }],
        execute: { path: "/search", fields: { title: "title" } },
      }),
    /"resultsPath" and "fields" must be declared together/,
  );
});

test("validateProviderToolEntry rejects resultPath combined with resultsPath", () => {
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "web_search" } }],
        execute: {
          path: "/search",
          resultPath: "output",
          resultsPath: "results",
          fields: { title: "title" },
        },
      }),
    /"resultPath" and "resultsPath" are mutually exclusive/,
  );
});

test("validateProviderToolEntry rejects wrongly typed fields", () => {
  assert.throws(
    () => validateProviderToolEntry({ label: 1, body: {} }),
    /"label" must be a string/,
  );
  assert.throws(
    () => validateProviderToolEntry({ tools: [{}], body: "x" }),
    /"body" must be an object/,
  );
  assert.throws(
    () => validateProviderToolEntry({ tools: "x" }),
    /"tools" must be an array of objects/,
  );
  assert.throws(
    () => validateProviderToolEntry({ tools: [1] }),
    /"tools" must be an array of objects/,
  );
  assert.throws(
    () => validateProviderToolEntry({ body: {}, ui: { expand: "no" } }),
    /"ui.expand" must be a boolean/,
  );
  assert.throws(
    () =>
      validateProviderToolEntry({
        tools: [{ type: "function", function: { name: "t" } }],
        execute: { path: "/x", errorPath: [1] },
      }),
    /"errorPath" must be a string or an array of strings/,
  );
});

test("validateProviderToolEntries validates arrays and indexes the error context", () => {
  assert.throws(() => validateProviderToolEntries({}), /providerTools must be an array/);
  assert.throws(
    () => validateProviderToolEntries([{ body: {} }, { label: "empty" }]),
    /providerTools\[1\]/,
  );
  const entries = [{ body: { enable_search: true } }, { toolsFrom: { url: "https://x/tools" } }];
  assert.deepEqual(validateProviderToolEntries(entries), entries);
});

test("isOpenAiFunctionToolEntry accepts only the OpenAI function shape", () => {
  assert.equal(
    isOpenAiFunctionToolEntry({ type: "function", function: { name: "web_search" } }),
    true,
  );
  assert.equal(isOpenAiFunctionToolEntry({ type: "function", function: { name: "  " } }), false);
  assert.equal(isOpenAiFunctionToolEntry({ type: "function", function: {} }), false);
  assert.equal(
    isOpenAiFunctionToolEntry({
      type: "moonshot_formula",
      formula_uri: "moonshot/web-search:latest",
    }),
    false,
  );
  assert.equal(
    isOpenAiFunctionToolEntry({ type: "web_search_20250305", name: "web_search" }),
    false,
  );
  assert.equal(isOpenAiFunctionToolEntry(null), false);
});

test("readJsonDotPathValue reads nested objects and array indexes", () => {
  const payload = { file: { file_id: 42 }, list: [{ name: "first" }] };
  assert.equal(readJsonDotPathValue(payload, "file.file_id"), 42);
  assert.equal(readJsonDotPathValue(payload, "list.0.name"), "first");
  assert.equal(readJsonDotPathValue(payload, "file.missing"), undefined);
  assert.equal(readJsonDotPathValue(payload, "file.file_id.deeper"), undefined);
  assert.equal(readJsonDotPathValue(payload, "list.name"), undefined);
  assert.equal(readJsonDotPathValue(null, "file"), undefined);
});
