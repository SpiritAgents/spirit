import { setImmediate as waitForImmediate } from "node:timers/promises";

import type {
  AskQuestionsResult,
  AuthorizationDecision,
  JsonObject,
  JsonValue,
  LlmMessage,
  PermissionMemoryTarget,
  ToolApprovalPrompt,
  ToolExecutionOutput,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from "../ports.js";
import {
  cloneLlmMessageContent,
  cloneLlmProviderState,
  createLlmMessageContentFromText,
} from "../ports.js";
import { emitContextUsageUpdated } from "./context-usage.js";
import { isOpenResponsesTransportConfig } from "../provider-config.js";
import {
  handleDeclaredProviderToolCallInTurn,
  handleDeclaredProviderToolCallInTurnAsync,
} from "./provider-tool-calls.js";
import {
  buildApplyPatchToolResultProviderState,
  registerPendingApplyPatchCallIds,
} from "../open-responses/apply-patch-bridge.js";
import { APPLY_PATCH_HOST_TOOL_NAME } from "../open-responses/apply-patch-eligibility.js";
import {
  applyAutoReviewToApprovalGate,
  prefetchAutoReviewsForToolCalls,
} from "./auto-approval-integration.js";
import {
  hookDeniedToolOutput,
  postHookToolInputFromPreGate,
  resolveApprovalGateAfterAuthorize,
  runPostToolUseSideEffects,
  runPreToolUseGate,
  type PreToolUseGateResult,
  type ToolApprovalGateResolution,
} from "../hooks/tool-hooks.js";
import { toolInputFromArgumentsJson } from "../hooks/integration.js";
import { appendToolResultMessages } from "../tool-agent.js";
import { prepareStateForContextRetryAsync } from "./compaction.js";
import { syncPreparedToolResultContentToHistory } from "./tool-execution.js";
import { buildEarlyExecutableArgumentsJson } from "../tool-streaming-preview-gate.js";
import {
  applyDeferredUserGuidance,
  appendLoopContinuationGuidance,
  buildToolContinuationStateFromHistory,
  enqueueDeferredToolOutputGuidance,
  enqueueDeferredUserGuidance,
  hasUnansweredAssistantToolCalls,
  isCompatibleContinuedToolRequest,
  renderError,
  resolveFinalAssistantHistoryMessage,
  toolArtifactsFromOutput,
} from "./helpers.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./tool-output-append.js";
import type { ToolExecutionResult } from "./tool-execution.js";
import type {
  AgentRuntimeOptions,
  EarlyStreamApprovalQueueItem,
  PendingEarlyToolExecution,
  PendingEarlyToolExecutionOutcome,
  PendingApprovalState,
  PendingQuestionsState,
  PendingToolAgentRound,
  RuntimeApprovalDecision,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
  RuntimeToolExecution,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from "./types.js";

export type EarlyInternalToolCallResult =
  | {
      kind: "completed";
      output: ToolExecutionOutput;
      failed: boolean;
      enqueueDeferredGuidance?: boolean;
      fatalError?: string;
    }
  | { kind: "defer-to-formal" };

export interface InternalToolCallRuntime<_Config, State, ToolRequest> {
  maybeExecuteInternalToolCall?: (
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ) => Promise<RuntimeTurnResult<State, ToolRequest> | undefined>;
  maybeContinueInternalToolCallAsync?: (
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ) => Promise<boolean>;
  tryPerformEarlyInternalToolCall?: (
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
  ) => Promise<EarlyInternalToolCallResult | undefined>;
}

export interface TurnMachineRuntime<Config, State, ToolRequest> extends InternalToolCallRuntime<
  Config,
  State,
  ToolRequest
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest>;
  historyStore: LlmMessage[];
  requestTraceStore: JsonValue[];
  pendingUserTurnStore: string | undefined;
  pendingApproval: PendingApprovalState<State, ToolRequest> | undefined;
  /** Single-slot overflow for early-stream approvals while pendingApproval is busy. */
  earlyApprovalQueue: EarlyStreamApprovalQueueItem<State, ToolRequest>[];
  /** Suspension point while the formal approval gate waits for the slot; canProceed=false means this turn was terminated (abort/history replacement). */
  pendingApprovalSlotWaiters: Array<(canProceed: boolean) => void>;
  /** FIFO chain tail linking early executions in start order: approval cards are shown in argument-completion order, not authorization-race order. */
  earlyApprovalOrderChain?: Promise<void>;
  pendingQuestions: PendingQuestionsState<State, ToolRequest> | undefined;
  pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void;
  clearStreamingUiState(): void;
  completeTurn(result: RuntimeTurnResult<State, ToolRequest>): void;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  recordContextMessage?(role: "system" | "user" | "assistant", content: string): void;
  performToolExecution(
    request: ToolRequest,
    toolName: string,
    toolCallId?: string,
  ): Promise<ToolExecutionResult>;
  startBackgroundToolExecutionAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    argumentsJson: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
    postHookToolInput?: JsonObject,
  ): void;
  scheduleBackgroundToolExecutionAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    argumentsJson: string,
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
    postHookToolInput?: JsonObject,
  ): void;
  resolveTurnToolState?: (turn: RuntimeTurnContext<ToolRequest>, fallback: State) => State;
  advanceTurnToolState?: (turn: RuntimeTurnContext<ToolRequest>, state: State) => void;
  startHistoryCompactionAsync(
    retryState: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    originalError: string,
    toolTruncationApplied: boolean,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): void;
  startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void>;
  queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void;
  takeCompletedTurnResult(): RuntimeTurnResult<State, ToolRequest> | undefined;
  compactHistoryImmediate(): Promise<RuntimeCompactionRecord>;
  loopEnabled(): boolean;
  isBusy(): boolean;
  poll(): Promise<void>;
}

export interface EarlyToolExecutionContext<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming?: boolean;
  streamingEmitBeginResponse?: boolean;
}

export async function resumePendingApproval<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  decision: RuntimeApprovalDecision,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  const pending = runtime.pendingApproval;
  if (!pending) {
    throw new Error("There is no pending tool call to confirm.");
  }

  runtime.pendingApproval = undefined;
  runtime.emitEvent({
    kind: "approval-resolved",
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    decisionKind: decision.kind,
  });

  if (decision.kind === "allow") {
    if (decision.remember && pending.rememberTarget !== undefined) {
      await runtime.options.toolExecutor.rememberApproval(
        pending.rememberTarget,
        decision.remember,
      );
    }

    return executeAuthorizedToolCall(
      runtime,
      pending.pendingUserInput,
      pending.state,
      pending.request,
      pending.toolCallId,
      pending.toolName,
      pending.remainingCalls,
      pending.turn,
      pending.argumentsJson,
    );
  }

  if (decision.kind === "guidance") {
    const guidanceText = decision.resultText?.trim()
      ? decision.resultText
      : "[denied by user] tool call rejected by user guidance";
    const guidanceMessage = decision.userMessage.trim();
    commitSyntheticToolExecutionFailure(
      runtime,
      pending.turn,
      pending.request,
      pending.toolCallId,
      pending.toolName,
      guidanceText,
    );
    let resumedState = runtime.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      guidanceText,
    );

    if (!guidanceMessage) {
      return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
    }

    enqueueDeferredUserGuidance(pending.turn, guidanceMessage);
    if (pending.remainingCalls.length > 0) {
      return processToolCalls(
        runtime,
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
      );
    }

    return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
  }

  const deniedText = decision.resultText?.trim()
    ? decision.resultText
    : "[denied by user] tool call rejected by user approval policy";
  commitSyntheticToolExecutionFailure(
    runtime,
    pending.turn,
    pending.request,
    pending.toolCallId,
    pending.toolName,
    deniedText,
  );
  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    deniedText,
  );

  return processToolCalls(
    runtime,
    resumedState,
    pending.pendingUserInput,
    pending.remainingCalls,
    pending.turn,
  );
}

