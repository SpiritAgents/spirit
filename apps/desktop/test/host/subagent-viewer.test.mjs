import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildSubagentConversationSnapshots,
  resolveSubagentPromptFromTaskFields,
} from "@spiritagent/host-internal";

test("buildSubagentConversationSnapshots maps user, assistant text, and tool results", () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: "user", content: "Inspect the repo layout" },
      {
        role: "assistant",
        content: "I will read README first.",
        toolCalls: [
          {
            id: "call_read_1",
            name: "read_file",
            argumentsJson: '{"path":"README.md"}',
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_read_1",
        content: "# Spirit",
      },
      { role: "assistant", content: "README mentions Desktop host." },
    ],
    { sessionStatus: "completed" },
  );

  assert.equal(messages.length, 4);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.content, "Inspect the repo layout");
  assert.equal(messages[1]?.role, "assistant");
  assert.equal(messages[1]?.content, "I will read README first.");
  assert.equal(messages[2]?.tool?.toolName, "read_file");
  assert.equal(messages[2]?.tool?.phase, "succeeded");
  assert.match(messages[2]?.tool?.outputExcerpt ?? "", /Spirit/);
  assert.equal(messages[3]?.content, "README mentions Desktop host.");
});

test("buildSubagentConversationSnapshots hides only the leading user timestamp metadata", () => {
  const messages = buildSubagentConversationSnapshots(
    [
      {
        role: "user",
        content:
          "<user_message_at>2026-11-06T01:00:00.000+08:00</user_message_at>\nInspect the repo",
      },
      {
        role: "user",
        content: "Keep this inline <user_message_at>literal</user_message_at> text",
      },
    ],
    { sessionStatus: "completed" },
  );
  assert.deepEqual(
    messages.map((message) => message.content),
    ["Inspect the repo", "Keep this inline <user_message_at>literal</user_message_at> text"],
  );
});

test("buildSubagentConversationSnapshots marks unresolved tools as running while session runs", () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: "user", content: "Run shell check" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_shell_1",
            name: "shell",
            argumentsJson: '{"command":"git status"}',
          },
        ],
      },
    ],
    { sessionStatus: "running" },
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.tool?.phase, "running");
  assert.equal(messages[1]?.pending, true);
});

test("buildSubagentConversationSnapshots marks last unresolved tool as pending-approval when blocked", () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: "user", content: "Delete temp file" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_delete_1",
            name: "delete_file",
            argumentsJson: '{"path":"tmp.txt"}',
          },
        ],
      },
    ],
    { sessionStatus: "blocked" },
  );

  assert.equal(messages[1]?.tool?.phase, "pending-approval");
});

test("buildSubagentConversationSnapshots maps assistant reasoning to thinking aux rows", () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: "user", content: "Say hello" },
      {
        role: "assistant",
        content: "Hello",
        providerState: { reasoning_content: "The subagent outputs hello" },
      },
    ],
    { sessionStatus: "completed" },
  );

  assert.equal(messages.length, 3);
  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[1]?.role, "assistant");
  assert.equal(messages[1]?.content, "");
  assert.equal(messages[1]?.aux?.thinking, "The subagent outputs hello");
  assert.equal(messages[2]?.content, "Hello");
});

test("resolveSubagentPromptFromTaskFields prefers task then context summary", () => {
  assert.equal(
    resolveSubagentPromptFromTaskFields({
      task: "  Run tests  ",
      contextSummary: "fallback",
      title: "title",
    }),
    "Run tests",
  );
  assert.equal(
    resolveSubagentPromptFromTaskFields({
      contextSummary: "Need grep",
      title: "title",
    }),
    "Need grep",
  );
});
