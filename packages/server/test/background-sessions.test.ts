import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createLlmMessageContentFromTextAndImages,
  setLlmFetchTransportOverrideForTests,
  type ChatArchive,
  type BackgroundTaskRecord,
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
  const childEvents: RuntimeEvent<JsonValue>[] = [];
  const finished: string[] = [];
  const snapshots: ReturnType<SessionManager["snapshot"]>[] = [];
  const manager = new SessionManager(dataDir, {
    broadcastRuntimeEvent: (_id, event) => events.push(event),
    broadcastSubagentEvents: (_id, drains) =>
      childEvents.push(...drains.flatMap((drain) => drain.events)),
    broadcastTurnFinished: (_id, reason) => finished.push(reason),
    broadcastSnapshot: (_id, snapshot) => snapshots.push(snapshot),
    broadcastTrustRequest: () => {},
    broadcastFileChange: () => {},
  });
  cleanups.push(() => manager.shutdown());
  return { manager, events, childEvents, finished, snapshots };
}

function response(
  text: string,
  tool?: { name: string; arguments: object } | { name: string; arguments: object }[],
): Response {
  const tools = tool ? (Array.isArray(tool) ? tool : [tool]) : [];
  const delta = tools.length
    ? {
        tool_calls: tools.map((entry, index) => ({
          index,
          id: `call-${entry.name}${tools.length > 1 ? `-${index}` : ""}`,
          type: "function",
          function: { name: entry.name, arguments: JSON.stringify(entry.arguments) },
        })),
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

it("rejects a second host opening an idle session with no task records", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const first = managerFor(dataDir).manager;
  const second = managerFor(dataDir).manager;
  const input = {
    workspaceRoot,
    hostKind: "desktop" as const,
    conversationKey: "ephemeral://idle-owner",
  };
  const session = await first.createSession(input);
  expect(first.snapshot(session.sessionId).backgroundTasks).toEqual([]);
  await expect(second.createSession(input)).rejects.toThrow("active in another runtime");
  await first.closeSession(session.sessionId);
  await expect(second.createSession(input)).resolves.toHaveProperty("sessionId");
});

async function waitUntil(predicate: () => boolean | Promise<boolean>) {
  await expect.poll(predicate, { timeout: 8_000, interval: 20 }).toBe(true);
}

async function parallelInputFixture(kind: "approval" | "questions", rounds = 1) {
  const { dataDir, workspaceRoot } = await fixture();
  const { manager, childEvents } = managerFor(dataDir);
  let inputRequests = 0;
  scriptedModel((body) => {
    const messages = body["messages"] as { role: string; content: unknown }[];
    const child = JSON.stringify(
      messages.find((message) => message.role === "user")?.content,
    ).includes("Parallel child");
    const results = messages.filter((message) => message.role === "tool").length;
    if (!child) {
      return results
        ? response("Parent response.")
        : response(
            "",
            ["A", "B"].map((name) => ({
              name: "subagent",
              arguments: { prompt: `Parallel child ${name}`, background: { delay: 0 } },
            })),
          );
    }
    if (results >= rounds) return response("Child response.");
    inputRequests += 1;
    return kind === "approval"
      ? response("", {
          name: "shell",
          arguments: {
            command: nodeCommand("console.log('completed')"),
            reason: "Inspect the fixture.",
            background: { type: false },
          },
        })
      : response("", {
          name: "ask_questions",
          arguments: { questions: [{ id: "choice", title: "Which option?" }] },
        });
  });
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "cli",
    approvalLevel: "default",
  });
  await manager.submitUserTurn(sessionId, { text: "Run two independent tasks." });
  const tasks = () =>
    manager.snapshot(sessionId).backgroundTasks?.filter((task) => task.kind === "subagent") ?? [];
  await waitUntil(() => tasks().filter((task) => task.status === "blocked").length === 2);
  const pending = () => {
    const snapshot = manager.snapshot(sessionId);
    return kind === "approval" ? snapshot.currentPendingApproval : snapshot.currentPendingQuestions;
  };
  const reply = (requestId: string | undefined) =>
    kind === "approval"
      ? manager.replyPendingApproval(sessionId, { kind: "allow" }, requestId)
      : manager.replyPendingQuestions(sessionId, { status: "skipped" }, requestId);
  const requests = () =>
    childEvents.flatMap<NonNullable<ReturnType<typeof pending>>>((event) => {
      if (kind === "approval" && event.kind === "approval-requested") return [event.approval];
      if (kind === "questions" && event.kind === "questions-requested") return [event.questions];
      return [];
    });
  await waitUntil(() => requests().length === 2);
  return {
    manager,
    sessionId,
    tasks,
    pending,
    reply,
    requests,
    inputRequests: () => inputRequests,
  };
}

