/** @vitest-environment jsdom */

import "../components/setup";

import { act, render, type RenderResult } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ExtensionTabHost } from "@/components/extension-tab-host";
import { SPIRIT_EXTENSION_WEB_VIEW_REQUEST } from "@/lib/extension-tab-frame";
import { BROWSER_WEBVIEW_WEBPREFERENCES } from "@/lib/workspace-browser-webview";

const tab = {
  id: "instance-1",
  kind: "extension" as const,
  extensionId: "personal/demo",
  contributionId: "browser",
  instanceId: "instance-1",
  channelId: "channel-1",
  scope: { kind: "window-shared" as const },
};
const contribution = {
  id: "browser",
  name: "Browser",
  path: "browser.html",
  icon: { type: "spirit" as const, name: "globe" },
  defaultScope: "window-shared" as const,
};
const nativeState = {
  viewId: "view-1",
  url: "about:blank",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

function dispatchNative(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { ...tab, ...data }, source: iframe.contentWindow }),
    );
  });
}

function mockFrameLayout(iframe: HTMLIFrameElement) {
  Object.defineProperties(iframe, {
    clientWidth: { configurable: true, value: 400 },
    clientHeight: { configurable: true, value: 400 },
    offsetLeft: { configurable: true, value: 0 },
    offsetTop: { configurable: true, value: 0 },
  });
}

async function attachRenderedWebview(rendered: RenderResult) {
  await act(async () => {
    await Promise.resolve();
  });
  const webview = rendered.container.querySelector("webview") as SpiritWebviewTag | null;
  expect(webview).not.toBeNull();
  Object.defineProperty(webview!, "getWebContentsId", {
    configurable: true,
    value: () => 42,
  });
  await act(async () => {
    webview!.dispatchEvent(new Event("did-attach"));
    await Promise.resolve();
    await Promise.resolve();
  });
  return webview!;
}

test("native create mounts a clipped DOM webview and attaches its owned guest", async () => {
  const onWebView = vi.fn().mockImplementation(async () => nativeState);
  const rendered = render(
    <ExtensionTabHost tab={tab} contribution={contribution} active onWebView={onWebView} />,
  );
  const iframe = rendered.container.querySelector("iframe")!;
  mockFrameLayout(iframe);
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-1",
    operation: "create",
    localRect: { x: -20, y: 30, width: 240, height: 450 },
    visible: true,
    url: "http://127.0.0.1:4173",
  });
  const webview = await attachRenderedWebview(rendered);

  expect(onWebView).toHaveBeenCalledWith({
    operation: "create",
    extensionId: tab.extensionId,
    contributionId: tab.contributionId,
    instanceId: tab.instanceId,
    url: "http://127.0.0.1:4173",
  });
  expect(onWebView).toHaveBeenCalledWith({
    operation: "attach",
    viewId: "view-1",
    guestWebContentsId: 42,
  });
  expect(webview.getAttribute("partition")).toBe("extension-webview-view-1");
  expect(webview.getAttribute("webpreferences")).toBe(BROWSER_WEBVIEW_WEBPREFERENCES);
  expect(webview.style).toMatchObject({
    left: "0px",
    top: "30px",
    width: "220px",
    height: "370px",
    visibility: "visible",
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "native-1",
      ok: true,
      result: expect.objectContaining({ viewId: "view-1", state: nativeState }),
    }),
    "*",
  );

  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-bounds",
    operation: "bounds",
    viewId: "view-1",
    localRect: { x: 390, y: 20, width: 100, height: 80 },
    visible: true,
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(webview.style).toMatchObject({
    left: "390px",
    top: "20px",
    width: "10px",
    height: "80px",
    visibility: "visible",
  });
  expect(onWebView.mock.calls.some(([request]) => request.operation === "bounds")).toBe(false);
});

test("native operations clean up the owned DOM guest on unmount", async () => {
  const onWebView = vi.fn().mockImplementation(async () => nativeState);
  const rendered = render(
    <ExtensionTabHost tab={tab} contribution={contribution} active onWebView={onWebView} />,
  );
  const iframe = rendered.container.querySelector("iframe")!;
  mockFrameLayout(iframe);
  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-1",
    operation: "create",
    localRect: { x: 0, y: 0, width: 100, height: 100 },
    visible: true,
  });
  const webview = await attachRenderedWebview(rendered);
  expect(webview.isConnected).toBe(true);

  rendered.unmount();
  expect(webview.isConnected).toBe(false);
  expect(onWebView).toHaveBeenCalledWith({ operation: "destroy", viewId: "view-1" });
});

test("native create rejects a missing host API without mounting a webview", async () => {
  const rendered = render(<ExtensionTabHost tab={tab} contribution={contribution} active />);
  const iframe = rendered.container.querySelector("iframe")!;
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-1",
    operation: "create",
    localRect: { x: 0, y: 0, width: 100, height: 100 },
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(rendered.container.querySelector("webview")).toBeNull();
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "native-1", ok: false }),
    "*",
  );
});
