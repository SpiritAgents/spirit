import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject } from "../ports.js";
import {
  buildApplyPatchToolCallArgumentsJson,
  patchResponsesRequestBodyForApplyPatch,
  prepareApplyPatchRequestBodyStash,
  registerPendingApplyPatchCallIds,
  runWithApplyPatchBridgeContext,
} from "./apply-patch-bridge.js";
import {
  APPLY_PATCH_HOST_TOOL_NAME,
  buildApplyPatchResponsesFunctionToolDefinition,
  hasApplyPatchToolInResponsesTools,
} from "./apply-patch-eligibility.js";

const openAiConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "gpt-5.1",
  sdk: "@ai-sdk/openai" as const,
  options: { applyPatch: true },
};

const gatewayConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "openai/gpt-5.4",
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

// A generic Open Responses endpoint (e.g. an aggregator route) declaring apply_patch support.
const openrouterConfig = {
  transportKind: "open-responses" as const,
  apiKey: "test",
  model: "openai/gpt-5.1",
  options: { applyPatch: true },
};

test("patchResponsesRequestBodyForApplyPatch generic endpoint uses built-in apply_patch_call items", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_test_1";
    const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
    registerPendingApplyPatchCallIds([callId]);

    const body = {
      input: [
        {
          type: "function_call",
          call_id: callId,
          name: APPLY_PATCH_HOST_TOOL_NAME,
          arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
        },
        {
          type: "function_call_output",
          call_id: callId,
          output: "ok",
        },
      ],
    } as JsonObject;

    patchResponsesRequestBodyForApplyPatch(body, openrouterConfig);

    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "apply_patch_call");
    assert.equal(input[1]?.type, "apply_patch_call_output");
  });
});

test("patchResponsesRequestBodyForApplyPatch on the openai adapter leaves the SDK tool path alone", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_sdk_1";
    const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
    registerPendingApplyPatchCallIds([callId]);

    const body = {
      input: [
        {
          type: "function_call",
          call_id: callId,
          name: APPLY_PATCH_HOST_TOOL_NAME,
          arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
        },
      ],
    } as JsonObject;

    patchResponsesRequestBodyForApplyPatch(body, openAiConfig);

    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "function_call");
  });
});

test("patchResponsesRequestBodyForApplyPatch generic endpoint uses the built-in apply_patch tool and call items", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_openrouter_1";
    const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
    registerPendingApplyPatchCallIds([callId]);

    const body = {
      tools: [{ type: "function", name: "read_file", parameters: {} }],
      input: [
        {
          type: "function_call",
          call_id: callId,
          name: APPLY_PATCH_HOST_TOOL_NAME,
          arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
        },
        {
          type: "function_call_output",
          call_id: callId,
          output: "ok",
        },
      ],
    } as JsonObject;

    patchResponsesRequestBodyForApplyPatch(body, openrouterConfig);

    const tools = body.tools as JsonObject[];
    assert.equal(
      tools.some((tool) => tool.type === "apply_patch"),
      true,
    );
    assert.equal(
      tools.some((tool) => tool.name === APPLY_PATCH_HOST_TOOL_NAME),
      false,
    );

    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "apply_patch_call");
    assert.equal(input[1]?.type, "apply_patch_call_output");
  });
});

test("patchResponsesRequestBodyForApplyPatch gateway adds Responses flat apply_patch tool", () => {
  const body = { tools: [{ type: "function", name: "read_file", parameters: {} }] } as JsonObject;
  patchResponsesRequestBodyForApplyPatch(body, gatewayConfig);
  const tools = body.tools as JsonObject[];
  assert.equal(hasApplyPatchToolInResponsesTools(tools), true);
  const applyPatch = tools.find((tool) => tool.name === APPLY_PATCH_HOST_TOOL_NAME);
  assert.equal(applyPatch?.type, "function");
  assert.equal(applyPatch?.function, undefined);
  assert.equal(
    tools.some((tool) => tool.type === "apply_patch"),
    false,
  );
});

test("patchResponsesRequestBodyForApplyPatch gateway skips duplicate apply_patch tool", () => {
  const body = {
    tools: [
      { type: "function", name: "read_file", parameters: {} },
      buildApplyPatchResponsesFunctionToolDefinition(),
    ],
  } as JsonObject;
  patchResponsesRequestBodyForApplyPatch(body, gatewayConfig);
  const tools = body.tools as JsonObject[];
  assert.equal(tools.length, 2);
  assert.equal(tools.filter((tool) => tool.name === APPLY_PATCH_HOST_TOOL_NAME).length, 1);
});

test("patchResponsesRequestBodyForApplyPatch gateway openai route keeps function_call pairs with callId in arguments", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_test_2";
    const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
    registerPendingApplyPatchCallIds([callId]);

    const body = {
      input: [
        {
          type: "function_call",
          call_id: callId,
          name: APPLY_PATCH_HOST_TOOL_NAME,
          arguments: JSON.stringify({ operation }),
        },
        {
          type: "function_call_output",
          call_id: callId,
          output: "ok",
        },
      ],
    } as JsonObject;

    patchResponsesRequestBodyForApplyPatch(body, gatewayConfig);

    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "function_call");
    assert.equal(input[0]?.name, APPLY_PATCH_HOST_TOOL_NAME);
    const args = JSON.parse(String(input[0]?.arguments)) as {
      callId?: string;
      operation?: unknown;
    };
    assert.equal(args.callId, callId);
    assert.equal(input[1]?.type, "function_call_output");
    assert.equal(
      input.some((item) => item.type === "apply_patch_call"),
      false,
    );
  });
});

test("patchResponsesRequestBodyForApplyPatch injects stashed rounds when input is missing", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_missing_input";
    const operation = { type: "create_file", path: "demo.txt", diff: "+hi\n" };
    prepareApplyPatchRequestBodyStash([
      {
        role: "assistant",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name: APPLY_PATCH_HOST_TOOL_NAME,
              arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: callId, content: "created ok" },
    ]);

    const body = {} as JsonObject;
    patchResponsesRequestBodyForApplyPatch(body, gatewayAnthropicConfig);
    const input = body.input as JsonObject[];
    assert.equal(input.length, 2);
    assert.equal(input[0]?.type, "function_call");
    assert.equal(input[1]?.type, "function_call_output");
    assert.equal(input[1]?.output, "created ok");
  });
});

test("patchResponsesRequestBodyForApplyPatch gateway non-openai route keeps function_call pairs", () => {
  runWithApplyPatchBridgeContext(() => {
    const callId = "call_test_3";
    const operation = { type: "update_file", path: "README.md", diff: "+x\n" };
    registerPendingApplyPatchCallIds([callId]);

    const body = {
      input: [
        {
          type: "function_call",
          call_id: callId,
          name: APPLY_PATCH_HOST_TOOL_NAME,
          arguments: JSON.stringify({ operation }),
        },
        {
          type: "function_call_output",
          call_id: callId,
          output: "ok",
        },
      ],
    } as JsonObject;

    patchResponsesRequestBodyForApplyPatch(body, gatewayAnthropicConfig);

    const input = body.input as JsonObject[];
    assert.equal(input[0]?.type, "function_call");
    assert.equal(input[0]?.name, APPLY_PATCH_HOST_TOOL_NAME);
    const args = JSON.parse(String(input[0]?.arguments)) as {
      callId?: string;
      operation?: unknown;
    };
    assert.equal(args.callId, callId);
    assert.equal(input[1]?.type, "function_call_output");
    assert.equal(
      input.some((item) => item.type === "apply_patch_call"),
      false,
    );
  });
});
