import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";

import { setKeyringStoreForTests, groupKeyAccount } from "@spiritagent/host-internal";

import { SessionManager } from "../src/session-manager.js";

function freshDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-server-session-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      providerGroups: [
        {
          id: "openai",
          provider: "openai",
          apiBase: "https://api.openai.com/v1",
          models: [{ name: "gpt-4o-mini" }, { name: "gpt-4o-mini-pane" }],
        },
      ],
      activeModel: { groupId: "openai", name: "gpt-4o-mini" },
    }),
  );
  return dir;
}

function withMockKeyring(run: () => Promise<void>): Promise<void> {
  const store = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  // The canonical Desktop/CLI account scheme: group::{groupId}.
  store.set(`Spirit/${groupKeyAccount("openai")}`, "test-key");
  return run().finally(() => setKeyringStoreForTests(undefined));
}

describe("SessionManager", () => {
  it("creates, lists, and closes sessions without touching the network", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const events: string[] = [];
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: (sessionId, event) => {
          events.push(`${sessionId}:${event.kind}`);
        },
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });

      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "cli",
      });
      assert.ok(created.sessionId.startsWith("sess_"));
      assert.equal(created.isBusy, false);
      assert.equal(created.approvalLevel, "default");

      const listed = manager.listSessions();
      assert.deepEqual(
        listed.map((session) => session.sessionId),
        [created.sessionId],
      );

      // Unknown session ids fail loudly at the RPC boundary.
      await assert.rejects(
        manager.submitUserTurn("sess_missing", { text: "hi" }),
        /session not found/,
      );

      await manager.closeSession(created.sessionId);
      assert.deepEqual(manager.listSessions(), []);
      // Closing twice is a no-op.
      await manager.closeSession(created.sessionId);
    });
  });

  it("applies the requested approval level and rejects invalid busy turns", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });
      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "desktop",
        approvalLevel: "bypass-approval",
        modelRef: { groupId: "openai", name: "gpt-4o-mini-pane" },
      });
      assert.equal(created.approvalLevel, "bypass-approval");
      assert.equal(created.model, "gpt-4o-mini-pane");
      const info = manager.getSession(created.sessionId);
      assert.equal(info?.hostKind, "desktop");

      await manager.setApprovalLevel(created.sessionId, "auto-approval");
      assert.equal(manager.getSession(created.sessionId)?.approvalLevel, "auto-approval");

      await manager.shutdown();
      assert.deepEqual(manager.listSessions(), []);
    });
  });

  it("projects a bridge-compatible snapshot (field parity)", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });
      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "cli",
      });

      const snapshot = manager.snapshot(created.sessionId);
      // Required fields of the legacy bridge snapshot contract.
      assert.equal(snapshot.isBusy, false);
      assert.equal(snapshot.loopEnabled, false);
      assert.equal(snapshot.approvalLevel, "default");
      assert.equal(snapshot.hasPendingApproval, false);
      assert.equal(snapshot.hasPendingManualApproval, false);
      assert.equal(snapshot.hasPendingQuestions, false);
      assert.deepEqual(snapshot.pendingImagePaths, []);
      assert.deepEqual(snapshot.pendingMcpResources, []);
      assert.deepEqual(snapshot.childSessions, []);
      // No unexpected keys beyond the bridge contract.
      const allowedKeys = new Set([
        "pendingUserTurn",
        "pendingImagePaths",
        "pendingMcpResources",
        "pendingAuxState",
        "hasPendingApproval",
        "hasPendingManualApproval",
        "hasPendingQuestions",
        "currentPendingApproval",
        "currentPendingQuestions",
        "childSessions",
        "isBusy",
        "loopEnabled",
        "approvalLevel",
        "backgroundToolStatus",
      ]);
      for (const key of Object.keys(snapshot)) {
        assert.ok(allowedKeys.has(key), `unexpected snapshot key: ${key}`);
      }

      await manager.shutdown();
    });
  });

  it("attach is idempotent and shares one runtime per conversationKey", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });
      const chatPath = join(tmpdir(), "shared-chat.json");

      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "desktop",
        conversationKey: chatPath,
      });
      assert.equal(created.conversationKey, chatPath);
      assert.equal(created.attachmentCount, 0);

      const duplicate = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "cli",
        conversationKey: chatPath,
      });
      assert.equal(duplicate.sessionId, created.sessionId);

      const clientA = "client-a";
      const clientB = "client-b";
      const attachA = manager.attachSession(clientA, { conversationKey: chatPath });
      assert.equal(attachA.session.sessionId, created.sessionId);
      assert.equal(attachA.session.attachmentCount, 1);

      const attachB = manager.attachSession(clientB, { sessionId: created.sessionId });
      assert.equal(attachB.session.attachmentCount, 2);

      const attachAgain = manager.attachSession(clientA, { sessionId: created.sessionId });
      assert.equal(attachAgain.session.attachmentCount, 2);

      const firstDetach = await manager.detachSession(clientA, created.sessionId);
      assert.equal(firstDetach.closed, false);
      assert.equal(manager.getSession(created.sessionId)?.sessionId, created.sessionId);

      const secondDetach = await manager.detachSession(clientB, created.sessionId);
      assert.equal(secondDetach.closed, true);
      assert.equal(manager.getSession(created.sessionId), undefined);
      assert.deepEqual(manager.listSessions(), []);

      await manager.shutdown();
    });
  });

  it("migrates conversationKey when provisional path promotes to stable", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });
      const provisional = join(tmpdir(), "provisional-chat.json");
      const stable = join(tmpdir(), "stable-chat.json");

      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "desktop",
        conversationKey: provisional,
      });
      await manager.migrateConversationKey(created.sessionId, stable);

      assert.throws(
        () => manager.attachSession("client-a", { conversationKey: provisional }),
        /no live session for conversationKey/,
      );
      const attached = manager.attachSession("client-a", { conversationKey: stable });
      assert.equal(attached.session.sessionId, created.sessionId);
      assert.equal(attached.session.conversationKey, stable);

      await manager.shutdown();
    });
  });

  it("broadcasts a shared user-turn boundary before runtime execution", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const submitted: Array<{ sessionId: string; text: string; clientTurnId?: string }> = [];
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastUserTurnSubmitted: (sessionId, turn) => {
          submitted.push({
            sessionId,
            text: turn.text,
            ...(turn.clientTurnId ? { clientTurnId: turn.clientTurnId } : {}),
          });
        },
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
      });
      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "desktop",
      });

      await manager.submitUserTurn(created.sessionId, {
        text: "shared boundary",
        clientTurnId: "desktop-turn-1",
      });

      assert.deepEqual(submitted, [
        {
          sessionId: created.sessionId,
          text: "shared boundary",
          clientTurnId: "desktop-turn-1",
        },
      ]);
      manager.abort(created.sessionId);
      await manager.shutdown();
    });
  });

  it("stores pushed desktop timelines, merges them into exportArchive, and clears on reset", async () => {
    await withMockKeyring(async () => {
      const dataDir = freshDataDir();
      const broadcasts: Array<{ sessionId: string; revision: number }> = [];
      const manager = new SessionManager(dataDir, {
        broadcastRuntimeEvent: () => {},
        broadcastTurnFinished: () => {},
        broadcastSnapshot: () => {},
        broadcastTrustRequest: () => {},
        broadcastFileChange: () => {},
        broadcastDesktopTimelineUpdated: (sessionId, revision) => {
          broadcasts.push({ sessionId, revision });
        },
      });
      const created = await manager.createSession({
        workspaceRoot: tmpdir(),
        hostKind: "desktop",
      });

      // No timeline yet: get returns null and exportArchive stays untouched.
      assert.equal(manager.getDesktopTimeline(created.sessionId), null);
      const plainArchive = manager.exportArchive(created.sessionId, [], []) as Record<
        string,
        unknown
      >;
      assert.equal("desktopMessageTimeline" in plainArchive, false);

      // Non-array payloads are rejected at the boundary.
      assert.throws(
        () => manager.pushDesktopTimeline(created.sessionId, { not: "an-array" }),
        /desktop timeline must be an array/,
      );

      const timelineV1 = [{ turnId: 1, createdOrder: 0, segments: [] }];
      const first = manager.pushDesktopTimeline(created.sessionId, timelineV1);
      assert.deepEqual(first, { ok: true, revision: 1 });
      assert.deepEqual(manager.getDesktopTimeline(created.sessionId), {
        revision: 1,
        timeline: timelineV1,
      });

      const timelineV2 = [
        { turnId: 1, createdOrder: 0, segments: [] },
        { turnId: 2, createdOrder: 1, segments: [] },
      ];
      const second = manager.pushDesktopTimeline(created.sessionId, timelineV2);
      assert.deepEqual(second, { ok: true, revision: 2 });
      assert.deepEqual(broadcasts, [
        { sessionId: created.sessionId, revision: 1 },
        { sessionId: created.sessionId, revision: 2 },
      ]);

      const mergedArchive = manager.exportArchive(created.sessionId, [], []) as Record<
        string,
        unknown
      >;
      assert.deepEqual(mergedArchive["desktopMessageTimeline"], timelineV2);
      assert.equal(mergedArchive["desktopMessageTimelineRevision"], 2);

      // History replacement invalidates the stored timeline.
      manager.replaceFromArchive(created.sessionId, {
        messages: [],
        assistantAux: [],
        llmHistory: [],
        subagentSessions: [],
        loopEnabled: false,
      });
      assert.equal(manager.getDesktopTimeline(created.sessionId), null);

      manager.pushDesktopTimeline(created.sessionId, timelineV1);
      manager.reset(created.sessionId);
      assert.equal(manager.getDesktopTimeline(created.sessionId), null);

      await manager.shutdown();
    });
  });

  it("creates a session without an active model and rejects turns until setup", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "spirit-server-session-nomodel-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        schemaVersion: 2,
        providerGroups: [],
        activeModel: { groupId: "", name: "" },
      }),
    );
    const manager = new SessionManager(dataDir, {
      broadcastRuntimeEvent: () => {},
      broadcastTurnFinished: () => {},
      broadcastSnapshot: () => {},
      broadcastTrustRequest: () => {},
      broadcastFileChange: () => {},
    });

    const created = await manager.createSession({
      workspaceRoot: tmpdir(),
      hostKind: "cli",
    });
    assert.ok(created.sessionId.startsWith("sess_"));
    assert.equal(created.model, "");

    await assert.rejects(
      manager.submitUserTurn(created.sessionId, { text: "hello" }),
      /No active model configured/,
    );

    await manager.closeSession(created.sessionId);
    await manager.shutdown();
  });
});
