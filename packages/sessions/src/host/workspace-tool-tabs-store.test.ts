import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { DesktopWorkspaceExtensionToolTab } from "../types.js";
import { WorkspaceToolTabsStore } from "./workspace-tool-tabs-store.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "spirit-workspace-tabs-"));
  return { directory, filePath: join(directory, "workspace-tool-tabs.json") };
}

function extensionTab(
  scope: DesktopWorkspaceExtensionToolTab["scope"] = { kind: "window-shared" },
) {
  return {
    id: "instance-1",
    kind: "extension",
    extensionId: "personal/demo",
    contributionId: "notes",
    instanceId: "instance-1",
    channelId: "channel-1",
    scope,
    initialParams: { text: "restored" },
    tabTitle: "runtime title",
    tabDirty: true,
  } satisfies DesktopWorkspaceExtensionToolTab;
}

test("store restores built-in tabs and strips runtime-only state", async () => {
  const { directory, filePath } = await fixture();
  try {
    const store = new WorkspaceToolTabsStore(filePath);
    const initial = await store.getSnapshot("main");
    const browser = initial.tabs.find(
      (tab) => tab.kind === "built-in" && tab.builtInKind === "browser",
    );
    assert.ok(browser && browser.kind === "built-in");
    await store.setSnapshot({
      windowId: "main",
      expectedRevision: initial.revision,
      tabs: [{ ...browser, browserUrl: "http://127.0.0.1:4173", tabTitle: "Local" }],
      activeTabId: browser.id,
    });

    const restored = new WorkspaceToolTabsStore(filePath);
    const snapshot = await restored.getSnapshot("main");
    assert.equal(snapshot.activeTabId, browser.id);
    assert.deepEqual(snapshot.tabs[0], {
      id: browser.id,
      kind: "built-in",
      builtInKind: "browser",
      browserUrl: "http://127.0.0.1:4173",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store waits for contexts before pruning extension tabs and omits runtime chrome", async () => {
  const { directory, filePath } = await fixture();
  try {
    const store = new WorkspaceToolTabsStore(filePath);
    const workspaceTab = extensionTab({ kind: "workspace", workspaceRoot: "/repo" });
    await store.setSnapshot({
      windowId: "main",
      expectedRevision: 0,
      tabs: [workspaceTab],
      activeTabId: workspaceTab.id,
    });
    const beforeReady = await store.getSnapshot("main");
    assert.equal(beforeReady.restoreReady, false);
    assert.equal(beforeReady.tabs.length, 1);

    await store.markRestoreReady({
      workspaceRoots: new Set(["/repo"]),
      sessionKeys: new Set(),
      extensions: [
        {
          id: "personal/demo",
          displayName: "Demo",
          version: "1.0.0",
          enabled: true,
          supportedHosts: ["desktop"],
          desktopTabs: [
            {
              id: "notes",
              name: "Notes",
              path: "notes.html",
              icon: { type: "spirit", name: "globe" },
              defaultScope: "workspace",
            },
          ],
        },
      ],
    });
    const ready = await store.getSnapshot("main");
    assert.equal(ready.restoreReady, true);
    assert.equal(ready.tabs[0]?.tabTitle, "runtime title");
    const restored = await new WorkspaceToolTabsStore(filePath).getSnapshot("main");
    assert.equal(
      restored.tabs[0]?.kind === "extension" && restored.tabs[0].channelId.length > 0,
      true,
    );
    assert.notEqual((restored.tabs[0] as DesktopWorkspaceExtensionToolTab).channelId, "channel-1");
    const { channelId: _channelId, ...restoredTab } = restored
      .tabs[0] as DesktopWorkspaceExtensionToolTab;
    assert.deepEqual(restoredTab, {
      id: "instance-1",
      kind: "extension",
      extensionId: "personal/demo",
      contributionId: "notes",
      instanceId: "instance-1",
      scope: { kind: "workspace", workspaceRoot: "/repo" },
      initialParams: { text: "restored" },
    });
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.windows.main.tabs[0].tabTitle, undefined);
    assert.equal(persisted.windows.main.tabs[0].tabDirty, undefined);

    await store.markRestoreReady({
      workspaceRoots: new Set(),
      sessionKeys: new Set(),
      extensions: [],
    });
    assert.equal((await store.getSnapshot("main")).tabs.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store reconciles disabled extensions and rebinds provisional session keys", async () => {
  const { directory, filePath } = await fixture();
  try {
    const store = new WorkspaceToolTabsStore(filePath);
    const tab = extensionTab({ kind: "session", sessionKey: "todo-scope:one" });
    await store.setSnapshot({
      windowId: "main",
      expectedRevision: 0,
      tabs: [tab],
      activeTabId: tab.id,
    });
    await store.markRestoreReady({
      workspaceRoots: new Set(),
      sessionKeys: new Set(["todo-scope:one"]),
      extensions: [
        {
          id: "personal/demo",
          displayName: "Demo",
          version: "1.0.0",
          enabled: true,
          supportedHosts: ["desktop"],
          desktopTabs: [
            {
              id: "notes",
              name: "Notes",
              path: "notes.html",
              icon: { type: "spirit", name: "globe" },
              defaultScope: "session",
            },
          ],
        },
      ],
    });
    await store.rebindSessionScope("todo-scope:one", "/repo/chats/one.json");
    const rebound = await store.getSnapshot("main");
    assert.deepEqual(rebound.tabs[0]?.kind === "extension" && rebound.tabs[0].scope, {
      kind: "session",
      sessionKey: "/repo/chats/one.json",
    });

    await store.reconcileExtensions([]);
    assert.deepEqual((await store.getSnapshot("main")).tabs, []);
    const restored = await new WorkspaceToolTabsStore(filePath).getSnapshot("main");
    assert.deepEqual(restored.tabs, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("stale renderer snapshots yield to host mutations but queued renderer writes continue", async () => {
  const { directory, filePath } = await fixture();
  try {
    const store = new WorkspaceToolTabsStore(filePath);
    const initial = await store.getSnapshot("main");
    const browser = initial.tabs.find(
      (tab) => tab.kind === "built-in" && tab.builtInKind === "browser",
    );
    assert.ok(browser && browser.kind === "built-in");

    const first = await store.setSnapshot({
      windowId: "main",
      expectedRevision: initial.revision,
      tabs: [{ ...browser, browserUrl: "http://127.0.0.1:4173/first" }],
      activeTabId: browser.id,
    });
    const queued = await store.setSnapshot({
      windowId: "main",
      expectedRevision: initial.revision,
      tabs: [{ ...browser, browserUrl: "http://127.0.0.1:4173/queued" }],
      activeTabId: browser.id,
    });
    assert.equal(queued.revision, first.revision + 1);
    assert.equal(
      queued.tabs[0]?.kind === "built-in" && queued.tabs[0].browserUrl,
      "http://127.0.0.1:4173/queued",
    );

    const opened = await store.openExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      contributionId: "notes",
      scope: { kind: "window-shared" },
      title: "Notes",
      reuse: "new",
    });
    const emitted: unknown[] = [];
    const unsubscribe = store.subscribe((_windowId, snapshot) => emitted.push(snapshot));
    const stale = await store.setSnapshot({
      windowId: "main",
      expectedRevision: queued.revision,
      tabs: queued.tabs,
      activeTabId: queued.activeTabId,
    });
    unsubscribe();

    assert.equal(stale.activeTabId, opened.instanceId);
    assert.equal(
      stale.tabs.some((tab) => tab.kind === "extension" && tab.id === opened.instanceId),
      true,
    );
    assert.deepEqual(emitted, [stale]);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      windows: { main: { tabs: Array<{ id: string }> } };
    };
    assert.equal(
      persisted.windows.main.tabs.some((tab) => tab.id === opened.instanceId),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extension open reuse, chrome updates, ownership checks, and close share one store", async () => {
  const { directory, filePath } = await fixture();
  try {
    const store = new WorkspaceToolTabsStore(filePath);
    const first = await store.openExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      contributionId: "notes",
      scope: { kind: "workspace", workspaceRoot: "/repo" },
      initialParams: { value: 1 },
      title: "Notes",
      icon: { type: "spirit", name: "globe" },
      reuse: "new",
    });
    const second = await store.openExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      contributionId: "notes",
      scope: { kind: "workspace", workspaceRoot: "/repo" },
      title: "Notes",
      reuse: "new",
    });
    assert.notEqual(first.instanceId, second.instanceId);

    const reused = await store.openExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      contributionId: "notes",
      scope: { kind: "workspace", workspaceRoot: "/repo" },
      title: "Ignored",
      reuse: "context",
    });
    assert.equal(reused.instanceId, first.instanceId);
    assert.deepEqual(reused.initialParams, { value: 1 });
    assert.equal((await store.getSnapshot("main")).activeTabId, first.instanceId);

    await store.updateExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      instanceId: first.instanceId,
      patch: { title: "Changed", dirty: true },
    });
    const updated = await store.getSnapshot("main");
    assert.equal(updated.tabs.find((tab) => tab.id === first.instanceId)?.tabTitle, "Changed");
    assert.equal(updated.tabs.find((tab) => tab.id === first.instanceId)?.tabDirty, true);
    await assert.rejects(
      store.closeExtensionTab({
        windowId: "main",
        extensionId: "personal/other",
        instanceId: first.instanceId,
      }),
      /not owned/,
    );
    await store.closeExtensionTab({
      windowId: "main",
      extensionId: "personal/demo",
      instanceId: first.instanceId,
    });
    const closed = await store.getSnapshot("main");
    assert.equal(
      closed.tabs.some((tab) => tab.id === first.instanceId),
      false,
    );
    assert.equal(
      closed.tabs.some((tab) => tab.id === second.instanceId),
      true,
    );
    const restored = await new WorkspaceToolTabsStore(filePath).getSnapshot("main");
    assert.equal(restored.tabs.filter((tab) => tab.kind === "extension").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
