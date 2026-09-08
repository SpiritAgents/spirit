import assert from "node:assert/strict";
import { test } from "vitest";

import { DesktopAssistantMessageStateMachine } from "../../dist-electron/src/host/assistant-message-state.js";
import { DesktopConversationSnapshotView } from "../../dist-electron/src/host/conversation-snapshot.js";
import { DesktopMessageTimeline } from "../../dist-electron/src/host/message-timeline.js";
import { buildVisibleMessageSnapshots } from "../../dist-electron/src/host/message-snapshots.js";
import { createDesktopRewindMetadata } from "../../dist-electron/src/host/rewind.js";
import {
  DesktopRuntimeEventOrchestrator,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
  splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview,
  runtimeEventsIncludeAppliedResponsesBuiltInToolStreamingUpdate,
  runtimeEventsIncludeAppliedHostToolStreamingUpdate,
} from "../../dist-electron/src/host/runtime-event-orchestrator.js";
import { shouldShowAssistantThinkingCollapsible } from "../../dist-electron/src/lib/conversation-thinking-ui.js";
import i18n from "../../dist-electron/src/lib/i18n-host.js";

function createHarness() {
  let messages = [];
  let nextMessageId = 1;
  let nextTimelineMessageId = 1;
  let nextSegmentKind = "initial";
  let completedTurnResult = undefined;
  const allocateMessageId = () => nextMessageId++;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextTimelineMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextTimelineMessageId) {
        nextTimelineMessageId = messageId + 1;
      }
    },
  });
  const assistantMessages = new DesktopAssistantMessageStateMachine({
    messages: () => messages,
    setMessages: (nextMessages) => {
      messages = nextMessages;
    },
    allocateMessageId,
    isRuntimeBusy: () => true,
  });
  const conversationSnapshotView = new DesktopConversationSnapshotView(allocateMessageId);
  const orchestrator = new DesktopRuntimeEventOrchestrator({
    runtime: () => ({
      isBusy: () => true,
      takeCompletedTurnResult: () => {
        const next = completedTurnResult;
        completedTurnResult = undefined;
        return next;
      },
    }),
    messages: () => messages,
    allocateMessageId,
    assistantMessages,
    messageTimeline: () => timeline,
    takeNextAssistantSegmentKind: () => {
      const kind = nextSegmentKind;
      nextSegmentKind = "initial";
      return kind;
    },
    conversationSnapshotView,
    clearCurrentTurnSkills: () => {},
    setLastRuntimeError: () => {},
    refreshArchiveFromRuntime: () => {},
    dispatchExtensionEvent: () => {},
    bindFileChangesToToolMessage: () => {},
  });

  return {
    assistantMessages,
    messages: () => messages,
    orchestrator,
    setNextSegmentKind(kind) {
      nextSegmentKind = kind;
    },
    setCompletedTurnResult(result) {
      completedTurnResult = result;
    },
    timeline,
    pushUser(content) {
      const message = {
        id: allocateMessageId(),
        role: "user",
        content,
        pending: false,
      };
      messages.push(message);
      timeline.beginUserTurn(content, { messageId: message.id });
    },
  };
}

function rowToken(message) {
  if (message.role === "user") return "user";
  if (message.tool) return `tool:${message.tool.toolCallId}`;
  if (message.aux?.thinking) return `thinking:${message.aux.thinking}`;
  if (message.pending) return "pending-assistant";
  return `assistant:${message.content}`;
}

function visibleRowTokens(messages) {
  return buildVisibleMessageSnapshots({
    messages,
    rewind: createDesktopRewindMetadata(),
  }).map(rowToken);
}

test("abort preemptive thinking finalize ignores duplicate deferred after-stream finalize event", () => {
  const harness = createHarness();
  const thinking = "The user just sent random typing.";
  harness.pushUser("enn");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "update-pending-assistant-thinking", text: thinking },
  ]);

  harness.orchestrator.finalizeInterruptedDeferredThinking({ thinkingText: thinking });
  harness.timeline.abortActiveAssistantSegment();

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "assistant-thinking-segment-finalized",
      text: thinking,
      placement: "after-stream",
    },
  ]);

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), ["user", `thinking:${thinking}`]);
});

test("runtime events are mirrored into continuation timeline segments", () => {
  const harness = createHarness();
  harness.pushUser("inspect this file");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "assistant-thinking-segment-finalized", text: "first reasoning" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-1",
      toolName: "read_file",
      argumentsJson: "{}",
    },
    { kind: "remove-pending-assistant" },
  ]);

  harness.assistantMessages.resetStreamingPlacementState(false);
  harness.setNextSegmentKind("continuation");
  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-2",
      toolName: "read_file",
      argumentsJson: "{}",
    },
    { kind: "assistant-thinking-segment-finalized", text: "second reasoning" },
    { kind: "remove-pending-assistant" },
  ]);

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    "user",
    "thinking:first reasoning",
    "tool:call-1",
    "thinking:second reasoning",
    "tool:call-2",
  ]);
});

