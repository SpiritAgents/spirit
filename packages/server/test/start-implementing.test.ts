import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  buildStartImplementingPrompt,
  createLlmMessageContentFromText,
  setLlmFetchTransportOverrideForTests,
} from "@spiritagent/agent-core";
import { readSessionStorageKey, RuntimeSessionStore } from "@spiritagent/host-internal";
import { SessionManager } from "../src/session-manager.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

async function fixture(hostKind: "cli" | "desktop") {
  const root = await mkdtemp(path.join(tmpdir(), "pl-"));
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
          apiKey: "fixture",
          models: [{ name: "fixture-model" }],
        },
      ],
      activeModel: { providerId: "fixture", name: "fixture-model" },
    }),
  );
  const finished: string[] = [];
  const submitted: { text: string; clientTurnId?: string }[] = [];
  const manager = new SessionManager(dataDir, {
    broadcastRuntimeEvent: () => {},
    broadcastSnapshot: () => {},
    broadcastTrustRequest: () => {},
    broadcastFileChange: () => {},
    broadcastTurnFinished: (_id, reason) => finished.push(reason),
    broadcastUserTurnSubmitted: (_id, turn) => submitted.push(turn),
  });
  cleanups.push(() => manager.shutdown());
  const params = {
    workspaceRoot,
    hostKind,
    conversationKey: "ephemeral://plan",
    agentMode: "plan" as const,
  };
  const session = await manager.createSession(params);
  return { manager, finished, submitted, params, session, dataDir };
}

function response(createPlan = false): Response {
  const delta = createPlan
    ? {
        tool_calls: [
          {
            index: 0,
            id: "plan-call",
            type: "function",
            function: {
              name: "create_plan",
              arguments: JSON.stringify({
                name: "implementation",
                content: "# Plan\n\nImplement the fixture.",
              }),
            },
          },
        ],
      }
    : { content: "Response." };
  return new Response(
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      model: "fixture-model",
      choices: [{ index: 0, delta, finish_reason: createPlan ? "tool_calls" : "stop" }],
    })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

it.each(["cli", "desktop"] as const)(
  "%s starts the recorded plan after history compaction and restoration",
  async (hostKind) => {
    const { manager, finished, submitted, params, session, dataDir } = await fixture(hostKind);
    const requests: unknown[] = [];
    setLlmFetchTransportOverrideForTests(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return response(requests.length === 1);
    });
    await manager.submitUserTurn(session.sessionId, { text: "Prepare a plan." });
    await expect
      .poll(() => manager.snapshot(session.sessionId).currentPendingApproval?.toolName)
      .toBe("create_plan");
    await expect(manager.startImplementing(session.sessionId)).rejects.toThrow(
      "Finish the current turn",
    );
    await manager.replyPendingApproval(session.sessionId, { kind: "allow" });
    await expect.poll(() => finished.length).toBe(1);
    expect(finished[0]).toBe("completed");
    await manager.closeSession(session.sessionId);
    const store = new RuntimeSessionStore(
      dataDir,
      readSessionStorageKey(dataDir, params.conversationKey)!,
    );
    const saved = (await store.read())!;
    expect(saved.activePlanPath).toMatch(/implementation\.md$/);
    await store.save({
      ...saved,
      archive: {
        ...saved.archive,
        llmHistory: [
          {
            role: "system",
            content: createLlmMessageContentFromText("Prior planning was compacted."),
          },
        ],
      },
    });
    const restored = await manager.createSession({
      workspaceRoot: params.workspaceRoot,
      hostKind,
      conversationKey: params.conversationKey,
    });
    expect(restored.restoredFromDisk).toBe(true);
    await manager.startImplementing(restored.sessionId, "approval-action");
    await expect.poll(() => finished.length).toBe(2);
    expect(submitted.at(-1)).toMatchObject({
      clientTurnId: "approval-action",
      text: buildStartImplementingPrompt(saved.activePlanPath),
    });
    expect(JSON.stringify(requests.at(-1))).toContain("You are in Agent mode.");
    expect(JSON.stringify(requests.at(-1))).toContain(saved.activePlanPath!);
    await manager.reset(restored.sessionId);
    await manager.startImplementing(restored.sessionId);
    await expect.poll(() => finished.length).toBe(3);
    expect(submitted.at(-1)?.text).toBe(buildStartImplementingPrompt());
    expect(finished).toEqual(["completed", "completed", "completed"]);
  },
);

it("missing paths use the shared recovery prompt rather than a hidden create_plan tool", async () => {
  const { manager, session, submitted, finished } = await fixture("cli");
  setLlmFetchTransportOverrideForTests(async () => response());
  await manager.startImplementing(session.sessionId);
  await expect.poll(() => finished.length).toBe(1);
  expect(submitted[0]?.text).toBe(buildStartImplementingPrompt());
  expect(submitted[0]?.text).not.toContain("create_plan");
  expect(finished).toEqual(["completed"]);
});

it("rejects an implementation action while busy without changing the current mode", async () => {
  const { manager, session, finished } = await fixture("desktop");
  let release: (response: Response) => void = () => {
    throw new Error("No request is waiting.");
  };
  const waiting = new Promise<Response>((resolve) => {
    release = resolve;
  });
  setLlmFetchTransportOverrideForTests(() => waiting);
  await manager.submitUserTurn(session.sessionId, { text: "Investigate first." });
  await expect(manager.startImplementing(session.sessionId)).rejects.toThrow(
    "Finish the current turn",
  );
  expect(JSON.stringify(await manager.exportState(session.sessionId))).toContain(
    "You are in Plan mode.",
  );
  release(response());
  await expect.poll(() => finished.length).toBe(1);
});
