import assert from "node:assert/strict";
import { test } from "vitest";

import { DesktopMessageTimeline } from "../../dist-electron/src/host/message-timeline.js";
import { buildVisibleMessageSnapshots } from "../../dist-electron/src/host/message-snapshots.js";
import { createDesktopRewindMetadata } from "../../dist-electron/src/host/rewind.js";

function createTimeline() {
  let nextMessageId = 1;
  return new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
}

function toolBlock(toolCallId, phase = "running") {
  return {
    toolCallId,
    toolName: "read_file",
    phase,
    headline: phase === "succeeded" ? "Read file" : "Reading file",
    detailLines: [],
    argsExcerpt: "{}",
  };
}

function rowToken(message) {
  if (message.role === "user") return `user:${message.content}`;
  if (message.tool) return `tool:${message.tool.toolCallId}:${message.tool.phase}`;
  if (message.aux?.thinking) return `thinking:${message.aux.thinking}`;
  if (message.aux?.compaction) return `compaction:${message.aux.compaction}`;
  if (message.aux?.finishTaskNotice) return `finish:${message.aux.finishTaskNotice}`;
  return `${message.pending ? "pending" : "assistant"}:${message.content}`;
}

function visibleRowTokens(messages) {
  return buildVisibleMessageSnapshots({
    messages,
    rewind: createDesktopRewindMetadata(),
  }).map(rowToken);
}

test("continuation segments derive rows after previous segment rows", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("inspect this file");

  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("first reasoning");
  timeline.upsertToolMessage("call-1", toolBlock("call-1", "succeeded"));
  timeline.removePendingAssistantText();

  timeline.beginAssistantSegment("continuation");
  timeline.upsertToolMessage("call-2", toolBlock("call-2"));
  timeline.finalizeThinkingSegment("second reasoning");
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:inspect this file",
    "thinking:first reasoning",
    "tool:call-1:succeeded",
    "thinking:second reasoning",
    "tool:call-2:running",
  ]);
});

test("late-finalized pre-tool thinking stays above tool preview inserted mid-stream", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("read again silently");
  timeline.beginAssistantSegment("initial");
  timeline.updatePendingAssistantAux("thinking", "Plan to read the full file without speaking.");
  timeline.upsertToolMessage("read-1", toolBlock("read-1", "preview"));
  timeline.finalizeThinkingSegment("Plan to read the full file without speaking.", "after-stream");
  timeline.updatePendingAssistantAux("thinking", "Finished reading the file.");
  timeline.finalizeThinkingSegment("Finished reading the file.", "after-stream");
  timeline.appendAssistantTextChunk("Finished reading.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    "user:read again silently",
    "thinking:Plan to read the full file without speaking.",
    "tool:read-1:preview",
    "thinking:Finished reading the file.",
    "assistant:Finished reading.",
  ]);
});

