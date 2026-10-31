import assert from "node:assert/strict";
import { test } from "vitest";

import { AgentRuntime } from "../runtime.js";
import { createLlmMessageContentFromText, llmMessageTextContent } from "../ports.js";
import { assistantToolCallMessageFromState } from "../tool-agent.js";
import {
  createTurnContext,
  hasUnansweredAssistantToolCalls,
  repairMissingToolResultsInHistory,
} from "./helpers.js";
import type { HookRunner } from "../hooks/types.js";
import type { PendingEarlyToolExecution, RuntimeEvent } from "./types.js";
import {
  executeAuthorizedToolCall,
  processToolCalls,
  processToolCallsAsync,
  pumpEarlyApprovalQueue,
  resolveEarlyToolCallArguments,
  resumePendingApproval,
  resumePendingQuestions,
  runTurnLoop,
  shouldSkipPersistAssistantToolCalls,
  persistProviderBuiltinToolRoundToHistoryStore,
  startEarlyToolExecution,
  type TurnMachineRuntime,
} from "./turn-machine.js";

test("shouldSkipPersistAssistantToolCalls skips subset re-persist after partial completion", () => {
  const history = [
    {
      role: "assistant" as const,
      content: [],
      toolCalls: [
        { id: "call_00", name: "glob", argumentsJson: "{}" },
        { id: "call_01", name: "grep", argumentsJson: "{}" },
      ],
    },
  ];
  const remaining = [{ id: "call_01", name: "grep", argumentsJson: "{}" }];

  assert.equal(shouldSkipPersistAssistantToolCalls(history, remaining), true);
  assert.equal(
    shouldSkipPersistAssistantToolCalls(history, [
      { id: "call_02", name: "read_file", argumentsJson: "{}" },
    ]),
    false,
  );
});

test("persistProviderBuiltinToolRoundToHistoryStore writes assistant tool_calls and tool results", () => {
  const historyStore: Array<{
    role: "user" | "assistant" | "tool";
    content: string | [];
    toolCalls?: Array<{ id: string; name: string; argumentsJson: string }>;
    toolCallId?: string;
  }> = [{ role: "user", content: "search" }];
  const state = {
    messages: [
      { role: "user", content: "search" },
      {
        role: "assistant",
        content: "Searching now.",
        tool_calls: [
          {
            id: "call_search",
            type: "function",
            function: { name: "web_search", arguments: '{"query":"latest models"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_search",
        content: "[web_search]\n1. Example",
      },
    ],
    steps: 1,
  };

  persistProviderBuiltinToolRoundToHistoryStore(
    {
      historyStore: historyStore as never,
      options: {
        assistantToolCallMessageFromState: assistantToolCallMessageFromState as never,
      } as never,
    },
    state,
    {
      calls: [
        { id: "call_search", name: "web_search", argumentsJson: '{"query":"latest models"}' },
      ],
      toolResults: [{ toolCallId: "call_search", content: "[web_search]\n1. Example" }],
    },
  );

  assert.equal(historyStore.length, 3);
  assert.equal(historyStore[1]?.role, "assistant");
  assert.equal(historyStore[1]?.toolCalls?.[0]?.name, "web_search");
  assert.equal(historyStore[2]?.role, "tool");
  assert.equal(historyStore[2]?.toolCallId, "call_search");
});

test("resumePendingApproval deny persists tool result into historyStore", async () => {
  const state = {
    messages: [
      {
        role: "assistant",
        content: "run shell",
        tool_calls: [
          {
            id: "call_shell",
            type: "function",
            function: { name: "shell", arguments: "{}" },
          },
        ],
      },
    ],
    steps: 0,
  };
  const request = { name: "shell", argumentsJson: "{}" };
  const turn = createTurnContext<{ name: string; argumentsJson: string }>();
  const historyStore = [
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "run shell" }],
      toolCalls: [
        {
          id: "call_shell",
          name: "shell",
          argumentsJson: "{}",
        },
      ],
    },
  ];
  const runtime = {
    options: buildAgentRuntimeOptions([{ kind: "final", text: "summary after deny" }]),
    historyStore,
    requestTraceStore: [],
    pendingUserTurnStore: "check types",
    pendingApproval: {
      pendingUserInput: "check types",
      state,
      request,
      toolCallId: "call_shell",
      toolName: "shell",
      remainingCalls: [],
      turn,
    },
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("unused");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, typeof request>;

  const result = await resumePendingApproval(runtime, { kind: "deny" });

  assert.equal(result.kind, "completed");
  const toolMessage = runtime.historyStore.find(
    (message) => message.role === "tool" && message.toolCallId === "call_shell",
  );
  assert.ok(toolMessage);
  assert.equal(
    toolMessage?.content[0]?.type === "text" ? toolMessage.content[0].text : "",
    "[denied by user] tool call rejected by user approval policy",
  );
});

test("executeAuthorizedToolCall forwards toolArgumentsJson to postToolUse hook", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let capturedToolInput: unknown;
  const hookRunner = createStubHookRunner(async () => ({
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
  }));
  hookRunner.runPostToolUse = async (input) => {
    capturedToolInput = input.toolInput;
    return {
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  };

  const runtime = {
    options: {
      config: {},
      hookRunner,
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          ...(JSON.parse(argumentsJson) as Record<string, unknown>),
        }),
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async () => ({
          output: { content: [], summaryText: "ok" },
          failed: false,
          backgroundExecution: false,
        }),
      },
      appendToolResultMessage: (currentState: typeof state) => currentState,
      createContinuationState: (messages: unknown[]) => ({ messages, steps: 0 }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => ({
      output: { content: [], summaryText: "ok" },
      failed: false,
      backgroundExecution: false,
    }),
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string; path?: string }>;

  await executeAuthorizedToolCall(
    runtime,
    "read file",
    state,
    { name: "read_file", path: "README.md" },
    "call_read",
    "read_file",
    [],
    createTurnContext(),
    '{"path":"README.md"}',
  );

  assert.deepEqual(capturedToolInput, { path: "README.md" });
});

test("resumePendingQuestions forwards argumentsJson to postToolUse hook", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let capturedToolInput: unknown;
  const hookRunner = createStubHookRunner(async () => ({
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
  }));
  hookRunner.runPostToolUse = async (input) => {
    capturedToolInput = input.toolInput;
    return {
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  };
  const turn = createTurnContext<{ name: string; command?: string }>();
  const request = { name: "shell", command: "echo hi" };
  const runtime = {
    options: {
      config: {},
      hookRunner,
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        continueAfterQuestions: async () => request,
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          ...(JSON.parse(argumentsJson) as Record<string, unknown>),
        }),
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async () => ({
          output: { content: [], summaryText: "ok" },
          failed: false,
          backgroundExecution: false,
        }),
      },
      appendToolResultMessage: (currentState: typeof state) => currentState,
      createContinuationState: (messages: unknown[]) => ({ messages, steps: 0 }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: {
      pendingUserInput: "run shell",
      state,
      request,
      questions: [],
      toolCallId: "call_shell",
      toolName: "shell",
      argumentsJson: '{"command":"echo hi"}',
      remainingCalls: [],
      turn,
    },
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => ({
      output: { content: [], summaryText: "ok" },
      failed: false,
      backgroundExecution: false,
    }),
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, typeof request>;

  await resumePendingQuestions(runtime, { status: "answered", answers: [] });

  assert.deepEqual(capturedToolInput, { command: "echo hi" });
});

