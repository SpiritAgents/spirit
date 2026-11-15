import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { beforeEach, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({ guests: new Map() }));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  webContents: { fromId: (id) => electronMock.guests.get(id) },
}));

import { ExtensionWebViewManager } from "../../electron/extension-web-view.ts";

class FakeGuest extends EventEmitter {
  constructor(id, host) {
    super();
    this.id = id;
    this.hostWebContents = host;
    this.url = "about:blank";
    this.destroyed = false;
    this.session = { setPermissionRequestHandler: vi.fn() };
    this.navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
    };
    this.setWindowOpenHandler = vi.fn();
    this.loadURL = vi.fn(async (url) => {
      this.url = url;
    });
    this.capturePage = vi.fn(async () => ({ toDataURL: () => "data:image/png;base64,AAAA" }));
    this.executeJavaScript = vi.fn(async () => ({ answer: 42 }));
    this.close = vi.fn(() => {
      this.destroyed = true;
      this.emit("destroyed");
    });
  }

  getType() {
    return "webview";
  }

  isDestroyed() {
    return this.destroyed;
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return "Fixture";
  }

  isLoading() {
    return false;
  }
}

const owner = {
  extensionId: "personal/demo",
  contributionId: "browser",
  instanceId: "instance-1",
  channelId: "channel-1",
  capabilities: new Set([
    "desktop-webview-display",
    "desktop-webview-control",
    "desktop-webview-script",
  ]),
};

beforeEach(() => {
  electronMock.guests.clear();
});

test("manager attaches only an owned webview guest and tears it down with its host", async () => {
  const host = { id: 7 };
  const guest = new FakeGuest(42, host);
  electronMock.guests.set(guest.id, guest);
  const publish = vi.fn();
  const manager = new ExtensionWebViewManager({
    resolveOwner: async () => owner,
    publish,
  });

  const created = await manager.handleRenderer(
    host,
    {
      operation: "create",
      extensionId: owner.extensionId,
      contributionId: owner.contributionId,
      instanceId: owner.instanceId,
      url: "http://127.0.0.1:4173/one",
    },
    "main",
  );
  const attached = await manager.handleRenderer(host, {
    operation: "attach",
    viewId: created.viewId,
    guestWebContentsId: guest.id,
  });

  assert.equal(attached.url, "http://127.0.0.1:4173/one");
  assert.equal(attached.title, "Fixture");
  expect(guest.loadURL).toHaveBeenCalledWith("http://127.0.0.1:4173/one");
  expect(guest.setWindowOpenHandler).toHaveBeenCalledOnce();
  assert.deepEqual(guest.setWindowOpenHandler.mock.calls[0][0](), { action: "deny" });
  const permissionHandler = guest.session.setPermissionRequestHandler.mock.calls[0][0];
  const permissionCallback = vi.fn();
  permissionHandler(guest, "media", permissionCallback);
  expect(permissionCallback).toHaveBeenCalledWith(false);
  for (const eventName of ["will-navigate", "will-redirect"]) {
    const blocked = { url: "file:///etc/passwd", preventDefault: vi.fn() };
    guest.emit(eventName, blocked);
    expect(blocked.preventDefault).toHaveBeenCalledOnce();
  }
  const allowedRedirect = { url: "https://example.com/next", preventDefault: vi.fn() };
  guest.emit("will-redirect", allowedRedirect);
  expect(allowedRedirect.preventDefault).not.toHaveBeenCalled();

  assert.equal(
    await manager.captureBackend(owner.extensionId, created.viewId),
    "data:image/png;base64,AAAA",
  );
  assert.deepEqual(
    await manager.executeScriptBackend(owner.extensionId, created.viewId, "({ answer: 42 })"),
    { answer: 42 },
  );
  await assert.rejects(
    manager.getStateBackend("personal/other", created.viewId),
    /not owned by this extension/,
  );
  await assert.rejects(
    manager.handleRenderer({ id: 8 }, { operation: "getState", viewId: created.viewId }, "main"),
    /not owned by this renderer/,
  );

  manager.disposeAllForWebContents(host);
  expect(guest.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  await assert.rejects(
    manager.getStateBackend(owner.extensionId, created.viewId),
    /not owned by this extension/,
  );
});

test("manager rejects a guest hosted by another renderer", async () => {
  const host = { id: 7 };
  const otherHost = { id: 8 };
  const guest = new FakeGuest(42, otherHost);
  electronMock.guests.set(guest.id, guest);
  const manager = new ExtensionWebViewManager({
    resolveOwner: async () => owner,
    publish: () => {},
  });
  const created = await manager.handleRenderer(
    host,
    {
      operation: "create",
      extensionId: owner.extensionId,
      contributionId: owner.contributionId,
      instanceId: owner.instanceId,
      url: "about:blank",
    },
    "main",
  );
  await assert.rejects(
    manager.handleRenderer(host, {
      operation: "attach",
      viewId: created.viewId,
      guestWebContentsId: guest.id,
    }),
    /Invalid browser guest webContents/,
  );
});

test("display-only attachment does not reveal loaded page state", async () => {
  const host = { id: 7 };
  const guest = new FakeGuest(42, host);
  guest.loadURL = vi.fn(async () => {
    guest.url = "file:///private";
  });
  electronMock.guests.set(guest.id, guest);
  const publish = vi.fn();
  const displayOwner = {
    ...owner,
    capabilities: new Set(["desktop-webview-display"]),
  };
  const manager = new ExtensionWebViewManager({
    resolveOwner: async () => displayOwner,
    publish,
  });
  const created = await manager.handleRenderer(
    host,
    {
      operation: "create",
      extensionId: displayOwner.extensionId,
      contributionId: displayOwner.contributionId,
      instanceId: displayOwner.instanceId,
      url: "http://127.0.0.1:4173/start",
    },
    "main",
  );
  const attached = await manager.handleRenderer(host, {
    operation: "attach",
    viewId: created.viewId,
    guestWebContentsId: guest.id,
  });

  assert.deepEqual(attached, {
    viewId: created.viewId,
    url: "http://127.0.0.1:4173/start",
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  expect(publish).not.toHaveBeenCalled();
  await assert.rejects(
    manager.handleRenderer(host, { operation: "getState", viewId: created.viewId }, "main"),
    /desktop-webview-control/,
  );
});
