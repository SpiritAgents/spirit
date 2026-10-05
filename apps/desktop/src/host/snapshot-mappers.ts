import type {
  PendingAssistantAux,
  PendingMcpResource,
  PendingToolApprovalSnapshot,
} from "../types.js";
import type { PermissionMemoryTarget, ToolApprovalPrompt } from "@spiritagent/agent-core";
import type { DesktopToolRequest } from "./contracts.js";
import { buildApprovalPromptView } from "../lib/approval-prompt.js";
import i18n from "../lib/i18n-host.js";
import { reasonForShellTool } from "./message-ordering.js";

export function mapPendingMcpResources(
  resources: readonly PendingMcpResource[],
): PendingMcpResource[] {
  return resources.map((resource) => ({
    server: resource.server,
    displayName: resource.displayName,
    uri: resource.uri,
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    readAtUnixMs: resource.readAtUnixMs,
    content: resource.content,
  }));
}

export function mapPendingAuxState(
  pendingAux: PendingAssistantAux | undefined,
): PendingAssistantAux | undefined {
  if (!pendingAux) {
    return undefined;
  }
  return {
    kind: pendingAux.kind,
    statusText: pendingAux.statusText,
    ...(pendingAux.detailText ? { detailText: pendingAux.detailText } : {}),
  };
}

export function mapPendingToolApproval(input: {
  toolName: string;
  request: DesktopToolRequest;
  prompt: ToolApprovalPrompt;
  rememberTarget?: PermissionMemoryTarget;
  subagentSessionId?: string;
  autoReviewBlockReason?: string;
}): PendingToolApprovalSnapshot {
  const view = buildApprovalPromptView(input.prompt, input.toolName, i18n.t);
  // A hook gate replaces the host prompt but keeps the shell reason as the card title.
  const hookShellReason =
    input.prompt.kind === "hook" ? reasonForShellTool(input.toolName, input.request) : undefined;
  return {
    toolName: hookShellReason ?? view.title,
    prompt: view.body,
    ...(input.rememberTarget !== undefined ? { rememberTarget: input.rememberTarget } : {}),
    ...(typeof input.subagentSessionId === "string" && input.subagentSessionId.trim()
      ? { subagentSessionId: input.subagentSessionId.trim() }
      : {}),
    ...(typeof input.autoReviewBlockReason === "string" && input.autoReviewBlockReason.trim()
      ? { autoReviewBlockReason: input.autoReviewBlockReason.trim() }
      : {}),
  };
}