test("deferred after-stream thinking is materialized before the first tool preview", () => {
  const harness = createHarness();
  harness.pushUser("cause an error");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "assistant-chunk", text: "Let me check the end of the file first." },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Plan to read the file end first.",
      placement: "after-stream",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "read-1",
      toolName: "read_file",
      argumentsJson: '{"path":"packages/agent-core/src/ports.ts"}',
    },
  ]);

  const tokens = visibleRowTokens(harness.timeline.toMessages());
  const thinkingIndex = tokens.findIndex(
    (token) => token === "thinking:Plan to read the file end first.",
  );
  const toolIndex = tokens.findIndex((token) => token === "tool:read-1");
  assert.ok(thinkingIndex >= 0 && toolIndex >= 0 && thinkingIndex < toolIndex);
});

test("after-stream thinking is finalized before later tools when the turn already has a tool preview", () => {
  const harness = createHarness();
  harness.pushUser("run diagnostics");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Pick a TypeScript file.",
      placement: "after-stream",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "glob-1",
      toolName: "glob",
      argumentsJson: '{"pattern":"**/*.ts"}',
    },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Use packages/agent-core/src/runtime/helpers.ts.",
      placement: "after-stream",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "diag-1",
      toolName: "get_diagnostics",
      argumentsJson: '{"paths":["packages/agent-core/src/runtime/helpers.ts"]}',
    },
  ]);

  const tokens = visibleRowTokens(harness.timeline.toMessages());
  const globIndex = tokens.findIndex((token) => token === "tool:glob-1");
  const firstThinkingIndex = tokens.findIndex(
    (token) => token === "thinking:Pick a TypeScript file.",
  );
  const secondThinkingIndex = tokens.findIndex(
    (token) => token === "thinking:Use packages/agent-core/src/runtime/helpers.ts.",
  );
  const diagIndex = tokens.findIndex((token) => token === "tool:diag-1");
  assert.ok(firstThinkingIndex >= 0 && globIndex >= 0 && firstThinkingIndex < globIndex);
  assert.ok(secondThinkingIndex > globIndex && secondThinkingIndex < diagIndex);
});

test("completed turn result reuses the finalized assistant text row instead of duplicating it", () => {
  const harness = createHarness();
  harness.pushUser("Hi");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "assistant-chunk", text: "Hi! I'm the Spirit." },
    { kind: "assistant-thinking-segment-finalized", text: "The user greeted me." },
    { kind: "assistant-response-completed" },
  ]);

  harness.setCompletedTurnResult({
    kind: "completed",
    assistantText: "Hi! I'm the Spirit.",
    toolExecutions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    "user",
    "thinking:The user greeted me.",
    "assistant:Hi! I'm the Spirit.",
  ]);
});

test("completed greeting keeps finalized thinking above the final assistant text", () => {
  const harness = createHarness();
  harness.pushUser("hello there");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "assistant-chunk", text: "Hi! How can I help you?" },
    {
      kind: "assistant-thinking-segment-finalized",
      text: 'The user is just greeting me with "hello there".',
    },
    { kind: "assistant-response-completed" },
  ]);

  harness.setCompletedTurnResult({
    kind: "completed",
    assistantText: "Hi! How can I help you?",
    toolExecutions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    "user",
    'thinking:The user is just greeting me with "hello there".',
    "assistant:Hi! How can I help you?",
  ]);
});

test("after-stream thinking stays on the body row until completion (same-instance collapse)", () => {
  const harness = createHarness();
  harness.pushUser("hi");

  // Real streaming order: thinking deltas, then after-stream finalize emitted right before
  // the first body chunk. The thinking must NOT split yet — it stays on the streaming body
  // row so AnimatedCollapse can collapse on the same instance once the body arrives.
  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "update-pending-assistant-thinking", text: "Planning the greeting." },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Planning the greeting.",
      placement: "after-stream",
    },
    { kind: "assistant-chunk", text: "Hello!" },
  ]);

  const streaming = harness.timeline
    .toMessages()
    .filter((message) => message.role === "assistant" && !message.tool);
  assert.equal(streaming.length, 1);
  assert.equal(streaming[0].content, "Hello!");
  assert.equal(streaming[0].aux?.thinking, "Planning the greeting.");

  harness.orchestrator.applyRuntimeHostEvents([{ kind: "assistant-response-completed" }]);

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    "user",
    "thinking:Planning the greeting.",
    "assistant:Hello!",
  ]);
});