test("resumePendingQuestions syncs native ask_questions answers into historyStore", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const turn = createTurnContext<{ name: string }>();
  const request = { name: "ask_questions" };
  const answersResult = {
    status: "answered" as const,
    answers: [{ questionId: "q1", selectedOptionIds: [], customText: "alpha" }],
  };
  const historyStore = [
    {
      role: "assistant" as const,
      content: [],
      toolCalls: [{ id: "call_q", name: "ask_questions", argumentsJson: "{}" }],
    },
  ];
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        continueAfterQuestions: async () => undefined,
      },
      appendToolResultMessage: (
        currentState: typeof state,
        toolCallId: string,
        content: string,
      ) => ({
        messages: [...currentState.messages, { role: "tool", content, toolCallId }],
        steps: currentState.steps,
      }),
      createContinuationState: (messages: unknown[]) => ({ messages, steps: 0 }),
      extractAssistantText: () => "done",
    },
    historyStore,
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: {
      pendingUserInput: "ask me",
      state,
      request,
      questions: [],
      toolCallId: "call_q",
      toolName: "ask_questions",
      argumentsJson: "{}",
      remainingCalls: [],
      turn,
      resumeAsStreaming: false,
      streamingEmitBeginResponse: true,
    },
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("native ask_questions should not execute");
    },
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, typeof request>;

  await resumePendingQuestions(runtime, answersResult);

  const toolMessage = runtime.historyStore.find(
    (message) => message.role === "tool" && message.toolCallId === "call_q",
  );
  assert.ok(toolMessage);
  assert.equal(llmMessageTextContent(toolMessage.content), JSON.stringify(answersResult));
});

test("executeAuthorizedToolCall runs postToolUse after internal tool completion", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let postToolUseCount = 0;
  const hookRunner = createStubHookRunner(async () => ({
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
  }));
  hookRunner.runPostToolUse = async () => {
    postToolUseCount += 1;
    return {
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  };
  const turn = createTurnContext<{ name: string }>();
  const runtime = {
    options: {
      config: {},
      hookRunner,
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async () => ({
          output: { content: [], summaryText: "ok" },
          failed: false,
          backgroundExecution: false,
        }),
      },
      appendToolResultMessage: (currentState: typeof state) => currentState,
      createContinuationState: (messages: unknown[]) => ({ messages, steps: 0 }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("external execution should not run");
    },
    maybeExecuteInternalToolCall: async (
      _pendingUserInput: string,
      currentState: typeof state,
      toolRequest: { name: string },
      toolCallId: string,
    ) => {
      turn.toolExecutions.push({
        toolCallId,
        toolName: toolRequest.name,
        request: toolRequest,
        output: "internal done",
        failed: false,
      });
      return {
        kind: "completed",
        assistantText: "internal done",
        state: currentState,
        requestTrace: [],
        toolExecutions: [...turn.toolExecutions],
        compactions: [],
      };
    },
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  await executeAuthorizedToolCall(
    runtime,
    "finish",
    state,
    { name: "finish_task" },
    "call_finish",
    "finish_task",
    [],
    turn,
    '{"summary":"done"}',
  );

  assert.equal(postToolUseCount, 1);
});

test("processToolCalls passes hook updatedInput to postToolUse", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let capturedToolInput: unknown;
  const hookRunner = createStubHookRunner(async () => ({
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: { path: "hooked.md" },
    additionalContexts: [],
    followupMessage: undefined,
  }));
  hookRunner.runPostToolUse = async (input) => {
    capturedToolInput = input.toolInput;
    return {
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  };
  const runtime = {
    options: {
      config: {},
      hookRunner,
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          ...(JSON.parse(argumentsJson) as Record<string, unknown>),
        }),
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async () => ({
          output: { content: [], summaryText: "ok" },
          failed: false,
          backgroundExecution: false,
        }),
      },
      appendToolResultMessage: (
        currentState: typeof state,
        _toolCallId: string,
        content: string,
      ) => ({
        ...currentState,
        messages: [...currentState.messages, { role: "tool", content }],
      }),
      createContinuationState: (messages: unknown[]) => ({ messages, steps: 0 }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => ({
      output: { content: [], summaryText: "ok" },
      failed: false,
      backgroundExecution: false,
    }),
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string; path?: string }>;

  await processToolCalls(
    runtime,
    state,
    "read",
    [{ id: "call_read", name: "read_file", argumentsJson: '{"path":"original.md"}' }],
    createTurnContext(),
  );

  assert.deepEqual(capturedToolInput, { path: "hooked.md" });
});

test("hasUnansweredAssistantToolCalls detects parallel tool calls with partial results", () => {
  const history = [
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "" }],
      toolCalls: [
        { id: "call_shell", name: "shell", argumentsJson: "{}" },
        { id: "call_glob", name: "glob", argumentsJson: "{}" },
      ],
    },
    {
      role: "tool" as const,
      toolCallId: "call_glob",
      content: [{ type: "text" as const, text: "glob ok" }],
    },
  ];

  assert.equal(hasUnansweredAssistantToolCalls(history), true);

  history.push({
    role: "tool" as const,
    toolCallId: "call_shell",
    content: [{ type: "text" as const, text: "shell ok" }],
  });

  assert.equal(hasUnansweredAssistantToolCalls(history), false);
});

test("repairMissingToolResultsInHistory inserts placeholders for orphaned tool calls", () => {
  const history = [
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "run shell" }],
      toolCalls: [
        {
          id: "call_00_zbxFvpiBoJJIy2ca3n8b4482",
          name: "shell",
          argumentsJson: "{}",
        },
      ],
    },
    {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "The tool was rejected but continuing." }],
    },
  ];

  const repaired = repairMissingToolResultsInHistory(history);
  const toolMessage = repaired.find(
    (message) =>
      message.role === "tool" && message.toolCallId === "call_00_zbxFvpiBoJJIy2ca3n8b4482",
  );

  assert.ok(toolMessage);
  assert.equal(repaired.indexOf(toolMessage!), 1);
});