export async function resumePendingQuestions<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  result: AskQuestionsResult,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  const pending = runtime.pendingQuestions;
  if (!pending) {
    throw new Error("There is no pending question form to answer.");
  }

  runtime.pendingQuestions = undefined;
  const continuedRequest = runtime.options.toolExecutor.continueAfterQuestions
    ? await runtime.options.toolExecutor.continueAfterQuestions(pending.request, result)
    : undefined;

  if (continuedRequest !== undefined) {
    if (!isCompatibleContinuedToolRequest(pending.request, continuedRequest)) {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        pending.request,
        "[continueAfterQuestions error] continued request must stay on the same tool.",
      );
    }

    let authorization: AuthorizationDecision;
    try {
      authorization = await runtime.options.toolExecutor.authorize(continuedRequest);
    } catch (error) {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        continuedRequest,
        `[authorization error] ${renderError(error)}`,
      );
    }

    if (authorization.kind === "denied") {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        continuedRequest,
        `[denied by permission rule] ${authorization.reason}`,
      );
    }

    if (authorization.kind === "need-approval") {
      const activeGate = await applyAutoReviewToApprovalGate(
        runtime.options.getApprovalLevel?.(),
        runtime.options.reviewToolApproval,
        runtime.options.toolExecutor.toolDefinitionsJson(),
        { name: pending.toolName, argumentsJson: pending.argumentsJson },
        {
          prompt: { kind: "tool", request: authorization.approval },
          rememberTarget: authorization.rememberTarget,
        },
        undefined,
        pending.toolCallId,
        pending.turn.autoReviewCache,
      );
      if (activeGate) {
        const approval = createApproval(
          activeGate.prompt,
          continuedRequest,
          pending.toolCallId,
          pending.toolName,
          activeGate.rememberTarget,
          activeGate.autoReviewBlockReason,
        );
        runtime.pendingApproval = {
          pendingUserInput: pending.pendingUserInput,
          state: pending.state,
          request: continuedRequest,
          prompt: activeGate.prompt,
          ...(activeGate.rememberTarget !== undefined
            ? { rememberTarget: activeGate.rememberTarget }
            : {}),
          ...(activeGate.autoReviewBlockReason !== undefined
            ? { autoReviewBlockReason: activeGate.autoReviewBlockReason }
            : {}),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          argumentsJson: pending.argumentsJson,
          remainingCalls: pending.remainingCalls,
          turn: pending.turn,
          resumeAsStreaming: false,
          streamingEmitBeginResponse: true,
        };
        runtime.emitEvent({
          kind: "approval-requested",
          approval,
        });

        return {
          kind: "requires-approval",
          approval,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        };
      }
    }

    if (authorization.kind === "need-questions") {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        continuedRequest,
        "[continueAfterQuestions error] continued request cannot require questions again.",
      );
    }

    return executeAuthorizedToolCall(
      runtime,
      pending.pendingUserInput,
      pending.state,
      continuedRequest,
      pending.toolCallId,
      pending.toolName,
      pending.remainingCalls,
      pending.turn,
      pending.argumentsJson,
    );
  }

  const output = JSON.stringify(result);
  const questionsExecution: RuntimeToolExecution<ToolRequest> = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    output,
    failed: false,
  };
  pending.turn.toolExecutions.push(questionsExecution);
  runtime.emitEvent({
    kind: "tool-execution-finished",
    execution: questionsExecution,
  });

  const preparedContent = await prepareAndSyncRuntimeToolResultToHistory(
    runtime,
    pending.toolCallId,
    output,
  );
  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    preparedContent,
  );

  if (pending.remainingCalls.length > 0) {
    return processToolCalls(
      runtime,
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
}

export async function runTurnLoop<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  let currentPendingUserInput = pendingUserInput;
  let currentState = state;
  ({ state: currentState, pendingUserInput: currentPendingUserInput } = applyDeferredUserGuidance(
    runtime,
    currentState,
    currentPendingUserInput,
    turn,
  ));
  let emptyAssistantRetries = 0;

  while (true) {
    const completion = await runtime.options.llmTransport.startToolAgentRound(
      runtime.options.config,
      currentState,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    );

    if (completion.kind === "failure") {
      runtime.appendTrace(completion.requestTrace, turn);

      if (
        runtime.options.llmTransport.isContextOverflowError(completion.error) &&
        turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
      ) {
        turn.autoCompactAttempts += 1;
        const preparedRetry = await prepareStateForContextRetryAsync(runtime.options, currentState);

        try {
          const compaction = await runtime.compactHistoryImmediate();
          turn.compactions.push(compaction);

          if (compaction.droppedMessages === 0 && !preparedRetry.changed) {
            return {
              kind: "failed",
              error: `Context limit detected, but history cannot be compacted further. Original error: ${completion.error}`,
              state: preparedRetry.state,
              requestTrace: [...turn.requestTrace],
              toolExecutions: [...turn.toolExecutions],
              compactions: [...turn.compactions],
            };
          }

          currentState =
            compaction.droppedMessages === 0
              ? preparedRetry.state
              : runtime.options.rebuildRetryStateAfterCompaction
                ? runtime.options.rebuildRetryStateAfterCompaction(
                    runtime.historyStore,
                    currentPendingUserInput,
                    preparedRetry.state,
                  )
                : runtime.options.createToolAgentState(
                    runtime.historyStore,
                    currentPendingUserInput,
                  );
          continue;
        } catch (error) {
          return {
            kind: "failed",
            error: `Context compaction failed: ${renderError(error)} | Original error: ${completion.error}`,
            state: currentState,
            requestTrace: [...turn.requestTrace],
            toolExecutions: [...turn.toolExecutions],
            compactions: [...turn.compactions],
          };
        }
      }

      return {
        kind: "failed",
        error: completion.error,
        state: currentState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    const round = completion.result;
    runtime.appendTrace(round.requestTrace, turn);
    currentState = round.state;

    if (round.step.kind === "tool-calls") {
      return processToolCalls(
        runtime,
        currentState,
        currentPendingUserInput,
        round.step.calls,
        turn,
      );
    }

    const assistantText = runtime.options.extractAssistantText(currentState)?.trim();
    if (!assistantText) {
      emptyAssistantRetries += 1;
      if (emptyAssistantRetries > 1) {
        return {
          kind: "failed",
          error: "The model returned final-response-ready, but there is no usable assistant text.",
          state: currentState,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        };
      }
      continue;
    }

    runtime.historyStore.push(
      resolveFinalAssistantHistoryMessage(runtime.options, currentState, assistantText),
    );
    if (runtime.loopEnabled()) {
      currentState = appendLoopContinuationGuidance(runtime, currentState, currentPendingUserInput);
      emptyAssistantRetries = 0;
      continue;
    }
    runtime.pendingUserTurnStore = undefined;

    return {
      kind: "completed",
      assistantText,
      state: currentState,
      requestTrace: [...turn.requestTrace],
      toolExecutions: [...turn.toolExecutions],
      compactions: [...turn.compactions],
    };
  }
}

export async function processToolCalls<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  pendingUserInput: string,
  calls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  let currentState = state;
  const remaining = [...calls];

  persistAssistantToolCalls(runtime, state, calls);
  prefetchAutoReviewsForToolCalls({
    calls,
    approvalLevel: runtime.options.getApprovalLevel?.(),
    reviewToolApproval: runtime.options.reviewToolApproval,
    toolDefinitions: runtime.options.toolExecutor.toolDefinitionsJson(),
    reviewCache: turn.autoReviewCache,
    requestFromFunctionCall: (name, argumentsJson) =>
      runtime.options.toolExecutor.requestFromFunctionCall(name, argumentsJson),
    authorize: (request) => runtime.options.toolExecutor.authorize(request),
  });

  while (remaining.length > 0) {
    const call = remaining.shift();
    if (!call) {
      break;
    }

    const declaredProviderToolOutcome = await handleDeclaredProviderToolCallInTurn(
      runtime,
      pendingUserInput,
      currentState,
      call,
      remaining,
      turn,
    );
    if (declaredProviderToolOutcome.kind === "turn-result") {
      return declaredProviderToolOutcome.result;
    }
    if (declaredProviderToolOutcome.kind === "advance") {
      currentState = declaredProviderToolOutcome.state;
      continue;
    }

    let request: ToolRequest;
    let preGate: PreToolUseGateResult<ToolRequest>;
    try {
      request = await runtime.options.toolExecutor.requestFromFunctionCall(
        call.name,
        call.argumentsJson,
      );
      request =
        runtime.options.toolExecutor.attachRequestMetadata?.(request, {
          toolCallId: call.id,
          toolName: call.name,
        }) ?? request;

      preGate = await runPreToolUseGate(runtime, call, request);
      if (preGate.kind === "denied") {
        const output = `[hook denied] ${hookDeniedToolOutput(preGate.error)}`;
        commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
        currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
        continue;
      }
      request = preGate.request;

      runtime.emitEvent({
        kind: "tool-call-started",
        toolCallId: call.id,
        toolName: call.name,
        request,
      });
    } catch (error) {
      commitToolCallSchemaError(runtime, turn, call, error);
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[tool schema error] ${renderError(error)}`,
      );
      continue;
    }

    let authorization: AuthorizationDecision;
    try {
      authorization = await runtime.options.toolExecutor.authorize(request);
    } catch (error) {
      const output = `[authorization error] ${renderError(error)}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
      continue;
    }

    const gateResolution = await resolveDescribedApprovalGate(runtime, preGate, authorization);
    if (gateResolution?.kind === "denied") {
      const output = `[denied by permission rule] ${gateResolution.reason}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
      continue;
    }
    const initialGate = gateResolution?.kind === "needs-approval" ? gateResolution.gate : null;
    const approvalGate = initialGate
      ? await applyAutoReviewToApprovalGate(
          runtime.options.getApprovalLevel?.(),
          runtime.options.reviewToolApproval,
          runtime.options.toolExecutor.toolDefinitionsJson(),
          call,
          initialGate,
          preGate,
          call.id,
          turn.autoReviewCache,
        )
      : null;
    if (approvalGate) {
      const approval = createApproval(
        approvalGate.prompt,
        request,
        call.id,
        call.name,
        approvalGate.rememberTarget,
        approvalGate.autoReviewBlockReason,
      );
      runtime.pendingApproval = {
        pendingUserInput,
        state: currentState,
        request,
        prompt: approvalGate.prompt,
        ...(approvalGate.rememberTarget !== undefined
          ? { rememberTarget: approvalGate.rememberTarget }
          : {}),
        ...(approvalGate.autoReviewBlockReason !== undefined
          ? { autoReviewBlockReason: approvalGate.autoReviewBlockReason }
          : {}),
        toolCallId: call.id,
        toolName: call.name,
        argumentsJson: call.argumentsJson,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming: false,
        streamingEmitBeginResponse: true,
      };
      runtime.emitEvent({
        kind: "approval-requested",
        approval,
      });

      return {
        kind: "requires-approval",
        approval,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    if (authorization.kind === "need-questions") {
      const questions = createQuestions(request, call.id, call.name, authorization.questions);
      runtime.pendingQuestions = {
        pendingUserInput,
        state: currentState,
        request,
        questions: authorization.questions,
        toolCallId: call.id,
        toolName: call.name,
        argumentsJson: call.argumentsJson,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming: false,
        streamingEmitBeginResponse: true,
      };
      runtime.emitEvent({
        kind: "questions-requested",
        questions,
      });

      return {
        kind: "requires-questions",
        questions,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    return executeAuthorizedToolCall(
      runtime,
      pendingUserInput,
      currentState,
      request,
      call.id,
      call.name,
      remaining,
      turn,
      call.argumentsJson,
      postHookToolInputFromPreGate(preGate, call.argumentsJson),
    );
  }

  return runTurnLoop(runtime, currentState, pendingUserInput, turn);
}

/**
 * Resolves the approval gate after authorization. For the corner where a hook asks on a call
 * the host auto-allowed, the executor lazily describes the structured approval, so the hook
 * prompt renders the same rich form as a direct tool approval. Only that corner pays for
 * descriptor building (describeApproval may read file contents for previews).
 */
async function resolveDescribedApprovalGate<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  preGate: PreToolUseGateResult<ToolRequest>,
  authorization: AuthorizationDecision,
): Promise<ToolApprovalGateResolution | null> {
  const describedApproval =
    preGate.kind === "needs-approval" && authorization.kind === "allowed"
      ? await runtime.options.toolExecutor.describeApproval?.(preGate.request)
      : undefined;
  return resolveApprovalGateAfterAuthorize(preGate, authorization, describedApproval);
}

async function runPostToolUseForTurnExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  turn: RuntimeTurnContext<ToolRequest>,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  startedAt: number,
  postHookToolInput?: JsonObject,
): Promise<void> {
  const execution = [...turn.toolExecutions]
    .reverse()
    .find((entry) => entry.toolCallId === toolCallId);
  if (!execution) {
    return;
  }
  const summaryText =
    typeof execution.output === "string" ? execution.output : JSON.stringify(execution.output);
  await runPostToolUseSideEffects(
    runtime,
    { id: toolCallId, name: toolName, argumentsJson },
    postHookToolInput ?? toolInputFromArgumentsJson(argumentsJson),
    {
      summaryText,
      content: createLlmMessageContentFromText(summaryText),
    },
    Math.max(0, Date.now() - startedAt),
    execution.failed ?? false,
  );
}

export async function executeAuthorizedToolCall<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  toolArgumentsJson = "{}",
  postHookToolInput?: JsonObject,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  const startedAt = Date.now();
  const internal = await runtime.maybeExecuteInternalToolCall?.(
    pendingUserInput,
    state,
    request,
    toolCallId,
    toolName,
    remainingCalls,
    turn,
  );
  if (internal) {
    await runPostToolUseForTurnExecution(
      runtime,
      turn,
      toolCallId,
      toolName,
      toolArgumentsJson,
      startedAt,
      postHookToolInput,
    );
    return internal;
  }

  const execution = await runtime.performToolExecution(request, toolName, toolCallId);
  commitToolExecutionOutput(runtime, turn, {
    toolCallId,
    toolName,
    request,
    output: execution.output,
    failed: execution.failed,
  });
  await runPostToolUseSideEffects(
    runtime,
    { id: toolCallId, name: toolName, argumentsJson: toolArgumentsJson },
    postHookToolInput ?? toolInputFromArgumentsJson(toolArgumentsJson),
    execution.output,
    Date.now() - startedAt,
    execution.failed,
  );
  const preparedContent = await prepareAndSyncRuntimeToolResultToHistory(
    runtime,
    toolCallId,
    execution.output.summaryText,
  );
  const resumedState = await appendToolResultForRoundAsync(
    runtime,
    state,
    toolCallId,
    toolName,
    preparedContent,
    execution.failed,
  );
  if (remainingCalls.length > 0) {
    return processToolCalls(runtime, resumedState, pendingUserInput, remainingCalls, turn);
  }

  return runTurnLoop(runtime, resumedState, pendingUserInput, turn);
}

async function appendToolResultForRoundAsync<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  toolCallId: string,
  toolName: string,
  content: string,
  failed = false,
): Promise<State> {
  if (
    toolName === APPLY_PATCH_HOST_TOOL_NAME &&
    isOpenResponsesTransportConfig(runtime.options.config as any)
  ) {
    registerPendingApplyPatchCallIds([toolCallId]);
    return appendToolResultMessages(state as any, [
      {
        toolCallId,
        content,
        providerState: buildApplyPatchToolResultProviderState(
          toolCallId,
          failed ? "failed" : "completed",
          failed ? content : undefined,
        ),
      },
    ]) as State;
  }

  return runtime.options.appendToolResultMessage(state, toolCallId, content);
}

async function continueAfterQuestionsFailure<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  pending: PendingQuestionsState<State, ToolRequest>,
  request: ToolRequest,
  output: string,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  commitSyntheticToolExecutionFailure(
    runtime,
    pending.turn,
    request,
    pending.toolCallId,
    pending.toolName,
    output,
  );
  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    output,
  );

  if (pending.remainingCalls.length > 0) {
    return processToolCalls(
      runtime,
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
}

export function startToolAgentRoundAsync<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
  emptyAssistantRetries = 0,
): void {
  ({ state, pendingUserInput } = applyDeferredUserGuidance(runtime, state, pendingUserInput, turn));
  runtime.clearStreamingUiState();

  const pending: PendingToolAgentRound<State, ToolRequest> = {
    pendingUserInput,
    state,
    turn,
    completion: undefined,
    completionHandled: false,
    emptyAssistantRetries,
  };
  runtime.pendingToolAgentRound = pending;

  void runtime.options.llmTransport
    .startToolAgentRound(
      runtime.options.config,
      state,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    )
    .then((completion) => {
      if (runtime.pendingToolAgentRound === pending) {
        pending.completion = completion;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingToolAgentRound === pending) {
        pending.completion = {
          kind: "failure",
          error: renderError(error),
          requestTrace: [],
        };
      }
    });
}

export async function pollPendingToolAgentRound<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): Promise<void> {
  const pending = runtime.pendingToolAgentRound;
  if (!pending || pending.completionHandled || !pending.completion) {
    return;
  }

  pending.completionHandled = true;
  runtime.pendingToolAgentRound = undefined;
  await handlePendingToolAgentRoundCompletion(runtime, pending, pending.completion);
}

export async function handlePendingToolAgentRoundCompletion<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  pending: PendingToolAgentRound<State, ToolRequest>,
  completion: ToolAgentRoundCompletion<State>,
): Promise<void> {
  if (completion.kind === "failure") {
    runtime.appendTrace(completion.requestTrace, pending.turn);

    if (
      runtime.options.llmTransport.isContextOverflowError(completion.error) &&
      pending.turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
    ) {
      pending.turn.autoCompactAttempts += 1;
      const preparedRetry = await prepareStateForContextRetryAsync(runtime.options, pending.state);
      runtime.startHistoryCompactionAsync(
        preparedRetry.state,
        pending.pendingUserInput,
        pending.turn,
        completion.error,
        preparedRetry.changed,
      );
      return;
    }

    runtime.completeTurn({
      kind: "failed",
      error: completion.error,
      state: pending.state,
      requestTrace: [...pending.turn.requestTrace],
      toolExecutions: [...pending.turn.toolExecutions],
      compactions: [...pending.turn.compactions],
    });
    return;
  }

  const round = completion.result;
  runtime.appendTrace(round.requestTrace, pending.turn);
  emitContextUsageUpdated(runtime.emitEvent.bind(runtime), round.usage);

  if (round.step.kind === "tool-calls") {
    await processToolCallsAsync(
      runtime,
      round.state,
      pending.pendingUserInput,
      round.step.calls,
      pending.turn,
    );
    return;
  }

  const assistantText = runtime.options.extractAssistantText(round.state)?.trim();
  if (!assistantText) {
    if (pending.emptyAssistantRetries >= 1) {
      runtime.completeTurn({
        kind: "failed",
        error: "The model returned final-response-ready, but there is no usable assistant text.",
        state: round.state,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
      return;
    }

    startToolAgentRoundAsync(
      runtime,
      round.state,
      pending.pendingUserInput,
      pending.turn,
      pending.emptyAssistantRetries + 1,
    );
    return;
  }

  runtime.historyStore.push(
    resolveFinalAssistantHistoryMessage(runtime.options, round.state, assistantText),
  );
  if (runtime.loopEnabled()) {
    const continuationState = appendLoopContinuationGuidance(
      runtime,
      round.state,
      pending.pendingUserInput,
    );
    startToolAgentRoundAsync(runtime, continuationState, pending.pendingUserInput, pending.turn);
    return;
  }
  runtime.pendingUserTurnStore = undefined;
  runtime.completeTurn({
    kind: "completed",
    assistantText,
    state: round.state,
    requestTrace: [...pending.turn.requestTrace],
    toolExecutions: [...pending.turn.toolExecutions],
    compactions: [...pending.turn.compactions],
  });
}

export async function processToolCallsAsync<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  pendingUserInput: string,
  calls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
): Promise<void> {
  let currentState = state;
  const remaining = [...calls];

  persistAssistantToolCalls(runtime, state, calls);
  prefetchAutoReviewsForToolCalls({
    calls,
    approvalLevel: runtime.options.getApprovalLevel?.(),
    reviewToolApproval: runtime.options.reviewToolApproval,
    toolDefinitions: runtime.options.toolExecutor.toolDefinitionsJson(),
    reviewCache: turn.autoReviewCache,
    requestFromFunctionCall: (name, argumentsJson) =>
      runtime.options.toolExecutor.requestFromFunctionCall(name, argumentsJson),
    authorize: (request) => runtime.options.toolExecutor.authorize(request),
  });

  while (remaining.length > 0) {
    const call = remaining.shift();
    if (!call) {
      break;
    }

    const declaredProviderToolHandled = await handleDeclaredProviderToolCallInTurnAsync(
      runtime,
      pendingUserInput,
      currentState,
      call,
      remaining,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
    if (declaredProviderToolHandled) {
      return;
    }

    const earlyOutcome = await matchingEarlyToolExecutionOutcome(call, earlyToolExecutions);
    if (earlyOutcome?.kind === "completed") {
      commitPreparedToolExecution(
        runtime,
        turn,
        earlyOutcome.execution,
        earlyOutcome.output,
        false,
        earlyOutcome.enqueueDeferredGuidance,
      );
      await runPostToolUseSideEffects(
        runtime,
        call,
        earlyOutcome.postHookToolInput ?? toolInputFromArgumentsJson(call.argumentsJson),
        earlyOutcome.output,
        0,
        earlyOutcome.execution.failed,
      );
      if (earlyOutcome.fatalError !== undefined) {
        runtime.completeTurn({
          kind: "failed",
          error: earlyOutcome.fatalError,
          state: currentState,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        });
        return;
      }
      const preparedOutput = await prepareAndSyncRuntimeToolResultToHistory(
        runtime,
        call.id,
        earlyOutcome.output.summaryText,
      );
      currentState = await appendToolResultForRoundAsync(
        runtime,
        currentState,
        call.id,
        call.name,
        preparedOutput,
        earlyOutcome.execution.failed,
      );
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }

    if (earlyOutcome?.kind === "background-scheduled") {
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }

    if (earlyOutcome?.kind === "rejected") {
      commitSyntheticToolExecutionFailure(
        runtime,
        turn,
        earlyOutcome.request,
        call.id,
        call.name,
        earlyOutcome.resultText,
      );
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        earlyOutcome.resultText,
      );
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }

    let request: ToolRequest;
    let preGate: PreToolUseGateResult<ToolRequest>;
    try {
      const earlyPreGate = await resolveEarlyPreGateForFormalCall(call, earlyToolExecutions);
      if (earlyPreGate?.kind === "denied") {
        let requestForFailure: ToolRequest;
        try {
          requestForFailure = await runtime.options.toolExecutor.requestFromFunctionCall(
            call.name,
            call.argumentsJson,
          );
          requestForFailure =
            runtime.options.toolExecutor.attachRequestMetadata?.(requestForFailure, {
              toolCallId: call.id,
              toolName: call.name,
            }) ?? requestForFailure;
        } catch (error) {
          commitToolCallSchemaError(runtime, turn, call, error);
          currentState = runtime.options.appendToolResultMessage(
            currentState,
            call.id,
            `[tool schema error] ${renderError(error)}`,
          );
          if (
            queueRemainingToolCallsAsync(
              runtime,
              currentState,
              pendingUserInput,
              remaining,
              turn,
              resumeAsStreaming,
              streamingEmitBeginResponse,
              earlyToolExecutions,
            )
          ) {
            return;
          }
          continue;
        }
        const output = `[hook denied] ${hookDeniedToolOutput(earlyPreGate.error)}`;
        commitSyntheticToolExecutionFailure(
          runtime,
          turn,
          requestForFailure,
          call.id,
          call.name,
          output,
        );
        currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
        if (
          queueRemainingToolCallsAsync(
            runtime,
            currentState,
            pendingUserInput,
            remaining,
            turn,
            resumeAsStreaming,
            streamingEmitBeginResponse,
            earlyToolExecutions,
          )
        ) {
          return;
        }
        continue;
      }
      if (earlyPreGate) {
        preGate = earlyPreGate;
        request = earlyPreGate.request;
      } else {
        request = await runtime.options.toolExecutor.requestFromFunctionCall(
          call.name,
          call.argumentsJson,
        );
        request =
          runtime.options.toolExecutor.attachRequestMetadata?.(request, {
            toolCallId: call.id,
            toolName: call.name,
          }) ?? request;

        preGate = await runPreToolUseGate(runtime, call, request);
        if (preGate.kind === "denied") {
          const output = `[hook denied] ${hookDeniedToolOutput(preGate.error)}`;
          commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
          currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
          if (
            queueRemainingToolCallsAsync(
              runtime,
              currentState,
              pendingUserInput,
              remaining,
              turn,
              resumeAsStreaming,
              streamingEmitBeginResponse,
              earlyToolExecutions,
            )
          ) {
            return;
          }
          continue;
        }
        request = preGate.request;
      }

      runtime.emitEvent({
        kind: "tool-call-started",
        toolCallId: call.id,
        toolName: call.name,
        request,
      });
    } catch (error) {
      commitToolCallSchemaError(runtime, turn, call, error);
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[tool schema error] ${renderError(error)}`,
      );
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }

    let authorization: AuthorizationDecision;
    try {
      authorization = await runtime.options.toolExecutor.authorize(request);
    } catch (error) {
      const output = `[authorization error] ${renderError(error)}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }

    const gateResolution = await resolveDescribedApprovalGate(runtime, preGate, authorization);
    if (gateResolution?.kind === "denied") {
      const output = `[denied by permission rule] ${gateResolution.reason}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(currentState, call.id, output);
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      continue;
    }
    const initialGate = gateResolution?.kind === "needs-approval" ? gateResolution.gate : null;
    const approvalGate = initialGate
      ? await applyAutoReviewToApprovalGate(
          runtime.options.getApprovalLevel?.(),
          runtime.options.reviewToolApproval,
          runtime.options.toolExecutor.toolDefinitionsJson(),
          call,
          initialGate,
          preGate,
          call.id,
          turn.autoReviewCache,
        )
      : null;
    if (approvalGate) {
      // Approval is single-slot: in parallel tool calls, a call whose arguments complete later
      // (typically shell) may already occupy the slot via the early-stream path. Never overwrite
      // it here — the overwritten approval's resolveEarlyDecision would never be called, its
      // execution promise would never settle, and later continuations would await forever.
      // When the slot is occupied, suspend and wait; pump/clear re-wakes us on slot changes.
      while (runtime.pendingApproval !== undefined) {
        const canProceed = await waitForPendingApprovalSlot(runtime);
        if (!canProceed) {
          return;
        }
      }
      const approval = createApproval(
        approvalGate.prompt,
        request,
        call.id,
        call.name,
        approvalGate.rememberTarget,
        approvalGate.autoReviewBlockReason,
      );
      runtime.pendingApproval = {
        pendingUserInput,
        state: currentState,
        request,
        prompt: approvalGate.prompt,
        ...(approvalGate.rememberTarget !== undefined
          ? { rememberTarget: approvalGate.rememberTarget }
          : {}),
        ...(approvalGate.autoReviewBlockReason !== undefined
          ? { autoReviewBlockReason: approvalGate.autoReviewBlockReason }
          : {}),
        toolCallId: call.id,
        toolName: call.name,
        argumentsJson: call.argumentsJson,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
      };

      if (resumeAsStreaming) {
        runtime.emitEvent({
          kind: "approval-requested",
          approval,
        });
      } else {
        runtime.completeTurn({
          kind: "requires-approval",
          approval,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        });
      }
      return;
    }

    if (authorization.kind === "need-questions") {
      const questions = createQuestions(request, call.id, call.name, authorization.questions);
      runtime.pendingQuestions = {
        pendingUserInput,
        state: currentState,
        request,
        questions: authorization.questions,
        toolCallId: call.id,
        toolName: call.name,
        argumentsJson: call.argumentsJson,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
      };

      if (resumeAsStreaming) {
        runtime.emitEvent({
          kind: "questions-requested",
          questions,
        });
      } else {
        runtime.completeTurn({
          kind: "requires-questions",
          questions,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        });
      }
      return;
    }

    if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
      runtime.scheduleBackgroundToolExecutionAsync(
        pendingUserInput,
        currentState,
        request,
        call.id,
        call.name,
        call.argumentsJson,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        earlyToolExecutions,
        postHookToolInputFromPreGate(preGate, call.argumentsJson),
      );
      if (
        queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )
      ) {
        return;
      }
      return;
    }

    const internalHandled = await runtime.maybeContinueInternalToolCallAsync?.(
      pendingUserInput,
      currentState,
      request,
      call.id,
      call.name,
      remaining,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
    if (internalHandled) {
      return;
    }

    const startedAt = Date.now();
    const execution = await runtime.performToolExecution(request, call.name, call.id);
    commitToolExecutionOutput(runtime, turn, {
      toolCallId: call.id,
      toolName: call.name,
      request,
      output: execution.output,
      failed: execution.failed,
    });
    await runPostToolUseSideEffects(
      runtime,
      call,
      postHookToolInputFromPreGate(preGate, call.argumentsJson),
      execution.output,
      Date.now() - startedAt,
      execution.failed,
    );
    const preparedOutput = await prepareAndSyncRuntimeToolResultToHistory(
      runtime,
      call.id,
      execution.output.summaryText,
    );
    currentState = await appendToolResultForRoundAsync(
      runtime,
      currentState,
      call.id,
      call.name,
      preparedOutput,
      execution.failed,
    );
    if (
      queueRemainingToolCallsAsync(
        runtime,
        currentState,
        pendingUserInput,
        remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        earlyToolExecutions,
      )
    ) {
      return;
    }
  }

  if (hasUnansweredAssistantToolCalls(runtime.historyStore)) {
    return;
  }

  const continuationState = buildToolContinuationStateFromHistory(
    runtime.options,
    runtime.historyStore,
    pendingUserInput,
  );

  if (resumeAsStreaming) {
    await runtime.startStreamingRound(
      continuationState,
      pendingUserInput,
      turn,
      streamingEmitBeginResponse,
    );
    return;
  }

  startToolAgentRoundAsync(runtime, continuationState, pendingUserInput, turn);
}

