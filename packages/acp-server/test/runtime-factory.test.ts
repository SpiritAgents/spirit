import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { setLlmFetchTransportOverrideForTests } from "@spiritagent/agent-core";
import {
  providerInternalKeyAccount,
  setKeyringStoreForTests,
} from "@spiritagent/config/credentials";

import { createAcpRuntime } from "../src/runtime-factory.js";

test("ACP request uses the config provider id instead of the SDK package", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "af-"));
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

  let result: Awaited<ReturnType<typeof createAcpRuntime>> | undefined;
  try {
    result = await createAcpRuntime({ workspaceRoot, spiritDataDir }, () => {});
    const turn = await result.runtime.submitUserTurn("hello");
    assert.equal(turn.kind, "completed");
    const messages = requestBodies[0]?.messages;
    assert.ok(messages);
    const serializedMessages = JSON.stringify(messages);
    assert.match(serializedMessages, /The user's model is kimi-k3 from moonshot-ai\./);
    assert.doesNotMatch(serializedMessages, /@ai-sdk\/moonshotai/);
  } finally {
    await result?.dispose();
    setLlmFetchTransportOverrideForTests(undefined);
    setKeyringStoreForTests(undefined);
  }
});

test("ACP conditional fast falls back and restores from real response usage", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "at-"));
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

  let result: Awaited<ReturnType<typeof createAcpRuntime>> | undefined;
  try {
    result = await createAcpRuntime({ workspaceRoot, spiritDataDir }, () => {});
    for (const text of ["first", "second", "third"]) {
      const turn = await result.runtime.submitUserTurn(text);
      assert.equal(turn.kind, "completed");
    }
    assert.deepEqual(requestTiers, ["fast", "default", "fast"]);
  } finally {
    await result?.dispose();
    setLlmFetchTransportOverrideForTests(undefined);
    setKeyringStoreForTests(undefined);
  }
});

test("ACP runtime injects nested AGENTS.md reminder on read_file without re-injecting root AGENTS.md", async () => {
  const spiritDataDir = realpathSync(mkdtempSync(join(tmpdir(), "an-")));
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "acp-na-ws-")));
  const rootAgents = join(workspaceRoot, "AGENTS.md");
  const pkgAgents = join(workspaceRoot, "packages", "core", "AGENTS.md");
  const targetFile = join(workspaceRoot, "packages", "core", "index.ts");
  mkdirSync(join(workspaceRoot, "packages", "core"), { recursive: true });
  writeFileSync(rootAgents, "# Root Rules\n");
  writeFileSync(pkgAgents, "# Core Package Rules\n");
  writeFileSync(targetFile, "export const ok = true;\n");
  writeFileSync(
    join(spiritDataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "local-fixture",
          apiBase: "http://127.0.0.1:1/v1",
          apiKey: "fixture-key",
          transportKind: "openai-compatible",
          models: [{ name: "fixture-model" }],
        },
      ],
      activeModel: { providerId: "local-fixture", name: "fixture-model" },
    }),
  );

  const requestBodies: Array<{ messages: Array<{ role: string; content?: unknown }> }> = [];
  let callIndex = 0;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    requestBodies.push(
      JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content?: unknown }> },
    );
    const step = callIndex++;
    if (step === 0) {
      return new Response(
        JSON.stringify({
          id: "chatcmpl-acp-na-1",
          object: "chat.completion",
          created: 0,
          model: "fixture-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_acp_read",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "packages/core/index.ts" }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl-acp-na-2",
        object: "chat.completion",
        created: 0,
        model: "fixture-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "done" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  let result: Awaited<ReturnType<typeof createAcpRuntime>> | undefined;
  try {
    result = await createAcpRuntime({ workspaceRoot, spiritDataDir }, () => {});
    const turn = await result.runtime.submitUserTurn("read core");
    assert.equal(turn.kind, "completed");
    const toolMsg = requestBodies[1]!.messages.find((msg) => msg.role === "tool");
    assert.ok(toolMsg);
    const text = String(toolMsg.content);
    assert.ok(text.includes("<nested_agents>"));
    assert.ok(text.includes(pkgAgents));
    assert.ok(!text.includes(rootAgents));
  } finally {
    await result?.dispose();
    setLlmFetchTransportOverrideForTests(undefined);
    rmSync(spiritDataDir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