it.each(["approval", "questions"] as const)(
  "rejects a stale %s reply instead of answering the next parallel child",
  async (kind) => {
    const { pending, reply, tasks, requests } = await parallelInputFixture(kind);
    const first = pending()!;
    expect(first.requestId).toBeTruthy();
    const second = requests().find((request) => request.requestId !== first.requestId)!;
    expect(second.toolCallId).toBe(first.toolCallId);
    await reply(second.requestId);
    expect(pending()?.requestId).toBe(first.requestId);
    await expect(reply(second.requestId)).rejects.toThrow("no longer pending");
    expect(pending()?.requestId).toBe(first.requestId);
    await reply(first.requestId);
    await waitUntil(() => tasks().every((task) => task.status === "completed"));
    await expect(reply(second.requestId)).rejects.toThrow("no longer pending");
  },
);

it.each(["approval", "questions"] as const)(
  "settles all parallel and subsequent %s requests after the last client disconnects",
  async (kind) => {
    const { manager, pending, tasks, inputRequests } = await parallelInputFixture(kind, 2);
    manager.handleNoClientsRemaining();
    await waitUntil(() => tasks().every((task) => task.status === "completed"));
    expect(pending()).toBeUndefined();
    expect(inputRequests()).toBe(4);
  },
);

it("starts two streamed default-delay shells before either hands off", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager } = managerFor(dataDir);
  const requests = scriptedModel(() =>
    response(
      "",
      [0, 1].map(() => ({
        name: "shell",
        arguments: { command: gatedShell(path.join(root, "never")), reason: "Run the fixture." },
      })),
    ),
  );
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "cli",
    conversationKey: "ephemeral://parallel-default",
    approvalLevel: "bypass-approval",
  });
  await manager.submitUserTurn(sessionId, { text: "Run independent checks." });
  await waitUntil(async () => {
    const tasks = manager.snapshot(sessionId).backgroundTasks ?? [];
    if (tasks.length !== 2) return false;
    const outputs = await Promise.all(tasks.map((task) => readFile(task.outputPath, "utf8")));
    return outputs.every((output) => output.includes("started"));
  });
  const tasks = manager.snapshot(sessionId).backgroundTasks!;
  expect(tasks.every((task) => !task.background && task.status === "running")).toBe(true);
  expect(finished).toEqual([]);
  expect(requests).toHaveLength(1);
  await manager.closeSession(sessionId);
  for (const task of tasks) {
    const record = JSON.parse(
      await readFile(path.join(path.dirname(task.outputPath), `${task.id}.json`), "utf8"),
    );
    expect(record.status).toBe("stopped");
  }
});

