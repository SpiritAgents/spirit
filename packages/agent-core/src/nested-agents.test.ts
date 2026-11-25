import assert from "node:assert/strict";
import { test } from "vitest";

import {
  appendNestedAgentsReminder,
  formatNestedAgentsReminder,
  type NestedAgentsNotification,
  type NestedAgentsTrackerPort,
} from "./nested-agents.js";
import {
  createLlmMessageContentFromText,
  llmMessageTextContent,
  type LlmMessage,
} from "./ports.js";
import { compactHistoryImmediate } from "./runtime/compaction.js";
import { prepareSubmittedUserTurn } from "./runtime/context.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./runtime/tool-output-append.js";
import { AgentRuntime } from "./runtime.js";
import { TOOL_OUTPUT_TRUNCATION_LABEL } from "./tool-agent.js";

function createFakeTracker(initial: Record<string, string> = {}): NestedAgentsTrackerPort & {
  toolCalls: Array<{ toolName: string; rawOutputLength: number; failed: boolean }>;
  workspaceFileBatches: string[][];
  resetCount: number;
  state: Record<string, string>;
  nextNotifications: NestedAgentsNotification[];
} {
  const tracker = {
    toolCalls: [] as Array<{ toolName: string; rawOutputLength: number; failed: boolean }>,
    workspaceFileBatches: [] as string[][],
    resetCount: 0,
    state: { ...initial },
    nextNotifications: [] as NestedAgentsNotification[],
    discoverForToolCall(input: {
      toolName: string;
      request: unknown;
      rawOutput: string;
      failed: boolean;
    }) {
      tracker.toolCalls.push({
        toolName: input.toolName,
        rawOutputLength: input.rawOutput.length,
        failed: input.failed,
      });
      return tracker.nextNotifications;
    },
    discoverForWorkspaceFiles(paths: readonly string[]) {
      tracker.workspaceFileBatches.push([...paths]);
      return tracker.nextNotifications;
    },
    resetForCompaction() {
      tracker.resetCount += 1;
      tracker.state = {};
    },
    snapshotState() {
      return { ...tracker.state };
    },
    restoreState(next: Readonly<Record<string, string>>) {
      tracker.state = { ...next };
    },
  };
  return tracker;
}

test("formatNestedAgentsReminder formats new and updated entries in order", () => {
  assert.equal(formatNestedAgentsReminder([]), undefined);

  const formatted = formatNestedAgentsReminder([
    { path: "/repo/packages/a/AGENTS.md", reason: "new" },
    { path: "/repo/packages/AGENTS.md", reason: "updated" },
  ]);
  assert.ok(formatted);
  assert.match(formatted, /^<nested_agents>\n/u);
  assert.match(formatted, /\n<\/nested_agents>$/u);
  const firstIdx = formatted.indexOf("- /repo/packages/a/AGENTS.md");
  const secondIdx = formatted.indexOf("- /repo/packages/AGENTS.md (updated");
  assert.ok(firstIdx >= 0 && secondIdx > firstIdx);

  const appended = appendNestedAgentsReminder("tool body\n", [
    { path: "/repo/packages/a/AGENTS.md", reason: "new" },
  ]);
  assert.ok(appended.startsWith("tool body\n\n<nested_agents>"));
});

test("prepareAndSyncRuntimeToolResultToHistory appends nested AGENTS.md reminder after truncation using raw output", async () => {
  const tracker = createFakeTracker();
  tracker.nextNotifications = [{ path: "/repo/packages/a/AGENTS.md", reason: "new" }];
  const longToolOutput = "x".repeat(40_000);
  const historyStore: LlmMessage[] = [];

  const prepared = await prepareAndSyncRuntimeToolResultToHistory(
    {
      options: {
        persistToolOutputArchive: async () => "/tmp/archive/call_1.txt",
        nestedAgentsTracker: tracker,
      } as never,
      historyStore,
    },
    "call_1",
    longToolOutput,
    {
      toolName: "read_file",
      request: { name: "read_file", path: "packages/a/src/index.ts" },
      failed: false,
    },
  );

  assert.equal(tracker.toolCalls.length, 1);
  assert.equal(tracker.toolCalls[0]?.rawOutputLength, longToolOutput.length);
  assert.ok(prepared.includes(TOOL_OUTPUT_TRUNCATION_LABEL));
  assert.ok(prepared.endsWith("</nested_agents>"));
  assert.ok(prepared.includes("- /repo/packages/a/AGENTS.md"));
  assert.equal(llmMessageTextContent(historyStore[0]!.content), prepared);
});

test("prepareSubmittedUserTurn discovers nested AGENTS.md for attached workspace files", async () => {
  const tracker = createFakeTracker();
  tracker.nextNotifications = [{ path: "/repo/packages/ui/AGENTS.md", reason: "new" }];
  const recorded: Array<{ role: string; content: string }> = [];
  const historyStore: LlmMessage[] = [];

  await prepareSubmittedUserTurn(
    {
      options: {
        nestedAgentsTracker: tracker,
        createToolAgentState: () => ({}),
      } as never,
      historyStore,
      pendingUserTurnStore: undefined,
      takePendingImages: () => [],
      takePendingMcpResources: () => [],
      recordContextMessage: (role, content) => {
        recorded.push({ role, content });
      },
    },
    "check @packages/ui/button.tsx",
    [],
    [
      {
        kind: "text",
        path: "/repo/packages/ui/button.tsx",
        totalBytes: 12,
        truncated: false,
        attachedAtUnixMs: 1,
        content: "export {};",
      },
      {
        kind: "image",
        path: "/repo/packages/ui/mock.png",
        attachedAtUnixMs: 2,
      },
    ],
  );

  assert.deepEqual(tracker.workspaceFileBatches, [
    ["/repo/packages/ui/button.tsx", "/repo/packages/ui/mock.png"],
  ]);
  const reminderEntry = recorded.find((entry) => entry.content.includes("<nested_agents>"));
  assert.ok(reminderEntry);
  assert.equal(reminderEntry.role, "system");
  assert.ok(reminderEntry.content.includes("/repo/packages/ui/AGENTS.md"));
});