test("processToolCalls emits tool-execution-finished when requestFromFunctionCall schema fails", async () => {
  const events: RuntimeEvent<{ name: string; summary?: string }>[] = [];
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const turn = createTurnContext<{ name: string; summary?: string }>();
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async () => {
          throw new Error("Unknown tool: finish_task");
        },
        authorize: async () => {
          throw new Error("unused");
        },
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => "tool failed",
    },
    historyStore: [] as Array<{
      role: string;
      toolCallId?: string;
      content: Array<{ type: string; text: string }>;
    }>,
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: (event: RuntimeEvent<{ name: string; summary?: string }>) => {
      events.push(event);
    },
    performToolExecution: async () => {
      throw new Error("unused");
    },
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string; summary?: string }>;

  await processToolCalls(
    runtime,
    state,
    "call finish_task",
    [{ id: "call_finish", name: "finish_task", argumentsJson: '{"summary":"confirm again"}' }],
    turn,
  );

  const finished = events.find((event) => event.kind === "tool-execution-finished");
  assert.ok(finished);
  assert.equal(finished.execution.toolName, "finish_task");
  assert.equal(finished.execution.failed, true);
  assert.match(finished.execution.output, /schema error/);
});

test("processToolCalls does not re-persist assistant tool calls when continuing remaining calls", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const calls = [
    { id: "call_00", name: "glob", argumentsJson: "{}" },
    { id: "call_01", name: "grep", argumentsJson: "{}" },
  ];
  let performExecutionCount = 0;
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: "allowed" }),
        execute: async (request: { name: string }) => ({
          content: [],
          summaryText: `ok:${request.name}`,
        }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (
        currentState: typeof state,
        toolCallId: string,
        content: string,
      ) => ({
        messages: [...currentState.messages, { role: "tool", content, toolCallId }],
        steps: currentState.steps,
      }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async (_request: { name: string }, toolName: string) => {
      performExecutionCount += 1;
      return {
        output: { content: [], summaryText: `ok:${toolName}` },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(runtime, state, "run tools", calls, createTurnContext());

  assert.equal(result.kind, "completed");
  assert.equal(performExecutionCount, 2);
  assert.equal(
    runtime.historyStore.filter(
      (message) => message.role === "assistant" && message.toolCalls?.length,
    ).length,
    1,
  );
  assert.deepEqual(
    runtime.historyStore
      .filter((message) => message.role === "assistant" && message.toolCalls?.length)
      .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.id) ?? []),
    ["call_00", "call_01"],
  );
});

function createStubHookRunner(preToolUse: HookRunner["runPreToolUse"]): HookRunner {
  const unused = async () => {
    throw new Error("unused");
  };
  const emptyHookResult = async () => ({
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
  });
  return {
    runSessionStart: unused,
    runSessionEnd: unused,
    runSubmitPrompt: unused,
    runPreToolUse: preToolUse,
    runPostToolUse: emptyHookResult,
    runSubagentStart: unused,
    runSubagentEnd: unused,
  };
}

