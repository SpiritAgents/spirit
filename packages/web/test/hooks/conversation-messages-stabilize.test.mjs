import assert from "node:assert/strict";
import { test } from "vitest";

import {
  jsonLikeEquals,
  stabilizeConversationMessages,
} from "../../src/hooks/useConversationViewState.ts";

function makeMessage(overrides = {}) {
  return {
    id: 1,
    role: "assistant",
    content: "hello",
    pending: false,
    ...overrides,
  };
}

test("jsonLikeEquals treats undefined fields as absent and compares deeply", () => {
  assert.equal(jsonLikeEquals({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(jsonLikeEquals({ a: 1 }, { a: 2 }), false);
  assert.equal(jsonLikeEquals({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] }), true);
  assert.equal(jsonLikeEquals({ a: [1] }, { a: [1, 2] }), false);
  assert.equal(jsonLikeEquals("x", "x"), true);
  assert.equal(jsonLikeEquals(null, {}), false);
  assert.equal(jsonLikeEquals([], {}), false);
});

test("stabilizeConversationMessages reuses the whole array when nothing changed", () => {
  const previous = [makeMessage({ id: 1 }), makeMessage({ id: 2, content: "b" })];
  const next = [makeMessage({ id: 1 }), makeMessage({ id: 2, content: "b" })];

  const stabilized = stabilizeConversationMessages(previous, next);
  assert.equal(stabilized, previous);
});

test("stabilizeConversationMessages reuses unchanged message objects on streaming delta", () => {
  const previous = [
    makeMessage({ id: 1, role: "user", content: "hi" }),
    makeMessage({ id: 2, content: "partial", pending: true }),
  ];
  const next = [
    makeMessage({ id: 1, role: "user", content: "hi" }),
    makeMessage({ id: 2, content: "partial more", pending: true }),
  ];

  const stabilized = stabilizeConversationMessages(previous, next);
  assert.notEqual(stabilized, previous);
  assert.equal(stabilized[0], previous[0]);
  assert.equal(stabilized[1], next[1]);
});

test("stabilizeConversationMessages detects nested tool / aux changes", () => {
  const previous = [
    makeMessage({
      id: 1,
      content: "",
      tool: { toolCallId: "t1", toolName: "shell", phase: "running" },
    }),
  ];
  const next = [
    makeMessage({
      id: 1,
      content: "",
      tool: { toolCallId: "t1", toolName: "shell", phase: "succeeded" },
    }),
  ];

  const stabilized = stabilizeConversationMessages(previous, next);
  assert.equal(stabilized[0], next[0]);
});

test("stabilizeConversationMessages handles appended messages", () => {
  const previous = [makeMessage({ id: 1 })];
  const next = [makeMessage({ id: 1 }), makeMessage({ id: 2, content: "new" })];

  const stabilized = stabilizeConversationMessages(previous, next);
  assert.equal(stabilized.length, 2);
  assert.equal(stabilized[0], previous[0]);
  assert.equal(stabilized[1], next[1]);
});
