/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ExtensionTabHost } from "@/components/extension-tab-host";
import {
  SPIRIT_EXTENSION_TAB_READY,
  SPIRIT_EXTENSION_TAB_READY_REQUEST,
  SPIRIT_EXTENSION_TAB_REQUEST,
  SPIRIT_EXTENSION_TAB_RESULT,
  SPIRIT_EXTENSION_TAB_EVENT,
  SPIRIT_EXTENSION_TAB_CHROME,
  SPIRIT_EXTENSION_TAB_CLOSED,
} from "@/lib/extension-tab-frame";

const tab = {
  id: "instance-1",
  kind: "extension" as const,
  extensionId: "personal/demo",
  contributionId: "notes",
  instanceId: "instance-1",
  channelId: "channel-1",
  scope: { kind: "window-shared" as const },
};
const contribution = {
  id: "notes",
  name: "Notes",
  path: "notes.html",
  icon: { type: "spirit" as const, name: "globe" },
  defaultScope: "window-shared" as const,
};

test("extension tab uses a scripts-only sandbox and keeps its instance identity", () => {
  const { container } = render(<ExtensionTabHost tab={tab} contribution={contribution} active />);
  const iframe = container.querySelector("iframe");
  expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe?.src).toContain("/tab/personal%2Fdemo/notes/instance-1/index.html");
  expect(container.firstElementChild?.getAttribute("data-extension-tab-instance")).toBe(
    "instance-1",
  );
});

test("load failure exposes an explicit retryable error", () => {
  vi.useFakeTimers();
  try {
    const { container } = render(
      <ExtensionTabHost tab={tab} contribution={contribution} active={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(
      screen.getByText("Could not load Notes. Check the extension package and try again."),
    ).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByText("Retry"));
    });
    expect(
      container
        .querySelector("[data-extension-tab-state]")
        ?.getAttribute("data-extension-tab-state"),
    ).toBe("loading");
  } finally {
    vi.useRealTimers();
  }
});

function dispatchFrameMessage(iframe: HTMLIFrameElement, type: string) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type, ...tab },
        source: iframe.contentWindow,
      }),
    );
  });
}

test("the runtime ready handshake clears the loading timeout", () => {
  vi.useFakeTimers();
  try {
    const { container } = render(<ExtensionTabHost tab={tab} contribution={contribution} active />);
    dispatchFrameMessage(container.querySelector("iframe")!, SPIRIT_EXTENSION_TAB_READY);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(
      container
        .querySelector("[data-extension-tab-state]")
        ?.getAttribute("data-extension-tab-state"),
    ).toBe("ready");
  } finally {
    vi.useRealTimers();
  }
});

test("ready requests receive initial parameters, scope, visibility, and host theme", () => {
  const tabWithParams = { ...tab, initialParams: { text: "hello" } };
  const { container, rerender } = render(
    <ExtensionTabHost
      tab={tabWithParams}
      contribution={contribution}
      active
      workspaceRoot="/repo-one"
      sessionKey="session-one"
    />,
  );
  const iframe = container.querySelector("iframe")!;
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  dispatchFrameMessage(iframe, SPIRIT_EXTENSION_TAB_READY_REQUEST);
  expect(postMessage).toHaveBeenCalled();
  const [context] = postMessage.mock.calls.at(-1)!;
  expect(context).toMatchObject({
    type: "spirit-extension-tab-context",
    extensionId: "personal/demo",
    contributionId: "notes",
    instanceId: "instance-1",
    initialParams: { text: "hello" },
    scope: { kind: "window-shared" },
    workspaceRoot: "/repo-one",
    sessionKey: "session-one",
    visible: true,
  });
  expect(context.theme).toHaveProperty("htmlClassName");
  expect(context.theme).toHaveProperty("htmlStyle");
  expect(context.theme).toHaveProperty("cssText");

  postMessage.mockClear();
  dispatchFrameMessage(iframe, SPIRIT_EXTENSION_TAB_READY);
  rerender(
    <ExtensionTabHost
      tab={tabWithParams}
      contribution={contribution}
      active
      workspaceRoot="/repo-two"
      sessionKey="session-two"
    />,
  );
  const [changedContext] = postMessage.mock.calls.at(-1)!;
  expect(changedContext).toMatchObject({
    workspaceRoot: "/repo-two",
    sessionKey: "session-two",
  });
});

test("page requests are identity checked and answered on the same channel", async () => {
  const onRequest = vi.fn().mockResolvedValue({ answer: 42 });
  const onChrome = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <ExtensionTabHost
      tab={tab}
      contribution={contribution}
      active
      onRequest={onRequest}
      onChrome={onChrome}
    />,
  );
  const iframe = container.querySelector("iframe")!;
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...tab,
          channelId: "forged",
          type: SPIRIT_EXTENSION_TAB_REQUEST,
          requestId: "bad",
          method: "echo",
        },
        source: iframe.contentWindow,
      }),
    );
  });
  expect(onRequest).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...tab,
          type: SPIRIT_EXTENSION_TAB_REQUEST,
          requestId: "request-1",
          method: "echo",
          params: { value: 1 },
        },
        source: iframe.contentWindow,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...tab,
          type: SPIRIT_EXTENSION_TAB_CHROME,
          patch: { dirty: true, title: "Changed" },
        },
        source: iframe.contentWindow,
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(onRequest).toHaveBeenCalledWith({
    extensionId: tab.extensionId,
    contributionId: tab.contributionId,
    instanceId: tab.instanceId,
    method: "echo",
    params: { value: 1 },
  });
  expect(onChrome).toHaveBeenCalledWith({
    extensionId: tab.extensionId,
    instanceId: tab.instanceId,
    patch: { dirty: true, title: "Changed" },
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: SPIRIT_EXTENSION_TAB_RESULT,
      requestId: "request-1",
      channelId: tab.channelId,
      ok: true,
      result: { answer: 42 },
    }),
    "*",
  );
});

test("backend events and teardown reach only the owning page channel", () => {
  let publish: ((event: unknown) => void) | undefined;
  const subscribeEvents = vi.fn((callback) => {
    publish = callback;
    return () => {};
  });
  const { container, unmount } = render(
    <ExtensionTabHost
      tab={tab}
      contribution={contribution}
      active
      subscribeEvents={subscribeEvents}
    />,
  );
  const iframe = container.querySelector("iframe")!;
  const postMessage = vi.spyOn(iframe.contentWindow!, "postMessage");
  act(() => {
    publish?.({
      windowId: "main",
      extensionId: tab.extensionId,
      contributionId: tab.contributionId,
      instanceId: tab.instanceId,
      channelId: tab.channelId,
      event: "refresh",
      params: { value: 2 },
    });
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: SPIRIT_EXTENSION_TAB_EVENT,
      event: "refresh",
      channelId: tab.channelId,
    }),
    "*",
  );
  unmount();
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: SPIRIT_EXTENSION_TAB_CLOSED, channelId: tab.channelId }),
    "*",
  );
});
