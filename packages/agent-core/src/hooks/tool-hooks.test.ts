import assert from "node:assert/strict";
import { test } from "vitest";

import {
  postHookToolInputFromPreGate,
  resolveApprovalGateAfterAuthorize,
  runPreToolUseGate,
} from "./tool-hooks.js";
import { HookDeniedError } from "./errors.js";
import type { HookRunner } from "./types.js";

const GREP_APPROVAL = {
  kind: "tool",
  request: { kind: "shell", command: "grep x", terminal: "zsh" },
} as const;

test("resolveApprovalGateAfterAuthorize keeps host approval when hook allows", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: "ready", request: { name: "grep" } },
    {
      kind: "need-approval",
      approval: { kind: "shell", command: "grep x", terminal: "zsh" },
    },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: { prompt: GREP_APPROVAL, rememberTarget: undefined },
  });
});

test("resolveApprovalGateAfterAuthorize keeps host approval without hook bypass", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: "ready", request: { name: "grep" } },
    {
      kind: "need-approval",
      approval: { kind: "shell", command: "grep x", terminal: "zsh" },
    },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: { prompt: GREP_APPROVAL, rememberTarget: undefined },
  });
});

test("resolveApprovalGateAfterAuthorize prefers hook ask prompt", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "grep" },
      prompt: { kind: "hook", message: "hook says ask" },
    },
    { kind: "allowed" },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: { prompt: { kind: "hook", message: "hook says ask" }, rememberTarget: undefined },
  });
});

test("resolveApprovalGateAfterAuthorize keeps hook ask prompt when both hook and allowlist ask", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "grep" },
      prompt: { kind: "hook", message: "hook says ask" },
    },
    {
      kind: "need-approval",
      approval: { kind: "shell", command: "grep x", terminal: "zsh" },
      rememberTarget: { kind: "shell", command: "grep x" },
    },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: {
      // The hook keeps its message, and the host's structured request rides along so hosts
      // can render the same rich approval form (command block / file previews).
      prompt: {
        kind: "hook",
        message: "hook says ask",
        request: { kind: "shell", command: "grep x", terminal: "zsh" },
      },
      rememberTarget: { kind: "shell", command: "grep x" },
    },
  });
});

test("resolveApprovalGateAfterAuthorize attaches a described request when the host allows", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "read_file" },
      prompt: { kind: "hook", message: "hook wants a look" },
    },
    { kind: "allowed" },
    {
      kind: "read_path",
      operation: "read_file",
      path: "src/index.ts",
      fileContentPreview: { path: "src/index.ts", content: "export {};\n" },
    },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: {
      prompt: {
        kind: "hook",
        message: "hook wants a look",
        request: {
          kind: "read_path",
          operation: "read_file",
          path: "src/index.ts",
          fileContentPreview: { path: "src/index.ts", content: "export {};\n" },
        },
      },
      rememberTarget: undefined,
    },
  });
});

test("resolveApprovalGateAfterAuthorize prefers the authorization request over the described one", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "delete_file" },
      prompt: { kind: "hook", message: "confirm" },
    },
    {
      kind: "need-approval",
      approval: { kind: "delete_file", path: "tmp/a.log" },
    },
    { kind: "delete_file", path: "tmp/stale.log" },
  );
  assert.deepEqual(gate, {
    kind: "needs-approval",
    gate: {
      prompt: {
        kind: "hook",
        message: "confirm",
        request: { kind: "delete_file", path: "tmp/a.log" },
      },
      rememberTarget: undefined,
    },
  });
});

test("resolveApprovalGateAfterAuthorize attaches a file preview request to the hook prompt", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "delete_file" },
      prompt: { kind: "hook", message: "confirm the cleanup" },
    },
    {
      kind: "need-approval",
      approval: {
        kind: "delete_file",
        path: "tmp/scratch.log",
        fileDiffPreview: {
          path: "tmp/scratch.log",
          original: "seed\n",
          modified: "",
          operation: "delete",
        },
      },
    },
  );
  if (!gate || gate.kind !== "needs-approval") {
    throw new Error("expected a needs-approval gate");
  }
  assert.equal(gate.gate.prompt.kind, "hook");
  if (gate.gate.prompt.kind !== "hook") {
    return;
  }
  assert.equal(gate.gate.prompt.request?.kind, "delete_file");
  assert.equal(
    gate.gate.prompt.request.kind === "delete_file"
      ? gate.gate.prompt.request.fileDiffPreview?.operation
      : undefined,
    "delete",
  );
});

test("resolveApprovalGateAfterAuthorize denies on allowlist deny even when hook allows", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: "ready", request: { name: "shell" } },
    { kind: "denied", reason: "shell is denied by rule" },
  );
  assert.deepEqual(gate, { kind: "denied", reason: "shell is denied by rule" });
});

test("resolveApprovalGateAfterAuthorize denies on allowlist deny when hook asks", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    {
      kind: "needs-approval",
      request: { name: "shell" },
      prompt: { kind: "hook", message: "hook says ask" },
    },
    { kind: "denied", reason: "shell is denied by rule" },
  );
  assert.deepEqual(gate, { kind: "denied", reason: "shell is denied by rule" });
});

test("resolveApprovalGateAfterAuthorize proceeds when hook and allowlist both allow", () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: "ready", request: { name: "grep" } },
    { kind: "allowed" },
  );
  assert.equal(gate, null);
});

