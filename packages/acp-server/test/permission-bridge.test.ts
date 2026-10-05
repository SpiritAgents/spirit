import assert from "node:assert/strict";
import { test } from "vitest";

import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import type { JsonValue, RuntimePendingApproval } from "@spiritagent/agent-core";

import { handleApprovalRequest } from "../src/permission-bridge.js";
import { normalizeModeId, AVAILABLE_MODES } from "../src/types.js";

// --- normalizeModeId ---

test("normalizeModeId: valid modes pass through", () => {
  assert.equal(normalizeModeId("agent"), "agent");
  assert.equal(normalizeModeId("plan"), "plan");
  assert.equal(normalizeModeId("ask"), "ask");
  assert.equal(normalizeModeId("debug"), "debug");
});

test("normalizeModeId: invalid mode falls back to agent", () => {
  assert.equal(normalizeModeId("unknown"), "agent");
  assert.equal(normalizeModeId(""), "agent");
  assert.equal(normalizeModeId("architect"), "agent");
});

// --- AVAILABLE_MODES ---

test("AVAILABLE_MODES has 4 modes", () => {
  assert.equal(AVAILABLE_MODES.length, 4);
});

test("AVAILABLE_MODES contains agent, plan, ask, debug", () => {
  const ids = AVAILABLE_MODES.map((m) => m.id);
  assert.ok(ids.includes("agent"));
  assert.ok(ids.includes("plan"));
  assert.ok(ids.includes("ask"));
  assert.ok(ids.includes("debug"));
});

test("AVAILABLE_MODES each mode has id, name, description", () => {
  for (const mode of AVAILABLE_MODES) {
    assert.ok(typeof mode.id === "string");
    assert.ok(typeof mode.name === "string");
    assert.ok(typeof mode.description === "string");
    assert.ok(mode.id.length > 0);
    assert.ok(mode.name.length > 0);
    assert.ok(mode.description.length > 0);
  }
});

// --- handleApprovalRequest ---

function stubConnection(
  response: schema.RequestPermissionResponse,
  captured?: { request?: schema.RequestPermissionRequest },
): AgentSideConnection {
  return {
    requestPermission: async (request: schema.RequestPermissionRequest) => {
      if (captured) {
        captured.request = request;
      }
      return response;
    },
  } as unknown as AgentSideConnection;
}

function shellApproval(
  rememberTarget?: RuntimePendingApproval<JsonValue>["rememberTarget"],
): RuntimePendingApproval<JsonValue> {
  return {
    prompt: {
      kind: "tool",
      request: { kind: "shell", command: "npm test", reason: "Run `npm test`?", terminal: "zsh" },
    },
    request: {},
    toolName: "shell",
    ...(rememberTarget !== undefined ? { rememberTarget } : {}),
  };
}

test("handleApprovalRequest: allow maps to a plain allow decision", async () => {
  const decision = await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "selected", optionId: "allow" } }),
    "sess_1",
    shellApproval({ kind: "shell", command: "npm test" }),
  );
  assert.deepEqual(decision, { kind: "allow" });
});

test("handleApprovalRequest: allow-always remembers for the session only", async () => {
  const decision = await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "selected", optionId: "allow-always" } }),
    "sess_1",
    shellApproval({ kind: "shell", command: "npm test" }),
  );
  // ACP has no third allow-kind option, so config persistence is not exposed.
  assert.deepEqual(decision, { kind: "allow", remember: "session" });
});

test("handleApprovalRequest: reject and cancelled map to deny", async () => {
  const rejected = await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "selected", optionId: "reject" } }),
    "sess_1",
    shellApproval(),
  );
  assert.equal(rejected.kind, "deny");

  const cancelled = await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "cancelled" } }),
    "sess_1",
    shellApproval(),
  );
  assert.equal(cancelled.kind, "deny");
});

test("handleApprovalRequest: allow-always option requires a remember target", async () => {
  const withTarget: { request?: schema.RequestPermissionRequest } = {};
  await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "selected", optionId: "allow" } }, withTarget),
    "sess_1",
    shellApproval({ kind: "shell", command: "npm test" }),
  );
  assert.deepEqual(
    withTarget.request?.options.map((option) => option.optionId),
    ["allow", "allow-always", "reject"],
  );

  const withoutTarget: { request?: schema.RequestPermissionRequest } = {};
  await handleApprovalRequest(
    stubConnection({ outcome: { outcome: "selected", optionId: "allow" } }, withoutTarget),
    "sess_1",
    shellApproval(),
  );
  assert.deepEqual(
    withoutTarget.request?.options.map((option) => option.optionId),
    ["allow", "reject"],
  );
});