test("empty assistant turn flushes deferred after-stream thinking on consumeCompletedTurnResult", () => {
  const harness = createHarness();
  harness.pushUser("hi");

  // Mirrors agent-core `done` with empty pendingAssistantTextStore:
  // remove-pending-assistant, then clearStreamingUiState thinking finalize — no
  // assistant-response-completed.
  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "update-pending-assistant-thinking", text: "Only thinking, no body." },
    { kind: "remove-pending-assistant" },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Only thinking, no body.",
      placement: "after-stream",
    },
  ]);

  harness.setCompletedTurnResult({
    kind: "completed",
    assistantText: "",
    toolExecutions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    "user",
    "thinking:Only thinking, no body.",
  ]);
});

test("read_file streaming preview shows filename from partial arguments JSON", () => {
  const harness = createHarness();
  harness.pushUser("read Cargo.toml");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-partial",
      toolName: "read_file",
      argumentsJson: '{"path":"Cargo.toml"',
    },
  ]);

  const previewTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "call-partial")?.tool;
  assert.equal(previewTool?.phase, "preview");
  assert.equal(previewTool?.headline, i18n.t("tool.read", { context: "running" }));
  assert.equal(previewTool?.headlineDetail, "Cargo.toml");

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-partial",
      toolName: "read_file",
      argumentsJson: '{"path":"Cargo.toml","offset":1,"limit":80',
    },
  ]);

  const updatedTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "call-partial")?.tool;
  assert.equal(updatedTool?.headlineDetail, "Cargo.toml 1 - 80");
});

test("tool previews keep live and finalized thinking above the tool card without duplicates", () => {
  const harness = createHarness();
  harness.pushUser("read README.md");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-1",
      toolName: "read_file",
      argumentsJson: '{"path":"README.md","offset":10,"limit":41}',
    },
    { kind: "update-pending-assistant-thinking", text: "Need to inspect README.md first." },
  ]);

  assert.deepEqual(visibleRowTokens(harness.timeline.toMessages()), [
    "user",
    "thinking:Need to inspect README.md first.",
    "tool:call-1",
  ]);

  const previewTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "call-1")?.tool;
  assert.equal(previewTool?.phase, "preview");
  assert.equal(previewTool?.headline, i18n.t("tool.read", { context: "running" }));
  assert.equal(previewTool?.headlineDetail, "README.md 10 - 50");

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "tool-call-started",
      toolCallId: "call-1",
      toolName: "read_file",
      request: { path: "README.md", offset: 10, limit: 41 },
    },
    { kind: "assistant-thinking-segment-finalized", text: "Need to inspect README.md first." },
  ]);

  assert.deepEqual(visibleRowTokens(harness.timeline.toMessages()), [
    "user",
    "thinking:Need to inspect README.md first.",
    "tool:call-1",
  ]);

  const runningTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "call-1")?.tool;
  assert.equal(runningTool?.phase, "running");
  assert.equal(runningTool?.headline, i18n.t("tool.read", { context: "running" }));
  assert.equal(runningTool?.headlineDetail, "README.md 10 - 50");
});

test("tool previews do not clone the first thinking block when multiple tool previews arrive", () => {
  const harness = createHarness();
  harness.pushUser("parallel tools");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "replace-pending-assistant",
      text: "OK, I'll call two tools concurrently, then run echo.",
    },
    {
      kind: "update-pending-assistant-thinking",
      text: "The user is asking me to call a few tools.",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-1",
      toolName: "ls",
      argumentsJson: "{}",
    },
    {
      kind: "update-pending-assistant-thinking",
      text: "The user is asking me to call a few tools (preferably concurrently).",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-2",
      toolName: "read_file",
      argumentsJson: "{}",
    },
  ]);

  const messages = harness.timeline.toMessages();
  const assistantRows = messages.filter((message) => message.role === "assistant" && !message.tool);

  assert.equal(assistantRows.length, 1);
  assert.equal(assistantRows[0].content, "OK, I'll call two tools concurrently, then run echo.");
  assert.equal(
    assistantRows[0].aux?.thinking,
    "The user is asking me to call a few tools (preferably concurrently).",
  );
  assert.deepEqual(
    messages.filter((message) => message.tool).map((message) => message.tool.toolCallId),
    ["call-1", "call-2"],
  );
});

