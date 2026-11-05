import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { setLlmFetchTransportOverrideForTests } from "@spiritagent/agent-core";
import { afterEach, expect, it } from "vitest";
import { SpiritAcpAgent } from "../src/acp-agent.js";
import { SessionManager } from "../src/session-manager.js";
import { AuthState } from "../src/auth/auth-state.js";
import type { AcpServerConfig } from "../src/types.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ac-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config = { spiritDataDir: path.join(root, "d"), workspaceRoot: path.join(root, "w") };
  await Promise.all([mkdir(config.spiritDataDir), mkdir(config.workspaceRoot)]);
  await writeFile(
    path.join(config.spiritDataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "fixture",
          transportKind: "openai-compatible",
          sdk: "@ai-sdk/openai-compatible",
          apiBase: "https://fixture.invalid/v1",
          apiKey: "fixture-key",
          models: [{ name: "fixture-model" }],
        },
      ],
      activeModel: { providerId: "fixture", name: "fixture-model" },
    }),
  );
  return { root, config };
}

function connect(config: AcpServerConfig) {
  let agentInbox: ReadableStreamDefaultController<Uint8Array>;
  let clientInbox: ReadableStreamDefaultController<Uint8Array>;
  const agentInput = new ReadableStream<Uint8Array>({
    start(controller) {
      agentInbox = controller;
    },
  });
  const clientInput = new ReadableStream<Uint8Array>({
    start(controller) {
      clientInbox = controller;
    },
  });
  let agent: SpiritAcpAgent;
  const server = new acp.AgentSideConnection(
    (connection) => {
      agent = new SpiritAcpAgent(connection, config, new AuthState(true));
      return agent;
    },
    acp.ndJsonStream(
      new WritableStream({
        write(chunk) {
          clientInbox.enqueue(chunk);
        },
      }),
      agentInput,
    ),
  );
  const updates: acp.SessionNotification[] = [];
  const client = new acp.ClientSideConnection(
    () => ({
      async sessionUpdate(update) {
        updates.push(update);
      },
      async requestPermission() {
        return { outcome: { outcome: "selected", optionId: "allow" } };
      },
    }),
    acp.ndJsonStream(
      new WritableStream({
        write(chunk) {
          agentInbox.enqueue(chunk);
        },
      }),
      clientInput,
    ),
  );
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await agent!.shutdown();
    agentInbox.close();
    clientInbox.close();
    await Promise.all([server.closed, client.closed]);
  };
  cleanups.push(close);
  return { client, updates, close };
}

function response(tool?: { name: string; arguments: object }): Response {
  const delta = tool
    ? {
        tool_calls: [
          {
            index: 0,
            id: `call-${tool.name}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
          },
        ],
      }
    : { content: "Response." };
  return new Response(
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function shell(gate: string) {
  return {
    name: "shell",
    arguments: {
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
        `const fs=require('node:fs');console.log('started');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){console.log('done');clearInterval(t);}},20);`,
      )}`,
      reason: "Run the local fixture.",
      background: { delay: 0 },
    },
  };
}

async function createClientSession(client: acp.ClientSideConnection, config: AcpServerConfig) {
  const initialized = await client.initialize({ protocolVersion: 1 });
  expect(initialized.agentCapabilities?.loadSession).toBe(true);
  return client.newSession({ cwd: config.workspaceRoot, mcpServers: [] });
}

const prompt = (sessionId: string, text: string): acp.PromptRequest => ({
  sessionId,
  prompt: [{ type: "text", text }],
});