export interface CommitToolExecutionOutputOptions<ToolRequest> {
  toolCallId: string;
  toolName: string;
  request: ToolRequest;
  output: ToolExecutionOutput;
  failed: boolean;
}

export function buildRuntimeToolExecution<ToolRequest>(
  options: CommitToolExecutionOutputOptions<ToolRequest>,
): RuntimeToolExecution<ToolRequest> {
  const artifacts = toolArtifactsFromOutput(options.output);
  return {
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    request: options.request,
    output: options.output.summaryText,
    failed: options.failed,
    ...(artifacts ? { artifacts } : {}),
    ...(options.output.hostUi ? { hostUi: options.output.hostUi } : {}),
  };
}

export function shouldSkipPersistAssistantToolCalls(
  historyStore: readonly LlmMessage[],
  calls: ToolCallRequest[],
): boolean {
  if (calls.length === 0) {
    return true;
  }

  const pendingIds = new Set(calls.map((call) => call.id));
  for (const message of historyStore) {
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      continue;
    }
    const existingIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
    if ([...pendingIds].every((id) => existingIds.has(id))) {
      return true;
    }
  }

  return false;
}

function persistAssistantToolCalls<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "historyStore" | "options">,
  state: State,
  calls: ToolCallRequest[],
): void {
  if (calls.length === 0) {
    return;
  }

  const skipped = shouldSkipPersistAssistantToolCalls(runtime.historyStore, calls);
  if (skipped) {
    return;
  }

  const preservedMessage = runtime.options.assistantToolCallMessageFromState?.(state, calls);
  if (preservedMessage) {
    runtime.historyStore.push({
      role: "assistant",
      content: cloneLlmMessageContent(preservedMessage.content),
      ...(preservedMessage.toolCalls !== undefined
        ? {
            toolCalls: preservedMessage.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            })),
          }
        : {}),
      ...(preservedMessage.providerState !== undefined
        ? { providerState: cloneLlmProviderState(preservedMessage.providerState) }
        : {}),
    });
    return;
  }

  runtime.historyStore.push({
    role: "assistant",
    content: [],
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      argumentsJson: call.argumentsJson,
    })),
  });
}