test("finish_task streaming preview updates finishTaskNotice on assistant text row", () => {
  const harness = createHarness();
  harness.pushUser("loop task");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "replace-pending-assistant",
      text: "Understood, I will call finish_task at the end of each reply.",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"verified each',
    },
  ]);

  const assistantRow = harness.timeline
    .toMessages()
    .find((message) => message.role === "assistant" && !message.tool);
  assert.equal(
    assistantRow?.content,
    "Understood, I will call finish_task at the end of each reply.",
  );
  assert.equal(assistantRow?.aux?.finishTaskNotice, "Task completed: verified each");
  assert.equal(
    harness.timeline.toMessages().some((message) => message.tool?.toolName === "finish_task"),
    false,
  );

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"called finish_task after verifying every message"}',
    },
  ]);

  const updatedAssistantRow = harness.timeline
    .toMessages()
    .find((message) => message.role === "assistant" && !message.tool);
  assert.equal(
    updatedAssistantRow?.aux?.finishTaskNotice,
    "Task completed: called finish_task after verifying every message.",
  );
});

test("failed finish_task clears streaming finishTaskNotice preview", () => {
  const harness = createHarness();
  harness.pushUser("call it again");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "replace-pending-assistant",
      text: "This time it errored: unknown tool finish_task.",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"calling again per user request"}',
    },
    {
      kind: "tool-execution-finished",
      execution: {
        toolCallId: "call-finish",
        toolName: "finish_task",
        request: { name: "finish_task", summary: "calling again per user request" },
        output: "[tool schema error] Unknown tool: finish_task",
        failed: true,
      },
    },
  ]);

  const assistantRow = harness.timeline
    .toMessages()
    .find((message) => message.role === "assistant" && !message.tool);
  assert.equal(assistantRow?.content, "This time it errored: unknown tool finish_task.");
  assert.equal(assistantRow?.aux?.finishTaskNotice, undefined);
});

test("failed finish_task clears notice when preview and tool-finished are split across batches", () => {
  const harness = createHarness();
  harness.pushUser("call it again");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"reconfirmed finish_task works"}',
    },
  ]);

  const afterPreview = harness.timeline
    .toMessages()
    .find((message) => message.role === "assistant" && !message.tool);
  assert.equal(
    afterPreview?.aux?.finishTaskNotice,
    "Task completed: reconfirmed finish_task works.",
  );

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "tool-execution-finished",
      execution: {
        toolCallId: "call-finish",
        toolName: "finish_task",
        request: { name: "finish_task", summary: "reconfirmed finish_task works" },
        output: "[tool schema error] Unknown tool: finish_task",
        failed: true,
      },
    },
    {
      kind: "replace-pending-assistant",
      text: "This call failed — it returned `Unknown tool: finish_task`.",
    },
  ]);

  const assistantRow = harness.timeline
    .toMessages()
    .find((message) => message.role === "assistant" && !message.tool);
  assert.equal(
    assistantRow?.content,
    "This call failed — it returned `Unknown tool: finish_task`.",
  );
  assert.equal(assistantRow?.aux?.finishTaskNotice, undefined);
});

test("inter-tool thinking finalizes before the next provider builtin tool card", () => {
  const harness = createHarness();
  harness.pushUser("search and run code");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Plan web search.",
      placement: undefined,
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek", status: "completed" }),
    },
    { kind: "update-pending-assistant-thinking", text: "Need to run a quick computation next." },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Need to run a quick computation next.",
      placement: "before-next-tool",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ci_1",
      toolName: "code_interpreter",
      argumentsJson: JSON.stringify({ code: "print(1+1)", status: "completed" }),
    },
  ]);

  assert.deepEqual(
    harness.timeline
      .toMessages()
      .filter((message) => message.role === "assistant")
      .map((message) => {
        if (message.tool) {
          return `tool:${message.tool.toolName}`;
        }
        if (message.aux?.thinking) {
          return `thinking:${message.aux.thinking}`;
        }
        return "assistant-text";
      }),
    [
      "thinking:Plan web search.",
      "tool:web_search",
      "thinking:Need to run a quick computation next.",
      "tool:code_interpreter",
      "assistant-text",
    ],
  );
});

test("provider builtin tool card maps _spiritUi to headline detail and output excerpt", () => {
  const harness = createHarness();
  harness.pushUser("search DeepSeek");

  const argumentsJson = JSON.stringify({
    query: "DeepSeek V4",
    status: "completed",
    action: {
      type: "search",
      query: "DeepSeek V4",
      sources: [{ type: "url", url: "https://www.deepseek.com/" }],
    },
    _spiritUi: {
      sourceCount: 1,
      inputExcerpt:
        '{\n  "query": "DeepSeek V4",\n  "status": "completed",\n  "action": {\n    "type": "search",\n    "query": "DeepSeek V4"\n  }\n}',
      outputExcerpt: "1. https://www.deepseek.com/",
    },
  });

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson,
    },
  ]);

  const tool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "ws_1")?.tool;
  assert.equal(tool?.phase, "succeeded");
  assert.equal(tool?.headlineDetail, "DeepSeek V4");
  assert.equal(tool?.outputExcerpt, "1. https://www.deepseek.com/");
  assert.match(tool?.argsExcerpt ?? "", /DeepSeek V4/);
  assert.ok(tool?.outputExcerpt?.trim() && tool?.argsExcerpt?.trim());
});

