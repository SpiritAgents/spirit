import assert from "node:assert/strict";
import { test } from "vitest";

import type { LlmStreamEvent, ToolAgentRoundCompletion } from "../ports.js";
import type { ToolAgentState } from "../tool-agent.js";
import type { OpenResponsesTransportConfig } from "./responses-compat.js";
import { createDeferred, responsesEventStreamToRuntimeEvents } from "./streaming.js";

/**
 * Regression pin for the apply_patch streaming preview ladder. Two stream shapes are covered:
 * non-gateway Open Responses vendors (e.g. Volcengine Ark) deliver raw SSE chunks only, so the
 * raw path owns accumulation; Vercel AI Gateway interleaves raw chunks with parsed SDK
 * tool-input parts, where the SDK path owns deltas (dual-append regression, 2026-10-06).
 * (The 2026-10 investigation showed a provider that delivers tool arguments in one shot;
 * these tests prove the ladder works when deltas do arrive incrementally.)
 */
test("apply_patch streaming previews ladder as argument deltas arrive", async () => {
  const config = {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-6.1-sol",
    llmVendor: "volcengine",
  } as OpenResponsesTransportConfig;

  const fullArguments = JSON.stringify({
    operation: {
      type: "update_file",
      path: "TEST_REPRO.md",
      diff: "@@\n-# 问题复现测试文档\n+# Issue Reproduction\n*** End Patch",
    },
  });

  const deltas = [
    '{"operation":{"type":"update_file","path":"TEST_',
    'REPRO.md","diff":"@@\\n-',
    "# 问题复现测试文档",
    "\\n+# Issue Reproduction",
    "\\n*** End Patch",
  ];

  const parts = [
    {
      type: "raw",
      rawValue: {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "apply_patch",
          arguments: "",
        },
      },
    },
    ...deltas.map((delta) => ({
      type: "raw",
      rawValue: { type: "response.function_call_arguments.delta", item_id: "fc_1", delta },
    })),
    {
      type: "raw",
      rawValue: {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "apply_patch",
          arguments: fullArguments,
        },
      },
    },
  ];

  async function* partStream() {
    for (const part of parts) {
      yield part as never;
    }
  }

  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const state = { messages: [] } as unknown as ToolAgentState;
  const events: LlmStreamEvent[] = [];
  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    partStream(),
    { usage: undefined, totalUsage: undefined },
    state,
    [],
    completion,
  )) {
    events.push(event);
  }

  const previews = events.filter(
    (event): event is Extract<LlmStreamEvent, { kind: "streaming-tool-preview" }> =>
      event.kind === "streaming-tool-preview" && event.toolName === "apply_patch",
  );
  assert.ok(previews.length >= 3, `expected a preview ladder, got ${previews.length}`);
  assert.equal(previews[0]?.argumentsJson, "");
  assert.ok(
    previews.some((event) => event.argumentsJson.includes('"path":"TEST_')),
    "expected a preview once the path has streamed",
  );
  assert.ok(
    previews.some(
      (event) => event.argumentsJson.includes('"diff"') && event.argumentsJson.includes("+# Issue"),
    ),
    "expected a preview once diff content has streamed",
  );
  // The ladder ends at the richest content-changing emit (the "*** End Patch" trailer changes
  // no +/- counts, so it does not re-emit; byte-complete arguments arrive with the tool call).
  assert.ok(previews.at(-1)?.argumentsJson.includes('"path":"TEST_REPRO.md"'));
  assert.ok(previews.at(-1)?.argumentsJson.includes("+# Issue Reproduction"));
});

