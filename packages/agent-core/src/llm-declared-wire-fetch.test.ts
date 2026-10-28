import assert from "node:assert/strict";
import { test } from "vitest";

import { createDeclaredWireMergeFetch } from "./llm-declared-wire-fetch.js";

interface CapturedRequest {
  body: unknown;
  headers: Headers;
}

function capturingFetch(): {
  fetch: typeof fetch;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    captured.push({
      body,
      headers: new Headers(init?.headers),
    });
    return new Response("{}", { status: 200 });
  };
  return { fetch: fetchImpl, captured };
}

test("declared headers merge into every request and override transport defaults on conflict", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    { headers: { "cf-aig-gateway-id": "gw-1", "x-Custom": "yes" } },
    "chat-completions",
    base,
  );

  await fetch("https://upstream.example/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Custom": "transport-default" },
    body: JSON.stringify({ model: "m" }),
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.headers.get("cf-aig-gateway-id"), "gw-1");
  assert.equal(captured[0]!.headers.get("x-custom"), "yes");
  assert.equal(captured[0]!.headers.get("content-type"), "application/json");
});

test("provider body merges into every JSON request body top level and wins over transport defaults", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    { body: { stream_options: { include_usage: true }, temperature: 0.9 } },
    "chat-completions",
    base,
  );

  await fetch("https://upstream.example/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "m", temperature: 0.2 }),
  });

  assert.deepEqual(captured[0]!.body, {
    model: "m",
    temperature: 0.9,
    stream_options: { include_usage: true },
  });
});

test("thinkingSwitch selects the state patch from vendorExtendedThinking", async () => {
  const { fetch: base, captured } = capturingFetch();
  const declaration = {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } }, headers: { "x-thinking": "off" } },
  };
  const on = createDeclaredWireMergeFetch(
    { thinkingSwitch: declaration },
    "chat-completions",
    base,
  );
  const off = createDeclaredWireMergeFetch(
    { thinkingSwitch: declaration, vendorExtendedThinking: false },
    "chat-completions",
    base,
  );

  await on("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "m" }),
  });
  await off("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "m" }),
  });

  assert.deepEqual(captured[0]!.body, { model: "m", thinking: { type: "enabled" } });
  assert.equal(captured[0]!.headers.get("x-thinking"), null);
  assert.deepEqual(captured[1]!.body, { model: "m", thinking: { type: "disabled" } });
  assert.equal(captured[1]!.headers.get("x-thinking"), "off");
});

test("a declared thinking patch overrides the SDK-serialized thinking field", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      thinkingSwitch: { on: { body: { thinking: { type: "adaptive", display: "summarized" } } } },
    },
    "messages",
    base,
  );

  await fetch("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "m", thinking: { type: "enabled", budget_tokens: 1024 } }),
  });

  assert.deepEqual(captured[0]!.body, {
    model: "m",
    thinking: { type: "adaptive", display: "summarized" },
  });
});

test("merge precedence: transport bodyBase < provider body < thinkingSwitch patch < serviceTier patch", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      body: { flag: "provider", shared: "provider" },
      thinkingSwitch: { on: { body: { shared: "thinking", thinking: { type: "enabled" } } } },
      serviceTier: "fast",
      serviceTiers: { fast: { body: { shared: "tier", speed: "fast" } } },
    },
    "messages",
    base,
    { bodyBase: { flag: "base", shared: "base" } },
  );

  await fetch("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({ model: "m", shared: "sdk" }),
  });

  assert.deepEqual(captured[0]!.body, {
    model: "m",
    shared: "tier",
    flag: "provider",
    thinking: { type: "enabled" },
    speed: "fast",
  });
});

test("the gateway v3 surface never merges the thinking body patch (providerOptions form only)", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      thinkingSwitch: {
        on: {
          body: { thinking: { type: "adaptive" } },
          providerOptions: { anthropic: { thinking: { type: "adaptive" } } },
        },
      },
    },
    "gateway-v3",
    base,
  );

  await fetch("https://gateway.example/v3/ai/language-model", {
    method: "POST",
    body: JSON.stringify({ model: "anthropic/claude-opus-5.5" }),
  });

  // No top-level `thinking` field: the v3 protocol carries the encoding in call providerOptions.
  assert.deepEqual(captured[0]!.body, { model: "anthropic/claude-opus-5.5" });
});

test("the bedrock surface never merges the thinking body patch (Converse has no such field)", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      thinkingSwitch: {
        on: { body: { thinking: { type: "adaptive" } } },
        off: { body: { thinking: { type: "disabled" } } },
      },
      vendorExtendedThinking: false,
    },
    "bedrock",
    base,
  );

  await fetch("https://bedrock.us-east-1.amazonaws.com/model/m/converse", {
    method: "POST",
    body: JSON.stringify({ model: "us.anthropic.claude-sonnet-4-6" }),
  });

  // No top-level `thinking` field: Converse carries the off encoding in
  // `providerOptions.bedrock.reasoningConfig`, emitted by the bedrock provider-options builder.
  assert.deepEqual(captured[0]!.body, { model: "us.anthropic.claude-sonnet-4-6" });
});

test("serviceTier simple form maps to the OpenAI-family service_tier body field", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    { serviceTier: "priority", serviceTiers: ["default", "priority"] },
    "responses",
    base,
  );

  await fetch("https://upstream.example/v1/responses", {
    method: "POST",
    body: JSON.stringify({ model: "m" }),
  });

  assert.deepEqual(captured[0]!.body, { model: "m", service_tier: "priority" });
});

test("output effort replaces SDK thinking and effort while preserving the rest of output_config", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      effortSemantics: "output",
      effort: "high",
      body: { output_config: { format: { type: "json_schema" } } },
      thinkingSwitch: {
        defaultState: "on",
        on: { body: { thinking: { type: "adaptive" } } },
        off: { body: { thinking: { type: "between_tools" } } },
      },
      vendorExtendedThinking: false,
    },
    "messages",
    base,
  );

  await fetch("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({
      model: "claude-sonnet-5.5",
      thinking: { type: "enabled", budget_tokens: 12000 },
      output_config: { effort: "max", task_budget: 4096 },
    }),
  });

  assert.deepEqual(captured[0]!.body, {
    model: "claude-sonnet-5.5",
    thinking: { type: "between_tools" },
    output_config: { format: { type: "json_schema" }, task_budget: 4096, effort: "high" },
  });
});

test("default output effort and omit thinking remove SDK-inferred fields", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch(
    {
      effortSemantics: "output",
      thinkingSwitch: { defaultState: "off", off: "omit" },
    },
    "messages",
    base,
  );

  await fetch("https://upstream.example/v1/messages", {
    method: "POST",
    body: JSON.stringify({
      model: "claude-opus-4.8",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "text" } },
    }),
  });

  assert.deepEqual(captured[0]!.body, {
    model: "claude-opus-4.8",
    output_config: { format: { type: "text" } },
  });
});

test("no declarations returns the base fetch untouched", () => {
  const { fetch: base } = capturingFetch();
  assert.equal(createDeclaredWireMergeFetch({}, "chat-completions", base), base);
});

test("non-JSON bodies (uploads) are left untouched", async () => {
  const { fetch: base, captured } = capturingFetch();
  const fetch = createDeclaredWireMergeFetch({ body: { enable_search: true } }, "responses", base);

  await fetch("https://upstream.example/v1/files", {
    method: "POST",
    body: new URLSearchParams({ a: "b" }).toString(),
  });

  assert.equal(captured[0]!.body, "a=b");
  assert.equal(captured.length, 1);
});
