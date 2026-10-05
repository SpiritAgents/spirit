import type { JsonValue, ToolApprovalPrompt } from "../ports.js";

export type SessionApprovalLevel = "default" | "auto-approval" | "bypass-approval";

export interface ToolAutoReviewInput {
  toolName: string;
  argumentsJson: string;
  inputSchema?: JsonValue;
  targetMcpToolSchema?: JsonValue;
  hostApprovalContext: ToolApprovalPrompt;
}

export interface ToolAutoReviewResult {
  allow: boolean;
  reason: string;
}

export type ToolAutoReviewer = (
  input: ToolAutoReviewInput,
) => Promise<ToolAutoReviewResult | undefined>;

export type ToolAutoReviewGateOutcome =
  | { kind: "manual" }
  | { kind: "allowed" }
  | { kind: "blocked"; reason: string };