test("ensureAfterToolsThinkingPlaceholderRow seeds pending row after terminal provider tools", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("search DeepSeek generation");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need web search for current DeepSeek versions.");
  timeline.upsertToolMessage("web-1", {
    toolCallId: "web-1",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Web search",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.removePendingAssistantText();
  timeline.ensureAfterToolsThinkingPlaceholderRow();

  const messages = timeline.toMessages();
  const pendingAfterTool = messages.find(
    (message, index) =>
      index > messages.findIndex((candidate) => candidate.tool?.toolCallId === "web-1") &&
      message.role === "assistant" &&
      message.pending &&
      !message.tool,
  );
  assert.ok(pendingAfterTool, "expected after-tools pending row for Thinking placeholder");

  assert.deepEqual(
    buildVisibleMessageSnapshots({
      messages,
      livePendingAux: { kind: "thinking", statusText: "| Thinking…" },
      rewind: createDesktopRewindMetadata(),
    }).map(rowToken),
    [
      "user:search DeepSeek generation",
      "thinking:Need web search for current DeepSeek versions.",
      "tool:web-1:succeeded",
      "pending:",
    ],
  );
});

test("post-tool thinking in the same segment stays below provider tool rows", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("search DeepSeek generation");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need web search for current DeepSeek versions.");
  timeline.upsertToolMessage("web-1", {
    toolCallId: "web-1",
    toolName: "web_search",
    phase: "preview",
    headline: "Web search",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.updatePendingAssistantAux("thinking", "Based on search results, DeepSeek is at V4.");
  timeline.finalizeThinkingSegment("Based on search results, DeepSeek is at V4.", "after-stream");
  timeline.appendAssistantTextChunk("DeepSeek is currently at generation 4.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    "user:search DeepSeek generation",
    "thinking:Need web search for current DeepSeek versions.",
    "tool:web-1:preview",
    "thinking:Based on search results, DeepSeek is at V4.",
    "assistant:DeepSeek is currently at generation 4.",
  ]);
});

test("post-tool thinking aux routes to after-tools row when before-tools body already exists", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("search again");
  timeline.beginAssistantSegment("initial");
  timeline.updatePendingAssistantAux("thinking", "OK, let me try the fixed search.");
  timeline.appendAssistantTextChunk("OK, let me try the fixed search.");
  timeline.finalizeThinkingSegment("OK, let me try the fixed search.", "before-next-tool");
  timeline.upsertToolMessage("web-1", {
    toolCallId: "web-1",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Web search",
    detailLines: ["10 sources"],
    argsExcerpt: "{}",
  });
  timeline.updatePendingAssistantAux("thinking", "Search is fixed; summarizing results.");
  timeline.appendAssistantTextChunk("Here is the summary.");
  timeline.finalizeThinkingSegment("Search is fixed; summarizing results.", "after-stream");
  timeline.completeActiveAssistantSegment();

  const messages = timeline.toMessages();
  const preToolBody = messages.find(
    (message) =>
      message.content.includes("let me try") && !message.aux?.thinking?.includes("summarizing"),
  );
  assert.ok(preToolBody);
  assert.equal(preToolBody.aux?.thinking?.includes("summarizing"), undefined);

  assert.deepEqual(visibleRowTokens(messages), [
    "user:search again",
    "thinking:OK, let me try the fixed search.",
    "assistant:OK, let me try the fixed search.",
    "tool:web-1:succeeded",
    "thinking:Search is fixed; summarizing results.",
    "assistant:Here is the summary.",
  ]);
});

test("first answer text chunk settles in-flight post-tool thinking without duplicate rows", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("search DeepSeek");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need web search first.");
  timeline.upsertToolMessage("web-1", {
    toolCallId: "web-1",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Web search",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.upsertToolMessage("fetch-1", {
    toolCallId: "fetch-1",
    toolName: "web_fetch",
    phase: "succeeded",
    headline: "Fetch",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.updatePendingAssistantAux("thinking", "Fetched page content; can summarize now.");
  timeline.appendAssistantTextChunk("DeepSeek is at V4.");
  timeline.finalizeThinkingSegment("Fetched page content; can summarize now.", "after-stream");
  timeline.completeActiveAssistantSegment();

  const tokens = visibleRowTokens(timeline.toMessages());
  const thinkingCount = tokens.filter((token) =>
    token.startsWith("thinking:Fetched page content"),
  ).length;
  assert.equal(thinkingCount, 1);
  assert.deepEqual(tokens, [
    "user:search DeepSeek",
    "thinking:Need web search first.",
    "tool:web-1:succeeded",
    "tool:fetch-1:succeeded",
    "thinking:Fetched page content; can summarize now.",
    "assistant:DeepSeek is at V4.",
  ]);
});

test("inter-tool thinking stays between provider builtin tool cards", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("search DeepSeek");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need web search first.");
  timeline.upsertToolMessage("web-1", {
    toolCallId: "web-1",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Web search",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.updatePendingAssistantAux(
    "thinking",
    "Search results mention versions; need a page fetch.",
  );
  timeline.finalizeThinkingSegment(
    "Search results mention versions; need a page fetch.",
    "before-next-tool",
  );
  timeline.upsertToolMessage("fetch-1", {
    toolCallId: "fetch-1",
    toolName: "web_fetch",
    phase: "succeeded",
    headline: "Fetch",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.updatePendingAssistantAux("thinking", "Fetched page content; can summarize now.");
  timeline.finalizeThinkingSegment("Fetched page content; can summarize now.", "after-stream");
  timeline.appendAssistantTextChunk("DeepSeek is at V4.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    "user:search DeepSeek",
    "thinking:Need web search first.",
    "tool:web-1:succeeded",
    "thinking:Search results mention versions; need a page fetch.",
    "tool:fetch-1:succeeded",
    "thinking:Fetched page content; can summarize now.",
    "assistant:DeepSeek is at V4.",
  ]);
});

test("fallback tool keys are scoped to the active segment", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("first turn");
  timeline.beginAssistantSegment("initial");
  timeline.upsertToolMessage("pending:read_file", toolBlock("pending:read_file"));
  timeline.removePendingAssistantText();

  timeline.beginUserTurn("second turn");
  timeline.beginAssistantSegment("initial");
  timeline.upsertToolMessage("pending:read_file", toolBlock("pending:read_file", "succeeded"));
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:first turn",
    "tool:pending:read_file:running",
    "user:second turn",
    "tool:pending:read_file:succeeded",
  ]);
});

