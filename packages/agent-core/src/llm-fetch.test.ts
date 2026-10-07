import assert from "node:assert/strict";
import { product } from "@spiritagent/product";
import { test } from "vitest";

import {
  buildSpiritUserAgent,
  configureLlmClientVersion,
  configureLlmHttpVersion,
  FLEX_SERVICE_TIER_WAIT_MS,
  getLlmClientVersion,
  getLlmDispatcherConstructionsForTests,
  getLlmFetch,
  getLlmHttpVersion,
  mergeLlmFetchInit,
  normalizeLlmHttpVersion,
  setLlmFetchTransportOverrideForTests,
} from "./llm-fetch.js";

test("normalizeLlmHttpVersion accepts common aliases and defaults to http2", () => {
  assert.equal(normalizeLlmHttpVersion("http1.1"), "http1.1");
  assert.equal(normalizeLlmHttpVersion("HTTP/1.1"), "http1.1");
  assert.equal(normalizeLlmHttpVersion("http2"), "http2");
  assert.equal(normalizeLlmHttpVersion("h2"), "http2");
  assert.equal(normalizeLlmHttpVersion("unknown"), "http2");
  assert.equal(normalizeLlmHttpVersion(undefined), "http2");
});

test("configureLlmHttpVersion updates getLlmHttpVersion", () => {
  configureLlmHttpVersion("http1.1");
  assert.equal(getLlmHttpVersion(), "http1.1");
  configureLlmHttpVersion("http2");
  assert.equal(getLlmHttpVersion(), "http2");
});

test("buildSpiritUserAgent formats product and version", () => {
  assert.equal(buildSpiritUserAgent("1.2.3"), `${encodeURIComponent(product.name)}/1.2.3`);
  assert.equal(buildSpiritUserAgent(" 0.1.0 "), `${encodeURIComponent(product.name)}/0.1.0`);
});

test("configureLlmClientVersion updates getLlmClientVersion and ignores empty strings", () => {
  configureLlmClientVersion("2.0.0");
  assert.equal(getLlmClientVersion(), "2.0.0");
  configureLlmClientVersion("   ");
  assert.equal(getLlmClientVersion(), "2.0.0");
  configureLlmClientVersion("0.1.0");
});

test("mergeLlmFetchInit sets User-Agent from record headers", () => {
  configureLlmClientVersion("1.0.0");
  const merged = mergeLlmFetchInit({
    method: "POST",
    headers: {
      Authorization: "Bearer token",
    },
  });
  assert.equal(merged.method, "POST");
  assert.ok(merged.headers instanceof Headers);
  assert.equal((merged.headers as Headers).get("Authorization"), "Bearer token");
  assert.equal(
    (merged.headers as Headers).get("User-Agent"),
    `${encodeURIComponent(product.name)}/1.0.0`,
  );
});

test("mergeLlmFetchInit sets User-Agent from Headers instance without mutating source", () => {
  configureLlmClientVersion("3.4.5");
  const source = new Headers({ "Content-Type": "application/json" });
  const merged = mergeLlmFetchInit({ headers: source });
  assert.equal(source.get("User-Agent"), null);
  assert.equal((merged.headers as Headers).get("Content-Type"), "application/json");
  assert.equal(
    (merged.headers as Headers).get("User-Agent"),
    `${encodeURIComponent(product.name)}/3.4.5`,
  );
});

test("mergeLlmFetchInit overwrites existing User-Agent", () => {
  configureLlmClientVersion("9.9.9");
  const merged = mergeLlmFetchInit({
    headers: {
      "User-Agent": "other-client/1.0",
    },
  });
  assert.equal(
    (merged.headers as Headers).get("User-Agent"),
    `${encodeURIComponent(product.name)}/9.9.9`,
  );
});

test("getLlmFetch applies Spirit User-Agent on outbound calls", async () => {
  configureLlmClientVersion("4.5.6");
  let capturedInit: RequestInit | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedInit = init;
    return new Response("ok");
  });
  try {
    await getLlmFetch()("https://example.com/v1/chat/completions", { method: "POST" });
    assert.ok(capturedInit?.headers instanceof Headers);
    assert.equal(
      (capturedInit.headers as Headers).get("User-Agent"),
      `${encodeURIComponent(product.name)}/4.5.6`,
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

function flexConstructions() {
  return getLlmDispatcherConstructionsForTests().filter((entry) => entry.kind === "flex");
}

test("flex dispatcher is constructed with the extended wait window", async () => {
  const before = flexConstructions().length;
  setLlmFetchTransportOverrideForTests(async () => new Response("ok"));
  try {
    await getLlmFetch({ flexWaiting: true })("https://example.com/v1/responses", {
      method: "POST",
    });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }

  const constructions = flexConstructions();
  assert.ok(constructions.length >= before);
  const flex = constructions.at(-1);
  assert.ok(flex);
  assert.equal(flex.options.headersTimeout, FLEX_SERVICE_TIER_WAIT_MS);
  assert.equal(flex.options.bodyTimeout, FLEX_SERVICE_TIER_WAIT_MS);
  assert.equal(FLEX_SERVICE_TIER_WAIT_MS, 1_800_000);
  // Same connection semantics as the standard dispatcher.
  assert.equal(flex.options.allowH2, getLlmHttpVersion() === "http2");
  assert.equal(flex.options.pipelining, 0);
});

test("default and explicitly non-flex fetches keep the standard dispatcher", async () => {
  const flexBefore = flexConstructions().length;
  const standardBefore = getLlmDispatcherConstructionsForTests().filter(
    (entry) => entry.kind === "standard",
  ).length;

  setLlmFetchTransportOverrideForTests(async () => new Response("ok"));
  try {
    await getLlmFetch()("https://example.com/v1/chat/completions", { method: "POST" });
    await getLlmFetch({})("https://example.com/v1/chat/completions", { method: "POST" });
    await getLlmFetch({ flexWaiting: false })("https://example.com/v1/chat/completions", {
      method: "POST",
    });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }

  assert.equal(flexConstructions().length, flexBefore);
  const standard = getLlmDispatcherConstructionsForTests()
    .filter((entry) => entry.kind === "standard")
    .at(-1);
  assert.ok(getLlmDispatcherConstructionsForTests().some((entry) => entry.kind === "standard"));
  assert.ok(standard);
  assert.equal(standard.options.headersTimeout, undefined);
  assert.equal(standard.options.bodyTimeout, undefined);
  assert.ok(
    getLlmDispatcherConstructionsForTests().filter((entry) => entry.kind === "standard").length >=
      standardBefore,
  );
});

test("flex fetch keeps UA merge and passes the abort signal through", async () => {
  configureLlmClientVersion("7.7.7");
  let capturedInit: RequestInit | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedInit = init;
    return new Response("ok");
  });

  const controller = new AbortController();
  try {
    const response = await getLlmFetch({ flexWaiting: true })("https://example.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.equal(capturedInit?.signal, controller.signal);
    assert.ok(capturedInit?.headers instanceof Headers);
    assert.equal(
      (capturedInit.headers as Headers).get("User-Agent"),
      `${encodeURIComponent(product.name)}/7.7.7`,
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