test("runPreToolUseGate maps hook ask to needs-approval", async () => {
  const runner: HookRunner = {
    runSessionStart: async () => {
      throw new Error("unused");
    },
    runSessionEnd: async () => {
      throw new Error("unused");
    },
    runSubmitPrompt: async () => {
      throw new Error("unused");
    },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: "ask",
      userMessage: "confirm grep",
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => {
      throw new Error("unused");
    },
    runSubagentStart: async () => {
      throw new Error("unused");
    },
    runSubagentEnd: async () => {
      throw new Error("unused");
    },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: "s1",
          conversationPath: null,
          workspaceRoot: "/w",
          model: "m",
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: "grep" }),
        },
      },
    } as never,
    { id: "tc1", name: "grep", argumentsJson: '{"pattern":"hook"}' },
    { name: "grep" },
  );

  assert.equal(gate.kind, "needs-approval");
  if (gate.kind === "needs-approval") {
    assert.deepEqual(gate.prompt, { kind: "hook", message: "confirm grep" });
  }
});

test("runPreToolUseGate maps hook ask without message to an empty hook prompt", async () => {
  const runner: HookRunner = {
    runSessionStart: async () => {
      throw new Error("unused");
    },
    runSessionEnd: async () => {
      throw new Error("unused");
    },
    runSubmitPrompt: async () => {
      throw new Error("unused");
    },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: "ask",
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => {
      throw new Error("unused");
    },
    runSubagentStart: async () => {
      throw new Error("unused");
    },
    runSubagentEnd: async () => {
      throw new Error("unused");
    },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: "s1",
          conversationPath: null,
          workspaceRoot: "/w",
          model: "m",
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: "grep" }),
        },
      },
    } as never,
    { id: "tc1", name: "grep", argumentsJson: "{}" },
    { name: "grep" },
  );

  assert.equal(gate.kind, "needs-approval");
  if (gate.kind === "needs-approval") {
    assert.deepEqual(gate.prompt, { kind: "hook", message: undefined });
  }
});

test("runPreToolUseGate maps hook allow to ready without bypassing host approval", async () => {
  const runner: HookRunner = {
    runSessionStart: async () => {
      throw new Error("unused");
    },
    runSessionEnd: async () => {
      throw new Error("unused");
    },
    runSubmitPrompt: async () => {
      throw new Error("unused");
    },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: "allow",
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => {
      throw new Error("unused");
    },
    runSubagentStart: async () => {
      throw new Error("unused");
    },
    runSubagentEnd: async () => {
      throw new Error("unused");
    },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: "s1",
          conversationPath: null,
          workspaceRoot: "/w",
          model: "m",
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: "shell" }),
        },
      },
    } as never,
    { id: "tc1", name: "shell", argumentsJson: '{"command":"echo hi"}' },
    { name: "shell" },
  );

  assert.equal(gate.kind, "ready");
  if (gate.kind === "ready") {
    // The hook-allow bypass flag was removed: a ready gate must carry no
    // approval-skipping marker, only the kind and the tool request.
    assert.deepEqual(Object.keys(gate).sort(), ["kind", "request"]);
  }
});

test("runPreToolUseGate maps hook deny to denied", async () => {
  const runner: HookRunner = {
    runSessionStart: async () => {
      throw new Error("unused");
    },
    runSessionEnd: async () => {
      throw new Error("unused");
    },
    runSubmitPrompt: async () => {
      throw new Error("unused");
    },
    runPreToolUse: async () => ({
      records: [],
      denied: true,
      permission: "deny",
      userMessage: "blocked",
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => {
      throw new Error("unused");
    },
    runSubagentStart: async () => {
      throw new Error("unused");
    },
    runSubagentEnd: async () => {
      throw new Error("unused");
    },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: "s1",
          conversationPath: null,
          workspaceRoot: "/w",
          model: "m",
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: "grep" }),
        },
      },
    } as never,
    { id: "tc1", name: "grep", argumentsJson: "{}" },
    { name: "grep" },
  );

  assert.equal(gate.kind, "denied");
  if (gate.kind === "denied") {
    assert.ok(gate.error instanceof HookDeniedError);
  }
});

test("runPreToolUseGate preserves effectiveToolInput from hook updatedInput", async () => {
  const runner: HookRunner = {
    runSessionStart: async () => {
      throw new Error("unused");
    },
    runSessionEnd: async () => {
      throw new Error("unused");
    },
    runSubmitPrompt: async () => {
      throw new Error("unused");
    },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: { path: "rewritten.md" },
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => {
      throw new Error("unused");
    },
    runSubagentStart: async () => {
      throw new Error("unused");
    },
    runSubagentEnd: async () => {
      throw new Error("unused");
    },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: "s1",
          conversationPath: null,
          workspaceRoot: "/w",
          model: "m",
        },
        toolExecutor: {
          requestFromFunctionCall: async (_name: string, argumentsJson: string) => ({
            name: "read_file",
            ...(JSON.parse(argumentsJson) as Record<string, unknown>),
          }),
        },
      },
    } as never,
    { id: "tc1", name: "read_file", argumentsJson: '{"path":"original.md"}' },
    { name: "read_file", path: "original.md" },
  );

  assert.equal(gate.kind, "ready");
  if (gate.kind === "ready") {
    assert.deepEqual(gate.effectiveToolInput, { path: "rewritten.md" });
    assert.equal((gate.request as { path?: string }).path, "rewritten.md");
  }
});

test("postHookToolInputFromPreGate prefers effectiveToolInput", () => {
  const toolInput = postHookToolInputFromPreGate(
    {
      kind: "ready",
      request: { name: "grep" },
      effectiveToolInput: { pattern: "hooked" },
    },
    '{"pattern":"original"}',
  );
  assert.deepEqual(toolInput, { pattern: "hooked" });
});
