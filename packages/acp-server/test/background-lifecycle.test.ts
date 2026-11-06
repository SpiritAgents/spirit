import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import { setLlmFetchTransportOverrideForTests } from "@spiritagent/agent-core";
import { isSessionId } from "@spiritagent/host-internal";
import type { BackgroundTaskRecord } from "@spiritagent/agent-core";
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
  const permissionRequests: acp.RequestPermissionRequest[] = [];
  const client = new acp.ClientSideConnection(
    () => ({
      async sessionUpdate(update) {
        updates.push(update);
      },
      async requestPermission(request) {
        permissionRequests.push(request);
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
  return { client, updates, permissionRequests, close };
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

it("creates native subagent sessions and reloads their metadata by session ID", async () => {
  const { config } = await fixture();
  const first = new SessionManager(config);
  const origin = { parentSessionId: "sess_parent", parentToolCallId: "call-1" };
  const created = await first.createSession(config.workspaceRoot, () => {}, "agent", {
    sessionKind: "subagent",
    subagentOrigin: origin,
  });
  expect(created.sessionKind).toBe("subagent");
  expect(created.subagentOrigin).toEqual(origin);
  await first.shutdown();

  const second = new SessionManager(config);
  const restored = await second.loadSession(created.sessionId, config.workspaceRoot, () => {});
  expect(restored.sessionId).toBe(created.sessionId);
  expect(restored.sessionKind).toBe("subagent");
  expect(restored.subagentOrigin).toEqual(origin);
  await second.shutdown();
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
  const { client, permissionRequests } = connect(config);
  const { sessionId } = await createClientSession(client, config);
  expect(await client.prompt(prompt(sessionId, "Delegate inspection."))).toEqual({
    stopReason: "end_turn",
  });
  expect(requests).toHaveLength(4);
  expect(permissionRequests).toHaveLength(1);
  expect(permissionRequests[0]?.sessionId).toBe(sessionId);
  expect(
    permissionRequests[0]?.toolCall.toolCallId.split(":")[0] &&
      isSessionId(permissionRequests[0].toolCall.toolCallId.split(":")[0]!),
  ).toBe(true);
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

function delegatedContext() {
  const updates: Array<Partial<BackgroundTaskRecord>> = [];
  const outputs: string[] = [];
  return {
    updates,
    outputs,
    context: {
      taskId: "task_delegate",
      signal: new AbortController().signal,
      update: async (metadata: Partial<BackgroundTaskRecord>) => {
        updates.push(metadata);
      },
      writeOutput: async (text: string) => {
        outputs.push(text);
      },
    },
  };
}

it("continues native subagent sessions with normal user turns", async () => {
  const { config } = await fixture();
  const manager = new SessionManager(config);
  const parent = await manager.createSession(config.workspaceRoot, () => {});
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    requests += 1;
    return response();
  });

  const first = delegatedContext();
  const created = await manager.delegateSubagentTurn(parent.sessionId, {
    prompt: "First continuation",
    parentToolCallId: "call-native",
    context: first.context,
  });
  const targetId = first.updates[0]?.sessionId;
  if (!targetId) throw new Error("Missing delegated session ID.");
  expect(created.output.summaryText).toContain("Response.");

  const second = delegatedContext();
  await manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: targetId,
    prompt: "Second continuation",
    parentToolCallId: "call-resume",
    context: second.context,
  });
  const history = manager.getSession(targetId)!.runtime.history();
  expect(JSON.stringify(history)).toContain("First continuation");
  expect(JSON.stringify(history)).toContain("Second continuation");
  expect(requests).toBe(2);
  await manager.shutdown();
});

it("rejects a second agent while an ACP target turn is active and allows the next one", async () => {
  const { config } = await fixture();
  const manager = new SessionManager(config);
  const firstParent = await manager.createSession(config.workspaceRoot, () => {});
  const secondParent = await manager.createSession(config.workspaceRoot, () => {});
  const target = await manager.createSession(config.workspaceRoot, () => {}, "agent", {
    sessionKind: "subagent",
    subagentOrigin: { parentSessionId: firstParent.sessionId, parentToolCallId: "call-target" },
  });
  let releaseFirst!: () => void;
  let calls = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((resolve) => {
        releaseFirst = () => resolve(response());
      });
    }
    return response();
  });
  const firstPromise = manager.delegateSubagentTurn(firstParent.sessionId, {
    sessionId: target.sessionId,
    prompt: "First writer",
    parentToolCallId: "call-first",
    context: delegatedContext().context,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await expect(
    manager.delegateSubagentTurn(secondParent.sessionId, {
      sessionId: target.sessionId,
      prompt: "Second writer",
      parentToolCallId: "call-second",
      context: delegatedContext().context,
    }),
  ).rejects.toThrow(/already being prompted by another agent/);
  releaseFirst();
  await firstPromise;

  await manager.delegateSubagentTurn(secondParent.sessionId, {
    sessionId: target.sessionId,
    prompt: "Third writer",
    parentToolCallId: "call-third",
    context: delegatedContext().context,
  });
  const history = manager.getSession(target.sessionId)!.runtime.history();
  expect(JSON.stringify(history)).toContain("First writer");
  expect(JSON.stringify(history)).not.toContain("Second writer");
  expect(JSON.stringify(history)).toContain("Third writer");
  await manager.shutdown();
});

it("persists and reuses an ACP continuation worktree across restart", async () => {
  const { config } = await fixture();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: config.workspaceRoot, stdio: "pipe" });
  git("init", "--quiet");
  await writeFile(path.join(config.workspaceRoot, "tracked.txt"), "committed");
  git("add", "tracked.txt");
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
  const manager = new SessionManager(config);
  const parent = await manager.createSession(config.workspaceRoot, () => {}, "debug");
  let replies = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    replies += 1;
    return response();
  });
  const first = delegatedContext();
  await manager.delegateSubagentTurn(parent.sessionId, {
    prompt: "First ACP worktree turn",
    parentToolCallId: "call-acp-worktree-create",
    worktree: true,
    context: first.context,
  });
  const targetId = first.updates[0]?.sessionId;
  if (!targetId) throw new Error("Missing delegated session ID.");
  const created = manager.getSession(targetId)!;
  expect(created.workLocation).toBe("worktree");
  expect(created.workspaceRoot).toBe(created.worktreePath);
  expect(created.currentMode).toBe("debug");

  await manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: targetId,
    prompt: "Second ACP worktree turn",
    parentToolCallId: "call-acp-worktree-reuse",
    worktree: true,
    context: delegatedContext().context,
  });
  expect(manager.getSession(targetId)?.worktreePath).toBe(created.worktreePath);
  await manager.shutdown();

  const restarted = new SessionManager(config);
  const restartedParent = await restarted.createSession(config.workspaceRoot, () => {});
  await restarted.delegateSubagentTurn(restartedParent.sessionId, {
    sessionId: targetId,
    prompt: "Third ACP worktree turn",
    parentToolCallId: "call-acp-worktree-restored",
    worktree: true,
    context: delegatedContext().context,
  });
  const restored = restarted.getSession(targetId)!;
  expect(restored.workspaceRoot).toBe(created.worktreePath);
  expect(restored.worktreePath).toBe(created.worktreePath);
  expect(restored.worktreeBranch).toBe(created.worktreeBranch);
  expect(restored.currentMode).toBe("debug");
  const history = JSON.stringify(restored.runtime.history());
  expect(history).toContain("First ACP worktree turn");
  expect(history).toContain("Second ACP worktree turn");
  expect(history).toContain("Third ACP worktree turn");
  expect(replies).toBe(3);
  await restarted.shutdown();
});

