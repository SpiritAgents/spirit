import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "@spiritagent/agent-core";
import { providerInternalKeyAccount, setKeyringStoreForTests } from "@spiritagent/host-internal";

import { createAcpRuntime } from "../src/runtime-factory.js";

test("ACP request uses the config provider id instead of the SDK package", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-acp-host-prompt-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-acp-host-prompt-ws-"));
  writeFileSync(
    join(spiritDataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "moonshot-ai",
          apiBase: "https://api.moonshot.cn/v1",
          sdk: "@ai-sdk/moonshotai",
          models: [{ name: "kimi-k3" }],
        },
      ],
      activeModel: { providerId: "moonshot-ai", name: "kimi-k3" },
    }),
  );
  setKeyringStoreForTests({
    getPassword: (_service, account) =>
      account === providerInternalKeyAccount("moonshot-ai") ? "test-key" : undefined,
    setPassword: () => {},
    deletePassword: () => {},
  });

  const requestBodies: Array<Record<string, unknown>> = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        id: "chatcmpl-acp-host-prompt",
        object: "chat.completion",
        created: 0,
        model: "kimi-k3",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const result = await createAcpRuntime({ workspaceRoot, spiritDataDir }, () => {});
    const turn = await result.runtime.submitUserTurn("hello");
    assert.equal(turn.kind, "completed");
    const messages = requestBodies[0]?.messages;
    assert.ok(messages);
    const serializedMessages = JSON.stringify(messages);
    assert.match(serializedMessages, /The user's model is kimi-k3 from moonshot-ai\./);
    assert.doesNotMatch(serializedMessages, /@ai-sdk\/moonshotai/);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    setKeyringStoreForTests(undefined);
  }
});

test("ACP conditional fast falls back and restores from real response usage", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-acp-tier-limit-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "spirit-acp-tier-limit-ws-"));
  writeFileSync(
    join(spiritDataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "openai",
          apiBase: "https://api.openai.com/v1",
          transportKind: "open-responses",
          sdk: "@ai-sdk/openai",
          models: [
            {
              name: "gpt-5.4",
              serviceTier: "fast",
              serviceTiers: {
                default: { body: { service_tier: "default" } },
                flex: { body: { service_tier: "flex" } },
                fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
              },
            },
          ],
        },
      ],
      activeModel: { providerId: "openai", name: "gpt-5.4" },
    }),
  );
  setKeyringStoreForTests({
    getPassword: (_service, account) =>
      account === providerInternalKeyAccount("openai") ? "test-key" : undefined,
    setPassword: () => {},
    deletePassword: () => {},
  });

  const requestTiers: unknown[] = [];
  let requestCount = 0;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestTiers.push(body.service_tier);
    const inputTokens = requestCount++ === 0 ? 278529 : 1000;
    return new Response(
      JSON.stringify({
        id: `resp-tier-${requestCount}`,
        object: "response",
        created_at: 0,
        model: "gpt-5.4",
        status: "completed",
        output: [
          {
            type: "message",
            id: `msg-${requestCount}`,
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: inputTokens,
          output_tokens: 1,
          total_tokens: inputTokens + 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const result = await createAcpRuntime({ workspaceRoot, spiritDataDir }, () => {});
    for (const text of ["first", "second", "third"]) {
      const turn = await result.runtime.submitUserTurn(text);
      assert.equal(turn.kind, "completed");
    }
    assert.deepEqual(requestTiers, ["fast", "default", "fast"]);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    setKeyringStoreForTests(undefined);
  }
});
