import assert from "node:assert/strict";
import { test } from "vitest";
import type { TextStreamPart } from "ai";

import type { ToolAgentRoundCompletion } from "../ports.js";
import type { ToolAgentState } from "../tool-agent.js";
import { createDeferred, responsesEventStreamToRuntimeEvents } from "./streaming.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";

const config: OpenResponsesTransportConfig = {
  transportKind: "open-responses",
  apiKey: "test",
  model: "openrouter/auto",
  sdk: "@ai-sdk/open-responses",
};

async function collectThinkingChunks(
  stream: AsyncIterable<TextStreamPart<any>>,
): Promise<string[]> {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const chunks: string[] = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    stream,
    {},
    state,
    [],
    completion,
  )) {
    if (event.kind === "thinking-chunk") {
      chunks.push(event.text);
    }
  }

  await completion.promise;
  return chunks;
}

test("responses streaming does not duplicate reasoning when raw SSE mirrors reasoning-delta", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: "raw",
      rawValue: {
        type: "response.reasoning_text.delta",
        delta: "The",
      },
    };
    yield { type: "reasoning-delta", id: "rs_1", text: "The" };
    // A faithful mirror carries every delta as a raw chunk too; the SDK deltas are suppressed.
    yield {
      type: "raw",
      rawValue: {
        type: "response.reasoning_text.delta",
        delta: " user",
      },
    };
    yield { type: "reasoning-delta", id: "rs_1", text: " user" };
    yield { type: "text-delta", id: "t1", text: "OK" };
    yield {
      type: "raw",
      rawValue: {
        type: "response.completed",
        response: { id: "resp-dedup" },
      },
    };
  }

  const chunks = await collectThinkingChunks(stream());
  assert.deepEqual(chunks, ["The", " user"]);
});

test("responses streaming uses only the first reasoning-delta item id", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "reasoning-delta", id: "rs_summary", text: "Plan." };
    yield { type: "reasoning-delta", id: "rs_full", text: " Full reasoning." };
    yield { type: "text-delta", id: "t2", text: "Done" };
    yield {
      type: "raw",
      rawValue: {
        type: "response.completed",
        response: { id: "resp-one-item" },
      },
    };
  }

  const chunks = await collectThinkingChunks(stream());
  assert.deepEqual(chunks, ["Plan."]);
});

test("responses streaming accepts a new reasoning-delta id after a built-in tool", async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: "reasoning-delta", id: "rs_before", text: "Need sources." };
    yield {
      type: "raw",
      rawValue: {
        type: "response.output_item.done",
        item: {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { type: "search", queries: ["SpaceXAI"] },
        },
      },
    };
    yield { type: "reasoning-delta", id: "rs_after", text: " Search finished." };
    yield { type: "text-delta", id: "t3", text: "Done" };
    yield {
      type: "raw",
      rawValue: {
        type: "response.completed",
        response: { id: "resp-after-builtin" },
      },
    };
  }

  const chunks = await collectThinkingChunks(stream());
  assert.deepEqual(chunks, ["Need sources.", " Search finished."]);
});

test("responses streaming falls back to raw reasoning when reasoning-delta is absent", async () => {
  const volcengineConfig: OpenResponsesTransportConfig = {
    transportKind: "open-responses",
    apiKey: "test",
    model: "doubao-seed-2-1-pro-260628",
    sdk: "@ai-sdk/open-responses",
  };

  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: "raw",
      rawValue: {
        type: "response.reasoning_summary_text.delta",
        delta: "Sum ",
      },
    };
    yield {
      type: "raw",
      rawValue: {
        type: "response.reasoning_summary_text.delta",
        delta: "values.",
      },
    };
    yield { type: "text-delta", id: "t1", text: "42" };
    yield {
      type: "raw",
      rawValue: {
        type: "response.completed",
        response: { id: "resp-volcengine" },
      },
    };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const chunks: string[] = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    volcengineConfig,
    stream(),
    {},
    state,
    [],
    completion,
  )) {
    if (event.kind === "thinking-chunk") {
      chunks.push(event.text);
    }
  }

  await completion.promise;
  assert.deepEqual(chunks, ["Sum ", "values."]);
  const assistant = state.messages.at(-1);
  assert.equal(
    assistant && typeof assistant === "object" && !Array.isArray(assistant)
      ? (assistant as { reasoning_content?: string }).reasoning_content
      : undefined,
    "Sum values.",
  );
});
