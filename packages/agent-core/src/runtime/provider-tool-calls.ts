import type { LlmTransportConfig } from "../provider-config.js";
import type { ToolCallRequest } from "../ports.js";
import { createLlmMessageContentFromText } from "../ports.js";
import { executeProviderToolCall } from "../provider-tools/execute.js";
import {
  peekDeclaredProviderToolNames,
  resolveDeclaredProviderTools,
  type ResolvedProviderToolExecution,
} from "../provider-tools/runtime.js";
import { buildProviderToolPreviewArgumentsJson } from "../provider-tools/spirit-ui.js";
import { validateProviderToolArguments } from "../provider-tools/validate.js";
import { readWebSearchQuery } from "../web-search/read-web-search-query.js";
import { toolNamesFromDefinitions } from "../unknown-tool-error.js";
import {
  commitSyntheticToolExecutionFailure,
  commitToolExecutionOutput,
  processToolCalls,
  processToolCallsAsync,
  runTurnLoop,
  startToolAgentRoundAsync,
  type TurnMachineRuntime,
} from "./turn-machine.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./tool-output-append.js";
import type { RuntimeTurnContext, RuntimeTurnResult } from "./types.js";

export type DeclaredProviderToolCallOutcome<State, ToolRequest> =
  | { kind: "not-handled" }
  | { kind: "advance"; state: State }
  | { kind: "turn-result"; result: RuntimeTurnResult<State, ToolRequest> };

function declaredProviderToolRequestStub<ToolRequest>(call: ToolCallRequest): ToolRequest {
  return {
    name: call.name,
    argumentsJson: call.argumentsJson,
  } as ToolRequest;
}

function localToolNamesForRuntime<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
): Set<string> {
  return new Set(toolNamesFromDefinitions(runtime.options.toolExecutor.toolDefinitionsJson()));
}

/**
 * A call whose declared name has no `execute` binding is an in-band (upstream-executed) provider
 * tool call: the transport stream carries its result, so the turn machine leaves it alone.
 */
async function resolveDeclaredProviderToolExecution<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  toolName: string,
): Promise<ResolvedProviderToolExecution | undefined> {
  const config = runtime.options.config as LlmTransportConfig;
  const resolved = await resolveDeclaredProviderTools(config, localToolNamesForRuntime(runtime));
  return resolved.executions.get(toolName);
}

function providerToolSummaryText(
  toolName: string,
  failed: boolean,
  suppressExpand: boolean,
  content?: string,
): string {
  if (failed) {
    return `[provider tool ${toolName}] failed`;
  }
  // Collapsed display does not change the model result: the content is still committed verbatim,
  // while the human-facing summary stays generic.
  if (!suppressExpand && content?.trim()) {
    return content;
  }
  return `[provider tool ${toolName}] completed`;
}