it("reports output and completion after the prompt response using stable task IDs", async () => {
  const { root, config } = await fixture();
  const { client, updates } = connect(config);
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async () =>
    ++requests === 1 ? response(shell(path.join(root, "release"))) : response(),
  );
  const { sessionId } = await createClientSession(client, config);
  expect(await client.prompt(prompt(sessionId, "Run the fixture."))).toEqual({
    stopReason: "end_turn",
  });
  const task = updates.find(
    (entry) =>
      entry.update.sessionUpdate === "tool_call" && entry.update.toolCallId.startsWith("task_"),
  )!.update;
  expect(task.sessionUpdate).toBe("tool_call");
  if (task.sessionUpdate !== "tool_call") throw new Error("Missing task announcement.");
  const metadata = task.rawOutput as { output_path: string };
  await writeFile(path.join(root, "release"), "");
  await expect
    .poll(
      () => updates.filter((entry) => entry.update.sessionUpdate === "agent_message_chunk").length,
    )
    .toBe(2);
  expect(requests).toBe(3);
  expect(await readFile(metadata.output_path, "utf8")).toContain("done");
  expect(
    updates.some(
      (entry) =>
        entry.update.sessionUpdate === "tool_call_update" &&
        entry.update.toolCallId === task.toolCallId &&
        JSON.stringify(entry.update.content).includes("done"),
    ),
  ).toBe(true);
  expect(
    updates.some(
      (entry) =>
        entry.update.sessionUpdate === "tool_call_update" &&
        entry.update.toolCallId === task.toolCallId &&
        entry.update.status === "completed",
    ),
  ).toBe(true);
  expect(
    updates.some(
      (entry) => "toolCallId" in entry.update && entry.update.toolCallId.startsWith("bg_"),
    ),
  ).toBe(false);
});

it("cancels foreground work independently and reloads a closed session without model execution", async () => {
  const { root, config } = await fixture();
  const first = connect(config);
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async (_url, init) => {
    if (++requests === 1) return response(shell(path.join(root, "never")));
    if (requests === 3)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    return response();
  });
  const { sessionId } = await createClientSession(first.client, config);
  await first.client.prompt(prompt(sessionId, "Start the fixture."));
  const pending = first.client.prompt(prompt(sessionId, "Foreground request."));
  await expect.poll(() => requests).toBe(3);
  await first.client.cancel({ sessionId });
  expect(await pending).toEqual({ stopReason: "cancelled" });
  expect(
    first.updates.some(
      (entry) =>
        entry.update.sessionUpdate === "tool_call_update" &&
        (entry.update.rawOutput as { status?: string } | undefined)?.status === "stopped",
    ),
  ).toBe(false);
  await first.client.closeSession({ sessionId });
  await first.close();
  const second = connect(config);
  await second.client.initialize({ protocolVersion: 1 });
  const loaded = await second.client.loadSession({
    sessionId,
    cwd: config.workspaceRoot,
    mcpServers: [],
  });
  expect(loaded.modes?.currentModeId).toBe("agent");
  const taskAnnouncements = second.updates.filter(
    (entry) =>
      entry.update.sessionUpdate === "tool_call" && entry.update.toolCallId.startsWith("task_"),
  );
  expect(taskAnnouncements).toHaveLength(1);
  expect(JSON.stringify(taskAnnouncements[0])).toContain("stopped");
  expect(requests).toBe(3);
  await second.client.deleteSession({ sessionId });
  await expect(
    second.client.loadSession({ sessionId, cwd: config.workspaceRoot, mcpServers: [] }),
  ).rejects.toThrow("not found");
});

it("does not let superseded prompt completions consume the next prompt's result", async () => {
  const { config } = await fixture();
  const { client } = connect(config);
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async (_url, init) => {
    if (++requests === 1)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    return response();
  });
  const { sessionId } = await createClientSession(client, config);
  const first = client.prompt(prompt(sessionId, "First."));
  await expect.poll(() => requests).toBe(1);
  const second = client.prompt(prompt(sessionId, "Second."));
  expect(await first).toEqual({ stopReason: "cancelled" });
  expect(await second).toEqual({ stopReason: "end_turn" });
  expect(requests).toBe(2);
});

