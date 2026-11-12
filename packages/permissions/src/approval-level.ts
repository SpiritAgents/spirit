export type { ApprovalLevel } from "@spiritagent/api/approval-level";
import type { ApprovalLevel } from "@spiritagent/api/approval-level";

export function normalizeApprovalLevel(value: unknown): ApprovalLevel {
  if (value === "bypass-approval") {
    return "bypass-approval";
  }
  if (value === "auto-approval") {
    return "auto-approval";
  }
  return "default";
}
