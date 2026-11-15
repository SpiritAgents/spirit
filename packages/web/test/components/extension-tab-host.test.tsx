/** @vitest-environment jsdom */

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ExtensionTabHost } from "@/components/extension-tab-host";
import {
  SPIRIT_EXTENSION_TAB_READY,
  SPIRIT_EXTENSION_TAB_READY_REQUEST,
} from "@/lib/extension-tab-frame";

const tab = {
  id: "instance-1",
  kind: "extension" as const,
  extensionId: "personal/demo",
  contributionId: "notes",
  instanceId: "instance-1",
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
  const { container } = render(
    <ExtensionTabHost
      tab={{ ...tab, initialParams: { text: "hello" } }}
      contribution={contribution}
      active
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
    visible: true,
  });
  expect(context.theme).toHaveProperty("htmlClassName");
  expect(context.theme).toHaveProperty("htmlStyle");
  expect(context.theme).toHaveProperty("cssText");
});
