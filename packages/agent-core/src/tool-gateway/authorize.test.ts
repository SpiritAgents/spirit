import assert from "node:assert/strict";
import { test } from "vitest";

import {
  authorizeLazyToolGatewayRequest,
  mcpToolCallSkipsApproval,
  resolveMcpToolCallApprovalAnnotations,
} from "./authorize.js";
import { TOOL_CALL_TOOL_NAME, TOOL_DESCRIBE_TOOL_NAME } from "./definitions.js";
import type { LazyToolGatewayToolRequest } from "./types.js";

function lazyRequest(name: string, args: Record<string, unknown>): LazyToolGatewayToolRequest {
  return {
    kind: "lazyToolGateway",
    name,
    argumentsJson: JSON.stringify(args),
  };
}

test("authorizeLazyToolGatewayRequest allows tool_describe without approval", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_DESCRIBE_TOOL_NAME, { provider: "mcp", server: "github", tool: "search" }),
    "default",
  );
  assert.equal(decision.kind, "allowed");
});

test("authorizeLazyToolGatewayRequest requires approval for tool_call under default", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_CALL_TOOL_NAME, {
      provider: "mcp",
      server: "msftlearn",
      tool: "microsoft_docs_search",
      arguments: { query: "azure" },
    }),
    "default",
  );
  assert.equal(decision.kind, "need-approval");
  if (decision.kind === "need-approval") {
    assert.match(decision.prompt, /msftlearn/u);
    assert.match(decision.prompt, /microsoft_docs_search/u);
    // No MCP permission domain in v1: lazy-gateway approvals carry no remember target.
    assert.equal(decision.rememberTarget, undefined);
  }
});

test("authorizeLazyToolGatewayRequest requires approval for tool_call under auto-approval", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_CALL_TOOL_NAME, {
      provider: "mcp",
      server: "msftlearn",
      tool: "microsoft_docs_search",
    }),
    "auto-approval",
  );
  assert.equal(decision.kind, "need-approval");
});

test("authorizeLazyToolGatewayRequest requires approval for built-in tool_call under default", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_CALL_TOOL_NAME, {
      provider: "built-in",
      server: "desktop",
      tool: "create_automation",
      arguments: { overview: "Daily summary." },
    }),
    "default",
  );
  assert.equal(decision.kind, "need-approval");
  if (decision.kind === "need-approval") {
    assert.match(decision.prompt, /built-in tool_call/u);
    assert.match(decision.prompt, /create_automation/u);
    assert.equal(decision.rememberTarget, undefined);
  }
});

test("authorizeLazyToolGatewayRequest allows tool_call under bypass-approval", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_CALL_TOOL_NAME, {
      provider: "mcp",
      server: "msftlearn",
      tool: "microsoft_docs_search",
    }),
    "bypass-approval",
  );
  assert.equal(decision.kind, "allowed");
});

test("mcpToolCallSkipsApproval requires explicit closed-world read-only hints", () => {
  assert.equal(mcpToolCallSkipsApproval(undefined), false);
  assert.equal(mcpToolCallSkipsApproval({ readOnlyHint: true }), false);
  assert.equal(mcpToolCallSkipsApproval({ readOnlyHint: true, openWorldHint: true }), false);
  assert.equal(mcpToolCallSkipsApproval({ readOnlyHint: false, openWorldHint: false }), false);
  assert.equal(mcpToolCallSkipsApproval({ readOnlyHint: true, openWorldHint: false }), true);
});

test("authorizeLazyToolGatewayRequest allows closed-world read-only MCP tool_call", () => {
  const request = lazyRequest(TOOL_CALL_TOOL_NAME, {
    provider: "mcp",
    server: "memory",
    tool: "get_note",
  });
  for (const level of ["default", "auto-approval"] as const) {
    const decision = authorizeLazyToolGatewayRequest(request, level, {
      readOnlyHint: true,
      openWorldHint: false,
    });
    assert.equal(decision.kind, "allowed", level);
  }
});

test("authorizeLazyToolGatewayRequest still asks for open-world or incomplete MCP hints", () => {
  const request = lazyRequest(TOOL_CALL_TOOL_NAME, {
    provider: "mcp",
    server: "search",
    tool: "web_search",
  });
  const cases = [
    undefined,
    { readOnlyHint: true },
    { readOnlyHint: true, openWorldHint: true },
    { readOnlyHint: false, openWorldHint: false },
  ];
  for (const annotations of cases) {
    const decision = authorizeLazyToolGatewayRequest(request, "default", annotations);
    assert.equal(decision.kind, "need-approval");
  }
});

test("authorizeLazyToolGatewayRequest ignores MCP annotations on built-in tool_call", () => {
  const decision = authorizeLazyToolGatewayRequest(
    lazyRequest(TOOL_CALL_TOOL_NAME, {
      provider: "built-in",
      server: "desktop",
      tool: "create_automation",
      arguments: { overview: "Daily summary." },
    }),
    "default",
    { readOnlyHint: true, openWorldHint: false },
  );
  assert.equal(decision.kind, "need-approval");
});

test("resolveMcpToolCallApprovalAnnotations looks up MCP tool_call only", () => {
  const lookup = (server: string, tool: string) =>
    server === "memory" && tool === "get_note"
      ? { readOnlyHint: true, openWorldHint: false }
      : undefined;
  assert.deepEqual(
    resolveMcpToolCallApprovalAnnotations(
      lazyRequest(TOOL_CALL_TOOL_NAME, { provider: "mcp", server: "memory", tool: "get_note" }),
      lookup,
    ),
    { readOnlyHint: true, openWorldHint: false },
  );
  assert.equal(
    resolveMcpToolCallApprovalAnnotations(
      lazyRequest(TOOL_DESCRIBE_TOOL_NAME, { provider: "mcp", server: "memory", tool: "get_note" }),
      lookup,
    ),
    undefined,
  );
  assert.equal(
    resolveMcpToolCallApprovalAnnotations(
      lazyRequest(TOOL_CALL_TOOL_NAME, {
        provider: "built-in",
        server: "desktop",
        tool: "create_automation",
      }),
      lookup,
    ),
    undefined,
  );
});