test("web_search provider builtin preview completes when output_item.done reports completed", () => {
  const harness = createHarness();
  harness.pushUser("search DeepSeek generation");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek generation", status: "in_progress" }),
    },
  ]);

  const previewTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "ws_1")?.tool;
  assert.equal(previewTool?.phase, "preview");
  assert.equal(previewTool?.headlineDetail, "DeepSeek generation");

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek generation", status: "completed" }),
    },
  ]);

  const completedTool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "ws_1")?.tool;
  assert.equal(completedTool?.phase, "succeeded");
});

test("remove-pending after terminal web_search seeds after-tools Thinking placeholder while busy", () => {
  const harness = createHarness();
  harness.pushUser("search DeepSeek generation");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "assistant-thinking-segment-finalized",
      text: "Need web search for current DeepSeek versions.",
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek generation", status: "completed" }),
    },
    { kind: "remove-pending-assistant" },
  ]);

  const timelineMessages = harness.timeline.toMessages();
  const pendingAfterTool = timelineMessages.find(
    (message, index) =>
      index > timelineMessages.findIndex((candidate) => candidate.tool?.toolCallId === "ws_1") &&
      message.role === "assistant" &&
      message.pending &&
      !message.tool,
  );
  assert.ok(pendingAfterTool, "expected after-tools pending row after remove-pending");

  assert.deepEqual(
    buildVisibleMessageSnapshots({
      messages: timelineMessages,
      livePendingAux: { kind: "thinking", statusText: "| Thinking..." },
      rewind: createDesktopRewindMetadata(),
    }).map(rowToken),
    [
      "user",
      "thinking:Need web search for current DeepSeek versions.",
      "tool:ws_1",
      "pending-assistant",
    ],
  );
});

test("splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview defers terminal preview after in-progress", () => {
  const events = [
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ status: "in_progress" }),
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ status: "completed" }),
    },
    { kind: "assistant-chunk", text: "done" },
  ];
  const split = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(events);
  assert.equal(split.toApply.length, 2);
  assert.equal(split.deferred.length, 1);
  assert.equal(split.toApply[0]?.toolCallId, "ws_1");
  assert.equal(split.deferred[0]?.argumentsJson, JSON.stringify({ status: "completed" }));
});

test("splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview defers terminal until preview seen in prior drain", () => {
  const events = [
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ status: "completed" }),
    },
  ];
  const split = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(events, new Set());
  assert.equal(split.toApply.length, 0);
  assert.equal(split.deferred.length, 1);
});

test("splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview applies deferred terminal after preview seen", () => {
  const events = [
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ status: "completed", _spiritUi: { sourceCount: 3 } }),
    },
  ];
  const split = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(
    events,
    new Set(["ws_1"]),
  );
  assert.equal(split.toApply.length, 1);
  assert.equal(split.deferred.length, 0);
  assert.ok(runtimeEventsIncludeAppliedResponsesBuiltInToolStreamingUpdate(split.toApply));
});

test("runtimeEventsIncludeAppliedHostToolStreamingUpdate matches host tool preview and started events", () => {
  assert.ok(
    runtimeEventsIncludeAppliedHostToolStreamingUpdate([
      {
        kind: "streaming-tool-preview",
        toolCallId: "glob_1",
        toolName: "glob",
        argumentsJson: '{"pattern":"**/*.md"}',
      },
    ]),
  );
  assert.ok(
    runtimeEventsIncludeAppliedHostToolStreamingUpdate([
      {
        kind: "tool-call-started",
        toolCallId: "glob_1",
        toolName: "glob",
        request: { name: "glob", pattern: "**/*.md" },
      },
    ]),
  );
  assert.equal(
    runtimeEventsIncludeAppliedHostToolStreamingUpdate([
      {
        kind: "streaming-tool-preview",
        toolCallId: "ws_1",
        toolName: "web_search",
        argumentsJson: "{}",
      },
    ]),
    false,
  );
  assert.equal(
    runtimeEventsIncludeAppliedHostToolStreamingUpdate([
      {
        kind: "streaming-tool-preview",
        toolCallId: "finish_1",
        toolName: "finish_task",
        argumentsJson: '{"summary":"done"}',
      },
    ]),
    false,
  );
});

