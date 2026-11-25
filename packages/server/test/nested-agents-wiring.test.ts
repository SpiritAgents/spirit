import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  parseShellToolResult,
  setLlmFetchTransportOverrideForTests,
  type RuntimeEvent,
  type JsonValue,
} from "@spiritagent/agent-core";

import { createServerRuntime } from "../src/runtime-factory.js";

function chatCompletionResponse(message: Record<string, unknown>, finishReason: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-fixture",
      object: "chat.completion",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function chatCompletionSseResponse(text: string): Response {
  const chunk1 = JSON.stringify({
    id: "chatcmpl-compact",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture-model",
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  });
  const chunk2 = JSON.stringify({
    id: "chatcmpl-compact",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture-model",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
  return new Response(`data: ${chunk1}\n\ndata: ${chunk2}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("server runtime injects nested AGENTS.md reminders, respects compaction reset, and keeps shell UI JSON and background logs clean", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "na-"));
  const workspaceRoot = path.join(root, "p", "w");
  const spiritDataDir = path.join(root, "d");
  const outerAgents = path.join(root, "p", "AGENTS.md");
  const rootAgents = path.join(workspaceRoot, "AGENTS.md");
  const pkgAAgents = path.join(workspaceRoot, "packages", "alpha", "AGENTS.md");
  const pkgAFile = path.join(workspaceRoot, "packages", "alpha", "src", "index.ts");
  const pkgBAgents = path.join(workspaceRoot, "packages", "beta", "AGENTS.md");
  const pkgCAgents = path.join(workspaceRoot, "packages", "gamma", "AGENTS.md");

  await mkdir(path.dirname(pkgAFile), { recursive: true });
  await mkdir(path.dirname(pkgBAgents), { recursive: true });
  await mkdir(path.dirname(pkgCAgents), { recursive: true });
  await mkdir(spiritDataDir, { recursive: true });

  await writeFile(outerAgents, "# Outer Projects Rule\n");
  await writeFile(rootAgents, "# Workspace Root Rule\n");
  await writeFile(pkgAAgents, "# Alpha v1\n");
  await writeFile(pkgAFile, "export const alpha = 1;\n");
  await writeFile(pkgBAgents, "# Beta Rule\n");
  await writeFile(pkgCAgents, "# Gamma Rule\n");
  await writeFile(
    path.join(spiritDataDir, "config.json"),
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

  const capturedRequests: Array<{ messages: Array<{ role: string; content?: unknown }> }> = [];
  const scriptedResponses: Array<() => Response> = [
    // Turn 1, step 1: read packages/alpha/src/index.ts
    () =>
      chatCompletionResponse(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_read_1",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "packages/alpha/src/index.ts" }),
              },
            },
          ],
        },
        "tool_calls",
      ),
    // Turn 1, step 2: shell foreground into packages/beta
    () =>
      chatCompletionResponse(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_shell_fg",
              type: "function",
              function: {
                name: "shell",
                arguments: JSON.stringify({
                  reason: "Print beta directory",
                  command: "cd packages/beta && pwd",
                }),
              },
            },
          ],
        },
        "tool_calls",
      ),
    // Turn 1, step 3: shell background into packages/gamma
    () =>
      chatCompletionResponse(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_shell_bg",
              type: "function",
              function: {
                name: "shell",
                arguments: JSON.stringify({
                  reason: "Sleep in gamma directory",
                  command: "cd packages/gamma && sleep 2",
                  background: { type: true, delay: 0 },
                }),
              },
            },
          ],
        },
        "tool_calls",
      ),
    // Turn 1, step 4: finish turn 1
    () => chatCompletionResponse({ role: "assistant", content: "turn-1-done" }, "stop"),
    // Manual compaction summary response (streaming SSE)
    () => chatCompletionSseResponse("[Session Overview]\nCompacted summary."),
    // Turn 2, step 1: read packages/alpha/src/index.ts again after compaction
    () =>
      chatCompletionResponse(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_read_2",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "packages/alpha/src/index.ts" }),
              },
            },
          ],
        },
        "tool_calls",
      ),
    // Turn 2, step 2: finish turn 2
    () => chatCompletionResponse({ role: "assistant", content: "turn-2-done" }, "stop"),
  ];

  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content?: unknown }>;
    };
    capturedRequests.push(body);
    const next = scriptedResponses.shift();
    if (!next) {
      throw new Error(`Unexpected extra LLM request #${capturedRequests.length}`);
    }
    return next();
  });

  const events: RuntimeEvent<JsonValue>[] = [];
  let serverRuntime: Awaited<ReturnType<typeof createServerRuntime>> | undefined;
  try {
    serverRuntime = await createServerRuntime({
      workspaceRoot,
      spiritDataDir,
      sessionKey: "sess_nested_agents_wiring",
      hostKind: "cli",
      approvalLevel: "bypass-approval",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const turn1 = await serverRuntime.runtime.submitUserTurn("inspect packages");
    assert.equal(turn1.kind, "completed");

    // Request #2 saw the read_file tool result: alpha + outer AGENTS.md, no root AGENTS.md, no file body.
    const readToolMsg1 = capturedRequests[1]!.messages.find(
      (msg) => msg.role === "tool" && String(msg.content).includes("export const alpha = 1;"),
    );
    assert.ok(readToolMsg1);
    const readToolText1 = String(readToolMsg1.content);
    assert.ok(readToolText1.includes("<nested_agents>"));
    assert.ok(readToolText1.includes(path.resolve(pkgAAgents)));
    assert.ok(readToolText1.includes(path.resolve(outerAgents)));
    assert.ok(!readToolText1.includes(path.resolve(rootAgents)));
    assert.ok(!readToolText1.includes("# Alpha v1"));

    // Request #3 saw foreground shell result with beta AGENTS.md appended for the LLM...
    const shellFgLlmMsg = capturedRequests[2]!.messages.filter((msg) => msg.role === "tool").at(-1);
    assert.ok(shellFgLlmMsg);
    assert.ok(String(shellFgLlmMsg.content).includes(path.resolve(pkgBAgents)));

    // ...while the UI event kept pure ShellToolResult JSON parseable by Desktop/Web cards.
    const shellFgEvent = events.find(
      (event) =>
        event.kind === "tool-execution-finished" && event.execution.toolCallId === "call_shell_fg",
    );
    assert.ok(shellFgEvent && shellFgEvent.kind === "tool-execution-finished");
    const parsedShellUi = parseShellToolResult(shellFgEvent.execution.output);
    assert.ok(parsedShellUi, "foreground shell UI output must stay valid ShellToolResult JSON");
    assert.ok(!shellFgEvent.execution.output.includes("<nested_agents>"));

    // Request #4 saw background shell handoff text with gamma AGENTS.md appended...
    const shellBgLlmMsg = capturedRequests[3]!.messages.filter((msg) => msg.role === "tool").at(-1);
    assert.ok(shellBgLlmMsg);
    const shellBgText = String(shellBgLlmMsg.content);
    assert.ok(shellBgText.includes("Task running."));
    assert.ok(shellBgText.includes(path.resolve(pkgCAgents)));

    // ...and the background task log file on disk must NOT contain the reminder.
    const bgTask = serverRuntime.tasks
      .records()
      .find((record) => record.toolCallId === "call_shell_bg");
    assert.ok(bgTask);
    const bgLogContent = await readFile(bgTask.outputPath, "utf8").catch(() => "");
    assert.ok(!bgLogContent.includes("<nested_agents>"));

    // Compact history: resets dynamic entries while keeping system-prompt root AGENTS.md suppressed.
    const compaction = await serverRuntime.runtime.compactHistory();
    assert.ok(compaction.droppedMessages > 0);

    const turn2 = await serverRuntime.runtime.submitUserTurn("inspect alpha again");
    assert.equal(turn2.kind, "completed");

    const readToolMsg2 = capturedRequests
      .at(-1)!
      .messages.filter((msg) => msg.role === "tool")
      .at(-1);
    assert.ok(readToolMsg2);
    const readToolText2 = String(readToolMsg2.content);
    assert.ok(readToolText2.includes(path.resolve(pkgAAgents)));
    assert.ok(readToolText2.includes(path.resolve(outerAgents)));
    assert.ok(!readToolText2.includes(path.resolve(rootAgents)));
  } finally {
    await serverRuntime?.dispose();
    setLlmFetchTransportOverrideForTests(undefined);
    await rm(root, { recursive: true, force: true });
  }
});