it("restores offline background replies after the acknowledged UI checkpoint without running the model", async () => {
  const { root, dataDir, workspaceRoot } = await fixture();
  const { manager } = managerFor(dataDir);
  const gate = path.join(root, "release");
  const requests = scriptedModel((_body, index) =>
    index === 0
      ? response("", {
          name: "shell",
          arguments: {
            command: gatedShell(gate),
            reason: "Run the fixture.",
            background: { delay: 0 },
          },
        })
      : response(index === 1 ? "The task is running." : "The offline task is complete."),
  );
  const key = "ephemeral://presentation";
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "desktop",
    conversationKey: key,
    approvalLevel: "bypass-approval",
  });
  await manager.submitUserTurn(sessionId, { text: "Start the task." });
  await waitUntil(() => finished.length === 1);
  const checkpoint = manager.exportArchive(sessionId, [], []) as ChatArchive & {
    presentation: { sequence: number; entries: unknown[] };
  };
  await manager.pushDesktopTimeline(sessionId, [], checkpoint.presentation.sequence);
  await writeFile(gate, "");
  await waitUntil(() => finished.length === 2);
  await manager.closeSession(sessionId);
  const resumed = managerFor(dataDir).manager;
  const reopened = await resumed.createSession({
    workspaceRoot,
    hostKind: "desktop",
    conversationKey: key,
  });
  const archive = resumed.exportArchive(reopened.sessionId, [], []) as ChatArchive & {
    presentation: { sequence: number; entries: unknown[] };
    desktopPresentationSequence: number;
  };
  expect(archive.desktopPresentationSequence).toBe(checkpoint.presentation.sequence);
  const events = JSON.stringify(archive.presentation.entries);
  expect(events).toContain("The offline task is complete.");
  expect(events).toContain("background-task-notification");
  expect(events).not.toContain("The task is running.");
  expect(requests).toHaveLength(3);
  await expect(
    resumed.pushDesktopTimeline(reopened.sessionId, [], checkpoint.presentation.sequence - 1),
  ).rejects.toThrow("older than the saved");
  await resumed.pushDesktopTimeline(reopened.sessionId, [], archive.presentation.sequence);
  expect(
    (resumed.exportArchive(reopened.sessionId, [], []) as typeof archive).presentation.entries,
  ).toEqual([]);
});

it("resolves streamed tool approvals while the foreground poll awaits their outcomes", async () => {
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
      : response("response"),
  );
  const { sessionId } = await manager.createSession({
    workspaceRoot,
    hostKind: "desktop",
    approvalLevel: "default",
    conversationKey: "ephemeral://approval",
  });
  manager.attachSession("client", { sessionId });
  await manager.submitUserTurn(sessionId, { text: "Run the check." });
  await waitUntil(() => events.some((event) => event.kind === "approval-requested"));
  expect(manager.snapshot(sessionId).backgroundTasks).toHaveLength(0);
  await manager.replyPendingApproval(sessionId, { kind: "allow" });
  await waitUntil(() => finished.length === 1);
  expect(manager.snapshot(sessionId).backgroundTasks?.[0]?.status).toBe("running");
  await writeFile(gate, "");
  await waitUntil(() => finished.length === 2);
  expect(requests).toHaveLength(3);
});

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

it("retains an imported UI baseline and offline replies before the first checkpoint", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const { manager, finished } = managerFor(dataDir);
  const requests = scriptedModel(() => response("New reply."));
  const input = {
    workspaceRoot,
    hostKind: "cli" as const,
    conversationKey: "ephemeral://ui-baseline",
  };
  const { sessionId } = await manager.createSession(input);
  const timeline = [{ turnId: 1, createdOrder: 0, segments: [] }];
  await manager.replaceFromArchive(sessionId, {
    messages: [],
    assistantAux: [],
    llmHistory: [{ role: "user", content: "Imported context." }],
    desktopMessageTimeline: timeline,
  });
  await manager.submitUserTurn(sessionId, { text: "New request." });
  await waitUntil(() => finished.length === 1);
  await manager.closeSession(sessionId);
  const restored = await manager.createSession(input);
  const archive = manager.exportArchive(restored.sessionId, [], []) as {
    desktopMessageTimeline: unknown[];
    presentation: { entries: unknown[] };
  };
  expect(archive.desktopMessageTimeline).toEqual(timeline);
  expect(archive.presentation.entries).toContainEqual(
    expect.objectContaining({
      kind: "user",
      text: "New request.",
    }),
  );
  expect(archive.presentation.entries).toContainEqual(
    expect.objectContaining({
      kind: "runtime",
      event: { kind: "assistant-chunk", text: "New reply." },
    }),
  );
  expect(requests).toHaveLength(1);
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
  const { manager, finished, events, snapshots } = managerFor(dataDir);
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
    approvalLevel: "default",
  });
  await manager.submitUserTurn(sessionId, { text: "Delegate the worktree inspection." });
  await waitUntil(() =>
    snapshots.some((snapshot) => Boolean(snapshot.currentPendingApproval?.subagentSessionId)),
  );
  await expect
    .poll(
      () =>
        manager.snapshot(sessionId).backgroundTasks?.find((task) => task.kind === "subagent")
          ?.status,
    )
    .toBe("blocked");
  await manager.replyPendingApproval(sessionId, { kind: "allow" });
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