it("does not prompt or move an ACP session when worktree creation fails", async () => {
  const { config } = await fixture();
  const manager = new SessionManager(config);
  const parent = await manager.createSession(config.workspaceRoot, () => {});
  const target = await manager.createSession(config.workspaceRoot, () => {});
  let requests = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    requests += 1;
    return response();
  });

  await expect(
    manager.delegateSubagentTurn(parent.sessionId, {
      sessionId: target.sessionId,
      prompt: "Must not enter ACP history",
      parentToolCallId: "call-acp-worktree-failure",
      worktree: true,
      context: delegatedContext().context,
    }),
  ).rejects.toThrow();
  expect(requests).toBe(0);
  expect(manager.getSession(target.sessionId)).toMatchObject({
    workspaceRoot: config.workspaceRoot,
    workLocation: "local",
  });
  expect(JSON.stringify(manager.getSession(target.sessionId)?.runtime.history())).not.toContain(
    "Must not enter ACP history",
  );
  await manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: target.sessionId,
    prompt: "ACP recovery after failure",
    parentToolCallId: "call-acp-worktree-recovery",
    context: delegatedContext().context,
  });
  expect(requests).toBe(1);
  expect(JSON.stringify(manager.getSession(target.sessionId)?.runtime.history())).toContain(
    "ACP recovery after failure",
  );
  await manager.shutdown();
});

it("rejects a second ACP writer throughout ordinary-turn interruption", async () => {
  const { config } = await fixture();
  const manager = new SessionManager(config);
  const parent = await manager.createSession(config.workspaceRoot, () => {});
  const secondParent = await manager.createSession(config.workspaceRoot, () => {});
  const target = await manager.createSession(config.workspaceRoot, () => {});
  setLlmFetchTransportOverrideForTests(async () => response());
  const session = manager["sessions"].get(target.sessionId)!;
  session.turnActive = true;
  let releaseOperations!: () => void;
  session.operations = new Promise<void>((resolve) => {
    releaseOperations = resolve;
  });

  const continuation = manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: target.sessionId,
    prompt: "Continue after interruption",
    parentToolCallId: "call-acp-interrupt",
    context: delegatedContext().context,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await expect(
    manager.delegateSubagentTurn(secondParent.sessionId, {
      sessionId: target.sessionId,
      prompt: "Must not interrupt the first ACP writer",
      parentToolCallId: "call-acp-second-during-interruption",
      context: delegatedContext().context,
    }),
  ).rejects.toThrow(/already being prompted by another agent/);
  releaseOperations();
  await continuation;
  const history = JSON.stringify(manager.getSession(target.sessionId)?.runtime.history());
  expect(history).toContain("Continue after interruption");
  expect(history).not.toContain("Must not interrupt the first ACP writer");
  await manager.shutdown();
});
