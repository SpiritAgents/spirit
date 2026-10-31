import type {
  PendingAssistantAux,
  PendingMcpResource,
  PendingToolApprovalSnapshot,
} from "../types.js";
import type { PermissionMemoryTarget, ToolApprovalPrompt } from "@spiritagent/agent-core";
import type { ApprovalLevel } from "@spiritagent/host-internal/approval-level";
import type { DesktopToolRequest } from "./contracts.js";
import {
  fileContentPreviewForApprovalRequest,
  fileDiffPreviewsForApprovalRequest,
} from "../lib/approval-file-previews.js";
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

function normalizeAutomationApprovalLevel(level: string): ApprovalLevel {
  return level === "auto-approval" || level === "bypass-approval" ? level : "default";
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
  // A hook ask carries the host's structured request when the authorization also required
  // approval, so the card renders the same command / file previews as a direct tool approval.
  const structuredRequest = input.prompt.request;
  const shellCommand = structuredRequest?.kind === "shell" ? structuredRequest.command : undefined;
  const mcpToolCallArgumentsJson =
    structuredRequest?.kind === "lazy_tool_call" &&
    structuredRequest.provider === "mcp" &&
    structuredRequest.arguments !== undefined
      ? JSON.stringify(structuredRequest.arguments, null, 2)
      : undefined;
  const fileDiffPreviews = structuredRequest
    ? fileDiffPreviewsForApprovalRequest(structuredRequest)
    : undefined;
  const fileContentPreview = structuredRequest
    ? fileContentPreviewForApprovalRequest(structuredRequest)
    : undefined;
  const hookMessage =
    input.prompt.kind === "hook" ? input.prompt.message?.trim() || undefined : undefined;
  const automationApprovalLevel =
    structuredRequest?.kind === "create_automation"
      ? normalizeAutomationApprovalLevel(structuredRequest.approvalLevel)
      : undefined;
  return {
    toolName: hookShellReason ?? view.title,
    prompt: view.body,
    ...(shellCommand !== undefined ? { shellCommand } : {}),
    ...(mcpToolCallArgumentsJson !== undefined ? { mcpToolCallArgumentsJson } : {}),
    ...(fileDiffPreviews !== undefined ? { fileDiffPreviews } : {}),
    ...(fileContentPreview !== undefined ? { fileContentPreview } : {}),
    ...(hookMessage !== undefined ? { hookMessage } : {}),
    ...(automationApprovalLevel !== undefined ? { automationApprovalLevel } : {}),
    ...(input.rememberTarget !== undefined ? { rememberTarget: input.rememberTarget } : {}),
    ...(typeof input.subagentSessionId === "string" && input.subagentSessionId.trim()
      ? { subagentSessionId: input.subagentSessionId.trim() }
      : {}),
    ...(typeof input.autoReviewBlockReason === "string" && input.autoReviewBlockReason.trim()
      ? { autoReviewBlockReason: input.autoReviewBlockReason.trim() }
      : {}),
  };
}
