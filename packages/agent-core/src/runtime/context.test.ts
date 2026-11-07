import assert from "node:assert/strict";
import { test } from "vitest";

import { SubmitPromptHookDeniedError } from "../hooks/errors.js";
import type { HookRunner, HookRunResult } from "../hooks/types.js";
import { prepareSubmittedUserTurn } from "./context.js";

function mockResult(overrides: Partial<HookRunResult> = {}): HookRunResult {
  return {
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
    ...overrides,
  };
}

test("prepareSubmittedUserTurn throws SubmitPromptHookDeniedError when hook denies", async () => {
  const hookRunner: HookRunner = {
    runSessionStart: async () => mockResult(),
    runSessionEnd: async () => mockResult(),
    runSubmitPrompt: async () =>
      mockResult({
        denied: true,
        userMessage: "blocked prompt",
        followupMessage: "try later",
      }),
    runPreToolUse: async () => mockResult(),
    runPostToolUse: async () => mockResult(),
    runSubagentStart: async () => mockResult(),
    runSubagentEnd: async () => mockResult(),
  };

  const runtime = {
    options: {
      hookRunner,
      hookSessionContext: {
        sessionId: "s1",
        conversationPath: null,
        workspaceRoot: "/w",
        model: "m",
      },
      createToolAgentState: (messages: unknown[], userInput: string) => ({ messages, userInput }),
    },
    historyStore: [] as Array<{ role: string; content: unknown }>,
    pendingUserTurnStore: undefined as string | undefined,
    takePendingImages: () => [] as string[],
    takePendingMcpResources: () => [],
    recordContextMessage: () => {},
  };

  await assert.rejects(
    () => prepareSubmittedUserTurn(runtime as never, "hello", []),
    (error: unknown) => {
      assert.ok(error instanceof SubmitPromptHookDeniedError);
      assert.equal(error.denialMessage, "blocked prompt");
      assert.equal(error.followupMessage, "try later");
      return true;
    },
  );
});

test("prepareSubmittedUserTurn carries audio and PDF attachments as typed content parts", async () => {
  const runtime = {
    options: {
      createToolAgentState: (messages: unknown[], userInput: string) => ({ messages, userInput }),
    },
    historyStore: [] as Array<{ role: string; content: unknown }>,
    pendingUserTurnStore: undefined,
    takePendingImages: () => [],
    takePendingMcpResources: () => [],
    recordContextMessage: () => {
      throw new Error("binary assets must not become text context");
    },
  };

  await prepareSubmittedUserTurn(
    runtime as never,
    "review",
    [],
    [
      { kind: "audio", path: "voice.mp3", attachedAtUnixMs: 1 },
      { kind: "document", path: "paper.pdf", attachedAtUnixMs: 1 },
    ],
  );

  const content = runtime.historyStore.at(-1)?.content as Array<Record<string, unknown>>;
  assert.match(String(content[0]?.text), /review$/);
  assert.deepEqual(content.slice(1), [
    { type: "audio", path: "voice.mp3" },
    { type: "document", path: "paper.pdf" },
  ]);
});
