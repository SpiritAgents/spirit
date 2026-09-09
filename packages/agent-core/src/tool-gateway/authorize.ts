import type { McpToolApprovalAnnotations } from "../mcp/types.js";
import type { AuthorizationDecision } from "../ports.js";
import { TOOL_CALL_TOOL_NAME, TOOL_DESCRIBE_TOOL_NAME } from "./definitions.js";
import { parseLazyToolGatewayArguments } from "./parse.js";
import { LAZY_TOOL_PROVIDER_BUILT_IN, LAZY_TOOL_PROVIDER_MCP } from "./types.js";
import type { LazyToolCallRequest, LazyToolGatewayToolRequest } from "./types.js";

export type LazyToolGatewayApprovalLevel = "default" | "auto-approval" | "bypass-approval";

export function mcpToolCallSkipsApproval(
  annotations: McpToolApprovalAnnotations | undefined,
): boolean {
  return annotations?.readOnlyHint === true && annotations?.openWorldHint === false;
}

export function resolveMcpToolCallApprovalAnnotations(
  request: LazyToolGatewayToolRequest,
  lookup: (server: string, tool: string) => McpToolApprovalAnnotations | undefined,
): McpToolApprovalAnnotations | undefined {
  if (request.name !== TOOL_CALL_TOOL_NAME) {
    return undefined;
  }
  try {
    const parsed = parseLazyToolGatewayArguments(request.name, request.argumentsJson);
    if (parsed.provider !== LAZY_TOOL_PROVIDER_MCP) {
      return undefined;
    }
    return lookup(parsed.server, parsed.tool);
  } catch {
    return undefined;
  }
}

export function authorizeLazyToolGatewayRequest(
  request: LazyToolGatewayToolRequest,
  approvalLevel: LazyToolGatewayApprovalLevel,
  mcpAnnotations?: McpToolApprovalAnnotations,
): AuthorizationDecision {
  if (request.name === TOOL_DESCRIBE_TOOL_NAME) {
    return { kind: "allowed" };
  }

  if (request.name !== TOOL_CALL_TOOL_NAME) {
    return { kind: "allowed" };
  }

  if (approvalLevel === "bypass-approval") {
    return { kind: "allowed" };
  }

  const parsed = parseLazyToolGatewayArguments(
    request.name,
    request.argumentsJson,
  ) as LazyToolCallRequest;
  if (parsed.provider === LAZY_TOOL_PROVIDER_MCP && mcpToolCallSkipsApproval(mcpAnnotations)) {
    return { kind: "allowed" };
  }
  // There is no MCP permission domain in v1, so lazy-gateway approvals offer no "remember" target.
  return {
    kind: "need-approval",
    prompt: buildLazyToolCallApprovalPrompt(parsed),
  };
}

function buildLazyToolCallApprovalPrompt(request: LazyToolCallRequest): string {
  const argsText =
    request.arguments === undefined ? "(none)" : JSON.stringify(request.arguments, null, 2);
  if (request.provider === LAZY_TOOL_PROVIDER_BUILT_IN) {
    return (
      `High-risk tool call: built-in tool_call\n` +
      `Server: ${request.server}\n` +
      `Tool: ${request.tool}\n` +
      `Arguments:\n${argsText}`
    );
  }
  if (request.provider !== LAZY_TOOL_PROVIDER_MCP) {
    return (
      `High-risk tool call: tool_call\n` +
      `provider: ${request.provider}\n` +
      `Server: ${request.server}\n` +
      `Tool: ${request.tool}\n` +
      `Arguments:\n${argsText}`
    );
  }
  return (
    `High-risk tool call: MCP tool_call\n` +
    `Server: ${request.server}\n` +
    `Tool: ${request.tool}\n` +
    `Arguments:\n${argsText}`
  );
}
