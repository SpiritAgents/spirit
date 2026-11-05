import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createLlmMessageContentFromTextAndImages,
  setLlmFetchTransportOverrideForTests,
  type ChatArchive,
  type JsonValue,
  type RuntimeEvent,
} from "@spiritagent/agent-core";
import {
  createBackgroundTaskOwner,
  ensureSessionStorageKey,
  FileBackgroundTaskStore,
  RuntimeSessionStore,
} from "@spiritagent/host-internal";
import { SessionManager } from "../src/session-manager.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "bs-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "d");
  const workspaceRoot = path.join(root, "w");
  await Promise.all([mkdir(dataDir), mkdir(workspaceRoot)]);
  await writeFile(
    path.join(dataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [
        {
          id: "fixture",
          transportKind: "openai-compatible",
          sdk: "@ai-sdk/openai-compatible",
          apiBase: "https://fixture.invalid/v1",
          apiKey: "fixture-key",
          models: [{ name: "fixture-model" }, { name: "next-model" }],
        },
      ],
      activeModel: { providerId: "fixture", name: "fixture-model" },
    }),
  );
  return { root, dataDir, workspaceRoot };
}

function managerFor(dataDir: string) {
  const events: RuntimeEvent<JsonValue>[] = [];
  const finished: string[] = [];
  const manager = new SessionManager(dataDir, {
    broadcastRuntimeEvent: (_id, event) => events.push(event),
    broadcastTurnFinished: (_id, reason) => finished.push(reason),
    broadcastSnapshot: () => {},
    broadcastTrustRequest: () => {},
    broadcastFileChange: () => {},
  });
  cleanups.push(() => manager.shutdown());
  return { manager, events, finished };
}