export function persistProviderBuiltinToolRoundToHistoryStore<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "historyStore" | "options">,
  state: State,
  round: {
    calls: ToolCallRequest[];
    toolResults: ReadonlyArray<{ toolCallId: string; content: string }>;
  },
): void {
  if (round.calls.length === 0) {
    return;
  }

  if (!shouldSkipPersistAssistantToolCalls(runtime.historyStore, round.calls)) {
    persistAssistantToolCalls(runtime, state, round.calls);
  }

  for (const result of round.toolResults) {
    syncPreparedToolResultContentToHistory(runtime, result.toolCallId, result.content);
  }
}

function requestStubFromToolCall(call: ToolCallRequest): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.argumentsJson) as Record<string, unknown>;
    return { name: call.name, ...parsed };
  } catch {
    return { name: call.name };
  }
}

export function commitToolCallSchemaError<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "emitEvent" | "historyStore">,
  turn: RuntimeTurnContext<ToolRequest>,
  call: ToolCallRequest,
  error: unknown,
): RuntimeToolExecution<ToolRequest> {
  const outputText = `[tool schema error] ${renderError(error)}`;
  return commitSyntheticToolExecutionFailure(
    runtime,
    turn,
    requestStubFromToolCall(call) as ToolRequest,
    call.id,
    call.name,
    outputText,
  );
}

