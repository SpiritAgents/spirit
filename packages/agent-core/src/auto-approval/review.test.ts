import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveToolAutoReviewGate } from "./gate.js";
import {
  applyAutoReviewToApprovalGate,
  prefetchAutoReviewForToolCallIfNeeded,
} from "../runtime/auto-approval-integration.js";
import { buildAutoApprovalReviewPrompt } from "./prompt.js";
import { normalizeAutoApprovalReviewResult } from "./run-review.js";
import { resolveToolInputSchema } from "./resolve-tool-schema.js";
import type { ToolAutoReviewInput } from "./types.js";

const sampleInput: ToolAutoReviewInput = {
  toolName: "shell",
  argumentsJson: '{"command":"echo hi","reason":"test"}',
  inputSchema: { type: "object", properties: { command: { type: "string" } } },
  hostApprovalContext: {
    kind: "tool",
    request: { kind: "shell", command: "echo hi", terminal: "zsh" },
  },
};

test("buildAutoApprovalReviewPrompt includes schema, context, and examples", () => {
  const prompt = buildAutoApprovalReviewPrompt(sampleInput);
  assert.match(prompt, /tool_name/u);
  assert.match(prompt, /shell/u);
  assert.match(prompt, /input_schema/u);
  assert.match(prompt, /host_approval_context/u);
  assert.match(prompt, /git push to main/u);
  assert.match(prompt, /npm install/u);
});

