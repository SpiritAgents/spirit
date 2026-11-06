import assert from "node:assert/strict";
import { test } from "vitest";

import { syncSubagentToolStreamingOutput } from "../../dist-electron/src/host/conversation-continuation.js";
import { DesktopMessageTimeline } from "../../dist-electron/src/host/message-timeline.js";
import { shouldShowAssistantThinkingCollapsible } from "../../dist-electron/src/lib/conversation-thinking-ui.js";

function createHarness(tool, { includeParentTool = false } = {}) {
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("Delegate research");
  timeline.upsertToolMessage("delegate", tool);
  if (includeParentTool) {
    timeline.upsertToolMessage("parent-read", {
      toolCallId: "parent-read",
      toolName: "read_file",
      phase: "succeeded",
      headline: "Read",
      headlineDetail: "note.txt",
      detailLines: [],
    });
  }
  const child = {
    summary: {
      sessionId: "child",
      parentToolCallId: "delegate",
      title: "Research",
      status: "running",
      startedAtUnixMs: 1,
      updatedAtUnixMs: 2,
      latestMessage: "Child progress",
    },
    llmHistory: [{ role: "assistant", content: "Child progress" }],
  };
  const bundle = {
    runtime: {
      isBusy: () => true,
      toArchive: () => ({ llmHistory: [], subagentSessions: [child] }),
    },
    messages: timeline.toMessages(),
    messageTimeline: timeline,
    archiveHistory: [],
    archiveSubagentSessions: [],
    loopEnabled: false,
  };
  const ctx = {
    activeBundle: () => bundle,
    activeSessionId: () => "session",
    orchestrationFor: () => ({
      assistantMessages: {
        upsertToolMessage: () => {},
        removeToolMessage: () => {},
      },
    }),
  };
  return {
    timeline,
    sync: () => syncSubagentToolStreamingOutput(ctx, bundle),
    tool: () => timeline.toMessages().find((message) => message.tool)?.tool,
    parentTool: () =>
      timeline.toMessages().find((message) => message.tool?.toolCallId === "parent-read")?.tool,
  };
}

const baseTool = {
  toolCallId: "delegate",
  toolName: "subagent",
  phase: "running",
  headline: "Subagent running",
  headlineDetail: "Research",
  detailLines: [],
  argsExcerpt: '{"prompt":"Research"}',
};

test("a returned background Subagent stays terminal and does not suppress empty Thinking", () => {
  const harness = createHarness(
    {
      ...baseTool,
      phase: "succeeded",
      headline: "Subagent done",
      outputExcerpt: "Background task metadata",
      backgroundTask: {
        id: "task_1",
        toolCallId: "delegate",
        kind: "subagent",
        status: "running",
        background: true,
      },
      backgroundTaskOutput: { text: "Partial output", truncated: false },
    },
    { includeParentTool: true },
  );

  harness.sync();

  const tool = harness.tool();
  const messages = [
    ...harness.timeline.toMessages(),
    { id: 1000, role: "assistant", content: "", pending: true },
  ];
  const pending = messages.at(-1);
  const showsThinking = shouldShowAssistantThinkingCollapsible(
    pending,
    { kind: "thinking", statusText: "| Thinking…" },
    messages,
    messages.length - 1,
  );
  assert.deepEqual(
    {
      phase: tool.phase,
      outputExcerpt: tool.outputExcerpt,
      parentReadPhase: harness.parentTool()?.phase,
      showsThinking,
    },
    {
      phase: "succeeded",
      outputExcerpt: "Background task metadata",
      parentReadPhase: "succeeded",
      showsThinking: true,
    },
  );
});

test("a foreground Subagent keeps its existing streaming phase and output sync", () => {
  const harness = createHarness(baseTool);

  harness.sync();

  const tool = harness.tool();
  assert.equal(tool.phase, "running");
  assert.equal(tool.outputExcerpt, "Child progress");
});
