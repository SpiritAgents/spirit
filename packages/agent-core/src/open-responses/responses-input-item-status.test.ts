import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "../ports.js";
import {
  createDefaultInputItemStatusFetch,
  declaredDefaultInputItemStatus,
  patchResponsesInputItemStatus,
} from "./responses-input-item-status.js";

const statusConfig = { options: { defaultInputItemStatus: "completed" } } as const;

test("declaredDefaultInputItemStatus reads the declared non-empty string", () => {
  assert.equal(declaredDefaultInputItemStatus(statusConfig), "completed");
  assert.equal(declaredDefaultInputItemStatus({}), undefined);
  assert.equal(
    declaredDefaultInputItemStatus({ options: { defaultInputItemStatus: "  " } }),
    undefined,
  );
});

test("patchResponsesInputItemStatus fills the declared status on message and tool items", () => {
  const body = {
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "grep",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "ok",
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
        status: "completed",
      },
    ],
  } as JsonObject;

  patchResponsesInputItemStatus(body, "completed");

  const input = body.input as JsonObject[];
  assert.equal(input[0]?.status, "completed");
  assert.equal(input[1]?.status, "completed");
  assert.equal(input[2]?.status, "completed");
  assert.equal(input[3]?.status, "completed");
});

test("patchResponsesInputItemStatus preserves an existing status", () => {
  const body = {
    input: [
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "error",
        status: "failed",
      },
    ],
  } as JsonObject;

  patchResponsesInputItemStatus(body, "completed");

  const input = body.input as JsonObject[];
  assert.equal(input[0]?.status, "failed");
});

test("the fetch fills the declared status when the option is set and passes through otherwise", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };
  const init = {
    method: "POST",
    body: JSON.stringify({
      model: "m",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    }),
  } as const;

  const gatedFetch = createDefaultInputItemStatusFetch(statusConfig, baseFetch);
  await gatedFetch("https://responses.example.test/responses", init);
  let input = capturedBody?.input as Array<{ status?: string }>;
  assert.equal(input[0]?.status, "completed");

  // Option off: the unwrapped base fetch is returned and the body passes through untouched.
  const offFetch = createDefaultInputItemStatusFetch({}, baseFetch);
  assert.equal(offFetch, baseFetch);
  await offFetch("https://responses.example.test/responses", init);
  input = capturedBody?.input as Array<{ status?: string }>;
  assert.equal(input[0]?.status, undefined);
});
