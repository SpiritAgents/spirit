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
