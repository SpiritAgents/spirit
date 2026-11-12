import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildLongConversationListDemoMessages,
  LONG_CONVERSATION_LIST_DEMO_TURN_COUNT,
  longConversationListDemoStats,
} from "../../src/lib/long-conversation-list-demo.ts";

test("long conversation list demo builds multi-turn thinking, tools, and body", () => {
  const messages = buildLongConversationListDemoMessages();
  const stats = longConversationListDemoStats(messages);

  assert.equal(stats.turnCount, LONG_CONVERSATION_LIST_DEMO_TURN_COUNT);
  assert.ok(stats.messageCount >= LONG_CONVERSATION_LIST_DEMO_TURN_COUNT * 6);
  assert.ok(stats.toolCount >= LONG_CONVERSATION_LIST_DEMO_TURN_COUNT * 3);

  const userMessages = messages.filter((message) => message.role === "user");
  const thinkingMessages = messages.filter((message) => message.aux?.thinking?.trim());
  const bodyMessages = messages.filter(
    (message) => message.role === "assistant" && message.content.trim(),
  );

  assert.equal(userMessages.length, LONG_CONVERSATION_LIST_DEMO_TURN_COUNT);
  assert.equal(thinkingMessages.length, LONG_CONVERSATION_LIST_DEMO_TURN_COUNT);
  assert.equal(bodyMessages.length, LONG_CONVERSATION_LIST_DEMO_TURN_COUNT);
  assert.ok(messages.every((message) => message.id < 0));
});