test("splitRuntimeEventsForIncrementalFinishTaskPreview applies one finish_task preview per batch", () => {
  const events = [
    { kind: "assistant-chunk", text: "hello" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"a"}',
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "call-finish",
      toolName: "finish_task",
      argumentsJson: '{"summary":"ab"}',
    },
  ];
  const split = splitRuntimeEventsForIncrementalFinishTaskPreview(events);
  assert.equal(split.toApply.length, 2);
  assert.equal(split.deferred.length, 1);
  assert.equal(split.toApply[1].argumentsJson, '{"summary":"a"}');
  assert.equal(split.deferred[0].argumentsJson, '{"summary":"ab"}');
});

test("edit_file tool-execution-finished preserves lspWriteDiagnostics on tool snapshot", () => {
  const harness = createHarness();
  harness.pushUser("fix types");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "tool-execution-finished",
      execution: {
        toolCallId: "call-edit",
        toolName: "edit_file",
        request: {
          name: "edit_file",
          path: "packages/agent-core/src/a.py",
          old_text: "x = 1",
          new_text: 'x = "1"',
        },
        output:
          "[write]\naction: edit_file\n\n[lsp]\nDiagnostics for packages/agent-core/src/a.py (1 shown):",
        failed: false,
        hostUi: {
          lspWriteDiagnostics: {
            relativePath: "packages/agent-core/src/a.py",
            items: [
              {
                severity: "error",
                line: 81,
                column: 7,
                message:
                  'Expression of type "Literal[\'1\']" cannot be assigned to declared type "int"',
                code: "reportAssignmentType",
                source: "pyright",
              },
            ],
          },
        },
      },
    },
  ]);

  const toolMessage = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "call-edit");
  assert.equal(toolMessage?.tool?.toolName, "edit_file");
  assert.equal(toolMessage?.tool?.lspWriteDiagnostics?.items.length, 1);
  assert.equal(toolMessage?.tool?.lspWriteDiagnostics?.items[0]?.severity, "error");
});

test("Moonshot Formula web_search tool-execution-finished preserves preview suppressExpand and argsExcerpt", () => {
  const harness = createHarness();
  harness.pushUser("search DeepSeek");

  const argumentsJson = JSON.stringify({
    status: "completed",
    _spiritUi: {
      inputExcerpt: "What is DeepSeek",
      headlineDetail: "What is DeepSeek",
      suppressExpand: true,
    },
  });

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_formula_1",
      toolName: "web_search",
      argumentsJson,
    },
    {
      kind: "tool-execution-finished",
      execution: {
        toolCallId: "ws_formula_1",
        toolName: "web_search",
        request: { name: "web_search", argumentsJson: '{"query":"What is DeepSeek"}' },
        output: "[moonshot formula web_search] completed",
        failed: false,
      },
    },
  ]);

  const tool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "ws_formula_1")?.tool;
  assert.equal(tool?.phase, "succeeded");
  assert.equal(tool?.suppressExpand, true);
  assert.equal(tool?.argsExcerpt, "What is DeepSeek");
  assert.equal(tool?.headlineDetail, "What is DeepSeek");
});

test("failed llm turn reuses streamed error text instead of duplicating assistant rows", () => {
  const harness = createHarness();
  const error = "Insufficient Balance";
  harness.pushUser("hello");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "replace-pending-assistant", text: error },
    { kind: "assistant-response-completed" },
  ]);
  harness.setCompletedTurnResult({
    kind: "failed",
    error,
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  const assistantMessages = harness
    .messages()
    .filter((message) => message.role === "assistant" && !message.tool);
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0]?.content, error);
  assert.deepEqual(
    visibleRowTokens(harness.timeline.toMessages()).filter((token) =>
      token.startsWith("assistant:"),
    ),
    [`assistant:${error}`],
  );
});

function createContextUsageHarness(options = {}) {
  let messages = [];
  let nextMessageId = 1;
  let nextTimelineMessageId = 1;
  let contextUsage = options.initialContextUsage;
  const refreshCatalogCalls = [];
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextTimelineMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextTimelineMessageId) {
        nextTimelineMessageId = messageId + 1;
      }
    },
  });
  const assistantMessages = new DesktopAssistantMessageStateMachine({
    messages: () => messages,
    setMessages: (nextMessages) => {
      messages = nextMessages;
    },
    allocateMessageId: () => nextMessageId++,
    isRuntimeBusy: () => false,
  });
  const orchestrator = new DesktopRuntimeEventOrchestrator({
    runtime: () => ({
      takeCompletedTurnResult: () => undefined,
    }),
    messages: () => messages,
    allocateMessageId: () => nextMessageId++,
    assistantMessages,
    messageTimeline: () => timeline,
    takeNextAssistantSegmentKind: () => "initial",
    conversationSnapshotView: new DesktopConversationSnapshotView(() => nextMessageId++),
    clearCurrentTurnSkills: () => {},
    setLastRuntimeError: () => {},
    refreshArchiveFromRuntime: () => {},
    dispatchExtensionEvent: () => {},
    bindFileChangesToToolMessage: () => {},
    resolveActiveModel: options.resolveActiveModel,
    resolveCatalogHints: options.resolveCatalogHints ?? (() => []),
    setContextUsage: (usage) => {
      contextUsage = usage;
    },
    refreshContextUsageCatalog: (input) => {
      refreshCatalogCalls.push(input);
    },
  });

  return {
    orchestrator,
    getContextUsage: () => contextUsage,
    refreshCatalogCalls,
  };
}

