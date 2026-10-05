import type {
  AuthorizationDecision,
  JsonObject,
  PermissionMemoryTarget,
  ToolApprovalPrompt,
  ToolCallRequest,
  ToolExecutionOutput,
} from "../ports.js";
import type { TurnMachineRuntime } from "../runtime/turn-machine.js";

import { HookDeniedError } from "./errors.js";
import {
  appendHookAdditionalContexts,
  applyUpdatedToolRequest,
  runPostToolUseHook,
  runPreToolUseHook,
  toolInputFromArgumentsJson,
} from "./integration.js";

export type PreToolUseGateResult<ToolRequest> =
  | {
      kind: "ready";
      request: ToolRequest;
      effectiveToolInput?: JsonObject;
    }
  | {
      kind: "needs-approval";
      request: ToolRequest;
      prompt: ToolApprovalPrompt;
      effectiveToolInput?: JsonObject;
    }
  | { kind: "denied"; error: HookDeniedError };

export interface ToolApprovalGate {
  prompt: ToolApprovalPrompt;
  rememberTarget: PermissionMemoryTarget | undefined;
}

export type ToolApprovalGateResolution =
  | { kind: "needs-approval"; gate: ToolApprovalGate }
  | { kind: "denied"; reason: string };

export function resolveApprovalGateAfterAuthorize<ToolRequest>(
  preGate: PreToolUseGateResult<ToolRequest>,
  authorization: AuthorizationDecision,
): ToolApprovalGateResolution | null {
  // A hook returning permission "allow" no longer skips host approval: hooks can only
  // tighten (allow -> ask/deny) or block, never loosen the host authorization outcome.
  // An allowlist deny denies outright; hook ask or an allowlist ask both end in
  // needs-approval (a hook ask keeps its own prompt); only allow + allow proceeds.
  if (authorization.kind === "denied") {
    return { kind: "denied", reason: authorization.reason };
  }

  if (preGate.kind === "needs-approval") {
    return {
      kind: "needs-approval",
      gate: {
        prompt: preGate.prompt,
        rememberTarget:
          authorization.kind === "need-approval" ? authorization.rememberTarget : undefined,
      },
    };
  }

  if (authorization.kind === "need-approval") {
    return {
      kind: "needs-approval",
      gate: {
        prompt: { kind: "tool", request: authorization.approval },
        rememberTarget: authorization.rememberTarget,
      },
    };
  }

  return null;
}

function preToolUseGateFromHookResult<ToolRequest>(
  request: ToolRequest,
  permission: "allow" | "ask" | undefined,
  userMessage: string | undefined,
): PreToolUseGateResult<ToolRequest> {
  if (permission === "ask") {
    return {
      kind: "needs-approval",
      request,
      prompt: { kind: "hook", message: userMessage?.trim() || undefined },
    };
  }

  return {
    kind: "ready",
    request,
  };
}

export async function runPreToolUseGate<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  call: ToolCallRequest,
  request: ToolRequest,
): Promise<PreToolUseGateResult<ToolRequest>> {
  try {
    const toolInput = toolInputFromArgumentsJson(call.argumentsJson);
    const preHook = await runPreToolUseHook(runtime.options, call, toolInput);
    appendHookAdditionalContexts(
      runtime.recordContextMessage
        ? (role, content) => runtime.recordContextMessage!(role, content)
        : undefined,
      preHook.additionalContexts,
    );

    let resolvedRequest = request;
    let effectiveToolInput: JsonObject | undefined;
    if (preHook.updatedInput) {
      effectiveToolInput = preHook.updatedInput;
      resolvedRequest = await applyUpdatedToolRequest(
        runtime.options.toolExecutor,
        call,
        preHook.updatedInput,
      );
    }

    const gate = preToolUseGateFromHookResult(
      resolvedRequest,
      preHook.permission === "allow" || preHook.permission === "ask"
        ? preHook.permission
        : undefined,
      preHook.userMessage,
    );
    if (gate.kind === "denied") {
      return gate;
    }
    return {
      ...gate,
      ...(effectiveToolInput ? { effectiveToolInput } : {}),
    };
  } catch (error) {
    if (error instanceof HookDeniedError) {
      return { kind: "denied", error };
    }
    throw error;
  }
}

export async function runPostToolUseSideEffects<Config, State, ToolRequest>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest>,
  call: Pick<ToolCallRequest, "id" | "name" | "argumentsJson">,
  toolInput: JsonObject,
  output: ToolExecutionOutput,
  durationMs: number,
  failed: boolean,
): Promise<void> {
  const postHook = await runPostToolUseHook(runtime.options, {
    toolName: call.name,
    toolCallId: call.id,
    toolInput,
    toolOutput: output.summaryText,
    durationMs,
    failed,
  });
  appendHookAdditionalContexts(
    runtime.recordContextMessage
      ? (role, content) => runtime.recordContextMessage!(role, content)
      : undefined,
    postHook.additionalContexts,
  );
}

export function hookDeniedToolOutput(error: HookDeniedError): string {
  return error.agentMessage ?? error.userMessage ?? error.message;
}

export function postHookToolInputFromPreGate<ToolRequest>(
  preGate: PreToolUseGateResult<ToolRequest>,
  argumentsJson: string,
): JsonObject {
  if (preGate.kind === "denied") {
    return toolInputFromArgumentsJson(argumentsJson);
  }
  return preGate.effectiveToolInput ?? toolInputFromArgumentsJson(argumentsJson);
}