function response(text: string, tool?: { name: string; arguments: object }): Response {
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
    : { content: text };
  const chunk = {
    id: "fixture-completion",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture-model",
    choices: [{ index: 0, delta, finish_reason: tool ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function scriptedModel(
  answer: (
    request: Record<string, unknown>,
    index: number,
    signal?: AbortSignal | null,
  ) => Response | Promise<Response>,
) {
  const requests: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests((_url, init) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    return Promise.resolve(answer(request, requests.length - 1, init?.signal));
  });
  return requests;
}

const nodeCommand = (script: string) =>
  `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;

function gatedShell(gate: string) {
  return nodeCommand(
    `const fs=require('node:fs'); console.log('started'); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(gate)})){console.log('done');clearInterval(timer);}},20);`,
  );
}

async function waitUntil(predicate: () => boolean | Promise<boolean>) {
  await expect.poll(predicate, { timeout: 8_000, interval: 20 }).toBe(true);
}

it("keeps detached tasks and output paths across promotion and model changes, then wakes once", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager, finished, events } = managerFor(dataDir);
  const gate = path.join(root, "release");
  const requests = scriptedModel((_body, index) =>
    index === 0
      ? response("", {
          name: "shell",
          arguments: {
            command: gatedShell(gate),
            reason: "Run the local fixture.",
            background: { delay: 0 },
          },
        })
      : response("parent response"),
  );
  const session = await manager.createSession({
    workspaceRoot,
    hostKind: "desktop",
    conversationKey: "ephemeral://background",
    approvalLevel: "bypass-approval",
  });
  manager.attachSession("first", { sessionId: session.sessionId });
  await manager.submitUserTurn(session.sessionId, { text: "Run the requested check." });
  await waitUntil(() => finished.length === 1);
  const task = manager.snapshot(session.sessionId).backgroundTasks![0]!;
  expect(task.background).toBe(true);
  expect(task.status).toBe("running");
  expect(await manager.detachSession("first", session.sessionId)).toEqual({ closed: false });
  await manager.migrateConversationKey(session.sessionId, "ephemeral://promoted");
  await manager.replaceConfig(session.sessionId, { providerId: "fixture", name: "next-model" });
  expect(manager.snapshot(session.sessionId).backgroundTasks![0]!.outputPath).toBe(task.outputPath);
  await writeFile(gate, "");
  await waitUntil(() => finished.length === 2);
  expect(requests).toHaveLength(3);
  expect(requests[2]!.model).toBe("next-model");
  expect(JSON.stringify(requests[2])).toContain(task.id);
  expect(await readFile(task.outputPath, "utf8")).toContain("done");
  expect(events.filter((event) => event.kind === "background-task-notification")).toHaveLength(1);
  expect(
    manager.attachSession("second", { conversationKey: "ephemeral://promoted" }).snapshot
      .backgroundTaskNotifications,
  ).toHaveLength(1);
});

it("foreground cancellation leaves detached work alive and stop_task delivers one terminal notification", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager, finished, events } = managerFor(dataDir);
  let taskId = "";
  const requests = scriptedModel((_body, index, signal) => {
    if (index === 0)
      return response("", {
        name: "shell",
        arguments: {
          command: gatedShell(path.join(root, "never")),
          reason: "Run the local fixture.",
          background: { delay: 0 },
        },
      });
    if (index === 2)
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    if (index === 3) return response("", { name: "stop_task", arguments: { task_id: taskId } });
    return response("finished");
  });
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "cli",
    conversationKey: "ephemeral://cancel",
    approvalLevel: "bypass-approval",
  });
  await manager.submitUserTurn(sessionId, { text: "Start the check." });
  await waitUntil(() => finished.length === 1);
  taskId = manager.snapshot(sessionId).backgroundTasks![0]!.id;
  await manager.submitUserTurn(sessionId, { text: "A different foreground request." });
  await waitUntil(() => requests.length === 3);
  manager.abort(sessionId);
  expect(manager.snapshot(sessionId).backgroundTasks![0]!.status).toBe("running");
  await manager.submitUserTurn(sessionId, { text: "Stop the check." });
  await waitUntil(() => finished.length === 3);
  expect(manager.snapshot(sessionId).backgroundTasks![0]!.status).toBe("stopped");
  expect(events.filter((event) => event.kind === "background-task-notification")).toHaveLength(1);
  expect(requests).toHaveLength(5);
});

it("reset and explicit close stop work while reset preserves an intentionally empty archive", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager, finished } = managerFor(dataDir);
  scriptedModel((_body, index) =>
    index % 2 === 0
      ? response("", {
          name: "shell",
          arguments: {
            command: gatedShell(path.join(root, "never")),
            reason: "Run the local fixture.",
            background: { delay: 0 },
          },
        })
      : response("dispatched"),
  );
  const params = {
    workspaceRoot,
    hostKind: "desktop" as const,
    conversationKey: "ephemeral://reset",
    approvalLevel: "bypass-approval" as const,
  };
  const { sessionId } = await manager.createSession(params);
  await manager.submitUserTurn(sessionId, { text: "Start the check." });
  await waitUntil(() => finished.length === 1);
  await manager.reset(sessionId);
  expect(manager.snapshot(sessionId).backgroundTasks![0]!.status).toBe("stopped");
  expect((manager.exportArchive(sessionId, [], []) as ChatArchive).llmHistory).toHaveLength(0);
  await manager.closeSession(sessionId);
  const restored = await manager.createSession(params);
  expect(restored.restoredFromDisk).toBe(true);
  expect(
    (manager.exportArchive(restored.sessionId, [], []) as ChatArchive).llmHistory,
  ).toHaveLength(0);
  await manager.submitUserTurn(restored.sessionId, { text: "Start another check." });
  await waitUntil(() => finished.length === 2);
  const task = manager
    .snapshot(restored.sessionId)
    .backgroundTasks!.find((entry) => entry.status === "running")!;
  await manager.closeSession(restored.sessionId);
  const record = JSON.parse(
    await readFile(path.join(path.dirname(task.outputPath), `${task.id}.json`), "utf8"),
  );
  expect(record.status).toBe("stopped");
});

it("restores interrupted work and its UI timeline without invoking the model or duplicating notices", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const conversationKey = "ephemeral://recovery";
  const storageKey = await ensureSessionStorageKey(dataDir, conversationKey);
  const owner = await createBackgroundTaskOwner(dataDir);
  const tasks = new FileBackgroundTaskStore({
    spiritDataDir: dataDir,
    sessionKey: storageKey,
    owner: owner.owner,
  });
  const task = await tasks.create({
    sessionKey: storageKey,
    runtimeId: "main",
    toolCallId: "orphan",
    kind: "shell",
    input: "previous check",
    argumentsJson: "{}",
  });
  await tasks.save({ ...task, status: "running", background: true, elapsedMs: 175 });
  await new RuntimeSessionStore(dataDir, storageKey).save({
    version: 1,
    sessionKey: storageKey,
    workspaceRoot,
    agentMode: "plan",
    initialized: true,
    archive: {
      messages: [],
      assistantAux: [],
      llmHistory: [
        {
          role: "user",
          content: createLlmMessageContentFromTextAndImages("The original goal."),
        },
      ],
    },
    desktopTimeline: {
      revision: 4,
      timeline: [{ id: "existing-turn" }],
      updatedAtUnixMs: Date.now(),
    },
  });
  await owner.close();
  const requests = scriptedModel(() => response("unexpected"));
  const { manager } = managerFor(dataDir);
  const params = { workspaceRoot, hostKind: "desktop" as const, conversationKey };
  const first = await manager.createSession(params);
  const snapshot = manager.snapshot(first.sessionId);
  expect(snapshot.backgroundTasks![0]).toMatchObject({
    status: "interrupted",
    elapsedMs: 175,
    elapsedApproximate: true,
  });
  expect(snapshot.backgroundTaskNotifications).toHaveLength(1);
  expect(manager.getDesktopTimeline(first.sessionId)).toEqual({
    revision: 4,
    timeline: [{ id: "existing-turn" }],
  });
  await manager.replaceConfig(first.sessionId);
  expect(JSON.stringify(await manager.exportState(first.sessionId))).toContain(
    "You are in Plan mode",
  );
  await manager.closeSession(first.sessionId);
  const second = await manager.createSession(params);
  expect(manager.snapshot(second.sessionId).backgroundTaskNotifications).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 75));
  expect(requests).toHaveLength(0);
});

it("runs a worktree child with scoped instructions, branch, filesystem, and isolated reply events", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspaceRoot, stdio: "pipe" });
  git("init", "--quiet");
  await writeFile(path.join(workspaceRoot, "AGENTS.md"), "Use the fixture marker.\n");
  await writeFile(path.join(workspaceRoot, "tracked.txt"), "committed");
  git("add", "AGENTS.md", "tracked.txt");
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
  await writeFile(path.join(workspaceRoot, "tracked.txt"), "dirty");
  await writeFile(path.join(workspaceRoot, "local-only.txt"), "untracked");
  const { manager, finished, events } = managerFor(dataDir);
  const requests = scriptedModel((_body, index) => {
    if (index === 0)
      return response("", {
        name: "subagent",
        arguments: {
          prompt: "Inspect the fixture worktree.",
          worktree: true,
          background: { type: false },
        },
      });

    if (index === 1)
      return response("", {
        name: "shell",
        arguments: {
          command: nodeCommand(
            "const fs=require('node:fs');console.log(JSON.stringify({cwd:process.cwd(),tracked:fs.readFileSync('tracked.txt','utf8'),local:fs.existsSync('local-only.txt')}));",
          ),
          reason: "Inspect the fixture worktree.",
          background: { type: false },
        },
      });
    return response(index === 2 ? "Child final response." : "Parent final response.");
  });
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "cli",
    conversationKey: "ephemeral://worktree",
    approvalLevel: "bypass-approval",
  });
  await manager.submitUserTurn(sessionId, { text: "Delegate the worktree inspection." });
  await waitUntil(() => finished.length === 1);
  expect(requests).toHaveLength(4);
  const snapshot = manager.snapshot(sessionId);
  const child = snapshot.childSessions![0]!;
  expect(child.status).toBe("completed");
  expect(JSON.stringify(requests[1])).toContain(child.worktreePath!);
  expect(JSON.stringify(requests[1])).toContain(child.worktreeBranch!);
  expect(JSON.stringify(requests[1])).toContain("Use the fixture marker.");
  const shell = snapshot.backgroundTasks!.find((entry) => entry.kind === "shell")!;
  const output = JSON.parse((await readFile(shell.outputPath, "utf8")).trim());
  expect(output).toEqual({ cwd: child.worktreePath, tracked: "committed", local: false });
  expect(await readFile(path.join(child.worktreePath!, "tracked.txt"), "utf8")).toBe("committed");
  expect(
    events
      .filter((event) => event.kind === "assistant-chunk")
      .map((event) => event.text)
      .join(""),
  ).not.toContain("Child final response.");
});

it("keeps a running child on its original model and mode until its own background work finishes", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager, finished } = managerFor(dataDir);
  const gate = path.join(root, "release-child");
  const childRequests: Record<string, unknown>[] = [];
  let parentRequests = 0;
  scriptedModel((request) => {
    const tools = request.tools as { function: { name: string } }[];
    const isChild = !tools.some((tool) => tool.function.name === "subagent");
    if (isChild) {
      childRequests.push(request);
      return childRequests.length === 1
        ? response("", {
            name: "shell",
            arguments: {
              command: gatedShell(gate),
              reason: "Run the child fixture.",
              background: { delay: 0 },
            },
          })
        : response("Child progress.");
    }
    return ++parentRequests === 1
      ? response("", {
          name: "subagent",
          arguments: { prompt: "Run the child fixture.", background: { delay: 0 } },
        })
      : response("Parent progress.");
  });
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "cli",
    conversationKey: "ephemeral://child-lifecycle",
    approvalLevel: "bypass-approval",
  });
  await manager.submitUserTurn(sessionId, { text: "Delegate the fixture." });
  await waitUntil(
    () =>
      finished.length === 1 &&
      manager
        .snapshot(sessionId)
        .backgroundTasks!.some((task) => task.status === "waiting-for-background"),
  );
  await manager.setAgentMode(sessionId, "ask");
  await manager.replaceConfig(sessionId, { providerId: "fixture", name: "next-model" });
  await writeFile(gate, "");
  await waitUntil(() => finished.length === 2);
  expect(childRequests).toHaveLength(3);
  expect(childRequests.every((request) => request.model === "fixture-model")).toBe(true);
  expect(
    (childRequests[2]!.tools as { function: { name: string } }[]).some(
      (tool) => tool.function.name === "shell",
    ),
  ).toBe(true);
  expect(
    manager.snapshot(sessionId).backgroundTasks!.every((task) => task.status === "completed"),
  ).toBe(true);
});