test("context-usage-updated queues catalog refresh without clearing cached usage", () => {
  const previousUsage = { inputTokens: 1000, contextLength: 128000, percent: 1 };
  const harness = createContextUsageHarness({
    initialContextUsage: previousUsage,
    resolveActiveModel: () => ({
      name: "openai/gpt-5",
      apiBase: "https://gateway.example/v1",
      provider: "vercel-ai-gateway",
      transportKind: "openai-compatible",
    }),
    resolveCatalogHints: () => [],
  });

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "context-usage-updated", usage: { inputTokens: 2000 } },
  ]);

  assert.equal(harness.refreshCatalogCalls.length, 1);
  assert.deepEqual(harness.refreshCatalogCalls[0]?.usage, { inputTokens: 2000 });
  assert.deepEqual(harness.getContextUsage(), previousUsage);
});

test("context-usage-updated clears usage when provider cannot resolve context length", () => {
  const harness = createContextUsageHarness({
    initialContextUsage: { inputTokens: 1000, contextLength: 128000, percent: 1 },
    resolveActiveModel: () => ({
      name: "custom-model",
      apiBase: "https://example.invalid/v1",
      provider: "custom",
    }),
  });

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "context-usage-updated", usage: { inputTokens: 2000 } },
  ]);

  assert.equal(harness.refreshCatalogCalls.length, 0);
  assert.equal(harness.getContextUsage(), undefined);
});

test("context-usage-updated updates usage when context length is already known", () => {
  const harness = createContextUsageHarness({
    resolveActiveModel: () => ({
      name: "custom-model",
      apiBase: "https://example.invalid/v1",
      provider: "custom",
      contextLength: 128000,
    }),
  });

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "context-usage-updated", usage: { inputTokens: 64000 } },
  ]);

  assert.deepEqual(harness.getContextUsage(), {
    inputTokens: 64000,
    contextLength: 128000,
    percent: 50,
  });
});

test("interleaved built-in web_search shows Thinking placeholder after last terminal tool", () => {
  const harness = createHarness();
  harness.pushUser("find in page");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    { kind: "assistant-chunk", text: "Fine, let's give it a try!" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "find-1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({
        status: "failed",
        _spiritUi: { inputExcerpt: "spirit.dev", internalActionType: "find_in_page" },
      }),
    },
    { kind: "assistant-chunk", text: "It failed, trying again:" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "find-2",
      toolName: "web_search",
      argumentsJson: JSON.stringify({
        status: "completed",
        _spiritUi: { inputExcerpt: "https://spirit.dev", internalActionType: "find_in_page" },
      }),
    },
  ]);

  const timelineMessages = harness.timeline.toMessages();
  const lastToolIndex = timelineMessages.findLastIndex((message) => message.tool);
  const pendingAfterAllTools = timelineMessages.find(
    (message, index) =>
      index > lastToolIndex &&
      message.role === "assistant" &&
      message.pending &&
      !message.tool &&
      !message.content.trim(),
  );
  const showThinking = pendingAfterAllTools
    ? shouldShowAssistantThinkingCollapsible(
        pendingAfterAllTools,
        { kind: "thinking", statusText: "| Thinking..." },
        timelineMessages,
        timelineMessages.indexOf(pendingAfterAllTools),
      )
    : false;

  assert.ok(lastToolIndex >= 0);
  assert.ok(pendingAfterAllTools, "expected empty pending row after last built-in tool");
  assert.equal(showThinking, true);
});