test("assistant text splits around tool rows inside a segment", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("check status");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("I will inspect it.");
  timeline.upsertToolMessage("call-1", toolBlock("call-1", "succeeded"));
  timeline.appendAssistantTextChunk("Done.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:check status",
    "assistant:I will inspect it.",
    "tool:call-1:succeeded",
    "assistant:Done.",
  ]);
});

test("built-in tool round-trip keeps interleaved body-tool-body order in one segment", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("find in page");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Fine, let us give it a try!");
  timeline.upsertToolMessage("find-1", {
    toolCallId: "find-1",
    toolName: "web_search",
    phase: "failed",
    headline: "Find in page spirit.dev failed",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.appendAssistantTextChunk("It failed, trying again:");
  timeline.upsertToolMessage("find-2", {
    toolCallId: "find-2",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Find in page https://spirit.dev",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.appendAssistantTextChunk("The second call succeeded.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:find in page",
    "assistant:Fine, let us give it a try!",
    "tool:find-1:failed",
    "assistant:It failed, trying again:",
    "tool:find-2:succeeded",
    "assistant:The second call succeeded.",
  ]);
});

test("finish_task notice clears duplicate completion text instead of adding a second row", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("Hello there");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Hello! I am Spirit, how can I help you?");
  timeline.completeActiveAssistantSegment();

  timeline.beginAssistantSegment("continuation");
  timeline.appendAssistantTextChunk("greeted the user, no follow-up task");
  timeline.completeActiveAssistantSegment();
  timeline.materializeFinishTaskNotice(
    "Task completed: greeted the user, no follow-up task.",
    "greeted the user, no follow-up task",
  );

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:Hello there",
    "assistant:Hello! I am Spirit, how can I help you?",
    "finish:Task completed: greeted the user, no follow-up task.",
  ]);
});

test("finish_task notice preview updates the active assistant text row", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("loop");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk(
    "Understood, I will call finish_task at the end of each reply.",
  );

  timeline.updateFinishTaskNoticePreview("Task completed: verified each");
  assert.equal(
    timeline.toMessages().find((message) => message.role === "assistant" && !message.tool)?.aux
      ?.finishTaskNotice,
    "Task completed: verified each",
  );

  timeline.updateFinishTaskNoticePreview(
    "Task completed: called finish_task after verifying every message.",
  );
  assert.equal(
    timeline.toMessages().find((message) => message.role === "assistant" && !message.tool)?.aux
      ?.finishTaskNotice,
    "Task completed: called finish_task after verifying every message.",
  );
});