test("compactHistoryImmediate resets nestedAgentsTracker only when messages are dropped", async () => {
  const tracker = createFakeTracker({ "/repo/packages/a/AGENTS.md": "abc" });
  const makeRuntime = (droppedMessages: number) => ({
    options: {
      config: {},
      nestedAgentsTracker: tracker,
      llmTransport: {
        async compactHistoryManual() {
          return { droppedMessages, beforeLength: 4, afterLength: 4 - droppedMessages };
        },
        compactSummaryText: () => "summary",
      },
    } as never,
    historyStore: [{ role: "user" as const, content: createLlmMessageContentFromText("hello") }],
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
    syncSessionTranscriptFromHistory: async () => undefined,
  });

  await compactHistoryImmediate(makeRuntime(0));
  assert.equal(tracker.resetCount, 0);

  await compactHistoryImmediate(makeRuntime(2));
  assert.equal(tracker.resetCount, 1);
  assert.deepEqual(tracker.snapshotState(), {});
});

test("AgentRuntime persists, restores, transfers, and resets nestedAgentsTracker state", () => {
  const firstTracker = createFakeTracker({ "/repo/packages/a/AGENTS.md": "hash-1" });
  const baseOptions = (nestedAgentsTracker: NestedAgentsTrackerPort) =>
    ({
      config: {},
      llmTransport: {} as never,
      toolExecutor: {} as never,
      createToolAgentState: () => ({}),
      appendToolResultMessage: (state: unknown) => state,
      extractAssistantText: () => undefined,
      nestedAgentsTracker,
    }) as never;

  const runtime = new AgentRuntime(baseOptions(firstTracker));

  const archive = runtime.toArchive([], []);
  assert.deepEqual(archive.nestedAgentsSeen, { "/repo/packages/a/AGENTS.md": "hash-1" });

  const secondTracker = createFakeTracker();
  runtime.replaceHostOptions(baseOptions(secondTracker));
  assert.deepEqual(secondTracker.snapshotState(), { "/repo/packages/a/AGENTS.md": "hash-1" });

  runtime.replaceHistory([]);
  assert.equal(secondTracker.resetCount, 1);
  assert.deepEqual(secondTracker.snapshotState(), {});

  runtime.replaceFromArchive(archive);
  assert.deepEqual(secondTracker.snapshotState(), { "/repo/packages/a/AGENTS.md": "hash-1" });
});

test("continuePendingApproval injects nested AGENTS.md reminder for approved foreground tools", async () => {
  const tracker = createFakeTracker();
  tracker.nextNotifications = [{ path: "/repo/packages/a/AGENTS.md", reason: "new" }];

  const appendedToolContents: string[] = [];
  let roundCount = 0;

  const runtime = new AgentRuntime<
    { model: string },
    { messages: string[] },
    { name: string; path: string }
  >({
    config: { model: "fixture-model" },
    nestedAgentsTracker: tracker,
    llmTransport: {
      startToolAgentRound: async () => {
        roundCount += 1;
        if (roundCount === 1) {
          return {
            kind: "success",
            result: {
              state: { messages: ["round-1"] },
              step: {
                kind: "tool-calls",
                calls: [
                  {
                    id: "call_create_1",
                    name: "create_file",
                    argumentsJson: JSON.stringify({ path: "packages/a/new.ts", content: "x" }),
                  },
                ],
              },
              requestTrace: [],
            },
          };
        }
        return {
          kind: "success",
          result: {
            state: { messages: ["round-2"] },
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        };
      },
      isContextOverflowError: () => false,
      compactHistoryManual: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
      compactSummaryText: () => "",
    } as never,
    toolExecutor: {
      toolDefinitionsJson: () => [],
      requestFromFunctionCall: async (_name: string, argsJson: string) => ({
        name: "create_file",
        path: (JSON.parse(argsJson) as { path: string }).path,
      }),
      authorize: async () => ({
        kind: "need-approval",
        approval: { kind: "create_file", path: "packages/a/new.ts", contentChars: 1 },
      }),
      rememberApproval: async () => {},
      execute: async () => ({
        content: createLlmMessageContentFromText(
          "[write]\naction: create_file\npath: /repo/packages/a/new.ts",
        ),
        summaryText: "[write]\naction: create_file\npath: /repo/packages/a/new.ts",
      }),
    } as never,
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state, _toolCallId, content) => {
      appendedToolContents.push(content);
      return { messages: [...state.messages, content] };
    },
    extractAssistantText: () => "approved-done",
  });

  await runtime.startUserTurn("create a file");
  while (!runtime.hasPendingApproval()) {
    await runtime.poll();
  }

  await runtime.continuePendingApproval({ kind: "allow" });
  while (runtime.isBusy()) {
    await runtime.poll();
  }

  assert.equal(tracker.toolCalls.length, 1);
  assert.equal(tracker.toolCalls[0]?.toolName, "create_file");
  assert.equal(appendedToolContents.length, 1);
  assert.ok(appendedToolContents[0]!.includes("<nested_agents>"));
  assert.ok(appendedToolContents[0]!.includes("/repo/packages/a/AGENTS.md"));
  const historyToolMsg = runtime.history().find((msg) => msg.role === "tool");
  assert.ok(historyToolMsg);
  assert.ok(llmMessageTextContent(historyToolMsg.content).includes("/repo/packages/a/AGENTS.md"));
});