test("processToolCalls hook allow does not bypass host need-approval", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let performExecutionCount = 0;
  const runtime = {
    options: {
      config: {},
      hookRunner: createStubHookRunner(async () => ({
        records: [],
        denied: false,
        permission: "allow",
        userMessage: undefined,
        agentMessage: undefined,
        updatedInput: undefined,
        additionalContexts: [],
        followupMessage: undefined,
      })),
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "success",
          result: {
            state,
            step: { kind: "final-response-ready" },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "grep x", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (
        currentState: typeof state,
        toolCallId: string,
        content: string,
      ) => ({
        messages: [...currentState.messages, { role: "tool", content, toolCallId }],
        steps: currentState.steps,
      }),
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      performExecutionCount += 1;
      return {
        output: { content: [], summaryText: "ok" },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(
    runtime,
    state,
    "run shell",
    [{ id: "call_shell", name: "shell", argumentsJson: '{"command":"echo hi"}' }],
    createTurnContext(),
  );

  // Hook "allow" can only tighten or keep the host decision, never skip host approval.
  assert.equal(result.kind, "requires-approval");
  assert.equal(performExecutionCount, 0);
});

test("processToolCalls auto-approval reviewer allow skips manual approval", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  let performExecutionCount = 0;
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async () => ({
          name: "shell",
          command: "echo hi",
          reason: "test",
        }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      getApprovalLevel: () => "auto-approval" as const,
      reviewToolApproval: async () => ({ allow: true, reason: "benign echo" }),
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      performExecutionCount += 1;
      return {
        output: { content: [], summaryText: "ok" },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<
    {},
    typeof state,
    { name: string; command: string; reason: string }
  >;

  const result = await processToolCalls(
    runtime,
    state,
    "run shell",
    [{ id: "call_shell", name: "shell", argumentsJson: '{"command":"echo hi","reason":"test"}' }],
    createTurnContext(),
  );

  assert.notEqual(result.kind, "requires-approval");
  assert.equal(performExecutionCount, 1);
});

test("processToolCalls auto-approval reviewer block requires manual approval with reason", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async () => ({
          name: "shell",
          command: "rm -rf /",
          reason: "test",
        }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "rm -rf /", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      getApprovalLevel: () => "auto-approval" as const,
      reviewToolApproval: async () => ({ allow: false, reason: "destructive command" }),
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("should not execute");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<
    {},
    typeof state,
    { name: string; command: string; reason: string }
  >;

  const result = await processToolCalls(
    runtime,
    state,
    "run shell",
    [{ id: "call_shell", name: "shell", argumentsJson: '{"command":"rm -rf /","reason":"test"}' }],
    createTurnContext(),
  );

  assert.equal(result.kind, "requires-approval");
  if (result.kind === "requires-approval") {
    assert.equal(result.approval.autoReviewBlockReason, "destructive command");
  }
});

test("processToolCalls auto-approval reviews multiple tools concurrently then executes in order", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  /** Incremented in async callbacks; object fields avoid an oxlint false positive about the loop condition not being modified. */
  const reviewProgress = { started: 0, inFlight: 0, maxInFlight: 0 };
  const releaseGates: Array<() => void> = [];
  const executionOrder: string[] = [];

  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          argumentsJson,
        }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "cat a.txt", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      getApprovalLevel: () => "auto-approval" as const,
      reviewToolApproval: async () => {
        reviewProgress.started += 1;
        reviewProgress.inFlight += 1;
        reviewProgress.maxInFlight = Math.max(reviewProgress.maxInFlight, reviewProgress.inFlight);
        await new Promise<void>((resolve) => {
          releaseGates.push(resolve);
        });
        reviewProgress.inFlight -= 1;
        return { allow: true, reason: "ok" };
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => "done",
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async (_request: unknown, toolName: string, toolCallId: string) => {
      executionOrder.push(toolCallId);
      return {
        output: { content: [], summaryText: `${toolName}-ok` },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string; argumentsJson: string }>;

  const resultPromise = processToolCalls(
    runtime,
    state,
    "edit files",
    [
      { id: "call_a", name: "edit_file", argumentsJson: '{"path":"a.txt"}' },
      { id: "call_b", name: "edit_file", argumentsJson: '{"path":"b.txt"}' },
    ],
    createTurnContext(),
  );

  const deadline = Date.now() + 2000;
  while (reviewProgress.started < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(reviewProgress.started, 2);
  assert.equal(reviewProgress.maxInFlight, 2);
  assert.equal(releaseGates.length, 2);
  for (const release of releaseGates) {
    release();
  }

  const result = await resultPromise;
  assert.notEqual(result.kind, "requires-approval");
  assert.deepEqual(executionOrder, ["call_a", "call_b"]);
});

test("processToolCalls auto-approval block stops later tools after earlier allow", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const executionOrder: string[] = [];
  let reviewStarts = 0;

  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          argumentsJson,
        }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "cat a.txt", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      getApprovalLevel: () => "auto-approval" as const,
      reviewToolApproval: async (input: { argumentsJson: string }) => {
        reviewStarts += 1;
        if (input.argumentsJson.includes("b.txt")) {
          return { allow: false, reason: "blocked b" };
        }
        return { allow: true, reason: "ok" };
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async (_request: unknown, _toolName: string, toolCallId: string) => {
      executionOrder.push(toolCallId);
      return {
        output: { content: [], summaryText: "ok" },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string; argumentsJson: string }>;

  const result = await processToolCalls(
    runtime,
    state,
    "edit files",
    [
      { id: "call_a", name: "edit_file", argumentsJson: '{"path":"a.txt"}' },
      { id: "call_b", name: "edit_file", argumentsJson: '{"path":"b.txt"}' },
      { id: "call_c", name: "edit_file", argumentsJson: '{"path":"c.txt"}' },
    ],
    createTurnContext(),
  );

  assert.equal(result.kind, "requires-approval");
  if (result.kind === "requires-approval") {
    assert.equal(result.approval.toolCallId, "call_b");
    assert.equal(result.approval.autoReviewBlockReason, "blocked b");
  }
  assert.deepEqual(executionOrder, ["call_a"]);
  assert.ok(reviewStarts >= 2);
});

test("processToolCalls hook ask triggers approval when host allows", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = {
    options: {
      config: {},
      hookRunner: createStubHookRunner(async () => ({
        records: [],
        denied: false,
        permission: "ask",
        userMessage: "hook confirmation required",
        agentMessage: undefined,
        updatedInput: undefined,
        additionalContexts: [],
        followupMessage: undefined,
      })),
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: "allowed" }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("unused");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(
    runtime,
    state,
    "run grep",
    [{ id: "call_grep", name: "grep", argumentsJson: '{"pattern":"hook"}' }],
    createTurnContext(),
  );

  assert.equal(result.kind, "requires-approval");
  if (result.kind === "requires-approval") {
    assert.deepEqual(result.approval.prompt, {
      kind: "hook",
      message: "hook confirmation required",
    });
    assert.equal(result.approval.toolName, "grep");
  }
});

test("processToolCalls hook ask on host-allowed call carries the described approval request", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const described = {
    kind: "read_path" as const,
    operation: "read_file" as const,
    path: "/w/notes.md",
    fileContentPreview: { path: "/w/notes.md", content: "hi\n" },
  };
  const runtime = {
    options: {
      config: {},
      hookRunner: createStubHookRunner(async () => ({
        records: [],
        denied: false,
        permission: "ask",
        userMessage: "hook confirmation required",
        agentMessage: undefined,
        updatedInput: undefined,
        additionalContexts: [],
        followupMessage: undefined,
      })),
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: "allowed" }),
        describeApproval: async () => described,
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("unused");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(
    runtime,
    state,
    "run read_file",
    [{ id: "call_read", name: "read_file", argumentsJson: '{"path":"notes.md"}' }],
    createTurnContext(),
  );

  assert.equal(result.kind, "requires-approval");
  if (result.kind === "requires-approval") {
    // The hook keeps its message; the described structured request rides along.
    assert.deepEqual(result.approval.prompt, {
      kind: "hook",
      message: "hook confirmation required",
      request: described,
    });
  }
});

test("processToolCalls auto-approval does not bypass hook ask permission", async () => {
  let performExecutionCount = 0;
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = {
    options: {
      config: {},
      hookRunner: createStubHookRunner(async () => ({
        records: [],
        denied: false,
        permission: "ask",
        userMessage: "hook confirmation required",
        agentMessage: undefined,
        updatedInput: undefined,
        additionalContexts: [],
        followupMessage: undefined,
      })),
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: "failure",
          error: "unused",
          requestTrace: [],
        }),
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: "allowed" }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      getApprovalLevel: () => "auto-approval" as const,
      reviewToolApproval: async () => ({ allow: true, reason: "would allow" }),
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      performExecutionCount += 1;
      return { content: [], summaryText: "ok" };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(
    runtime,
    state,
    "run grep",
    [{ id: "call_grep", name: "grep", argumentsJson: '{"pattern":"hook"}' }],
    createTurnContext(),
  );

  assert.equal(result.kind, "requires-approval");
  assert.equal(performExecutionCount, 0);
  if (result.kind === "requires-approval") {
    assert.deepEqual(result.approval.prompt, {
      kind: "hook",
      message: "hook confirmation required",
    });
    assert.equal(result.approval.autoReviewBlockReason, undefined);
  }
});

test("processToolCalls persists the full assistant tool-call message from state", async () => {
  const state = {
    messages: [
      {
        role: "assistant",
        content: "calling weather",
        reasoning_parts: [
          {
            type: "reasoning",
            text: "Need weather first.",
            providerOptions: {
              anthropic: {
                signature: "sig_turn_machine",
              },
            },
          },
        ],
        tool_calls: [
          {
            id: "call_weather",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"Paris"}',
            },
          },
        ],
      },
    ],
    steps: 1,
  };
  const calls = [
    {
      id: "call_weather",
      name: "get_weather",
      argumentsJson: '{"city":"Paris"}',
    },
  ];

  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({ kind: "failure", error: "unused", requestTrace: [] }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) => ({
          argumentsJson,
        }),
        authorize: async () => ({
          kind: "need-approval",
          approval: { kind: "shell", command: "ls", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "" }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      assistantToolCallMessageFromState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error("unused");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { argumentsJson: string }>;

  const result = await processToolCalls(runtime, state, "weather?", calls, createTurnContext());

  assert.equal(result.kind, "requires-approval");
  assert.equal(runtime.historyStore.length, 1);
  assert.deepEqual(runtime.historyStore[0], {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "calling weather",
      },
    ],
    toolCalls: [
      {
        id: "call_weather",
        name: "get_weather",
        argumentsJson: '{"city":"Paris"}',
      },
    ],
    providerState: {
      reasoning_parts: [
        {
          type: "reasoning",
          text: "Need weather first.",
          providerOptions: {
            anthropic: {
              signature: "sig_turn_machine",
            },
          },
        },
      ],
    },
  });
});

test("runTurnLoop completes ordinary final response when Loop is disabled", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = buildLoopTestRuntime({
    loopEnabled: false,
    rounds: [{ kind: "final", text: "done" }],
  });

  const result = await runTurnLoop(runtime, state, "work", createTurnContext());

  assert.equal(result.kind, "completed");
  assert.equal(result.kind === "completed" ? result.assistantText : "", "done");
  assert.deepEqual(
    runtime.historyStore.map((message) => message.role),
    ["assistant"],
  );
});