test("updatePendingAssistantAux preserves finish_task notice preview on assistant text row", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("loop");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Body content.");
  timeline.updateFinishTaskNoticePreview("Task completed: verified each");

  timeline.updatePendingAssistantAux("thinking", "Still reasoning about the reply.");

  assert.equal(
    timeline.toMessages().find((message) => message.content.includes("Body content."))?.aux
      ?.finishTaskNotice,
    "Task completed: verified each",
  );
});

test("appendAssistantTextChunk keeps no-tool thinking on the same row as the body", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("hi");
  timeline.beginAssistantSegment("initial");
  timeline.updatePendingAssistantAux("thinking", "Planning the greeting.");
  timeline.appendAssistantTextChunk("Hello!");
  timeline.completeActiveAssistantSegment();

  const assistantRows = timeline
    .toMessages()
    .filter((message) => message.role === "assistant" && !message.tool);
  assert.equal(assistantRows.length, 1);
  assert.equal(assistantRows[0].content, "Hello!");
  assert.equal(assistantRows[0].aux?.thinking, "Planning the greeting.");
});

test("finalized thinking stays above completed assistant text in the same segment", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("Hello there");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Hello! How can I help you?");
  timeline.finalizeThinkingSegment("The user is greeting me.");
  timeline.completeActiveAssistantSegment();
  timeline.materializeCompletedAssistantText("Hello! How can I help you?");

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:Hello there",
    "thinking:The user is greeting me.",
    "assistant:Hello! How can I help you?",
  ]);
});

test("materializeCompletedAssistantText does not duplicate before-tools preamble after web search", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("Did the Anomaly team also write OpenNext?");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Let me search to confirm who owns these projects.");
  timeline.upsertToolMessage("search-1", {
    toolCallId: "search-1",
    toolName: "web_search",
    phase: "succeeded",
    headline: "Searched online",
    detailLines: [],
    argsExcerpt: "OpenNext Anomaly SST",
  });
  timeline.appendAssistantTextChunk("Right, all three are Anomaly (the SST team) projects.");
  timeline.completeActiveAssistantSegment();
  timeline.materializeCompletedAssistantText(
    "Let me search to confirm who owns these projects.Right, all three are Anomaly (the SST team) projects.",
  );

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:Did the Anomaly team also write OpenNext?",
    "assistant:Let me search to confirm who owns these projects.",
    "tool:search-1:succeeded",
    "assistant:Right, all three are Anomaly (the SST team) projects.",
  ]);
});

test("live thinking stays above tool rows while the tool is running", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("read README.md");
  timeline.beginAssistantSegment("initial");
  timeline.upsertToolMessage("call-1", toolBlock("call-1"));
  timeline.updatePendingAssistantAux("thinking", "Need to inspect README.md first.");

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    "user:read README.md",
    "thinking:Need to inspect README.md first.",
    "tool:call-1:running",
  ]);
});

test("tool previews do not duplicate a thinking row after assistant prefix text appears", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("parallel tools");
  timeline.beginAssistantSegment("initial");
  timeline.replaceAssistantText("OK, I will call two tools concurrently, then run echo.");
  timeline.updatePendingAssistantAux("thinking", "The user is asking me to call a few tools.");
  timeline.upsertToolMessage("call-1", toolBlock("call-1"));
  timeline.updatePendingAssistantAux(
    "thinking",
    "The user is asking me to call a few tools (preferably concurrently).",
  );
  timeline.upsertToolMessage("call-2", toolBlock("call-2"));

  const messages = timeline.toMessages();
  const assistantRows = messages.filter((message) => message.role === "assistant" && !message.tool);

  assert.equal(assistantRows.length, 1);
  assert.equal(assistantRows[0].content, "OK, I will call two tools concurrently, then run echo.");
  assert.equal(
    assistantRows[0].aux?.thinking,
    "The user is asking me to call a few tools (preferably concurrently).",
  );
  assert.deepEqual(
    messages.filter((message) => message.tool).map((message) => message.tool.toolCallId),
    ["call-1", "call-2"],
  );
});