export function commitSyntheticToolExecutionFailure<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "emitEvent" | "historyStore">,
  turn: RuntimeTurnContext<ToolRequest>,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  outputText: string,
): RuntimeToolExecution<ToolRequest> {
  const content = createLlmMessageContentFromText(outputText);
  runtime.historyStore.push({
    role: "tool",
    toolCallId,
    content,
  });

  return commitToolExecutionOutput(runtime, turn, {
    toolCallId,
    toolName,
    request,
    output: {
      content,
      summaryText: outputText,
    },
    failed: true,
  });
}

export function commitToolExecutionOutput<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "emitEvent">,
  turn: RuntimeTurnContext<ToolRequest>,
  options: CommitToolExecutionOutputOptions<ToolRequest>,
): RuntimeToolExecution<ToolRequest> {
  const finished = buildRuntimeToolExecution(options);
  return commitPreparedToolExecution(runtime, turn, finished, options.output, true);
}

export function commitPreparedToolExecution<Config, State, ToolRequest>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest>, "emitEvent">,
  turn: RuntimeTurnContext<ToolRequest>,
  execution: RuntimeToolExecution<ToolRequest>,
  output: ToolExecutionOutput,
  emitFinishedEvent: boolean,
  enqueueDeferredGuidance = true,
): RuntimeToolExecution<ToolRequest> {
  if (!turn.toolExecutions.some((item) => item.toolCallId === execution.toolCallId)) {
    turn.toolExecutions.push(execution);
  }
  if (emitFinishedEvent) {
    runtime.emitEvent({ kind: "tool-execution-finished", execution });
  }
  if (enqueueDeferredGuidance) {
    enqueueDeferredToolOutputGuidance(turn, execution.toolName, output);
  }
  return execution;
}

