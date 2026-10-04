import {
  resolveToolAutoReviewGate,
  resolveToolInputSchema,
  type SessionApprovalLevel,
  type ToolAutoReviewGateOutcome,
  type ToolAutoReviewInput,
  type ToolAutoReviewer,
} from "../auto-approval/index.js";
import type {
  AuthorizationDecision,
  JsonValue,
  ToolApprovalPrompt,
  ToolCallRequest,
} from "../ports.js";
import type { PreToolUseGateResult } from "../hooks/tool-hooks.js";
import type { ToolApprovalGate } from "../hooks/tool-hooks.js";

export interface ResolvedToolApprovalGate extends ToolApprovalGate {
  autoReviewBlockReason?: string;
}

/** Per-tool-call auto-review outcomes shared across a turn (including recursive remaining batches). */
export type AutoReviewCache = Map<string, Promise<ToolAutoReviewGateOutcome>>;

export function buildToolAutoReviewInput(input: {
  toolName: string;
  argumentsJson: string;
  hostApprovalContext: ToolApprovalPrompt;
  toolDefinitions: JsonValue;
  targetMcpToolSchema?: JsonValue;
}): ToolAutoReviewInput {
  const inputSchema = resolveToolInputSchema(input.toolDefinitions, input.toolName);
  return {
    toolName: input.toolName,
    argumentsJson: input.argumentsJson,
    ...(inputSchema !== undefined ? { inputSchema } : {}),
    ...(input.targetMcpToolSchema !== undefined
      ? { targetMcpToolSchema: input.targetMcpToolSchema }
      : {}),
    hostApprovalContext: input.hostApprovalContext,
  };
}

function gateFromAutoReviewOutcome(
  gate: ToolApprovalGate,
  outcome: ToolAutoReviewGateOutcome,
): ResolvedToolApprovalGate | null {
  if (outcome.kind === "allowed") {
    return null;
  }
  if (outcome.kind === "blocked") {
    return {
      ...gate,
      autoReviewBlockReason: outcome.reason,
    };
  }
  return gate;
}

export async function applyAutoReviewToApprovalGate<ToolRequest>(
  approvalLevel: SessionApprovalLevel | undefined,
  reviewToolApproval: ToolAutoReviewer | undefined,
  toolDefinitions: JsonValue,
  call: { name: string; argumentsJson: string },
  gate: ToolApprovalGate,
  preGate?: PreToolUseGateResult<ToolRequest>,
  toolCallId?: string,
  reviewCache?: AutoReviewCache,
): Promise<ResolvedToolApprovalGate | null> {
  if (!reviewToolApproval || approvalLevel !== "auto-approval") {
    return gate;
  }
  // Hook permission: ask must stay on manual approval; auto review must not bypass it.
  if (preGate?.kind === "needs-approval") {
    return gate;
  }

  let outcome: ToolAutoReviewGateOutcome;
  const cached = toolCallId && reviewCache ? reviewCache.get(toolCallId) : undefined;
  if (cached) {
    outcome = await cached;
  } else {
    const reviewPromise = resolveToolAutoReviewGate(
      approvalLevel,
      reviewToolApproval,
      buildToolAutoReviewInput({
        toolName: call.name,
        argumentsJson: call.argumentsJson,
        hostApprovalContext: gate.prompt,
        toolDefinitions,
      }),
    );
    if (toolCallId && reviewCache) {
      reviewCache.set(toolCallId, reviewPromise);
    }
    outcome = await reviewPromise;
  }

  return gateFromAutoReviewOutcome(gate, outcome);
}

/**
 * Start auto-review LLM calls for every tool in the batch that host-authorize
 * marks need-approval. Does not await reviews (pipeline); execution awaits via cache.
 * Skips PreToolUse hooks here to avoid double side effects — hook ask is still
 * honored in applyAutoReviewToApprovalGate before consuming cache.
 */
export function prefetchAutoReviewsForToolCalls<ToolRequest>(input: {
  calls: readonly ToolCallRequest[];
  approvalLevel: SessionApprovalLevel | undefined;
  reviewToolApproval: ToolAutoReviewer | undefined;
  toolDefinitions: JsonValue;
  reviewCache: AutoReviewCache;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision>;
}): void {
  const { approvalLevel, reviewToolApproval, reviewCache } = input;
  if (!reviewToolApproval || approvalLevel !== "auto-approval") {
    return;
  }

  for (const call of input.calls) {
    if (reviewCache.has(call.id)) {
      continue;
    }
    reviewCache.set(
      call.id,
      startAutoReviewPromise({
        call,
        approvalLevel,
        reviewToolApproval,
        toolDefinitions: input.toolDefinitions,
        requestFromFunctionCall: input.requestFromFunctionCall,
        authorize: input.authorize,
      }),
    );
  }
}

/**
 * Streaming preview path: start (or restart) auto-review for one tool when its
 * arguments fingerprint changes. Uses the same AutoReviewCache as formal tool processing.
 */
export function prefetchAutoReviewForToolCallIfNeeded<ToolRequest>(input: {
  call: ToolCallRequest;
  canonicalArgumentsJson: string;
  argFingerprints: Map<string, string>;
  approvalLevel: SessionApprovalLevel | undefined;
  reviewToolApproval: ToolAutoReviewer | undefined;
  toolDefinitions: JsonValue;
  reviewCache: AutoReviewCache;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision>;
}): void {
  const { approvalLevel, reviewToolApproval, reviewCache, call, canonicalArgumentsJson } = input;
  if (!reviewToolApproval || approvalLevel !== "auto-approval") {
    return;
  }

  const previousFingerprint = input.argFingerprints.get(call.id);
  if (previousFingerprint === canonicalArgumentsJson && reviewCache.has(call.id)) {
    return;
  }

  if (previousFingerprint !== undefined && previousFingerprint !== canonicalArgumentsJson) {
    reviewCache.delete(call.id);
  }
  input.argFingerprints.set(call.id, canonicalArgumentsJson);

  reviewCache.set(
    call.id,
    startAutoReviewPromise({
      call,
      approvalLevel,
      reviewToolApproval,
      toolDefinitions: input.toolDefinitions,
      requestFromFunctionCall: input.requestFromFunctionCall,
      authorize: input.authorize,
    }),
  );
}

function startAutoReviewPromise<ToolRequest>(input: {
  call: ToolCallRequest;
  approvalLevel: SessionApprovalLevel;
  reviewToolApproval: ToolAutoReviewer;
  toolDefinitions: JsonValue;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision>;
}): Promise<ToolAutoReviewGateOutcome> {
  return (async (): Promise<ToolAutoReviewGateOutcome> => {
    try {
      const request = await input.requestFromFunctionCall(
        input.call.name,
        input.call.argumentsJson,
      );
      const authorization = await input.authorize(request);
      if (authorization.kind !== "need-approval") {
        return { kind: "manual" };
      }
      return resolveToolAutoReviewGate(
        input.approvalLevel,
        input.reviewToolApproval,
        buildToolAutoReviewInput({
          toolName: input.call.name,
          argumentsJson: input.call.argumentsJson,
          hostApprovalContext: { kind: "tool", request: authorization.approval },
          toolDefinitions: input.toolDefinitions,
        }),
      );
    } catch {
      return { kind: "manual" };
    }
  })();
}
