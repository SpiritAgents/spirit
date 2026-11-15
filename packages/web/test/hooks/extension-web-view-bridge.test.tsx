/** @vitest-environment jsdom */

import "../components/setup";

import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ExtensionTabHost } from "@/components/extension-tab-host";
import { SPIRIT_EXTENSION_WEB_VIEW_REQUEST } from "@/lib/extension-tab-frame";

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

function dispatchNative(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { ...tab, ...data }, source: iframe.contentWindow }),
    );
  });
}

test("native create computes a clipped window region and returns a view proxy identity", async () => {
  const onWebView = vi.fn().mockResolvedValue({
    viewId: "view-1",
    url: "about:blank",
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const { container } = render(
    <ExtensionTabHost tab={tab} contribution={contribution} active onWebView={onWebView} />,
  );
  const iframe = container.querySelector("iframe")!;
  vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 500,
    bottom: 450,
    width: 400,
    height: 400,
    toJSON: () => ({}),
  });
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-1",
    operation: "create",
    localRect: { x: 20, y: 30, width: 200, height: 100 },
    visible: true,
    url: "http://127.0.0.1:4173",
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(onWebView).toHaveBeenCalledWith({
    operation: "create",
    extensionId: tab.extensionId,
    contributionId: tab.contributionId,
    instanceId: tab.instanceId,
    url: "http://127.0.0.1:4173",
    bounds: { x: 120, y: 80, width: 200, height: 100 },
    visible: true,
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: "native-1",
      ok: true,
      result: expect.objectContaining({ viewId: "view-1" }),
    }),
    "*",
  );
});

test("native operations reject a missing host API and clean up owned views", async () => {
  const onWebView = vi.fn().mockResolvedValue({
    viewId: "view-1",
    url: "about:blank",
    title: "",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const { container, unmount } = render(
    <ExtensionTabHost tab={tab} contribution={contribution} active onWebView={onWebView} />,
  );
  const iframe = container.querySelector("iframe")!;
  dispatchNative(iframe, {
    type: SPIRIT_EXTENSION_WEB_VIEW_REQUEST,
    requestId: "native-1",
    operation: "create",
    localRect: { x: 0, y: 0, width: 100, height: 100 },
    visible: true,
  });
  await act(async () => {
    await Promise.resolve();
  });
  unmount();
  expect(onWebView).toHaveBeenCalledWith({ operation: "destroy", viewId: "view-1" });
});
