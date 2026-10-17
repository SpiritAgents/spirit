import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "../ports.js";
import { openAiMessagesToResponsesAiSdkMessages } from "./ai-sdk-message-bridge.js";
import {
  buildApplyPatchToolCallArgumentsJson,
  normalizeApplyPatchToolCallArgumentsJson,
  patchResponsesRequestBodyForApplyPatch,
  prepareApplyPatchRequestBodyStash,
  runWithApplyPatchBridgeContext,
} from "./apply-patch-bridge.js";

const openAiConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "gpt-5.1",
  sdk: "@ai-sdk/openai" as const,
  options: { applyPatch: true },
};

// The v3 language-model path is still selected by the legacy gateway web-search predicate
// (pending providerTools rewiring); the fixture carries both the legacy marker and the
// declaration-driven keys.
const gatewayOpenAiConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "openai/gpt-5.4-mini",
  llmVendor: "vercel-ai-gateway" as const,
  sdk: "@ai-sdk/gateway" as const,
  options: { applyPatch: true },
};

const gatewayAnthropicConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "anthropic/claude-sonnet-4",
  sdk: "@ai-sdk/gateway" as const,
  options: { applyPatch: true },
};

const openrouterConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "openai/gpt-5.4",
  options: { applyPatch: true },
};

test("normalizeApplyPatchToolCallArgumentsJson injects callId for AI SDK", () => {
  const callId = "call_apply_1";
  const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
  const raw = JSON.stringify({ operation });
  const normalized = normalizeApplyPatchToolCallArgumentsJson(callId, raw);
  const parsed = JSON.parse(normalized) as { callId?: string; operation?: unknown };
  assert.equal(parsed.callId, callId);
  assert.deepEqual(parsed.operation, operation);
});

test("openAiMessagesToResponsesAiSdkMessages tolerates malformed apply_patch arguments", () => {
  const callId = "call_apply_bad";
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: "apply_patch",
            arguments: "{not valid json",
          },
        },
      ],
    },
  ];

  assert.doesNotThrow(() => {
    openAiMessagesToResponsesAiSdkMessages(messages, openAiConfig);
  });
});

test("openAiMessagesToResponsesAiSdkMessages keeps apply_patch tool parts for OpenAI SDK path", () => {
  const callId = "call_apply_1";
  const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: "apply_patch",
            arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: callId,
      content: "ok",
      providerState: {
        openAiResponses: {
          applyPatchCallOutput: {
            call_id: callId,
            status: "completed",
          },
        },
      },
    },
  ];

  const sdkMessages = openAiMessagesToResponsesAiSdkMessages(messages, openAiConfig);
  assert.equal(
    sdkMessages.some((message) => {
      const content = message.content;
      return (
        Array.isArray(content) &&
        content.some((part) => {
          const typed = part as { type?: string; toolName?: string };
          return typed.type === "tool-call" && typed.toolName === "apply_patch";
        })
      );
    }),
    true,
  );
  assert.equal(
    sdkMessages.some((message) => {
      const content = message.content;
      return (
        Array.isArray(content) &&
        content.some((part) => {
          const typed = part as { type?: string; toolName?: string; output?: { value?: unknown } };
          return (
            typed.type === "tool-result" &&
            typed.toolName === "apply_patch" &&
            (typed.output?.value as { status?: string })?.status === "completed"
          );
        })
      );
    }),
    true,
  );
});

test("openAiMessagesToResponsesAiSdkMessages keeps apply_patch in SDK messages on Gateway language-model path", () => {
  const callId = "call_apply_1";
  const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: "apply_patch",
            arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: callId,
      content: "ok",
    },
  ];

  const sdkMessages = openAiMessagesToResponsesAiSdkMessages(messages, gatewayOpenAiConfig);
  assert.equal(
    sdkMessages.some((message) => {
      const content = message.content;
      return (
        Array.isArray(content) &&
        content.some((part) => (part as { type?: string }).type === "tool-call")
      );
    }),
    true,
  );
  assert.equal(
    sdkMessages.some((message) => message.role === "tool"),
    true,
  );

  runWithApplyPatchBridgeContext(() => {
    const body = { input: [] } as JsonObject;
    patchResponsesRequestBodyForApplyPatch(body, gatewayOpenAiConfig);
    const input = body.input as JsonObject[];
    assert.equal(input.length, 0);
  });
});