test("resolveToolInputSchema reads OpenAI function definitions", () => {
  const schema = resolveToolInputSchema(
    [
      {
        type: "function",
        function: {
          name: "shell",
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      },
    ],
    "shell",
  );
  assert.ok(schema);
  const properties = schema.properties;
  assert.ok(properties && typeof properties === "object" && !Array.isArray(properties));
  assert.deepEqual(properties.command, { type: "string" });
});

test("normalizeAutoApprovalReviewResult validates output", () => {
  assert.deepEqual(normalizeAutoApprovalReviewResult({ allow: true, reason: "read-only" }), {
    allow: true,
    reason: "read-only",
  });
  assert.equal(normalizeAutoApprovalReviewResult({ allow: true, reason: "  " }), undefined);
  assert.equal(normalizeAutoApprovalReviewResult({ allow: "yes", reason: "x" }), undefined);
});

test("resolveToolAutoReviewGate bypasses when approval level is not auto-approval", async () => {
  const gate = await resolveToolAutoReviewGate(
    "default",
    async () => ({ allow: true, reason: "x" }),
    sampleInput,
  );
  assert.equal(gate.kind, "manual");
});

test("resolveToolAutoReviewGate allows when reviewer returns allow", async () => {
  const gate = await resolveToolAutoReviewGate(
    "auto-approval",
    async () => ({ allow: true, reason: "safe read" }),
    sampleInput,
  );
  assert.equal(gate.kind, "allowed");
});

test("resolveToolAutoReviewGate blocks when reviewer returns deny", async () => {
  const gate = await resolveToolAutoReviewGate(
    "auto-approval",
    async () => ({ allow: false, reason: "force push" }),
    sampleInput,
  );
  assert.deepEqual(gate, { kind: "blocked", reason: "force push" });
});

test("resolveToolAutoReviewGate falls back to manual when reviewer is unavailable", async () => {
  const gate = await resolveToolAutoReviewGate("auto-approval", async () => undefined, sampleInput);
  assert.equal(gate.kind, "manual");
});

test("applyAutoReviewToApprovalGate skips auto review when hook requested approval", async () => {
  const gate = await applyAutoReviewToApprovalGate(
    "auto-approval",
    async () => ({ allow: true, reason: "would allow" }),
    [],
    { name: "grep", argumentsJson: "{}" },
    { prompt: { kind: "hook", message: "hook confirmation required" }, rememberTarget: undefined },
    {
      kind: "needs-approval",
      request: { name: "grep" },
      prompt: { kind: "hook", message: "hook confirmation required" },
    },
  );
  assert.deepEqual(gate, {
    prompt: { kind: "hook", message: "hook confirmation required" },
    rememberTarget: undefined,
  });
});

test("prefetchAutoReviewForToolCallIfNeeded starts review and skips unchanged fingerprint", async () => {
  let reviewCalls = 0;
  const reviewCache = new Map();
  const fingerprints = new Map();
  const call = {
    id: "call_1",
    name: "shell",
    argumentsJson: '{"command":"echo a","reason":"t"}',
  };
  const canonical = JSON.stringify({ command: "echo a", reason: "t" });

  prefetchAutoReviewForToolCallIfNeeded({
    call,
    canonicalArgumentsJson: canonical,
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: async () => {
      reviewCalls += 1;
      return { allow: true, reason: "ok" };
    },
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async () => ({ name: "shell" }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });

  assert.equal(reviewCache.has("call_1"), true);
  assert.equal(fingerprints.get("call_1"), canonical);

  prefetchAutoReviewForToolCallIfNeeded({
    call,
    canonicalArgumentsJson: canonical,
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: async () => {
      reviewCalls += 1;
      return { allow: true, reason: "ok" };
    },
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async () => ({ name: "shell" }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });

  const first = await reviewCache.get("call_1");
  assert.deepEqual(first, { kind: "allowed" });
  assert.equal(reviewCalls, 1);
});

test("prefetchAutoReviewForToolCallIfNeeded invalidates cache when arguments change", async () => {
  let reviewCalls = 0;
  const reviewedCommands: string[] = [];
  const reviewCache = new Map();
  const fingerprints = new Map();

  prefetchAutoReviewForToolCallIfNeeded({
    call: {
      id: "call_1",
      name: "shell",
      argumentsJson: '{"command":"echo a","reason":"t"}',
    },
    canonicalArgumentsJson: JSON.stringify({ command: "echo a", reason: "t" }),
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: async (input) => {
      reviewCalls += 1;
      reviewedCommands.push(input.argumentsJson);
      return { allow: true, reason: "ok" };
    },
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async (_name, argumentsJson) => ({ name: "shell", argumentsJson }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });

  await reviewCache.get("call_1");

  prefetchAutoReviewForToolCallIfNeeded({
    call: {
      id: "call_1",
      name: "shell",
      argumentsJson: '{"command":"echo b","reason":"t"}',
    },
    canonicalArgumentsJson: JSON.stringify({ command: "echo b", reason: "t" }),
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: async (input) => {
      reviewCalls += 1;
      reviewedCommands.push(input.argumentsJson);
      return { allow: true, reason: "ok" };
    },
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async (_name, argumentsJson) => ({ name: "shell", argumentsJson }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });

  const second = await reviewCache.get("call_1");
  assert.deepEqual(second, { kind: "allowed" });
  assert.equal(reviewCalls, 2);
  assert.ok(reviewedCommands[1]?.includes("echo b"));
});

test("applyAutoReviewToApprovalGate reuses streaming prefetch cache without second reviewer call", async () => {
  let reviewCalls = 0;
  const reviewCache = new Map();
  const fingerprints = new Map();
  const call = {
    id: "call_shell",
    name: "shell",
    argumentsJson: '{"command":"echo hi","reason":"t"}',
  };
  const canonical = JSON.stringify({ command: "echo hi", reason: "t" });
  const reviewer = async () => {
    reviewCalls += 1;
    return { allow: true, reason: "cached" };
  };

  prefetchAutoReviewForToolCallIfNeeded({
    call,
    canonicalArgumentsJson: canonical,
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: reviewer,
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async () => ({ name: "shell" }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });

  const gate = await applyAutoReviewToApprovalGate(
    "auto-approval",
    reviewer,
    [],
    call,
    {
      prompt: {
        kind: "tool",
        request: { kind: "shell", command: "echo hi", terminal: "zsh" },
      },
      rememberTarget: undefined,
    },
    { kind: "ready", request: { name: "shell" } },
    call.id,
    reviewCache,
  );

  assert.equal(gate, null);
  assert.equal(reviewCalls, 1);
});

test("applyAutoReviewToApprovalGate still blocks auto allow when hook ask after prefetch", async () => {
  const reviewCache = new Map();
  const fingerprints = new Map();
  const call = {
    id: "call_shell",
    name: "shell",
    argumentsJson: '{"command":"echo hi","reason":"t"}',
  };

  prefetchAutoReviewForToolCallIfNeeded({
    call,
    canonicalArgumentsJson: JSON.stringify({ command: "echo hi", reason: "t" }),
    argFingerprints: fingerprints,
    approvalLevel: "auto-approval",
    reviewToolApproval: async () => ({ allow: true, reason: "would allow" }),
    toolDefinitions: [],
    reviewCache,
    requestFromFunctionCall: async () => ({ name: "shell" }),
    authorize: async () => ({
      kind: "need-approval",
      approval: { kind: "shell", command: "echo hi", terminal: "zsh" },
    }),
  });
  await reviewCache.get(call.id);

  const gate = await applyAutoReviewToApprovalGate(
    "auto-approval",
    async () => ({ allow: true, reason: "would allow" }),
    [],
    call,
    { prompt: { kind: "hook", message: "hook confirmation required" }, rememberTarget: undefined },
    {
      kind: "needs-approval",
      request: { name: "shell" },
      prompt: { kind: "hook", message: "hook confirmation required" },
    },
    call.id,
    reviewCache,
  );

  assert.deepEqual(gate, {
    prompt: { kind: "hook", message: "hook confirmation required" },
    rememberTarget: undefined,
  });
});