export function canonicalizeToolArguments(argumentsJson: string): string | undefined {
  try {
    return JSON.stringify(stableJsonValue(JSON.parse(argumentsJson) as JsonValue));
  } catch {
    return undefined;
  }
}

export function resolveEarlyToolCallArguments(
  name: string,
  argumentsJson: string,
): { argumentsJson: string; canonicalArgumentsJson: string } | undefined {
  const directCanonical = canonicalizeToolArguments(argumentsJson);
  if (directCanonical !== undefined) {
    return { argumentsJson, canonicalArgumentsJson: directCanonical };
  }

  const builtArgumentsJson = buildEarlyExecutableArgumentsJson(name, argumentsJson);
  if (builtArgumentsJson === undefined) {
    return undefined;
  }

  const builtCanonical = canonicalizeToolArguments(builtArgumentsJson);
  if (builtCanonical === undefined) {
    return undefined;
  }

  return { argumentsJson: builtArgumentsJson, canonicalArgumentsJson: builtCanonical };
}

export function startEarlyToolExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  context?: EarlyToolExecutionContext<State, ToolRequest>,
): PendingEarlyToolExecution<ToolRequest> | undefined {
  const resolved = resolveEarlyToolCallArguments(call.name, call.argumentsJson);
  if (resolved === undefined) {
    return undefined;
  }

  const existing = earlyToolExecutions.get(call.id);
  if (existing) {
    if (existing.canonicalArgumentsJson === resolved.canonicalArgumentsJson) {
      return existing;
    }
    if (!tryInvalidateUnapprovedEarlyToolExecution(runtime, call.id, earlyToolExecutions)) {
      return existing;
    }
  }

  const executionCall: ToolCallRequest = {
    ...call,
    argumentsJson: resolved.argumentsJson,
  };
  // Approval cards must be shown in argument-completion (i.e. early-start) order, not
  // authorization-race order: each early execution attaches a FIFO chain node at start and,
  // once authorization completes, waits for earlier calls to enqueue/occupy the slot before
  // competing for the single approval slot; the node releases right after enqueue/occupying
  // (resolve is idempotent, finally covers exception paths).
  runtime.earlyApprovalOrderChain ??= Promise.resolve();
  const waitTurn = runtime.earlyApprovalOrderChain;
  let releaseTurn: () => void = () => {};
  runtime.earlyApprovalOrderChain = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const orderTurn = { waitTurn, releaseTurn };
  const record: PendingEarlyToolExecution<ToolRequest> = {
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: resolved.argumentsJson,
    canonicalArgumentsJson: resolved.canonicalArgumentsJson,
    outcome: runEarlyToolExecution(
      runtime,
      executionCall,
      earlyToolExecutions,
      context,
      orderTurn,
    ).finally(() => releaseTurn()),
  };
  earlyToolExecutions.set(call.id, record);
  return record;
}