it("refuses to load or delete task files owned by another live ACP host", async () => {
  const { root, config } = await fixture();
  const first = connect(config);
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async () =>
    ++requests === 1 ? response(shell(path.join(root, "never"))) : response(),
  );
  const { sessionId } = await createClientSession(first.client, config);
  await first.client.prompt(prompt(sessionId, "Run the fixture."));
  const second = connect(config);
  await second.client.initialize({ protocolVersion: 1 });
  await expect(
    second.client.loadSession({ sessionId, cwd: config.workspaceRoot, mcpServers: [] }),
  ).rejects.toThrow("active in another runtime");
  await expect(second.client.deleteSession({ sessionId })).rejects.toThrow(
    "active in another runtime",
  );
  expect(requests).toBe(2);
  await first.client.closeSession({ sessionId });
  await second.client.deleteSession({ sessionId });
});

it("preserves an idle session when another host tries to load or delete it", async () => {
  const { config } = await fixture();
  const first = connect(config);
  const { sessionId } = await createClientSession(first.client, config);
  const second = connect(config);
  await second.client.initialize({ protocolVersion: 1 });
  await expect(
    second.client.loadSession({ sessionId, cwd: config.workspaceRoot, mcpServers: [] }),
  ).rejects.toThrow("active in another runtime");
  await expect(second.client.deleteSession({ sessionId })).rejects.toThrow(
    "active in another runtime",
  );
  await first.client.closeSession({ sessionId });
  await expect(
    second.client.loadSession({ sessionId, cwd: config.workspaceRoot, mcpServers: [] }),
  ).resolves.toHaveProperty("modes");
  await second.client.deleteSession({ sessionId });
});

it("shares one restored runtime across concurrent loads and preserves its mode", async () => {
  const { config } = await fixture();
  const original = new SessionManager(config);
  cleanups.push(() => original.shutdown());
  const { sessionId } = await original.createSession(config.workspaceRoot, () => {}, "plan");
  await original.closeSession(sessionId);
  const restored = new SessionManager(config);
  cleanups.push(() => restored.shutdown());
  const results = await Promise.all([
    restored.loadSession(sessionId, config.workspaceRoot, () => {}),
    restored.loadSession(sessionId, config.workspaceRoot, () => {}),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]?.currentMode).toBe("plan");
  await restored.closeSession(sessionId);
  expect(restored.getSession(sessionId)).toBeUndefined();
});

it("runs ACP worktree children against committed files with scoped context and real approvals", async () => {
  const { config } = await fixture();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: config.workspaceRoot, stdio: "pipe" });
  git("init", "--quiet");
  await writeFile(path.join(config.workspaceRoot, "tracked.txt"), "committed");
  await writeFile(path.join(config.workspaceRoot, "AGENTS.md"), "Use the scoped fixture marker.\n");
  git("add", "tracked.txt", "AGENTS.md");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  await writeFile(path.join(config.workspaceRoot, "tracked.txt"), "dirty");
  const requests: { messages: { role: string; content: string }[] }[] = [];
  setLlmFetchTransportOverrideForTests(async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1)
      return response({
        name: "subagent",
        arguments: { prompt: "Inspect the worktree.", worktree: true, background: { type: false } },
      });
    if (requests.length === 2)
      return response({
        name: "shell",
        arguments: {
          command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("const fs=require('node:fs');console.log(JSON.stringify({cwd:process.cwd(),tracked:fs.readFileSync('tracked.txt','utf8')}));")}`,
          reason: "Inspect the local fixture.",
          background: { type: false },
        },
      });
    return response();
  });
  const { client } = connect(config);
  const { sessionId } = await createClientSession(client, config);
  expect(await client.prompt(prompt(sessionId, "Delegate inspection."))).toEqual({
    stopReason: "end_turn",
  });
  expect(requests).toHaveLength(4);
  expect(JSON.stringify(requests[1])).toContain("Use the scoped fixture marker.");
  const result = JSON.parse(
    requests[2]!.messages.find((message) => message.role === "tool")!.content,
  );
  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.output.trim());
  expect(output.tracked).toBe("committed");
  expect(output.cwd).not.toBe(config.workspaceRoot);
  await client.closeSession({ sessionId });
  expect(await readFile(path.join(output.cwd, "tracked.txt"), "utf8")).toBe("committed");
});