test("runTurnLoop continues ordinary final response when Loop is enabled", async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = buildLoopTestRuntime({
    loopEnabled: true,
    rounds: [
      { kind: "final", text: "step one" },
      { kind: "failure", error: "stop after loop continuation" },
    ],
  });

  const result = await runTurnLoop(runtime, state, "work", createTurnContext());

  assert.equal(result.kind, "failed");
  assert.equal(runtime.roundsStarted, 2);
  assert.deepEqual(
    runtime.historyStore.map((message) => message.role),
    ["assistant", "user"],
  );
  assert.match(
    runtime.historyStore[1]?.content[0]?.type === "text"
      ? runtime.historyStore[1].content[0].text
      : "",
    /finish_task/,
  );
  assert.match(
    runtime.historyStore[1]?.content[0]?.type === "text"
      ? runtime.historyStore[1].content[0].text
      : "",
    /Original user request:\nwork/,
  );
  assert.equal(runtime.pendingUserTurnStore, "work");
});

test("AgentRuntime completes Loop when finish_task is called", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([
      { kind: "final", text: "step one" },
      {
        kind: "tool",
        id: "call_finish",
        name: "finish_task",
        argumentsJson: '{"summary":"all done"}',
      },
    ]),
  );
  runtime.setLoopEnabled(true);

  const result = await runtime.submitUserTurn("work");

  assert.equal(result.kind, "completed");
  assert.equal(result.kind === "completed" ? result.assistantText : "", "all done");
  assert.equal(runtime.loopEnabled(), true);
  assert.deepEqual(
    runtime.history().map((message) => message.role),
    ["user", "assistant", "user", "assistant", "tool"],
  );
});

test("AgentRuntime omits sync assistant UI events when finish_task completes", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([
      {
        kind: "tool",
        id: "call_finish",
        name: "finish_task",
        argumentsJson: '{"summary":"all done"}',
      },
    ]),
  );
  runtime.setLoopEnabled(true);

  await runtime.submitUserTurn("work");
  const events = runtime.drainEvents();

  assert.equal(
    events.some((event) => event.kind === "begin-assistant-response"),
    false,
  );
  assert.equal(
    events.some((event) => event.kind === "assistant-chunk"),
    false,
  );
  assert.equal(
    events.some((event) => event.kind === "assistant-response-completed"),
    false,
  );
});

test("AgentRuntime rejects finish_task when Loop is disabled", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions(
      [
        { kind: "tool", id: "call_finish", name: "finish_task", argumentsJson: "{}" },
        { kind: "final", text: "done without finish_task" },
      ],
      {
        requestFromFunctionCall: async (name: string) => {
          if (name === "finish_task") {
            throw new Error(`Unknown tool: ${name}`);
          }
          return { name };
        },
      },
    ),
  );

  const result = await runtime.submitUserTurn("work");

  assert.equal(result.kind, "completed");
  assert.equal(result.kind === "completed" ? result.assistantText : "", "done without finish_task");
  assert.equal(runtime.loopEnabled(), false);
});

test("continueAssistantCompletionStreaming repairs unanswered tool calls left by an abort", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([{ kind: "final", text: "continued" }]),
    [
      { role: "user", content: createLlmMessageContentFromText("run something") },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("running a tool"),
        toolCalls: [{ id: "call_shell", name: "shell", argumentsJson: "{}" }],
      },
    ],
  );

  await runtime.continueAssistantCompletionStreaming();
  for (let index = 0; index < 24 && runtime.isBusy(); index += 1) {
    await runtime.poll();
  }

  // The dangling tool call must have a (placeholder) result before the continue request is built.
  const toolResultIds = runtime
    .history()
    .filter((message) => message.role === "tool")
    .map((message) => message.toolCallId);
  assert.ok(toolResultIds.includes("call_shell"));
  assert.equal(hasUnansweredAssistantToolCalls(runtime.history()), false);
});

type LoopTestRound =
  | { kind: "final"; text: string }
  | { kind: "tool"; id: string; name: string; argumentsJson: string }
  | { kind: "failure"; error: string };

function buildLoopTestRuntime(options: {
  loopEnabled: boolean;
  rounds: LoopTestRound[];
}): TurnMachineRuntime<
  {},
  { messages: Array<{ role: string; content?: string }>; steps: number },
  { name: string; summary?: string }
> & {
  roundsStarted: number;
} {
  let index = 0;
  const runtime = {
    roundsStarted: 0,
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => {
          runtime.roundsStarted += 1;
          const round = options.rounds[index++];
          if (!round || round.kind === "failure") {
            return {
              kind: "failure" as const,
              error: round?.kind === "failure" ? round.error : "missing round",
              requestTrace: [],
            };
          }
          if (round.kind === "tool") {
            return {
              kind: "success" as const,
              result: {
                state: { messages: [], steps: 0 },
                step: {
                  kind: "tool-calls" as const,
                  calls: [{ id: round.id, name: round.name, argumentsJson: round.argumentsJson }],
                },
                requestTrace: [],
              },
            };
          }
          return {
            kind: "success" as const,
            result: {
              state: { messages: [{ role: "assistant", content: round.text }], steps: 0 },
              step: { kind: "final-response-ready" as const },
              requestTrace: [],
            },
          };
        },
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          ...(JSON.parse(argumentsJson) as { summary?: string }),
        }),
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async () => ({ content: [], summaryText: "" }),
      },
      createToolAgentState: () => ({ messages: [], steps: 0 }),
      appendUserMessage: (
        currentState: { messages: Array<{ role: string; content?: string }>; steps: number },
        content: string,
      ) => ({
        messages: [...currentState.messages, { role: "user", content }],
        steps: currentState.steps,
      }),
      appendToolResultMessage: (currentState: {
        messages: Array<{ role: string; content?: string }>;
        steps: number;
      }) => currentState,
      extractAssistantText: (currentState: {
        messages: Array<{ role: string; content?: string }>;
      }) => latestAssistantContent(currentState.messages),
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => ({
      output: { content: [], summaryText: "" },
      failed: false,
      backgroundExecution: false,
    }),
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    startStreamingRound: async () => {},
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    loopEnabled: () => options.loopEnabled,
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<
    {},
    { messages: Array<{ role: string; content?: string }>; steps: number },
    { name: string; summary?: string }
  > & {
    roundsStarted: number;
  };
  return runtime;
}

