import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createToolsRejectReasoningEffortFetch,
  patchToolsRejectReasoningEffortBody,
} from "./tools-reject-reasoning-effort-fetch.js";

const gatedConfig = { options: { toolsRejectReasoningEffort: true } } as const;

function captureFetch(): {
  fetchImpl: typeof fetch;
  bodies: () => Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  };
  return { fetchImpl, bodies: () => bodies };
}

test("patchToolsRejectReasoningEffortBody forces top-level and nested effort to none", () => {
  const patched = patchToolsRejectReasoningEffortBody({
    model: "m",
    tools: [{ type: "function", function: { name: "grep" } }],
    reasoning_effort: "high",
    reasoning: { effort: "max", summary: "auto" },
  });
  assert.equal(patched.reasoning_effort, "none");
  assert.deepEqual(patched.reasoning, { effort: "none", summary: "auto" });
});

test("patchToolsRejectReasoningEffortBody passes through without function tools or with none effort", () => {
  const noTools = {
    model: "m",
    tools: [{ type: "web_search" }],
    reasoning_effort: "high",
  };
  assert.equal(patchToolsRejectReasoningEffortBody(noTools), noTools);

  const noneEffort = {
    model: "m",
    tools: [{ type: "function", function: { name: "grep" } }],
    reasoning_effort: "none",
    reasoning: { effort: "none" },
  };
  assert.equal(patchToolsRejectReasoningEffortBody(noneEffort), noneEffort);

  const noEffort = {
    model: "m",
    tools: [{ type: "function", function: { name: "grep" } }],
  };
  assert.equal(patchToolsRejectReasoningEffortBody(noEffort), noEffort);
});

test("the fetch forces reasoning_effort none on POST /chat/completions when declared", async () => {
  const { fetchImpl, bodies } = captureFetch();
  const fetch = createToolsRejectReasoningEffortFetch(gatedConfig, fetchImpl);

  await fetch("https://gateway.example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      messages: [],
      tools: [{ type: "function", function: { name: "grep", parameters: {} } }],
      reasoning_effort: "high",
    }),
  });

  assert.equal(bodies()[0]?.["reasoning_effort"], "none");
});

test("the fetch leaves bodies untouched when the option is not declared", async () => {
  const { fetchImpl, bodies } = captureFetch();
  const fetch = createToolsRejectReasoningEffortFetch({}, fetchImpl);

  await fetch("https://gateway.example.test/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      tools: [{ type: "function", function: { name: "grep", parameters: {} } }],
      reasoning_effort: "high",
    }),
  });

  assert.equal(bodies()[0]?.["reasoning_effort"], "high");
});

test("the fetch ignores other endpoints, non-POST methods, and non-JSON bodies", async () => {
  const { fetchImpl, bodies } = captureFetch();
  const fetch = createToolsRejectReasoningEffortFetch(gatedConfig, fetchImpl);

  await fetch("https://gateway.example.test/v1/responses", {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      tools: [{ type: "function", function: { name: "grep", parameters: {} } }],
      reasoning_effort: "high",
    }),
  });
  assert.equal(bodies()[0]?.["reasoning_effort"], "high");

  const passthrough = createToolsRejectReasoningEffortFetch(gatedConfig, async (input, init) => {
    assert.equal(typeof init?.body, "string");
    return new Response("{}", { status: 200 });
  });
  await passthrough("https://gateway.example.test/v1/chat/completions", {
    method: "POST",
    body: "not json",
  });
});
