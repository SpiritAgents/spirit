import assert from "node:assert/strict";
import { test } from "vitest";

import {
  rehydrateFinishTaskNoticesInConversation,
  rehydrateFinishTaskNoticesInTimeline,
} from "../../../../packages/sessions/dist/host/finish-task-notice-rehydrate.js";
import { DesktopMessageTimeline } from "../../../../packages/sessions/dist/host/message-timeline.js";
import {
  buildArchiveAssistantAuxFromConversation,
  restoreMessagesFromArchive,
} from "../../../../packages/sessions/dist/host/sessions.js";
import { buildV2StoredSession } from "./chat-schema-fixture.mjs";

test("buildArchiveAssistantAuxFromConversation persists finishTaskNotice", () => {
  const messages = [
    { id: 1, role: "user", content: "hello", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "hi there",
      pending: false,
      aux: { finishTaskNotice: "Task completed: greeted." },
    },
  ];

  assert.deepEqual(buildArchiveAssistantAuxFromConversation(messages), [
    {
      messageIndex: 1,
      finishTaskNotice: "Task completed: greeted.",
    },
  ]);
});

test("restoreMessagesFromArchive restores finishTaskNotice from v2 timeline", () => {
  const restored = restoreMessagesFromArchive(
    buildV2StoredSession({
      desktopMessageTimeline: [
        {
          turnId: 1,
          createdOrder: 1,
          userRow: {
            rowId: "row-user",
            messageId: 1,
            turnId: 1,
            kind: "user",
            createdOrder: 0,
            content: "hello",
            pending: false,
          },
          segments: [
            {
              segmentId: 1,
              turnId: 1,
              kind: "initial",
              status: "completed",
              createdOrder: 1,
              rows: [
                {
                  rowId: "row-assistant",
                  messageId: 2,
                  turnId: 1,
                  segmentId: 1,
                  kind: "assistant-text",
                  section: "after-tools",
                  createdOrder: 2,
                  content: "hi there",
                  pending: false,
                  aux: { finishTaskNotice: "Task completed: greeted." },
                },
              ],
            },
          ],
        },
      ],
    }),
  );

  assert.equal(restored[1]?.aux?.finishTaskNotice, "Task completed: greeted.");
});

test("rehydrateFinishTaskNoticesInConversation rebuilds notice from finish_task tool history", () => {
  const messages = [
    { id: 1, role: "user", content: "loop task", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "done for this turn",
      pending: false,
    },
  ];

  rehydrateFinishTaskNoticesInConversation(messages, [
    { role: "user", content: "loop task" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-finish",
          name: "finish_task",
          argumentsJson: '{"summary":"verified each message"}',
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-finish",
      content: "Task marked complete.",
    },
  ]);

  assert.equal(messages[1]?.aux?.finishTaskNotice, "Task completed: verified each message.");
});

test("rehydrateFinishTaskNoticesInTimeline applies notice to assistant text row by message id", () => {
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("loop task");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("done for this turn");
  timeline.completeActiveAssistantSegment();

  rehydrateFinishTaskNoticesInTimeline(timeline, [
    { role: "user", content: "loop task" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-finish",
          name: "finish_task",
          argumentsJson: '{"summary":"verified each message"}',
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-finish",
      content: "Task marked complete.",
    },
  ]);

  assert.equal(
    timeline.toMessages().find((message) => message.role === "assistant" && !message.tool)?.aux
      ?.finishTaskNotice,
    "Task completed: verified each message.",
  );
});
