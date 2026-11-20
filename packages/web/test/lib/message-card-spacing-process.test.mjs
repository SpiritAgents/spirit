import assert from "node:assert/strict";
import { test } from "vitest";

import {
  conversationRenderItemGapBeforePx,
  shouldTightenBodyAfterProcessGroup,
  shouldTightenAfterPreviousMetaMessage,
  shouldTightenAfterPreviousRenderItem,
} from "../../src/lib/message-card-spacing.ts";
import { conversationRenderItemGapBeforePxAt } from "../../src/lib/conversation-virtual-row-size.ts";

test("process groups tighten both gray cards and body text", () => {
  const messages = [
    { id: 1, role: "user", content: "hi", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: false,
      tool: { toolName: "read_file", phase: "succeeded", headline: "Viewed", detailLines: [] },
    },
    { id: 3, role: "assistant", content: "Answer", pending: false },
  ];
  const previousItem = {
    kind: "process-group",
    groupId: "main:process:2",
    messageIndices: [1],
    toolCounts: {
      explore: 1,
      view: 0,
      create: 0,
      edit: 0,
      delete: 0,
      ask: 0,
      diagnose: 0,
      generate: 0,
      run: 0,
      other: 0,
    },
  };
  assert.equal(shouldTightenAfterPreviousRenderItem(previousItem, messages[2], messages), false);
  assert.equal(shouldTightenBodyAfterProcessGroup(previousItem, messages[2]), true);

  const thought = {
    id: 4,
    role: "assistant",
    content: "",
    pending: false,
    aux: { thinking: "Checking the result." },
  };
  assert.equal(shouldTightenAfterPreviousRenderItem(previousItem, thought, messages), true);
  assert.equal(shouldTightenBodyAfterProcessGroup(previousItem, thought), false);
});

test("shouldTightenAfterPreviousMetaMessage packs continued Thought rows", () => {
  const messages = [
    { id: 1, role: "user", content: "nih", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: false,
      aux: { thinking: "Interrupted reasoning." },
    },
    {
      id: 3,
      role: "assistant",
      content: "",
      pending: true,
      aux: { thinking: "Continued reasoning." },
    },
  ];

  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[1], messages[2]), true);

  const currentWithBody = {
    ...messages[2],
    content: "Hello",
  };
  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[1], currentWithBody), false);
});

test("shouldTightenAfterPreviousMetaMessage packs tool-turn Thought→Thinking", () => {
  const messages = [
    { id: 1, role: "user", content: "hi", pending: false },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: false,
      tool: { toolName: "read_file", phase: "running", headline: "read", detailLines: [] },
    },
    {
      id: 3,
      role: "assistant",
      content: "",
      pending: false,
      aux: { thinking: "Planning which lines to read." },
    },
    {
      id: 4,
      role: "assistant",
      content: "",
      pending: true,
      aux: { thinking: "Reading the rest of the file now." },
    },
  ];

  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[2], messages[3]), true);
});

test("gray card spacing includes tools, notifications, and finish_task notices", () => {
  const messages = [
    {
      id: 1,
      role: "assistant",
      content: "",
      pending: false,
      aux: { thinking: "Planning." },
    },
    {
      id: 2,
      role: "assistant",
      content: "",
      pending: false,
      tool: { toolName: "read_file", phase: "succeeded", headline: "Read", detailLines: [] },
    },
    {
      id: 3,
      role: "assistant",
      content: "",
      pending: false,
      tool: {
        toolName: "shell",
        phase: "succeeded",
        headline: "Ran",
        detailLines: [],
        taskNotification: { restored: false },
      },
    },
    {
      id: 4,
      role: "assistant",
      content: "",
      pending: false,
      aux: { finishTaskNotice: "Task complete." },
    },
    {
      id: 5,
      role: "assistant",
      content: "",
      pending: false,
      aux: { compaction: "Compacted." },
    },
    { id: 6, role: "assistant", content: "Answer", pending: false },
  ];
  const items = messages.map((_, messageIndex) => ({ kind: "message", messageIndex }));

  assert.deepEqual(
    items.map((_, index) => conversationRenderItemGapBeforePxAt(index, items, messages)),
    [0, 12, 12, 12, 12, 12],
  );
});

test("conversationRenderItemGapBeforePx maps virtual row spacing", () => {
  assert.equal(
    conversationRenderItemGapBeforePx({
      isFirst: true,
      compactAfterPrevious: false,
      tightenAfterPreviousMeta: false,
      tightenBodyAfterProcessGroup: false,
    }),
    0,
  );
  assert.equal(
    conversationRenderItemGapBeforePx({
      isFirst: false,
      compactAfterPrevious: false,
      tightenAfterPreviousMeta: false,
      tightenBodyAfterProcessGroup: false,
    }),
    24,
  );
  assert.equal(
    conversationRenderItemGapBeforePx({
      isFirst: false,
      compactAfterPrevious: true,
      tightenAfterPreviousMeta: false,
      tightenBodyAfterProcessGroup: false,
    }),
    12,
  );
  assert.equal(
    conversationRenderItemGapBeforePx({
      isFirst: false,
      compactAfterPrevious: false,
      tightenAfterPreviousMeta: true,
      tightenBodyAfterProcessGroup: false,
    }),
    12,
  );
  assert.equal(
    conversationRenderItemGapBeforePx({
      isFirst: false,
      compactAfterPrevious: false,
      tightenAfterPreviousMeta: false,
      tightenBodyAfterProcessGroup: true,
    }),
    12,
  );
});