function buildAgentRuntimeOptions(
  rounds: LoopTestRound[],
  toolExecutorOverrides: Record<string, unknown> = {},
): any {
  let index = 0;
  const baseToolExecutor = {
    toolDefinitionsJson: () => [],
    parseCommand: async () => ({ name: "finish_task" }),
    requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
      name,
      ...(JSON.parse(argumentsJson || "{}") as { summary?: string }),
    }),
    authorize: async () => ({ kind: "allowed" as const }),
    rememberApproval: async () => {},
    execute: async () => ({ content: [], summaryText: "" }),
    startMcpBackgroundRefresh: () => {},
    mcpStatusSnapshot: () => ({
      revision: 0,
      state: "idle" as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    }),
    addMcpServer: async () => "",
    listMcpServers: async () => [],
    inspectMcpServer: async () => ({}),
    listMcpTools: async () => [],
    listMcpResources: async () => [],
    readMcpResource: async () => ({}),
    listCachedMcpPrompts: async () => [],
    listMcpPrompts: async () => [],
    getMcpPrompt: async () => ({}),
  };
  return {
    config: {},
    llmTransport: {
      startToolAgentRound: async () => {
        const round = rounds[index++];
        if (!round || round.kind === "failure") {
          return {
            kind: "failure" as const,
            error: round?.kind === "failure" ? round.error : "missing round",
            requestTrace: [],
          };
        }
        if (round.kind === "tool") {
          return {
            kind: "success" as const,
            result: {
              state: {
                messages: [
                  {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: round.id,
                        type: "function",
                        function: {
                          name: round.name,
                          arguments: round.argumentsJson,
                        },
                      },
                    ],
                  },
                ],
                steps: 0,
              },
              step: {
                kind: "tool-calls" as const,
                calls: [{ id: round.id, name: round.name, argumentsJson: round.argumentsJson }],
              },
              requestTrace: [],
            },
          };
        }
        return {
          kind: "success" as const,
          result: {
            state: { messages: [{ role: "assistant", content: round.text }], steps: 0 },
            step: { kind: "final-response-ready" as const },
            requestTrace: [],
          },
        };
      },
      compactHistoryManual: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
      compactSummaryText: () => undefined,
      isContextOverflowError: () => false,
      llmHistoryAsApiMessages: () => [],
      llmSystemPromptsForExport: () => ({}),
    },
    toolExecutor: {
      ...baseToolExecutor,
      ...toolExecutorOverrides,
    },
    createToolAgentState: (_history: unknown[], userInput: string) => ({
      messages: [{ role: "user", content: userInput }],
      steps: 0,
    }),
    appendUserMessage: (state: { messages: unknown[]; steps: number }, content: string) => ({
      messages: [...state.messages, { role: "user", content }],
      steps: state.steps,
    }),
    createContinuationState: () => ({ messages: [], steps: 0 }),
    appendToolResultMessage: (
      state: { messages: unknown[]; steps: number },
      toolCallId: string,
      content: string,
    ) => ({
      messages: [...state.messages, { role: "tool", tool_call_id: toolCallId, content }],
      steps: state.steps,
    }),
    assistantToolCallMessageFromState: (
      state: unknown,
      calls: Parameters<typeof assistantToolCallMessageFromState>[1],
    ) =>
      assistantToolCallMessageFromState(
        state as Parameters<typeof assistantToolCallMessageFromState>[0],
        calls,
      ),
    extractAssistantText: (state: { messages: Array<{ role: string; content?: string }> }) =>
      latestAssistantContent(state.messages),
  };
}

function latestAssistantContent(
  messages: Array<{ role: string; content?: string }>,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message.content;
    }
  }
  return undefined;
}

test("resolveEarlyToolCallArguments waits for complete read_file JSON", () => {
  assert.equal(resolveEarlyToolCallArguments("read_file", '{"path":"Cargo.toml"'), undefined);
  const resolved = resolveEarlyToolCallArguments("read_file", '{"path":"Cargo.toml"}');
  assert.deepEqual(resolved, {
    argumentsJson: '{"path":"Cargo.toml"}',
    canonicalArgumentsJson: '{"path":"Cargo.toml"}',
  });
});

test("startEarlyToolExecution executes read_file once arguments JSON is complete", async () => {
  const executed: string[] = [];
  const events: RuntimeEvent<{ name: string; path: string }>[] = [];
  const runtime = {
    options: {
      toolExecutor: {
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as { name: string; path: string },
        authorize: async () => ({ kind: "allowed" as const }),
        execute: async (request: { path: string }) => {
          executed.push(request.path);
          return { content: [], summaryText: `read ${request.path}` };
        },
      },
    },
    emitEvent: (event: RuntimeEvent<{ name: string; path: string }>) => {
      events.push(event);
    },
    tryPerformEarlyInternalToolCall: undefined,
    earlyApprovalQueue: [],
  } as unknown as TurnMachineRuntime<{}, {}, { name: string; path: string }>;

  const early = new Map();
  const record = startEarlyToolExecution(
    runtime,
    { id: "call-preview-read", name: "read_file", argumentsJson: '{"path":"preview.txt"}' },
    early,
  );
  assert.ok(record);
  const outcome = await record?.outcome;
  assert.equal(outcome?.kind, "completed");
  assert.deepEqual(executed, ["preview.txt"]);
  assert.ok(events.some((event) => event.kind === "tool-call-started"));
  assert.ok(events.some((event) => event.kind === "tool-execution-finished"));
});

test("startEarlyToolExecution requests approval when preview args are stable", async () => {
  type ShellRequest = { name: string; command: string };
  const events: RuntimeEvent<ShellRequest>[] = [];
  const turn = createTurnContext<ShellRequest>();
  const runtime = {
    options: {
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as ShellRequest,
        authorize: async () => ({
          kind: "need-approval" as const,
          approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
    },
    pendingApproval: undefined,
    earlyApprovalQueue: [],
    emitEvent: (event: RuntimeEvent<ShellRequest>) => {
      events.push(event);
    },
    scheduleBackgroundToolExecutionAsync: () => {
      throw new Error("should not schedule before allow");
    },
  } as unknown as TurnMachineRuntime<{}, { n: number }, ShellRequest>;

  const early = new Map<string, PendingEarlyToolExecution<ShellRequest>>();
  const record = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    {
      id: "call-shell-1",
      name: "shell",
      argumentsJson: '{"name":"shell","command":"echo 1"}',
    },
    early,
    {
      pendingUserInput: "run",
      state: { n: 1 },
      turn,
      resumeAsStreaming: true,
      streamingEmitBeginResponse: true,
    },
  );
  assert.ok(record);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.source, "early-stream");
  assert.equal(runtime.pendingApproval?.toolCallId, "call-shell-1");
  assert.ok(events.some((event) => event.kind === "approval-requested"));

  const pending = runtime.pendingApproval;
  pending?.resolveEarlyDecision?.({ kind: "allow" });
  runtime.pendingApproval = undefined;
  const outcome = await record!.outcome;
  assert.equal(outcome?.kind, "completed");
});