test("sequential web_search clears Thinking placeholder during next preview and restores it after terminal", () => {
  const harness = createHarness();
  harness.pushUser("search twice");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek V4 Pro", status: "in_progress" }),
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_1",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek V4 Pro", status: "completed" }),
    },
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_2",
      toolName: "web_search",
      argumentsJson: JSON.stringify({
        query: "DeepSeek V4 Pro architecture",
        status: "in_progress",
      }),
    },
  ]);

  const timelineMessages = harness.timeline.toMessages();
  const ws2Index = timelineMessages.findIndex((message) => message.tool?.toolCallId === "ws_2");
  const pendingAfterWs2 = timelineMessages.find(
    (message, index) =>
      index > ws2Index &&
      ws2Index >= 0 &&
      message.role === "assistant" &&
      message.pending &&
      !message.tool,
  );

  const showThinking = pendingAfterWs2
    ? shouldShowAssistantThinkingCollapsible(
        pendingAfterWs2,
        { kind: "thinking", statusText: "| Thinking..." },
        timelineMessages,
        timelineMessages.indexOf(pendingAfterWs2),
      )
    : false;

  assert.ok(ws2Index >= 0, "expected second web_search tool row");
  assert.equal(
    pendingAfterWs2,
    undefined,
    "premature after-tools placeholder should be cleared once the next search preview arrives",
  );
  assert.equal(
    timelineMessages[ws2Index]?.tool?.phase,
    "preview",
    "second search should still be in preview",
  );
  assert.equal(
    showThinking,
    false,
    "Thinking placeholder must not show while a search tool is shimmering",
  );

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "streaming-tool-preview",
      toolCallId: "ws_2",
      toolName: "web_search",
      argumentsJson: JSON.stringify({ query: "DeepSeek V4 Pro architecture", status: "completed" }),
    },
  ]);

  const afterTerminalMessages = harness.timeline.toMessages();
  const lastToolIndex = afterTerminalMessages.findLastIndex((message) => message.tool);
  const pendingAfterAllTools = afterTerminalMessages.find(
    (message, index) =>
      index > lastToolIndex &&
      message.role === "assistant" &&
      message.pending &&
      !message.tool &&
      !message.aux?.thinking?.trim(),
  );
  const showThinkingAfterTerminal = pendingAfterAllTools
    ? shouldShowAssistantThinkingCollapsible(
        pendingAfterAllTools,
        { kind: "thinking", statusText: "| Thinking..." },
        afterTerminalMessages,
        afterTerminalMessages.indexOf(pendingAfterAllTools),
      )
    : false;

  assert.ok(pendingAfterAllTools, "expected after-tools placeholder once all searches complete");
  assert.equal(
    showThinkingAfterTerminal,
    true,
    "Thinking placeholder should show after the last search completes",
  );
});

test("shell tool-execution-finished keeps full outputExcerpt without 4k truncation", () => {
  const harness = createHarness();
  harness.pushUser("run build");

  const longBody = `${"line\n".repeat(2_000)}TAIL_MARKER_OK`;
  const shellOutput = JSON.stringify({
    terminal: "POSIX shell (zsh)",
    workspace: "/tmp/ws",
    command: "pnpm run build:renderer",
    exitCode: 0,
    output: longBody,
  });
  assert.ok(shellOutput.length > 4_000);

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "tool-execution-finished",
      execution: {
        toolCallId: "shell-1",
        toolName: "shell",
        request: { name: "shell", command: "pnpm run build:renderer" },
        output: shellOutput,
        failed: false,
      },
    },
  ]);

  const tool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "shell-1")?.tool;
  assert.equal(tool?.outputExcerpt, shellOutput);
  assert.equal(tool?.outputExcerpt?.includes("...<truncated>"), false);

  const parsed = JSON.parse(tool?.outputExcerpt ?? "");
  assert.equal(parsed.exitCode, 0);
  assert.ok(String(parsed.output).endsWith("TAIL_MARKER_OK"));
});

test("shell tool-execution-output-chunk appends while phase stays running", () => {
  const harness = createHarness();
  harness.pushUser("stream lint");

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: "begin-assistant-response" },
    {
      kind: "tool-call-started",
      toolCallId: "shell-stream-1",
      toolName: "shell",
      request: { name: "shell", command: "pnpm run lint" },
    },
  ]);

  let tool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "shell-stream-1")?.tool;
  assert.equal(tool?.phase, "running");
  assert.equal(tool?.outputExcerpt, undefined);

  harness.orchestrator.applyRuntimeHostEvents([
    {
      kind: "tool-execution-output-chunk",
      toolCallId: "shell-stream-1",
      toolName: "shell",
      request: { name: "shell", command: "pnpm run lint" },
      chunk: "line1\n",
    },
    {
      kind: "tool-execution-output-chunk",
      toolCallId: "shell-stream-1",
      toolName: "shell",
      request: { name: "shell", command: "pnpm run lint" },
      chunk: "line2\n",
    },
  ]);

  tool = harness.timeline
    .toMessages()
    .find((message) => message.tool?.toolCallId === "shell-stream-1")?.tool;
  assert.equal(tool?.phase, "running");
  assert.equal(tool?.outputExcerpt, "line1\nline2\n");
});