async function runEarlyToolExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  context: EarlyToolExecutionContext<State, ToolRequest> | undefined,
  orderTurn?: { waitTurn: Promise<void>; releaseTurn: () => void },
): Promise<PendingEarlyToolExecutionOutcome<ToolRequest>> {
  let request: ToolRequest;
  try {
    request = await runtime.options.toolExecutor.requestFromFunctionCall(
      call.name,
      call.argumentsJson,
    );
    request =
      runtime.options.toolExecutor.attachRequestMetadata?.(request, {
        toolCallId: call.id,
        toolName: call.name,
      }) ?? request;
  } catch {
    return { kind: "deferred", reason: "schema-error" };
  }

  const preGate = await runPreToolUseGate(runtime, call, request);
  if (preGate.kind === "denied") {
    return { kind: "deferred", reason: "authorization-error", preGate };
  }
  request = preGate.request;

  let authorization: AuthorizationDecision;
  try {
    authorization = await runtime.options.toolExecutor.authorize(request);
  } catch {
    return { kind: "deferred", reason: "authorization-error", preGate };
  }

  const gateResolution = await resolveDescribedApprovalGate(runtime, preGate, authorization);
  if (gateResolution?.kind === "denied") {
    // Defer to the formal path, which re-authorizes and commits the permission-rule denial.
    return { kind: "deferred", reason: "authorization-error", preGate };
  }
  const initialGate = gateResolution?.kind === "needs-approval" ? gateResolution.gate : null;
  const approvalGate = initialGate
    ? await applyAutoReviewToApprovalGate(
        runtime.options.getApprovalLevel?.(),
        runtime.options.reviewToolApproval,
        runtime.options.toolExecutor.toolDefinitionsJson(),
        call,
        initialGate,
        preGate,
        call.id,
        context?.turn.autoReviewCache,
      )
    : null;

  if (approvalGate) {
    if (!context) {
      return { kind: "deferred", reason: "approval-required", preGate };
    }

    // Wait for earlier-started calls to finish approval enqueue/slot-occupying before competing
    // for the single approval slot (order chain); once this call has enqueued/occupied the slot,
    // release the following calls immediately.
    if (orderTurn) {
      await orderTurn.waitTurn;
    }
    const decisionPromise = waitForEarlyStreamApprovalDecision(runtime, {
      pendingUserInput: context.pendingUserInput,
      state: context.state,
      request,
      prompt: approvalGate.prompt,
      ...(approvalGate.rememberTarget !== undefined
        ? { rememberTarget: approvalGate.rememberTarget }
        : {}),
      ...(approvalGate.autoReviewBlockReason !== undefined
        ? { autoReviewBlockReason: approvalGate.autoReviewBlockReason }
        : {}),
      toolCallId: call.id,
      toolName: call.name,
      argumentsJson: call.argumentsJson,
      canonicalArgumentsJson: canonicalizeToolArguments(call.argumentsJson) ?? call.argumentsJson,
      turn: context.turn,
      earlyToolExecutions,
      resumeAsStreaming: context.resumeAsStreaming ?? true,
      streamingEmitBeginResponse: context.streamingEmitBeginResponse ?? true,
    });
    orderTurn?.releaseTurn();
    const decision = await decisionPromise;

    if (decision.kind === "allow") {
      if (decision.remember && approvalGate.rememberTarget !== undefined) {
        await runtime.options.toolExecutor.rememberApproval(
          approvalGate.rememberTarget,
          decision.remember,
        );
      }
    } else if (decision.kind === "guidance") {
      const guidanceText = decision.resultText?.trim()
        ? decision.resultText
        : "[denied by user] tool call rejected by user guidance";
      const guidanceMessage = decision.userMessage.trim();
      if (guidanceMessage) {
        enqueueDeferredUserGuidance(context.turn, guidanceMessage);
      }
      return {
        kind: "rejected",
        request,
        resultText: guidanceText,
        preGate,
      };
    } else {
      const deniedText = decision.resultText?.trim()
        ? decision.resultText
        : "[denied by user] tool call rejected by user approval policy";
      return {
        kind: "rejected",
        request,
        resultText: deniedText,
        preGate,
      };
    }
  }

  // When no approval is needed (or approval was already granted), release the approval queueing
  // of subsequent calls immediately without waiting for this call to finish executing;
  // the approval path already released at enqueue/occupying time, promise resolve is idempotent,
  // and this is the release point for the no-approval path.
  orderTurn?.releaseTurn();

  if (authorization.kind === "need-questions") {
    return { kind: "deferred", reason: "questions-required", preGate };
  }

  if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
    if (!context) {
      return { kind: "deferred", reason: "background-required", preGate };
    }
    const executionState =
      runtime.resolveTurnToolState?.(context.turn, context.state) ?? context.state;
    runtime.emitEvent({
      kind: "tool-call-started",
      toolCallId: call.id,
      toolName: call.name,
      request,
    });
    runtime.scheduleBackgroundToolExecutionAsync(
      context.pendingUserInput,
      executionState,
      request,
      call.id,
      call.name,
      call.argumentsJson,
      context.turn,
      context.resumeAsStreaming ?? true,
      context.streamingEmitBeginResponse ?? true,
      earlyToolExecutions,
      postHookToolInputFromPreGate(preGate, call.argumentsJson),
    );
    return {
      kind: "background-scheduled",
      request,
      postHookToolInput: postHookToolInputFromPreGate(preGate, call.argumentsJson),
      preGate,
    };
  }

  const internal = await runtime.tryPerformEarlyInternalToolCall?.(request, call.id, call.name);
  if (internal?.kind === "defer-to-formal") {
    return { kind: "deferred", reason: "internal-deferred", preGate };
  }

  runtime.emitEvent({
    kind: "tool-call-started",
    toolCallId: call.id,
    toolName: call.name,
    request,
  });

  const external =
    internal === undefined ? await performEarlyExternalToolExecution(runtime, request) : undefined;
  const output = internal?.kind === "completed" ? internal.output : external?.output;
  const failed = internal?.kind === "completed" ? internal.failed : external?.failed;
  if (!output || failed === undefined) {
    return { kind: "deferred", reason: "internal-deferred", preGate };
  }
  const fatalError = internal?.kind === "completed" ? internal.fatalError : undefined;
  const enqueueDeferredGuidance =
    internal?.kind === "completed" ? (internal.enqueueDeferredGuidance ?? true) : true;
  const execution = buildRuntimeToolExecution({
    toolCallId: call.id,
    toolName: call.name,
    request,
    output,
    failed,
  });
  runtime.emitEvent({ kind: "tool-execution-finished", execution });
  return {
    kind: "completed",
    request,
    execution,
    output,
    enqueueDeferredGuidance,
    postHookToolInput: postHookToolInputFromPreGate(preGate, call.argumentsJson),
    ...(fatalError !== undefined ? { fatalError } : {}),
  };
}

/**
 * Suspends the formal approval gate until the single approval slot is released.
 * Returns false when this turn was terminated (abort / history replacement); the caller should exit silently.
 */
function waitForPendingApprovalSlot<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): Promise<boolean> {
  if (!Array.isArray(runtime.pendingApprovalSlotWaiters)) {
    runtime.pendingApprovalSlotWaiters = [];
  }
  return new Promise((resolve) => {
    runtime.pendingApprovalSlotWaiters.push(resolve);
  });
}

/** Wakes all formal gate waiters to re-check after a slot state change; canProceed=false means this turn was terminated. */
function notifyPendingApprovalSlotWaiters<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  canProceed: boolean,
): void {
  if (
    !Array.isArray(runtime.pendingApprovalSlotWaiters) ||
    runtime.pendingApprovalSlotWaiters.length === 0
  ) {
    return;
  }
  const waiters = runtime.pendingApprovalSlotWaiters;
  runtime.pendingApprovalSlotWaiters = [];
  for (const resolve of waiters) {
    resolve(canProceed);
  }
}

export function pumpEarlyApprovalQueue<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): void {
  ensureEarlyApprovalQueue(runtime);
  // Regardless of this pump's outcome, wake formal gate waiters to re-check the slot.
  try {
    if (runtime.pendingApproval) {
      return;
    }
    const next = runtime.earlyApprovalQueue.shift();
    if (!next) {
      return;
    }
    showEarlyStreamApproval(runtime, next);
  } finally {
    notifyPendingApprovalSlotWaiters(runtime, true);
  }
}

export function clearEarlyApprovalWaiters<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  resultText = "[aborted] tool approval cancelled",
): void {
  ensureEarlyApprovalQueue(runtime);
  const deny: RuntimeApprovalDecision = { kind: "deny", resultText };
  const pending = runtime.pendingApproval;
  if (pending?.source === "early-stream") {
    pending.resolveEarlyDecision?.(deny);
    runtime.pendingApproval = undefined;
  }
  while (runtime.earlyApprovalQueue.length > 0) {
    const item = runtime.earlyApprovalQueue.shift();
    item?.resolveDecision(deny);
  }
  // This turn was terminated: wake formal gate waiters so they exit silently, avoiding permanently suspended poll coroutines.
  notifyPendingApprovalSlotWaiters(runtime, false);
}

function ensureEarlyApprovalQueue<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): void {
  if (!Array.isArray(runtime.earlyApprovalQueue)) {
    runtime.earlyApprovalQueue = [];
  }
}

