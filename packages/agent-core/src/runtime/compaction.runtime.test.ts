import assert from "node:assert/strict";
import { test } from "vitest";

import { unwrapCompactSummaryBlock, wrapCompactSummaryBlock } from "../llm-context-block.js";
import { truncateLlmHistoryForCompaction } from "../llm-tool-agent.js";
import {
  createLlmMessageContentFromText,
  llmMessageTextContent,
  type LlmMessage,
  type LlmTransport,
} from "../ports.js";
import { compactHistoryImmediate, type CompactionRuntime } from "./compaction.js";
import type { AgentRuntimeOptions } from "./types.js";
import { buildSessionTranscript } from "../transcript.js";

type TestState = { messages: LlmMessage[] };

async function syncSessionTranscriptFromHistoryForTest(
  options: AgentRuntimeOptions<undefined, TestState, never>,
  history: readonly LlmMessage[],
  emitEvent: (event: { kind: string; error?: string }) => void = () => {},
): Promise<string | undefined> {
  const sync = options.syncSessionTranscript;
  if (!sync) {
    return undefined;
  }
  try {
    return await sync({ transcript: buildSessionTranscript(history) });
  } catch (error: unknown) {
    emitEvent({
      kind: "session-transcript-sync-failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

test("compactHistoryImmediate syncs transcript without post-processing compact summary", async () => {
  const archivePath = "/tmp/spirit/transcripts/s1";
  const history: LlmMessage[] = [
    { role: "user", content: createLlmMessageContentFromText("hello") },
    {
      role: "assistant",
      content: [],
      toolCalls: [{ id: "call-1", name: "read_file", argumentsJson: "{}" }],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      content: createLlmMessageContentFromText("noise"),
    },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error("not used");
    },
    async compactHistoryManual(_config, targetHistory) {
      targetHistory.splice(0, targetHistory.length, {
        role: "system",
        content: createLlmMessageContentFromText(wrapCompactSummaryBlock("compact summary")),
      });
      return {
        droppedMessages: targetHistory.length > 0 ? 2 : 0,
        beforeLength: 3,
        afterLength: 1,
      };
    },
    compactSummaryText(targetHistory) {
      const message = targetHistory.find((entry) => entry.role === "system");
      if (!message) {
        return undefined;
      }
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return unwrapCompactSummaryBlock(text);
    },
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  let persisted = false;
  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    toolExecutor: {
      execute: async () => {
        throw new Error("not used");
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>["toolExecutor"],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    syncSessionTranscript: async ({ transcript }) => {
      persisted = true;
      assert.equal(transcript.kind, "session_transcript");
      assert.equal(transcript.message_count, 2);
      assert.equal(transcript.messages[1]?.toolCalls?.[0]?.name, "read_file");
      return archivePath;
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: "",
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: () => {},
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
    syncSessionTranscriptFromHistory: async (history) =>
      syncSessionTranscriptFromHistoryForTest(options, history ?? runtime.historyStore, (event) =>
        runtime.emitEvent(event as never),
      ),
  };

  const result = await compactHistoryImmediate(runtime);

  assert.equal(persisted, true);
  assert.equal(result.transcriptDirPath, archivePath);
  assert.equal(runtime.historyStore.length, 1);
  const compactText = runtime.historyStore[0]?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  assert.equal(compactText, wrapCompactSummaryBlock("compact summary"));
});

test("compactHistoryImmediate emits event when session transcript sync fails", async () => {
  const history: LlmMessage[] = [
    { role: "user", content: createLlmMessageContentFromText("hello") },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error("not used");
    },
    async compactHistoryManual(_config, targetHistory) {
      targetHistory.splice(0, targetHistory.length, {
        role: "system",
        content: createLlmMessageContentFromText(wrapCompactSummaryBlock("summary")),
      });
      return { droppedMessages: 0, beforeLength: 1, afterLength: 1 };
    },
    compactSummaryText: () => "summary",
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const events: Array<{ kind: string; error?: string }> = [];
  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    toolExecutor: {
      execute: async () => {
        throw new Error("not used");
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>["toolExecutor"],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    syncSessionTranscript: async () => {
      throw new Error("disk full");
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: "",
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: (event) => {
      events.push(event);
    },
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
    syncSessionTranscriptFromHistory: async (history) =>
      syncSessionTranscriptFromHistoryForTest(options, history ?? runtime.historyStore, (event) =>
        runtime.emitEvent(event as never),
      ),
  };

  const result = await compactHistoryImmediate(runtime);

  assert.equal(result.transcriptDirPath, undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "session-transcript-sync-failed");
  assert.match(events[0]?.error ?? "", /disk full/);
});

test("compactHistoryImmediate syncs pre-truncation history and compacts post-truncation history", async () => {
  const longToolOutput = "x".repeat(40_000);
  const history: LlmMessage[] = [
    { role: "user", content: createLlmMessageContentFromText("investigate") },
    {
      role: "assistant",
      content: [],
      toolCalls: [{ id: "call-1", name: "read_file", argumentsJson: "{}" }],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  let compactionToolText = "";

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error("not used");
    },
    async compactHistoryManual(_config, targetHistory) {
      const toolMessage = targetHistory.find((entry) => entry.role === "tool");
      compactionToolText = llmMessageTextContent(toolMessage?.content ?? []);
      targetHistory.splice(0, targetHistory.length, {
        role: "system",
        content: createLlmMessageContentFromText(wrapCompactSummaryBlock("summary")),
      });
      return { droppedMessages: 2, beforeLength: 3, afterLength: 1 };
    },
    compactSummaryText: () => "summary",
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    toolExecutor: {
      execute: async () => {
        throw new Error("not used");
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>["toolExecutor"],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    syncSessionTranscript: async ({ transcript }) => {
      assert.equal(transcript.kind, "session_transcript");
      assert.equal(transcript.message_count, 2);
      assert.equal(transcript.messages[0]?.role, "user");
      assert.equal(transcript.messages[1]?.toolCalls?.[0]?.name, "read_file");
      return "/tmp/spirit/transcripts/s1";
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: "",
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: () => {},
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
    syncSessionTranscriptFromHistory: async (history) =>
      syncSessionTranscriptFromHistoryForTest(options, history ?? runtime.historyStore, (event) =>
        runtime.emitEvent(event as never),
      ),
  };

  await compactHistoryImmediate(runtime);

  assert.match(compactionToolText, /\[tool output truncated for context retry\]/);
  assert.ok(compactionToolText.length < longToolOutput.length);
});

test("compactHistoryImmediate persists tool output archive path in truncated excerpt", async () => {
  const longToolOutput = "y".repeat(40_000);
  const archivePath = "/Spirit/tool-output-archives/smoke-sess/call-1.txt";
  const history: LlmMessage[] = [
    { role: "user", content: createLlmMessageContentFromText("investigate") },
    {
      role: "tool",
      toolCallId: "call-1",
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  let persistedContent = "";
  let compactionToolText = "";

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error("not used");
    },
    async compactHistoryManual(_config, targetHistory) {
      const toolMessage = targetHistory.find((entry) => entry.role === "tool");
      compactionToolText = llmMessageTextContent(toolMessage?.content ?? []);
      targetHistory.splice(0, targetHistory.length, {
        role: "system",
        content: createLlmMessageContentFromText(wrapCompactSummaryBlock("summary")),
      });
      return { droppedMessages: 1, beforeLength: 2, afterLength: 1 };
    },
    compactSummaryText: () => "summary",
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    toolExecutor: {
      execute: async () => {
        throw new Error("not used");
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>["toolExecutor"],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    persistToolOutputArchive: async ({ content }) => {
      persistedContent = content;
      return archivePath;
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: "",
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: () => {},
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
    syncSessionTranscriptFromHistory: async (history) =>
      syncSessionTranscriptFromHistoryForTest(options, history ?? runtime.historyStore, (event) =>
        runtime.emitEvent(event as never),
      ),
  };

  await compactHistoryImmediate(runtime);

  assert.equal(persistedContent, longToolOutput);
  assert.match(
    compactionToolText,
    /Full output archived at: \/Spirit\/tool-output-archives\/smoke-sess\/call-1\.txt/u,
  );
  assert.match(
    compactionToolText,
    /Use read_file on that path only when you need omitted details\./u,
  );
});

test("compactHistoryImmediate keeps transcript when compaction fails after sync", async () => {
  const transcriptDirPath = "/tmp/spirit/transcripts/orphan-session";
  const history: LlmMessage[] = [
    { role: "user", content: createLlmMessageContentFromText("hello") },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error("not used");
    },
    compactHistoryManual: async () => {
      throw new Error("llm unavailable");
    },
    compactSummaryText: () => undefined,
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  let synced = false;
  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    toolExecutor: {
      execute: async () => {
        throw new Error("not used");
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>["toolExecutor"],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    syncSessionTranscript: async () => {
      synced = true;
      return transcriptDirPath;
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: "",
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: () => {},
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
    syncSessionTranscriptFromHistory: async (history) =>
      syncSessionTranscriptFromHistoryForTest(options, history ?? runtime.historyStore, (event) =>
        runtime.emitEvent(event as never),
      ),
  };

  await assert.rejects(() => compactHistoryImmediate(runtime), /llm unavailable/);
  assert.equal(synced, true);
});