test("finalized thinking does not remain duplicated below tool rows", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("read README.md");
  timeline.beginAssistantSegment("initial");
  timeline.upsertToolMessage("call-1", toolBlock("call-1", "succeeded"));
  timeline.updatePendingAssistantAux("thinking", "Need to inspect README.md first.");
  timeline.finalizeThinkingSegment("Need to inspect README.md first.");
  timeline.appendAssistantTextChunk("I checked README.md.");
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    "user:read README.md",
    "thinking:Need to inspect README.md first.",
    "tool:call-1:succeeded",
    "assistant:I checked README.md.",
  ]);
});

test("hydrating flat messages preserves a later thinking segment after a tool row", () => {
  let nextMessageId = 7;
  const timeline = DesktopMessageTimeline.fromMessages(
    [
      {
        id: 1,
        role: "user",
        content: "read README.md",
        pending: false,
      },
      {
        id: 4,
        role: "assistant",
        content: "",
        aux: { thinking: "Need to inspect README.md first." },
        pending: false,
      },
      {
        id: 3,
        role: "assistant",
        content: "",
        tool: toolBlock("call-1", "succeeded"),
        pending: false,
      },
      {
        id: 6,
        role: "assistant",
        content: "",
        aux: { thinking: "I have read README.md and can summarize it." },
        pending: false,
      },
      {
        id: 5,
        role: "assistant",
        content: "README.md content (lines 1-11): Spirit is an open-source AI Agent.",
        pending: false,
      },
    ],
    {
      allocateMessageId: () => nextMessageId++,
      reserveMessageId: (messageId) => {
        if (messageId >= nextMessageId) {
          nextMessageId = messageId + 1;
        }
      },
    },
  );

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:read README.md",
    "thinking:Need to inspect README.md first.",
    "tool:call-1:succeeded",
    "thinking:I have read README.md and can summarize it.",
    "assistant:README.md content (lines 1-11): Spirit is an open-source AI Agent.",
  ]);
});

test(
  "verbose pending segment row logs are deduplicated and throttled",
  { concurrency: false },
  () => {
    const originalDebug = process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG;
    const originalLog = console.warn;
    const originalNow = Date.now;
    const logs = [];
    let now = 1_000;

    process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG = "verbose";
    console.warn = (message) => {
      logs.push(String(message));
    };
    Date.now = () => now;

    try {
      const timeline = createTimeline();
      timeline.beginUserTurn("Hi");
      timeline.beginAssistantSegment("initial");

      timeline.updatePendingAssistantAux("thinking", 'The user just said "Hi."');
      timeline.updatePendingAssistantAux("thinking", 'The user just said "Hi."');

      now += 200;
      timeline.updatePendingAssistantAux(
        "thinking",
        'The user just said "Hi." and I should reply warmly.',
      );

      now += 1_300;
      timeline.updatePendingAssistantAux(
        "thinking",
        "I should greet the user warmly and offer help.",
      );
    } finally {
      if (originalDebug === undefined) {
        delete process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG;
      } else {
        process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG = originalDebug;
      }
      console.warn = originalLog;
      Date.now = originalNow;
    }

    const segmentLogs = logs.filter((line) =>
      line.includes("[desktop-host][timeline] segment-rows"),
    );
    assert.equal(segmentLogs.length, 2);
    assert.match(segmentLogs[0], /stage=update-pending-thinking/);
    assert.match(segmentLogs[0], /The user just said "Hi\./);
    assert.match(segmentLogs[1], /stage=update-pending-thinking/);
    assert.match(segmentLogs[1], /I should greet the user warmly/);
  },
);

test("timeline snapshot round-trip preserves finishTaskNotice on assistant text rows", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("loop");
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("done for this turn");
  timeline.updateFinishTaskNoticePreview("Task completed: verified each.");
  timeline.completeActiveAssistantSegment();

  const snapshot = timeline.snapshot();
  let nextMessageId = 4;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.equal(
    restored.toMessages().find((message) => message.role === "assistant" && !message.tool)?.aux
      ?.finishTaskNotice,
    "Task completed: verified each.",
  );
});

