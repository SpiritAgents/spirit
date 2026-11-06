import assert from "node:assert/strict";
import { test } from "vitest";

import { mapRuntimeEventToUpdate, createEventMapperState } from "../src/event-mapper.js";
import type { RuntimeEvent, JsonValue, BackgroundTaskRecord } from "@spiritagent/agent-core";

const SESSION_ID = "sess_test123";

test("background tasks keep distinct IDs, bounded output, and terminal metadata", () => {
  const state = createEventMapperState();
  const task: BackgroundTaskRecord = {
    version: 1,
    id: "task_000000000001",
    ownerSessionId: "session",
    runtimeId: "main",
    toolCallId: "call_1",
    kind: "shell",
    input: "command",
    argumentsJson: "{}",
    owner: { id: "host", pid: 1 },
    status: "running",
    background: true,
    outputPath: "/workspace/background-tasks/shell-task_000000000001.log",
    startedAtUnixMs: 0,
    updatedAtUnixMs: 0,
    elapsedMs: 0,
  };
  const second = { ...task, id: "task_000000000002", toolCallId: "call_2" };
  assert.equal(
    map({ kind: "background-task-changed", task }, state)?.update.sessionUpdate,
    "tool_call",
  );
  assert.equal(
    map({ kind: "background-task-changed", task: second }, state)?.update.sessionUpdate,
    "tool_call",
  );
  const output = map({ kind: "background-task-output", task, chunk: "x".repeat(8_000) }, state);
  assert.equal(output?.update.sessionUpdate, "tool_call_update");
  assert.equal(state.outputs.get(task.id)?.length, 4_000);
  assert.equal(state.outputs.has(second.id), false);
  const terminal = map(
    {
      kind: "background-task-notification",
      task: { ...task, status: "failed", exitCode: 2, elapsedMs: 2_500 },
      content: "Failed.",
      restored: true,
    },
    state,
  )?.update;
  assert.ok(terminal && terminal.sessionUpdate === "tool_call_update");
  assert.equal(terminal.toolCallId, task.id);
  assert.equal(terminal.status, "failed");
  assert.equal((terminal.rawOutput as { exit_code: number }).exit_code, 2);
  assert.equal(state.outputs.has(task.id), false);
});

/** Helper: create a fresh mapper state and call mapRuntimeEventToUpdate */
function map(event: RuntimeEvent<JsonValue>, state = createEventMapperState()) {
  return mapRuntimeEventToUpdate(event, SESSION_ID, state);
}

// --- assistant-chunk ---

test("assistant-chunk → agent_message_chunk", () => {
  const event: RuntimeEvent<JsonValue> = { kind: "assistant-chunk", text: "Hello world" };
  const result = map(event);
  assert.ok(result);
  assert.equal(result.sessionId, SESSION_ID);
  const update = (result as any).update;
  assert.equal(update.sessionUpdate, "agent_message_chunk");
  assert.equal(update.content.type, "text");
  assert.equal(update.content.text, "Hello world");
});

// --- streaming-tool-preview ---

test("streaming-tool-preview → tool_call with proper kind and title", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "streaming-tool-preview",
    toolCallId: "call_1",
    toolName: "read_file",
    argumentsJson: JSON.stringify({ path: "/home/user/main.ts" }),
  };
  const result = map(event);
  assert.ok(result);
  const update = (result as any).update;
  assert.equal(update.sessionUpdate, "tool_call");
  assert.equal(update.toolCallId, "call_1");
  assert.equal(update.kind, "read");
  assert.equal(update.status, "pending");
  assert.ok(update.title.includes("main.ts"));
  assert.ok(update.locations);
  assert.equal(update.locations.length, 1);
});

test("streaming-tool-preview: shell → execute kind", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "streaming-tool-preview",
    toolCallId: "call_2",
    toolName: "shell",
    argumentsJson: JSON.stringify({ command: "npm test" }),
  };
  const result = map(event);
  assert.ok(result);
  const update = (result as any).update;
  assert.equal(update.kind, "execute");
});