it("creates and continues native subagent sessions by ID", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const { manager } = managerFor(dataDir);
  const parent = await manager.createSession({ workspaceRoot, hostKind: "desktop" });
  let replies = 0;
  setLlmFetchTransportOverrideForTests(async () => response(`Reply ${++replies}`));

  const first = delegatedContext();
  const created = await manager.delegateSubagentTurn(parent.sessionId, {
    prompt: "First continuation",
    parentToolCallId: "call-native",
    context: first.context,
  });
  const targetId = first.updates[0]?.sessionId;
  expect(targetId).toMatch(/^sess_/);
  if (!targetId) throw new Error("Missing delegated session ID.");
  expect(created.output.summaryText).toContain("Reply 1");
  expect(created.output.summaryText).toContain(targetId);

  const second = delegatedContext();
  const continued = await manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: targetId,
    prompt: "Second continuation",
    parentToolCallId: "call-resume",
    context: second.context,
  });
  expect(continued.output.summaryText).toContain("Reply 2");
  expect(second.updates[0]?.sessionId).toBe(targetId);
  const archive = manager.exportArchive(targetId, [], []);
  expect(JSON.stringify(archive)).toContain("First continuation");
  expect(JSON.stringify(archive)).toContain("Second continuation");
  expect(JSON.stringify(archive)).toContain("Reply 2");
  expect(replies).toBe(2);
});

it("rejects a second agent while a target turn is active and allows the next one", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const { manager } = managerFor(dataDir);
  const firstParent = await manager.createSession({ workspaceRoot, hostKind: "desktop" });
  const secondParent = await manager.createSession({ workspaceRoot, hostKind: "desktop" });
  const target = await manager.createSession({
    workspaceRoot,
    hostKind: "desktop",
    sessionKind: "subagent",
    subagentOrigin: { parentSessionId: firstParent.sessionId, parentToolCallId: "call-target" },
  });
  let releaseFirst!: () => void;
  let calls = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((resolve) => {
        releaseFirst = () => resolve(response("First done"));
      });
    }
    return response("Next done");
  });
  const first = delegatedContext();
  const firstPromise = manager.delegateSubagentTurn(firstParent.sessionId, {
    sessionId: target.sessionId,
    prompt: "First writer",
    parentToolCallId: "call-first",
    context: first.context,
  });
  await waitUntil(() => calls === 1);
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
  const archive = manager.exportArchive(target.sessionId, [], []);
  expect(JSON.stringify(archive)).toContain("First writer");
  expect(JSON.stringify(archive)).not.toContain("Second writer");
  expect(JSON.stringify(archive)).toContain("Third writer");
});

it("interrupts an ordinary target turn before continuing it", async () => {
  const { dataDir, workspaceRoot } = await fixture();
  const { manager, finished } = managerFor(dataDir);
  const parent = await manager.createSession({ workspaceRoot, hostKind: "desktop" });
  const target = await manager.createSession({ workspaceRoot, hostKind: "desktop" });
  let calls = 0;
  setLlmFetchTransportOverrideForTests(async () => {
    calls += 1;
    return response("Continued reply");
  });
  const internal = manager["sessions"].get(target.sessionId)!;
  internal.turnActive = true;
  internal.runtimeResult.runtime.replaceHistory([
    ...internal.runtimeResult.runtime.history(),
    { role: "user", content: [{ type: "text", text: "Ordinary old turn" }] },
  ]);
  const continuation = manager.delegateSubagentTurn(parent.sessionId, {
    sessionId: target.sessionId,
    prompt: "Continued turn",
    parentToolCallId: "call-continue",
    context: delegatedContext().context,
  });
  const result = await continuation;
  expect(result.output.summaryText).toContain("Continued reply");
  expect(finished).toContain("cancelled");
  const archive = manager.exportArchive(target.sessionId, [], []);
  expect(JSON.stringify(archive)).toContain("Ordinary old turn");
  expect(JSON.stringify(archive)).toContain("Continued turn");
});