test("timeline snapshot round-trip preserves segment boundaries across restore", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("read README.md");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need to inspect README.md first.");
  timeline.upsertToolMessage("call-1", toolBlock("call-1", "succeeded"));
  timeline.removePendingAssistantText();
  timeline.beginAssistantSegment("continuation");
  timeline.finalizeThinkingSegment("I have read README.md and can summarize it.");
  timeline.materializeCompletedAssistantText(
    "README.md content (lines 1-11): Spirit is an open-source AI Agent.",
  );

  const snapshot = timeline.snapshot();
  let nextMessageId = 7;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.deepEqual(restored.toMessages().map(rowToken), [
    "user:read README.md",
    "thinking:Need to inspect README.md first.",
    "tool:call-1:succeeded",
    "thinking:I have read README.md and can summarize it.",
    "assistant:README.md content (lines 1-11): Spirit is an open-source AI Agent.",
  ]);
});

test("hydrated messages can open a continuation segment without reordering restored rows", () => {
  let nextMessageId = 4;
  const timeline = DesktopMessageTimeline.fromMessages(
    [
      {
        id: 1,
        role: "user",
        content: "inspect this file",
        pending: false,
      },
      {
        id: 2,
        role: "assistant",
        content: "",
        aux: { thinking: "restored reasoning" },
        pending: false,
      },
      {
        id: 3,
        role: "assistant",
        content: "",
        tool: toolBlock("call-1", "succeeded"),
        pending: false,
        canContinue: true,
      },
    ],
    {
      allocateMessageId: () => nextMessageId++,
      reserveMessageId: (messageId) => {
        if (messageId >= nextMessageId) {
          nextMessageId = messageId + 1;
        }
      },
    },
  );

  assert.equal(timeline.latestContinuableAssistantMessage()?.id, 3);

  timeline.beginAssistantSegment("continuation");
  timeline.finalizeThinkingSegment("continued reasoning");
  timeline.upsertToolMessage("call-2", toolBlock("call-2", "running"));
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    "user:inspect this file",
    "thinking:restored reasoning",
    "tool:call-1:succeeded",
    "thinking:continued reasoning",
    "tool:call-2:running",
  ]);
});

test("user local file attachments survive timeline round trip", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("how is this image?", {
    localFileAttachments: [{ path: "/tmp/photo.png", name: "photo.png", isImage: true }],
  });
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Looks good.");
  timeline.completeActiveAssistantSegment();

  const messages = timeline.toMessages();
  assert.equal(messages[0].localFileAttachments?.length, 1);
  assert.equal(messages[0].localFileAttachments?.[0]?.name, "photo.png");

  let nextMessageId = 10;
  const rebuilt = DesktopMessageTimeline.fromMessages(messages, {
    allocateMessageId: () => nextMessageId++,
  });
  const roundTripped = rebuilt.toMessages();
  assert.deepEqual(roundTripped[0].localFileAttachments, messages[0].localFileAttachments);
});

test("interrupted deferred thinking finalizes to one row without duplicate pending aux", () => {
  const timeline = createTimeline();
  const thinking = 'The user just sent "A" — random typing.';
  timeline.beginUserTurn("A");
  timeline.beginAssistantSegment("initial");
  timeline.updatePendingAssistantAux("thinking", thinking);
  // abortConversation: drain remove-pending-assistant before abortActiveAssistantSegment
  timeline.removePendingAssistantText();
  timeline.finalizeThinkingSegment(thinking, "after-stream");
  timeline.abortActiveAssistantSegment();

  const messages = timeline.toMessages();
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(rowToken), ["user:A", `thinking:${thinking}`]);
  assert.equal(messages[1].pending, false);
});

