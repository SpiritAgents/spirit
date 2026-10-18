import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectEchoServerToolCallInsertions,
  createEchoServerToolCallsFetch,
  injectEchoServerToolCallInputItems,
  runWithEchoServerToolCallsContext,
  withEchoServerToolCallsContext,
} from "./echo-server-tool-calls.js";

const echoConfig = { options: { echoServerToolCalls: true } } as const;

test("injectEchoServerToolCallInputItems inserts web_search_call before the matching assistant", () => {
  const insertions = new Map([
    [
      0,
      [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
        },
      ],
    ],
  ]);
  const injected = injectEchoServerToolCallInputItems(
    [
      { role: "user", type: "message", content: [{ type: "input_text", text: "q1" }] },
      { role: "assistant", type: "message", content: [{ type: "output_text", text: "a1" }] },
      { role: "user", type: "message", content: [{ type: "input_text", text: "q2" }] },
    ],
    insertions,
  );

  assert.deepEqual(
    injected.map((item) =>
      typeof item === "object" && item !== null && "type" in item ? item.type : undefined,
    ),
    ["message", "web_search_call", "message", "message"],
  );
  assert.equal(
    typeof injected[1] === "object" && injected[1] !== null && "id" in injected[1]
      ? injected[1].id
      : undefined,
    "ws_1",
  );
});

test("collectEchoServerToolCallInsertions reads builtInOutputItems off assistant provider state", () => {
  const insertions = collectEchoServerToolCallInsertions([
    { role: "user", content: "q1" },
    {
      role: "assistant",
      content: "a1",
      providerState: {
        openResponses: {
          builtInOutputItems: [{ type: "web_search_call", id: "ws_hist", status: "completed" }],
        },
      },
    },
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
  ]);

  assert.equal(insertions.size, 1);
  assert.deepEqual(insertions.get(0), [
    { type: "web_search_call", id: "ws_hist", status: "completed" },
  ]);
});

test("the echo fetch injects stored web_search_call items into input when declared", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  const fetchImpl = createEchoServerToolCallsFetch(echoConfig, baseFetch);
  const insertions = collectEchoServerToolCallInsertions([
    { role: "user", content: "q1" },
    {
      role: "assistant",
      content: "a1",
      providerState: {
        openResponses: {
          builtInOutputItems: [{ type: "web_search_call", id: "ws_hist", status: "completed" }],
        },
      },
    },
    { role: "user", content: "q2" },
  ]);

  await runWithEchoServerToolCallsContext(insertions, () =>
    fetchImpl("https://responses.example.test/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "m",
        input: [
          { role: "user", type: "message", content: [{ type: "input_text", text: "q1" }] },
          { role: "assistant", type: "message", content: [{ type: "output_text", text: "a1" }] },
          { role: "user", type: "message", content: [{ type: "input_text", text: "q2" }] },
        ],
      }),
    }),
  );

  const input = capturedBody?.input as Array<{ type?: string; id?: string }> | undefined;
  assert.equal(
    input?.some((item) => item.type === "web_search_call" && item.id === "ws_hist"),
    true,
  );
});

test("withEchoServerToolCallsContext gates the context on the declared option", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };
  const fetchImpl = createEchoServerToolCallsFetch(echoConfig, baseFetch);
  const messages = [
    { role: "user", content: "q1" },
    {
      role: "assistant",
      content: "a1",
      providerState: {
        openResponses: {
          builtInOutputItems: [{ type: "web_search_call", id: "ws_hist" }],
        },
      },
    },
  ];
  const requestInit = {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      input: [
        { role: "assistant", type: "message", content: [{ type: "output_text", text: "a1" }] },
      ],
    }),
  } as const;

  // Option declared: the context reaches the fetch and the item lands in the body.
  await withEchoServerToolCallsContext(echoConfig, messages, () =>
    fetchImpl("https://responses.example.test/responses", requestInit),
  );
  let input = capturedBody?.input as Array<{ type?: string }>;
  assert.equal(
    input.some((item) => item.type === "web_search_call"),
    true,
  );

  // Option off: the context is never bound, so the body passes through untouched.
  await withEchoServerToolCallsContext({} as const, messages, () =>
    fetchImpl("https://responses.example.test/responses", requestInit),
  );
  input = capturedBody?.input as Array<{ type?: string }>;
  assert.equal(
    input.some((item) => item.type === "web_search_call"),
    false,
  );
});

test("the echo fetch passes through when the option is off or the URL is not /responses", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  const offFetch = createEchoServerToolCallsFetch({}, baseFetch);
  assert.equal(offFetch, baseFetch);

  const fetchImpl = createEchoServerToolCallsFetch(echoConfig, baseFetch);
  const insertions = new Map([[0, [{ type: "web_search_call", id: "ws_1" }]]]);
  await runWithEchoServerToolCallsContext(insertions, () =>
    fetchImpl("https://chat.example.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "m",
        input: [{ role: "assistant", type: "message", content: [] }],
      }),
    }),
  );

  const input = capturedBody?.input as Array<{ type?: string }>;
  assert.equal(
    input.some((item) => item.type === "web_search_call"),
    false,
  );
});
