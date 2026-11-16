/** @vitest-environment jsdom */
import "./setup";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ExtensionViewHost } from "@/components/extension-view-host";
import {
  EXTENSION_PAGE_READY,
  EXTENSION_PAGE_SIZE,
  EXTENSION_PAGE_ERROR,
  EXTENSION_PAGE_CLOSE,
} from "@/lib/extension-page-frame";
import {
  closeAllOpenExtensionViews,
  openExtensionView,
  updateOpenExtensionView,
} from "@/lib/extension-view-runtime";

afterEach(() => {
  closeAllOpenExtensionViews();
  vi.useRealTimers();
});
const identity = {
  extensionId: "built-in/demo",
  contributionId: "main",
  instanceId: "request-1",
  channelId: "channel-1",
};
function open(chrome?: "default" | "close-only" | "none", height?: number) {
  let result: Promise<unknown>;
  act(() => {
    result = openExtensionView({
      requestId: identity.instanceId,
      channelId: identity.channelId,
      extensionId: identity.extensionId,
      viewId: identity.contributionId,
      title: "Demo",
      chrome,
      height,
      params: { step: 1 },
    });
  });
  render(<ExtensionViewHost />);
  return { frame: document.querySelector("iframe")!, result: result! };
}
function message(frame: HTMLIFrameElement, type: string, extra: Record<string, unknown> = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: { ...identity, type, ...extra },
      }),
    );
  });
}
test("View loads a packaged document with scripts-only sandbox", () => {
  const { frame } = open();
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.src).toContain("/view/built-in%2Fdemo/main/request-1/index.html");
  expect(frame.getAttribute("srcdoc")).toBeNull();
});
test.each(["default", "close-only", "none"] as const)(
  "%s chrome preserves native dialog semantics",
  (chrome) => {
    open(chrome);
    expect(
      document.querySelector("[data-slot='dialog-header']")?.classList.contains("sr-only"),
    ).toBe(chrome !== "default");
    expect(Boolean(document.querySelector("[data-slot='dialog-close']"))).toBe(chrome !== "none");
  },
);
test("state updates preserve the iframe, identity and ready state", () => {
  const { frame } = open();
  message(frame, EXTENSION_PAGE_READY);
  act(() => updateOpenExtensionView(identity.instanceId, { step: 2 }));
  expect(document.querySelector("iframe")).toBe(frame);
  expect(frame.dataset.extensionPageState).toBe("ready");
});
test("only matching frame identities can resize or close", async () => {
  const { frame, result } = open(undefined, 360);
  message(frame, EXTENSION_PAGE_READY);
  message(frame, EXTENSION_PAGE_SIZE, { channelId: "wrong", height: 280 });
  expect(frame.style.height).toBe("160px");
  message(frame, EXTENSION_PAGE_SIZE, { height: 280 });
  expect(frame.style.height).toBe("280px");
  expect(frame.style.maxHeight).toBe("360px");
  message(frame, EXTENSION_PAGE_CLOSE, { result: { done: true } });
  expect(await result).toEqual({ done: true });
});
test("failed pages show an explicit error and a close control even with no chrome", () => {
  const { frame } = open("none");
  message(frame, EXTENSION_PAGE_ERROR);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(document.querySelector("[data-slot='dialog-close']")).toBeTruthy();
  expect(frame.dataset.extensionPageState).toBe("error");
});
test("timeout is failure, never a blank successful view", () => {
  vi.useFakeTimers();
  const { frame } = open();
  act(() => vi.advanceTimersByTime(10_000));
  expect(frame.dataset.extensionPageState).toBe("error");
  expect(screen.getByRole("alert")).toBeTruthy();
});
