import { setImmediate as waitForImmediate } from "node:timers/promises";

import type { AuthorizationDecision } from "../ports.js";

import { renderError, toolNameFromRequest } from "./helpers.js";
import { applyAutoReviewToApprovalGate } from "./auto-approval-integration.js";
import type { ToolExecutionResult } from "./tool-execution.js";
import type {
  AgentRuntimeOptions,
  PendingManualApprovalState,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeEvent,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimeTurnResult,
} from "./types.js";

export interface ManualToolsRuntime<Config, State, ToolRequest> {
  options: AgentRuntimeOptions<Config, State, ToolRequest>;
  pendingManualApproval: PendingManualApprovalState<ToolRequest> | undefined;
  completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  isBusy(): boolean;
  startUserTurn(userInput: string, explicitImages?: string[]): Promise<void>;
  startManualBackgroundToolExecution(request: ToolRequest, toolName: string): string | undefined;
  performToolExecution(
    request: ToolRequest,
    toolName: string,
    toolCallId?: string,
  ): Promise<ToolExecutionResult>;
  takeCompletedManualToolCommandResult():
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest>>;
  poll(): Promise<void>;
}

export async function startManualToolCommand<Config, State, ToolRequest>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest>,
  message: string,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
  if (runtime.isBusy()) {
    throw new Error("A response or approval is already being processed; please wait.");
  }

  runtime.completedManualToolCommandResultStore = undefined;

  let request: ToolRequest;
  try {
    request = await runtime.options.toolExecutor.parseCommand(message);
    request =
      runtime.options.toolExecutor.attachRequestMetadata?.(request, {
        toolName: toolNameFromRequest(request),
        userInitiated: true,
      }) ?? request;
  } catch (error) {
    return {
      kind: "failed",
      error: `Failed to parse tool command: ${renderError(error)}`,
    };
  }

  const toolName = toolNameFromRequest(request);

  let authorization: AuthorizationDecision;
  try {
    authorization = await runtime.options.toolExecutor.authorize(request);
  } catch (error) {
    return {
      kind: "failed",
      error: `Tool authorization check failed: ${renderError(error)}`,
      request,
    };
  }

  if (authorization.kind === "denied") {
    return {
      kind: "denied",
      request,
      toolName,
      message: `[denied by permission rule] ${authorization.reason}`,
    };
  }

  if (authorization.kind === "need-approval") {
    const activeGate = await applyAutoReviewToApprovalGate(
      runtime.options.getApprovalLevel?.(),
      runtime.options.reviewToolApproval,
      runtime.options.toolExecutor.toolDefinitionsJson(),
      {
        name: toolName,
        argumentsJson: JSON.stringify(request),
      },
      {
        prompt: { kind: "tool", request: authorization.approval },
        rememberTarget: authorization.rememberTarget,
      },
    );
    if (activeGate) {
      runtime.pendingManualApproval = {
        request,
        prompt: activeGate.prompt,
        ...(activeGate.rememberTarget !== undefined
          ? { rememberTarget: activeGate.rememberTarget }
          : {}),
        ...(activeGate.autoReviewBlockReason !== undefined
          ? { autoReviewBlockReason: activeGate.autoReviewBlockReason }
          : {}),
        toolName,
      };
      runtime.emitEvent({
        kind: "approval-requested",
        approval: {
          prompt: activeGate.prompt,
          request,
          ...(activeGate.rememberTarget !== undefined
            ? { rememberTarget: activeGate.rememberTarget }
            : {}),
          ...(activeGate.autoReviewBlockReason !== undefined
            ? { autoReviewBlockReason: activeGate.autoReviewBlockReason }
            : {}),
          toolName,
        },
      });
      return {
        kind: "requires-approval",
        approval: {
          prompt: activeGate.prompt,
          request,
          ...(activeGate.rememberTarget !== undefined
            ? { rememberTarget: activeGate.rememberTarget }
            : {}),
          ...(activeGate.autoReviewBlockReason !== undefined
            ? { autoReviewBlockReason: activeGate.autoReviewBlockReason }
            : {}),
          toolName,
        },
      };
    }
  }

  if (authorization.kind === "need-questions") {
    return {
      kind: "failed",
      error: "Manual tool commands do not support ask_questions interaction.",
      request,
    };
  }

  return startManualToolRequest(runtime, request, toolName);
}

export async function continuePendingManualToolApproval<Config, State, ToolRequest>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest>,
  decision: RuntimeApprovalDecision,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
  const pending = runtime.pendingManualApproval;
  if (!pending) {
    throw new Error("There is no pending manual tool call to confirm.");
  }

  runtime.pendingManualApproval = undefined;
  runtime.completedManualToolCommandResultStore = undefined;

  if (decision.kind === "allow") {
    if (decision.remember && pending.rememberTarget !== undefined) {
      await runtime.options.toolExecutor.rememberApproval(
        pending.rememberTarget,
        decision.remember,
      );
    }

    return startManualToolRequest(runtime, pending.request, pending.toolName);
  }

  if (decision.kind === "guidance") {
    const userMessage = decision.userMessage.trim();
    if (!userMessage) {
      return {
        kind: "denied",
        request: pending.request,
        toolName: pending.toolName,
        message: "This tool call was denied.",
      };
    }

    await runtime.startUserTurn(userMessage);
    return {
      kind: "started-user-turn",
      userMessage,
    };
  }

  return {
    kind: "denied",
    request: pending.request,
    toolName: pending.toolName,
    message: "This tool call was denied.",
  };
}

export async function startManualToolRequest<Config, State, ToolRequest>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest>,
  request: ToolRequest,
  toolName: string,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest>> {
  if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
    const statusText = runtime.startManualBackgroundToolExecution(request, toolName);
    return {
      kind: "started-background",
      request,
      toolName,
      ...(statusText !== undefined ? { statusText } : {}),
    };
  }

  const execution = await runtime.performToolExecution(request, toolName);
  return {
    kind: "completed",
    request,
    toolName,
    output: execution.output.summaryText,
    failed: execution.failed,
    backgroundExecution: execution.backgroundExecution,
  };
}

export async function waitForStartedManualToolCommandResult<Config, State, ToolRequest>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest>,
  result: RuntimeManualToolCommandStartResult<State, ToolRequest>,
): Promise<RuntimeManualToolCommandResult<State, ToolRequest>> {
  if (result.kind === "started-background") {
    return waitForCompletedManualToolCommandResult(runtime);
  }

  if (result.kind === "started-user-turn") {
    return {
      kind: "submitted-user-turn",
      userMessage: result.userMessage,
      result: await runtime.waitForCompletedTurnResult(),
    };
  }

  return result;
}

export async function waitForCompletedManualToolCommandResult<Config, State, ToolRequest>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest>,
): Promise<RuntimeCompletedManualToolCommandResult<ToolRequest>> {
  while (true) {
    const existing = runtime.takeCompletedManualToolCommandResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a manual tool result.");
    }

    await runtime.poll();

    const result = runtime.takeCompletedManualToolCommandResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error("runtime went idle before producing a manual tool result.");
    }

    await waitForImmediate();
  }
}