test("apply_patch previews emit before the path when the diff streams first", async () => {
  const config = {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-6.1-sol",
    llmVendor: "volcengine",
  } as OpenResponsesTransportConfig;

  // The observed failure mode: type and the diff body stream first, `path` arrives last.
  const deltas = [
    '{"operation":{"type":"update_file","diff":"@@\\n-',
    "old line",
    "\\n+new line",
    '\\n*** End Patch","path":"TEST_REPRO.md"}}',
  ];

  const parts = [
    {
      type: "raw",
      rawValue: {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_2",
          call_id: "call_2",
          name: "apply_patch",
          arguments: "",
        },
      },
    },
    ...deltas.map((delta) => ({
      type: "raw",
      rawValue: { type: "response.function_call_arguments.delta", item_id: "fc_2", delta },
    })),
  ];

  async function* partStream() {
    for (const part of parts) {
      yield part as never;
    }
  }

  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const state = { messages: [] } as unknown as ToolAgentState;
  const events: LlmStreamEvent[] = [];
  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    partStream(),
    { usage: undefined, totalUsage: undefined },
    state,
    [],
    completion,
  )) {
    events.push(event);
  }

  const previews = events.filter(
    (event): event is Extract<LlmStreamEvent, { kind: "streaming-tool-preview" }> =>
      event.kind === "streaming-tool-preview" && event.toolName === "apply_patch",
  );
  // A content-bearing preview fires while `path` has not streamed yet.
  const contentBeforePath = previews.find(
    (event) => event.argumentsJson.includes('"diff"') && !event.argumentsJson.includes('"path"'),
  );
  assert.ok(contentBeforePath, "expected a preview carrying diff content before the path arrives");
});

test("apply_patch previews stay clean when the gateway stream emits both raw and SDK parts", async () => {
  const config = {
    transportKind: "open-responses",
    apiKey: "test-key",
    model: "openai/gpt-6.1-sol",
    llmVendor: "vercel-ai-gateway",
  } as OpenResponsesTransportConfig;

  // 2026-10-06 incident pin: the real Vercel AI Gateway fullStream carries every wire event
  // twice — a raw Open Responses SSE chunk followed by a parsed SDK tool-input part. Both paths
  // appended to the same accumulator, so the incremental arguments doubled
  // ("{\"{\"operationoperation…"), the readiness signature never matched, and the card stayed on
  // the bare verb until output_item.done replaced the arguments wholesale.
  const deltas = [
    '{"operation":{"type":"up',
    'date_file","path":"TEST_',
    'REPRO.md","diff":"@@\\n-',
    "old line",
    "\\n+new line",
  ];
  const fullArguments = `${deltas.join("")}\\n*** End Patch"}`;

  const parts = [
    {
      type: "raw",
      rawValue: {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_3",
          call_id: "call_3",
          name: "apply_patch",
          arguments: "",
        },
      },
    },
    { type: "tool-input-start", id: "call_3", toolName: "apply_patch" },
    ...deltas.flatMap((delta) => [
      {
        type: "raw",
        rawValue: { type: "response.function_call_arguments.delta", item_id: "fc_3", delta },
      },
      { type: "tool-input-delta", id: "call_3", delta },
    ]),
    {
      type: "raw",
      rawValue: {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "fc_3",
          call_id: "call_3",
          name: "apply_patch",
          arguments: fullArguments,
        },
      },
    },
  ];

  async function* partStream() {
    for (const part of parts) {
      yield part as never;
    }
  }

  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const state = { messages: [] } as unknown as ToolAgentState;
  const events: LlmStreamEvent[] = [];
  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    partStream(),
    { usage: undefined, totalUsage: undefined },
    state,
    [],
    completion,
  )) {
    events.push(event);
  }

  const previews = events.filter(
    (event): event is Extract<LlmStreamEvent, { kind: "streaming-tool-preview" }> =>
      event.kind === "streaming-tool-preview" && event.toolName === "apply_patch",
  );
  assert.ok(previews.length >= 2, `expected a preview ladder, got ${previews.length}`);
  // Every incremental payload must be an exact prefix of the true arguments — any delta that
  // landed twice breaks this property immediately (e.g. `{"{"` is not a prefix of `{"operation"`).
  for (const preview of previews) {
    assert.ok(
      fullArguments.startsWith(preview.argumentsJson),
      `preview payload is not a clean prefix of the arguments: ${preview.argumentsJson.slice(0, 80)}`,
    );
  }
  // The signature readiness must fire mid-stream on the clean buffer, not only at done.
  const midStream = previews.find(
    (event) =>
      event.argumentsJson.includes('"type":"update_file"') &&
      event.argumentsJson.length < fullArguments.length,
  );
  assert.ok(midStream, "expected a content-bearing preview before output_item.done");
});