test("startEarlyToolExecution queues second approval while first is pending", async () => {
  type ShellRequest = { name: string; command: string };
  const turn = createTurnContext<ShellRequest>();
  const scheduled: string[] = [];
  const runtime = {
    options: {
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as ShellRequest,
        authorize: async () => ({
          kind: "need-approval" as const,
          approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
        }),
        shouldExecuteInBackground: () => true,
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
    },
    pendingApproval: undefined,
    earlyApprovalQueue: [],
    emitEvent: () => {},
    scheduleBackgroundToolExecutionAsync: (
      _pendingUserInput: string,
      _state: { n: number },
      _request: ShellRequest,
      toolCallId: string,
    ) => {
      scheduled.push(toolCallId);
    },
    resolveTurnToolState: (_turn: unknown, fallback: { n: number }) => fallback,
  } as unknown as TurnMachineRuntime<{}, { n: number }, ShellRequest>;

  const early = new Map<string, PendingEarlyToolExecution<ShellRequest>>();
  const first = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    {
      id: "call-1",
      name: "shell",
      argumentsJson: '{"name":"shell","command":"echo 1"}',
    },
    early,
    { pendingUserInput: "run", state: { n: 1 }, turn },
  );
  const second = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    {
      id: "call-2",
      name: "shell",
      argumentsJson: '{"name":"shell","command":"echo 2"}',
    },
    early,
    { pendingUserInput: "run", state: { n: 1 }, turn },
  );
  assert.ok(first);
  assert.ok(second);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.toolCallId, "call-1");
  assert.equal(runtime.earlyApprovalQueue.length, 1);
  assert.equal(runtime.earlyApprovalQueue[0]?.toolCallId, "call-2");

  runtime.pendingApproval?.resolveEarlyDecision?.({ kind: "allow" });
  runtime.pendingApproval = undefined;
  pumpEarlyApprovalQueue(runtime);

  await new Promise((resolve) => setImmediate(resolve));
  const secondPending = (
    runtime as unknown as {
      pendingApproval?: {
        toolCallId: string;
        resolveEarlyDecision?: (d: { kind: "allow" }) => void;
      };
    }
  ).pendingApproval;
  assert.equal(secondPending?.toolCallId, "call-2");
  assert.equal(runtime.earlyApprovalQueue.length, 0);

  const firstOutcome = await first!.outcome;
  assert.equal(firstOutcome?.kind, "background-scheduled");
  assert.deepEqual(scheduled, ["call-1"]);

  secondPending?.resolveEarlyDecision?.({ kind: "allow" });
  runtime.pendingApproval = undefined;
  const secondOutcome = await second!.outcome;
  assert.equal(secondOutcome?.kind, "background-scheduled");
  assert.deepEqual(scheduled, ["call-1", "call-2"]);
});

test("startEarlyToolExecution invalidates queued approval when arguments change", async () => {
  type ShellRequest = { name: string; command: string };
  const turn = createTurnContext<ShellRequest>();
  const runtime = {
    options: {
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as ShellRequest,
        authorize: async () => ({
          kind: "need-approval" as const,
          approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
    },
    pendingApproval: undefined,
    earlyApprovalQueue: [],
    emitEvent: () => {},
  } as unknown as TurnMachineRuntime<{}, { n: number }, ShellRequest>;

  const early = new Map<string, PendingEarlyToolExecution<ShellRequest>>();
  startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    {
      id: "call-rewrite",
      name: "shell",
      argumentsJson: '{"name":"shell","command":"echo old"}',
    },
    early,
    { pendingUserInput: "run", state: { n: 1 }, turn },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.toolCallId, "call-rewrite");

  const rewritten = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    {
      id: "call-rewrite",
      name: "shell",
      argumentsJson: '{"name":"shell","command":"echo new"}',
    },
    early,
    { pendingUserInput: "run", state: { n: 1 }, turn },
  );
  assert.ok(rewritten);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.toolCallId, "call-rewrite");
  assert.equal(runtime.pendingApproval?.argumentsJson, '{"name":"shell","command":"echo new"}');

  runtime.pendingApproval?.resolveEarlyDecision?.({ kind: "deny" });
  const outcome = await rewritten!.outcome;
  assert.equal(outcome?.kind, "rejected");
});

// Regression: P0-5 parallel approval deadlock. In parallel tool calls, a call whose arguments
// complete later (typically shell) may occupy the approval slot first via the early-stream path;
// the formal gate must never overwrite it — the overwritten approval's resolveEarlyDecision would
// never be called, its execution promise would never settle, and later continuations would await
// forever (the whole Agent deadlocks).
test("processToolCallsAsync parks the formal approval gate behind a pending early-stream approval", async () => {
  type ShellRequest = { name: string; command?: string; path?: string };
  const events: RuntimeEvent<ShellRequest>[] = [];
  const turn = createTurnContext<ShellRequest>();
  const runtime = {
    options: {
      config: {},
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as ShellRequest,
        authorize: async () => ({
          kind: "need-approval" as const,
          approval: { kind: "read_path", operation: "ls", path: "/tmp" },
        }),
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
      appendToolResultMessage: (state: { n: number }) => state,
      createContinuationState: () => ({ n: 0 }),
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: "run",
    pendingApproval: {
      source: "early-stream" as const,
      pendingUserInput: "run",
      state: { n: 1 },
      request: { name: "shell", command: "git stash list" },
      prompt: {
        kind: "tool",
        request: { kind: "shell", command: "git stash list", terminal: "zsh" },
      },
      toolCallId: "call-shell",
      toolName: "shell",
      argumentsJson: '{"name":"shell","command":"git stash list"}',
      remainingCalls: [],
      turn,
      resumeAsStreaming: true,
      streamingEmitBeginResponse: true,
      resolveEarlyDecision: () => {},
    },
    earlyApprovalQueue: [],
    pendingApprovalSlotWaiters: [],
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: (event: RuntimeEvent<ShellRequest>) => {
      events.push(event);
    },
    performToolExecution: async () => {
      throw new Error("should not execute before approval");
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error("unused");
    },
    startHistoryCompactionAsync: () => {},
  } as unknown as TurnMachineRuntime<{}, { n: number }, ShellRequest>;

  const gate = processToolCallsAsync(
    runtime,
    { n: 1 },
    "run",
    [{ id: "call-ls", name: "ls", argumentsJson: '{"name":"ls","path":"/tmp"}' }],
    turn,
    true,
    true,
    new Map(),
  );

  // While the slot is occupied by the early-stream approval: the formal gate stays suspended and must not overwrite it or pop a second dialog
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.toolCallId, "call-shell");
  assert.equal(
    events.some(
      (event) => event.kind === "approval-requested" && event.approval.toolCallId === "call-ls",
    ),
    false,
  );

  // The user approved the early-stream approval: the slot is released and pump wakes the formal gate
  runtime.pendingApproval = undefined;
  pumpEarlyApprovalQueue(runtime);
  await gate;

  const pendingAfter = (
    runtime as unknown as { pendingApproval?: { toolCallId: string; source?: string } }
  ).pendingApproval;
  assert.equal(pendingAfter?.toolCallId, "call-ls");
  assert.equal(pendingAfter?.source, undefined);
  assert.ok(
    events.some(
      (event) => event.kind === "approval-requested" && event.approval.toolCallId === "call-ls",
    ),
  );
});