test("user local file attachments survive timeline snapshot restore", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("hahaha", {
    localFileAttachments: [
      { path: "D:\\project\\ReadmeHero_en.png", name: "ReadmeHero_en.png", isImage: true },
    ],
  });
  timeline.beginAssistantSegment("initial");
  timeline.appendAssistantTextChunk("Looks good.");
  timeline.completeActiveAssistantSegment();

  const snapshot = timeline.snapshot();
  let nextMessageId = 10;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  const messages = restored.toMessages();
  assert.equal(messages[0].localFileAttachments?.length, 1);
  assert.equal(messages[0].localFileAttachments?.[0]?.name, "ReadmeHero_en.png");
});

test("approval guidance user reply stays after pending tool within the same turn", () => {
  const timeline = createTimeline();
  timeline.beginUserTurn("run a command");
  timeline.beginAssistantSegment("initial");
  timeline.finalizeThinkingSegment("Need to ask which command.");
  timeline.upsertToolMessage("ask-1", {
    toolCallId: "ask-1",
    toolName: "ask_questions",
    phase: "succeeded",
    headline: "Asked 1 question",
    detailLines: [],
    argsExcerpt: "{}",
  });
  timeline.finalizeThinkingSegment("Running echo nb.");
  timeline.upsertToolMessage("shell-1", {
    toolCallId: "shell-1",
    toolName: "shell",
    phase: "pending-approval",
    headline: "Execute command",
    detailLines: ["echo nb"],
    argsExcerpt: "{}",
  });

  timeline.insertApprovalGuidanceUserReply("switch to echo nihao", "shell-1");
  timeline.upsertToolMessage("shell-1", {
    toolCallId: "shell-1",
    toolName: "shell",
    phase: "failed",
    headline: "Execute command",
    detailLines: ["echo nb"],
    argsExcerpt: "{}",
  });
  timeline.finalizeThinkingSegment("Retry with echo nihao.");
  timeline.upsertToolMessage("shell-2", {
    toolCallId: "shell-2",
    toolName: "shell",
    phase: "succeeded",
    headline: "Execute command",
    detailLines: ["echo nihao"],
    argsExcerpt: "{}",
  });
  timeline.appendAssistantTextChunk("done");
  timeline.completeActiveAssistantSegment();

  const tokens = visibleRowTokens(timeline.toMessages());
  assert.equal(timeline.snapshot().length, 1);
  assert.equal(tokens.filter((token) => token.startsWith("tool:ask-1")).length, 1);
  assert.equal(tokens.filter((token) => token.startsWith("tool:shell-1")).length, 1);
  assert.ok(tokens.indexOf("user:switch to echo nihao") > tokens.indexOf("tool:shell-1:failed"));
  assert.ok(tokens.indexOf("tool:shell-2:succeeded") > tokens.indexOf("user:switch to echo nihao"));
  assert.equal(tokens.at(-1), "assistant:done");
});

test("fromMessages hydrates mid-turn approval guidance without starting a new turn", () => {
  const source = createTimeline();
  source.beginUserTurn("run a command");
  source.beginAssistantSegment("initial");
  source.finalizeThinkingSegment("Need to ask which command.");
  source.upsertToolMessage("ask-1", {
    toolCallId: "ask-1",
    toolName: "ask_questions",
    phase: "succeeded",
    headline: "Asked 1 question",
    detailLines: [],
    argsExcerpt: "{}",
  });
  source.upsertToolMessage("shell-1", {
    toolCallId: "shell-1",
    toolName: "shell",
    phase: "pending-approval",
    headline: "Execute command",
    detailLines: ["echo nb"],
    argsExcerpt: "{}",
  });
  source.insertApprovalGuidanceUserReply("switch to echo nihao", "shell-1");

  let restoredCounter = 0;
  const restored = DesktopMessageTimeline.fromMessages(source.toMessages(), {
    allocateMessageId: () => 100 + restoredCounter++,
  });

  assert.equal(restored.snapshot().length, 1);
  assert.deepEqual(visibleRowTokens(restored.toMessages()), visibleRowTokens(source.toMessages()));
});