test("openAiMessagesToResponsesAiSdkMessages omits apply_patch when Open Responses fetch stash path is active", () => {
  const callId = "call_apply_1";
  const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: {
            name: "apply_patch",
            arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: callId,
      content: "ok",
    },
  ];

  const sdkMessages = openAiMessagesToResponsesAiSdkMessages(messages, openrouterConfig);
  assert.equal(
    sdkMessages.some((message) => {
      const content = message.content;
      return (
        Array.isArray(content) &&
        content.some((part) => (part as { type?: string }).type === "tool-call")
      );
    }),
    false,
  );
  assert.equal(
    sdkMessages.some((message) => message.role === "tool"),
    false,
  );

  runWithApplyPatchBridgeContext(() => {
    prepareApplyPatchRequestBodyStash(messages);
    const body = { input: [] } as JsonObject;
    patchResponsesRequestBodyForApplyPatch(body, openrouterConfig);
    const input = body.input as JsonObject[];
    assert.equal(input.length, 2);
    assert.equal(input[0]?.type, "apply_patch_call");
    assert.equal(input[1]?.type, "apply_patch_call_output");
  });
});

test("runWithApplyPatchBridgeContext isolates nested apply_patch stash rounds", () => {
  const callIdA = "call_apply_a";
  const callIdB = "call_apply_b";
  const operationA = { type: "update_file", path: "a.md", diff: "+a\n" };
  const operationB = { type: "update_file", path: "b.md", diff: "+b\n" };

  runWithApplyPatchBridgeContext(() => {
    prepareApplyPatchRequestBodyStash([
      {
        role: "assistant",
        tool_calls: [
          {
            id: callIdA,
            type: "function",
            function: {
              name: "apply_patch",
              arguments: buildApplyPatchToolCallArgumentsJson(callIdA, operationA),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: callIdA, content: "ok-a" },
    ]);

    runWithApplyPatchBridgeContext(() => {
      prepareApplyPatchRequestBodyStash([
        {
          role: "assistant",
          tool_calls: [
            {
              id: callIdB,
              type: "function",
              function: {
                name: "apply_patch",
                arguments: buildApplyPatchToolCallArgumentsJson(callIdB, operationB),
              },
            },
          ],
        },
        { role: "tool", tool_call_id: callIdB, content: "ok-b" },
      ]);

      const bodyB = { input: [] } as JsonObject;
      patchResponsesRequestBodyForApplyPatch(bodyB, gatewayAnthropicConfig);
      const inputB = bodyB.input as JsonObject[];
      assert.equal(inputB[0]?.call_id, callIdB);
    });

    const bodyA = { input: [] } as JsonObject;
    patchResponsesRequestBodyForApplyPatch(bodyA, gatewayAnthropicConfig);
    const inputA = bodyA.input as JsonObject[];
    assert.equal(inputA[0]?.call_id, callIdA);
  });
});

test("prepareApplyPatchRequestBodyStash pairs assistant call with tool result on fetch path", () => {
  const callId = "call_apply_2";
  const operation = { type: "create_file", path: "demo.txt", diff: "+hi\n" };
  runWithApplyPatchBridgeContext(() => {
    prepareApplyPatchRequestBodyStash([
      {
        role: "assistant",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name: "apply_patch",
              arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: callId, content: "created" },
    ]);

    const body = { input: [] } as JsonObject;
    patchResponsesRequestBodyForApplyPatch(body, openrouterConfig);
    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "apply_patch_call");
    assert.equal(input[0]?.call_id, callId);
    assert.equal(input[1]?.type, "apply_patch_call_output");
    assert.equal(input[1]?.output, "created");
  });
});