// Regression: the mirror timing of P0-5 — while a formal approval is active, the second call's
// early approval can only queue; once the formal decision releases the slot, the queued waiter
// must be pumped out, otherwise its promise is never settled.
test("continuePendingApproval pumps the queued early approval after resolving a formal approval", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions(
      [
        { kind: "tool", id: "call_ls", name: "ls", argumentsJson: '{"path":"/tmp"}' },
        { kind: "final", text: "done" },
      ],
      {
        authorize: async () => ({
          kind: "need-approval" as const,
          approval: { kind: "read_path", operation: "ls", path: "/tmp" },
        }),
      },
    ),
  );

  const result = await runtime.submitUserTurn("work");
  assert.equal(result.kind, "requires-approval");
  assert.equal(runtime.currentPendingApproval()?.toolCallId, "call_ls");

  let queuedDecision: { kind: string } | undefined;
  (
    runtime as unknown as { earlyApprovalQueue: Array<Record<string, unknown>> }
  ).earlyApprovalQueue.push({
    pendingUserInput: "work",
    state: { messages: [], steps: 0 },
    request: { name: "shell", command: "echo hi" },
    prompt: {
      kind: "tool",
      request: { kind: "shell", command: "echo hi", terminal: "zsh" },
    },
    toolCallId: "call_shell",
    toolName: "shell",
    argumentsJson: '{"command":"echo hi"}',
    canonicalArgumentsJson: '{"command":"echo hi"}',
    turn: createTurnContext(),
    earlyToolExecutions: new Map(),
    resumeAsStreaming: true,
    streamingEmitBeginResponse: true,
    resolveDecision: (decision: { kind: string }) => {
      queuedDecision = decision;
    },
  });

  await runtime.continuePendingApproval({ kind: "allow" });

  assert.equal(runtime.currentPendingApproval()?.toolCallId, "call_shell");
  // Promotion is not a decision: it still waits for the user's next approval
  assert.equal(queuedDecision, undefined);
});

// Regression: approval cards must be shown in argument-completion (early-start) order, not
// authorization-race order. When the earlier call's authorize is slower (e.g. ls doing realpath
// on an external path), a later call must not preempt the approval slot.
test("startEarlyToolExecution shows approvals in start order even when a later authorize resolves first", async () => {
  type ShellRequest = { name: string; command: string };
  const turn = createTurnContext<ShellRequest>();
  const events: RuntimeEvent<ShellRequest>[] = [];
  let resolveSlowAuthorize: (() => void) | undefined;
  const runtime = {
    options: {
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) =>
          JSON.parse(argumentsJson) as ShellRequest,
        authorize: async (request: ShellRequest) => {
          if (request.command === "echo slow") {
            await new Promise<void>((resolve) => {
              resolveSlowAuthorize = resolve;
            });
          }
          return {
            kind: "need-approval" as const,
            approval: { kind: "shell", command: request.command, terminal: "zsh" },
          };
        },
        execute: async () => ({ content: [], summaryText: "ok" }),
      },
    },
    pendingApproval: undefined,
    earlyApprovalQueue: [],
    earlyApprovalOrderChain: undefined,
    emitEvent: (event: RuntimeEvent<ShellRequest>) => {
      events.push(event);
    },
  } as unknown as TurnMachineRuntime<{}, { n: number }, ShellRequest>;

  const early = new Map<string, PendingEarlyToolExecution<ShellRequest>>();
  const context = { pendingUserInput: "run", state: { n: 1 }, turn };
  const first = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    { id: "call-1", name: "shell", argumentsJson: '{"name":"shell","command":"echo slow"}' },
    early,
    context,
  );
  const second = startEarlyToolExecution<{}, { n: number }, ShellRequest>(
    runtime,
    { id: "call-2", name: "shell", argumentsJson: '{"name":"shell","command":"echo fast"}' },
    early,
    context,
  );
  assert.ok(first);
  assert.ok(second);

  // The later call finishing authorization first must not get a card: the order chain requires waiting for the earlier call's approval decision
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const pendingBeforeSlowAuthorize = (
    runtime as unknown as { pendingApproval?: { toolCallId: string } }
  ).pendingApproval;
  assert.equal(pendingBeforeSlowAuthorize, undefined);
  assert.equal(runtime.earlyApprovalQueue.length, 0);

  resolveSlowAuthorize?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.pendingApproval?.toolCallId, "call-1");
  assert.equal(runtime.earlyApprovalQueue[0]?.toolCallId, "call-2");

  // The second card only pops after the first is decided
  runtime.pendingApproval?.resolveEarlyDecision?.({ kind: "allow" });
  runtime.pendingApproval = undefined;
  pumpEarlyApprovalQueue(runtime);
  await new Promise((resolve) => setImmediate(resolve));
  const secondPending = (
    runtime as unknown as {
      pendingApproval?: {
        toolCallId: string;
        resolveEarlyDecision?: (d: { kind: "allow" }) => void;
      };
    }
  ).pendingApproval;
  assert.equal(secondPending?.toolCallId, "call-2");

  secondPending?.resolveEarlyDecision?.({ kind: "allow" });
  runtime.pendingApproval = undefined;
  assert.equal((await first!.outcome)?.kind, "completed");
  assert.equal((await second!.outcome)?.kind, "completed");
});

test("processToolCalls commits a synthetic failure when the permission rule denies the call", async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions(
      [
        { kind: "tool", id: "call_shell", name: "shell", argumentsJson: '{"command":"rm -rf /"}' },
        { kind: "final", text: "done" },
      ],
      {
        authorize: async () => ({
          kind: "denied" as const,
          reason: "shell is disabled by rule",
        }),
      },
    ),
  );

  const result = await runtime.submitUserTurn("cleanup");
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") {
    return;
  }
  const denial = result.toolExecutions.find((execution) => execution.toolCallId === "call_shell");
  assert.ok(denial);
  assert.equal(denial.failed, true);
  assert.equal(denial.output, "[denied by permission rule] shell is disabled by rule");
});

test("continuePendingApproval routes remember session/config into rememberApproval", async () => {
  for (const scope of ["session", "config"] as const) {
    const remembered: Array<{ target: unknown; scope: string }> = [];
    const runtime = new AgentRuntime(
      buildAgentRuntimeOptions(
        [
          { kind: "tool", id: "call_ls", name: "ls", argumentsJson: '{"path":"/tmp"}' },
          { kind: "final", text: "done" },
        ],
        {
          authorize: async () => ({
            kind: "need-approval" as const,
            approval: { kind: "read_path", operation: "ls", path: "/tmp" },
            rememberTarget: { kind: "read_file", path: "/tmp" },
          }),
          rememberApproval: async (target: unknown, rememberScope: string) => {
            remembered.push({ target, scope: rememberScope });
          },
        },
      ),
    );

    const result = await runtime.submitUserTurn("list tmp");
    assert.equal(result.kind, "requires-approval");

    await runtime.continuePendingApproval({ kind: "allow", remember: scope });

    assert.deepEqual(remembered, [{ target: { kind: "read_file", path: "/tmp" }, scope }]);
  }
});