// --- tool-call-started ---

test("tool-call-started → tool_call_update in_progress", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "tool-call-started",
    toolCallId: "call_1",
    toolName: "read_file",
    request: {} as JsonValue,
  };
  const result = map(event);
  assert.ok(result);
  const update = (result as any).update;
  assert.equal(update.sessionUpdate, "tool_call_update");
  assert.equal(update.toolCallId, "call_1");
  assert.equal(update.status, "in_progress");
});

// --- tool-execution-finished ---

test("tool-execution-finished: success → completed", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "tool-execution-finished",
    execution: {
      toolCallId: "call_1",
      toolName: "read_file",
      request: {} as JsonValue,
      output: "file contents here",
      failed: false,
    },
  };
  const result = map(event);
  assert.ok(result);
  const update = (result as any).update;
  assert.equal(update.status, "completed");
  assert.ok(update.content);
  assert.ok(update.content.length > 0);
});

test("tool-execution-finished: failure → failed", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "tool-execution-finished",
    execution: {
      toolCallId: "call_2",
      toolName: "shell",
      request: {} as JsonValue,
      output: "exit code 1",
      failed: true,
    },
  };
  const result = map(event);
  assert.ok(result);
  const update = (result as any).update;
  assert.equal(update.status, "failed");
});

// --- context-usage-updated ---

test("context-usage-updated → undefined (no context window info available)", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "context-usage-updated",
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    },
  };
  const result = map(event);
  // LlmTokenUsage has no context window size, so we skip to avoid misleading size == used
  assert.equal(result, undefined);
});

// --- events that should return undefined ---

test("approval-requested → undefined", () => {
  const event: RuntimeEvent<JsonValue> = {
    kind: "approval-requested",
    approval: {} as any,
  };
  const result = map(event);
  assert.equal(result, undefined);
});

test("begin-assistant-response → undefined", () => {
  const event: RuntimeEvent<JsonValue> = { kind: "begin-assistant-response" };
  const result = map(event);
  assert.equal(result, undefined);
});

test("history-compacted → undefined", () => {
  const event: RuntimeEvent<JsonValue> = { kind: "history-compacted", droppedMessages: 5 };
  const result = map(event);
  assert.equal(result, undefined);
});

// --- thinking delta tracking ---

test("update-pending-assistant-thinking: emits delta, not full text", () => {
  const state = createEventMapperState();

  // First chunk: "Hello" (full text = "Hello", delta = "Hello")
  const r1 = mapRuntimeEventToUpdate(
    { kind: "update-pending-assistant-thinking", text: "Hello" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.ok(r1);
  assert.equal((r1 as any).update.content.text, "Hello");

  // Second chunk: full text = "Hello world", delta = " world"
  const r2 = mapRuntimeEventToUpdate(
    { kind: "update-pending-assistant-thinking", text: "Hello world" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.ok(r2);
  assert.equal((r2 as any).update.content.text, " world");

  // Third chunk: same full text, delta = "" → should return undefined
  const r3 = mapRuntimeEventToUpdate(
    { kind: "update-pending-assistant-thinking", text: "Hello world" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.equal(r3, undefined);
});

test("assistant-thinking-segment-finalized resets delta tracker", () => {
  const state = createEventMapperState();

  // First thinking segment
  mapRuntimeEventToUpdate(
    { kind: "update-pending-assistant-thinking", text: "Segment 1" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.equal(state.sentThinkingLength, 9);

  // Finalize segment → reset tracker
  const finalized = mapRuntimeEventToUpdate(
    { kind: "assistant-thinking-segment-finalized", text: "Segment 1" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.equal(finalized, undefined);
  assert.equal(state.sentThinkingLength, 0);

  // New segment starts fresh
  const r = mapRuntimeEventToUpdate(
    { kind: "update-pending-assistant-thinking", text: "New" } as RuntimeEvent<JsonValue>,
    SESSION_ID,
    state,
  );
  assert.ok(r);
  assert.equal((r as any).update.content.text, "New");
});