function waitForEarlyStreamApprovalDecision<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  item: Omit<EarlyStreamApprovalQueueItem<State, ToolRequest>, "resolveDecision">,
): Promise<RuntimeApprovalDecision> {
  ensureEarlyApprovalQueue(runtime);
  return new Promise((resolve) => {
    const queued: EarlyStreamApprovalQueueItem<State, ToolRequest> = {
      ...item,
      resolveDecision: resolve,
    };
    if (runtime.pendingApproval) {
      runtime.earlyApprovalQueue.push(queued);
      return;
    }
    showEarlyStreamApproval(runtime, queued);
  });
}

function showEarlyStreamApproval<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  item: EarlyStreamApprovalQueueItem<State, ToolRequest>,
): void {
  const state = runtime.resolveTurnToolState?.(item.turn, item.state) ?? item.state;
  const approval = createApproval(
    item.prompt,
    item.request,
    item.toolCallId,
    item.toolName,
    item.rememberTarget,
    item.autoReviewBlockReason,
  );
  runtime.pendingApproval = {
    source: "early-stream",
    pendingUserInput: item.pendingUserInput,
    state,
    request: item.request,
    prompt: item.prompt,
    ...(item.rememberTarget !== undefined ? { rememberTarget: item.rememberTarget } : {}),
    ...(item.autoReviewBlockReason !== undefined
      ? { autoReviewBlockReason: item.autoReviewBlockReason }
      : {}),
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    argumentsJson: item.argumentsJson,
    remainingCalls: [],
    turn: item.turn,
    resumeAsStreaming: item.resumeAsStreaming,
    streamingEmitBeginResponse: item.streamingEmitBeginResponse,
    earlyToolExecutions: item.earlyToolExecutions,
    resolveEarlyDecision: item.resolveDecision,
  };
  runtime.emitEvent({
    kind: "approval-requested",
    approval,
  });
}

function tryInvalidateUnapprovedEarlyToolExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  toolCallId: string,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>,
): boolean {
  ensureEarlyApprovalQueue(runtime);
  const queuedIndex = runtime.earlyApprovalQueue.findIndex(
    (item) => item.toolCallId === toolCallId,
  );
  const isQueued = queuedIndex >= 0;
  const isPending =
    runtime.pendingApproval?.source === "early-stream" &&
    runtime.pendingApproval.toolCallId === toolCallId;

  if (!isQueued && !isPending) {
    return false;
  }

  const deny: RuntimeApprovalDecision = {
    kind: "deny",
    resultText: "[cancelled] tool arguments changed before approval",
  };

  if (isQueued) {
    const [removed] = runtime.earlyApprovalQueue.splice(queuedIndex, 1);
    removed?.resolveDecision(deny);
  }

  if (isPending) {
    runtime.pendingApproval?.resolveEarlyDecision?.(deny);
    runtime.pendingApproval = undefined;
    pumpEarlyApprovalQueue(runtime);
  }

  earlyToolExecutions.delete(toolCallId);
  return true;
}

async function performEarlyExternalToolExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  request: ToolRequest,
): Promise<ToolExecutionResult> {
  try {
    const output = await runtime.options.toolExecutor.execute(request);
    return {
      output,
      failed: false,
      backgroundExecution: false,
    };
  } catch (error) {
    const summaryText = `[tool error] ${renderError(error)}`;
    return {
      output: {
        content: createLlmMessageContentFromText(summaryText),
        summaryText,
      },
      failed: true,
      backgroundExecution: false,
    };
  }
}

async function resolveEarlyPreGateForFormalCall<ToolRequest>(
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>> | undefined,
): Promise<PreToolUseGateResult<ToolRequest> | undefined> {
  const early = earlyToolExecutions?.get(call.id);
  if (!early || early.toolName !== call.name) {
    return undefined;
  }

  const canonicalArgumentsJson = canonicalizeToolArguments(call.argumentsJson);
  if (canonicalArgumentsJson === undefined) {
    return undefined;
  }
  if (
    canonicalArgumentsJson !== early.canonicalArgumentsJson &&
    !earlyToolArgumentsMatchFormal(call.name, early.canonicalArgumentsJson, call.argumentsJson)
  ) {
    return undefined;
  }

  const outcome = await early.outcome;
  if (outcome.kind === "deferred" && outcome.preGate) {
    return outcome.preGate;
  }
  return undefined;
}

async function matchingEarlyToolExecutionOutcome<ToolRequest>(
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>> | undefined,
): Promise<PendingEarlyToolExecutionOutcome<ToolRequest> | undefined> {
  const early = earlyToolExecutions?.get(call.id);
  if (!early || early.toolName !== call.name) {
    return undefined;
  }

  const canonicalArgumentsJson = canonicalizeToolArguments(call.argumentsJson);
  if (canonicalArgumentsJson === undefined) {
    return undefined;
  }
  if (
    canonicalArgumentsJson !== early.canonicalArgumentsJson &&
    !earlyToolArgumentsMatchFormal(call.name, early.canonicalArgumentsJson, call.argumentsJson)
  ) {
    return undefined;
  }

  const outcome = await early.outcome;
  if (
    outcome.kind === "completed" ||
    outcome.kind === "background-scheduled" ||
    outcome.kind === "rejected"
  ) {
    return outcome;
  }
  return undefined;
}

function earlyToolArgumentsMatchFormal(
  toolName: string,
  earlyCanonicalJson: string,
  formalArgumentsJson: string,
): boolean {
  const formalCanonical = canonicalizeToolArguments(formalArgumentsJson);
  if (formalCanonical === undefined || formalCanonical === earlyCanonicalJson) {
    return formalCanonical === earlyCanonicalJson;
  }

  if (toolName !== "read_file" && toolName !== "ls" && toolName !== "delete_file") {
    return false;
  }

  let early: Record<string, unknown>;
  let formal: Record<string, unknown>;
  try {
    early = JSON.parse(earlyCanonicalJson) as Record<string, unknown>;
    formal = JSON.parse(formalCanonical) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (typeof early.path !== "string" || early.path !== formal.path) {
    return false;
  }

  const earlyKeys = Object.keys(early).sort();
  if (earlyKeys.length !== 1 || earlyKeys[0] !== "path") {
    return false;
  }

  if (toolName === "read_file") {
    if (early.offset === formal.offset && early.limit === formal.limit) {
      return true;
    }
    return formal.offset === undefined && formal.limit === undefined;
  }

  return true;
}

function stableJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  return value;
}

export async function waitForCompletedTurnResult<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): Promise<RuntimeTurnResult<State, ToolRequest>> {
  while (true) {
    const existing = runtime.takeCompletedTurnResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a result.");
    }

    await runtime.poll();

    const result = runtime.takeCompletedTurnResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a result.");
    }

    await waitForImmediate();
  }
}

function createApproval<ToolRequest>(
  prompt: ToolApprovalPrompt,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  rememberTarget: PermissionMemoryTarget | undefined,
  autoReviewBlockReason?: string,
): RuntimePendingApproval<ToolRequest> {
  return {
    prompt,
    request,
    ...(rememberTarget !== undefined ? { rememberTarget } : {}),
    ...(autoReviewBlockReason !== undefined ? { autoReviewBlockReason } : {}),
    toolCallId,
    toolName,
  };
}

function createQuestions<ToolRequest>(
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  questions: RuntimePendingQuestions<ToolRequest>["questions"],
): RuntimePendingQuestions<ToolRequest> {
  return {
    request,
    toolCallId,
    toolName,
    questions,
  };
}

function queueRemainingToolCallsAsync<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  pendingUserInput: string,
  remaining: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming: boolean,
  streamingEmitBeginResponse: boolean,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>> | undefined,
): boolean {
  if (remaining.length === 0) {
    return false;
  }

  runtime.queuePendingToolCallContinuation(
    state,
    pendingUserInput,
    remaining,
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    earlyToolExecutions,
  );
  return true;
}