async function executeAndCommitDeclaredProviderToolCall<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  state: State,
  call: ToolCallRequest,
  turn: RuntimeTurnContext<ToolRequest>,
  execution: ResolvedProviderToolExecution,
): Promise<{ state: State; failed: boolean }> {
  const config = runtime.options.config as LlmTransportConfig;
  const request = declaredProviderToolRequestStub<ToolRequest>(call);
  const query = readWebSearchQuery(call.argumentsJson);
  const suppressExpand = execution.entry.ui?.expand === false;
  const label = execution.entry.label ?? call.name;

  runtime.emitEvent({
    kind: "streaming-tool-preview",
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: buildProviderToolPreviewArgumentsJson({
      label,
      toolName: call.name,
      query,
      status: "in_progress",
      suppressExpand,
    }),
  });

  await Promise.resolve(runtime.options.flushPendingHostEvents?.());

  // Fail-fast argument validation against the declared schema: the error goes back to the model
  // as the tool result; there is no silent clamping.
  const validationError = validateProviderToolArguments(
    call.name,
    call.argumentsJson,
    execution.parameters,
  );
  if (validationError !== undefined) {
    runtime.emitEvent({
      kind: "streaming-tool-preview",
      toolCallId: call.id,
      toolName: call.name,
      argumentsJson: buildProviderToolPreviewArgumentsJson({
        label,
        toolName: call.name,
        query,
        failed: true,
        status: "failed",
        suppressExpand,
      }),
    });
    commitSyntheticToolExecutionFailure(
      runtime,
      turn,
      request,
      call.id,
      call.name,
      validationError,
    );
    const resumedState = runtime.options.appendToolResultMessage(state, call.id, validationError);
    return { state: resumedState, failed: true };
  }

  const result = await executeProviderToolCall(
    execution.execute,
    { toolName: call.name, argumentsJson: call.argumentsJson },
    { apiBase: config.baseUrl ?? "", apiKey: config.apiKey ?? "" },
  );

  runtime.emitEvent({
    kind: "streaming-tool-preview",
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: buildProviderToolPreviewArgumentsJson({
      label,
      toolName: call.name,
      query,
      ...(result.kind === "failed"
        ? { failed: true, status: "failed" }
        : { status: "completed", outputExcerpt: result.content }),
      suppressExpand,
    }),
  });

  if (result.kind === "failed") {
    commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, result.error);
    const resumedState = runtime.options.appendToolResultMessage(state, call.id, result.error);
    return { state: resumedState, failed: true };
  }

  const summaryText = providerToolSummaryText(call.name, false, suppressExpand, result.content);
  const content = createLlmMessageContentFromText(summaryText);
  commitToolExecutionOutput(runtime, turn, {
    toolCallId: call.id,
    toolName: call.name,
    request,
    output: {
      content,
      summaryText,
    },
    failed: false,
  });

  const preparedContent = await prepareAndSyncRuntimeToolResultToHistory(
    runtime,
    call.id,
    result.content,
  );
  const resumedState = runtime.options.appendToolResultMessage(state, call.id, preparedContent);
  return { state: resumedState, failed: false };
}

export async function handleDeclaredProviderToolCallInTurn<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
  state: State,
  call: ToolCallRequest,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<DeclaredProviderToolCallOutcome<State, ToolRequest>> {
  const execution = await resolveDeclaredProviderToolExecution(runtime, call.name);
  if (execution === undefined) {
    return { kind: "not-handled" };
  }

  const { state: resumedState } = await executeAndCommitDeclaredProviderToolCall(
    runtime,
    state,
    call,
    turn,
    execution,
  );

  if (remainingCalls.length > 0) {
    return {
      kind: "turn-result",
      result: await processToolCalls(runtime, resumedState, pendingUserInput, remainingCalls, turn),
    };
  }

  return {
    kind: "turn-result",
    result: await runTurnLoop(runtime, resumedState, pendingUserInput, turn),
  };
}

export async function handleDeclaredProviderToolCallInTurnAsync<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  pendingUserInput: string,
  state: State,
  call: ToolCallRequest,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
): Promise<boolean> {
  const execution = await resolveDeclaredProviderToolExecution(runtime, call.name);
  if (execution === undefined) {
    return false;
  }

  const { state: resumedState } = await executeAndCommitDeclaredProviderToolCall(
    runtime,
    state,
    call,
    turn,
    execution,
  );

  if (remainingCalls.length > 0) {
    await processToolCallsAsync(
      runtime,
      resumedState,
      pendingUserInput,
      remainingCalls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
    return true;
  }

  if (resumeAsStreaming) {
    await runtime.startStreamingRound(
      resumedState,
      pendingUserInput,
      turn,
      streamingEmitBeginResponse,
    );
    return true;
  }

  startToolAgentRoundAsync(runtime, resumedState, pendingUserInput, turn);
  return true;
}

/**
 * Early-execution skip (sync): a recognized provider tool name never early-executes through the
 * local tool path. Reads the latest completed resolution; before the first resolution lands, a
 * provider tool call defers safely through the executor's unknown-tool error.
 */
export function shouldSkipEarlyExecutionForDeclaredProviderTool(
  toolName: string,
  config: unknown,
): boolean {
  const names = peekDeclaredProviderToolNames(config as LlmTransportConfig);
  return names !== undefined && names.has(toolName);
}
