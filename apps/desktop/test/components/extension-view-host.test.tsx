/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ExtensionViewHost } from "@/components/extension-view-host";
import {
  SPIRIT_EXTENSION_VIEW_READY_MESSAGE,
  SPIRIT_EXTENSION_VIEW_SIZE_MESSAGE,
} from "@/lib/extension-view-frame";
import {
  closeAllOpenExtensionViews,
  openExtensionView,
} from "@/lib/extension-view-runtime";

afterEach(() => {
  closeAllOpenExtensionViews();
});

test("iframe is sandboxed to scripts only and uses the View default-export srcdoc", async () => {
  act(() => {
    void openExtensionView({
      requestId: "req-host",
      extensionId: "built-in/demo",
      viewId: "main",
      viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
      title: "Demo View",
    });
  });

  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const iframe = document.querySelector("iframe");
  expect(iframe).toBeTruthy();
  expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(iframe?.srcdoc).toContain("default-export function View({ params, close })");
});

function renderOpenExtensionView(chrome?: "default" | "close-only" | "none") {
  act(() => {
    void openExtensionView({
      requestId: `req-chrome-${chrome ?? "default"}`,
      extensionId: "built-in/demo",
      viewId: "main",
      viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
      title: "Demo View",
      ...(chrome ? { chrome } : {}),
    });
  });
}

test("default chrome shows the dialog title and close button", async () => {
  renderOpenExtensionView();
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const header = document.querySelector("[data-slot='dialog-header']");
  expect(header).toBeTruthy();
  expect(header?.classList.contains("sr-only")).toBe(false);
  expect(document.querySelector("[data-slot='dialog-title']")?.textContent).toBe("Demo View");
  expect(document.querySelector("[data-slot='dialog-close']")).toBeTruthy();
});

test("close-only chrome hides the title visually and keeps the close button", async () => {
  renderOpenExtensionView("close-only");
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const header = document.querySelector("[data-slot='dialog-header']");
  expect(header?.classList.contains("sr-only")).toBe(true);
  expect(document.querySelector("[data-slot='dialog-title']")?.textContent).toBe("Demo View");
  expect(document.querySelector("[data-slot='dialog-close']")).toBeTruthy();
});

test("none chrome hides the title visually and omits the close button", async () => {
  renderOpenExtensionView("none");
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const header = document.querySelector("[data-slot='dialog-header']");
  expect(header?.classList.contains("sr-only")).toBe(true);
  expect(document.querySelector("[data-slot='dialog-title']")?.textContent).toBe("Demo View");
  expect(document.querySelector("[data-slot='dialog-close']")).toBeNull();
});

function dialogContentStyle(): CSSStyleDeclaration | undefined {
  const content = document.querySelector("[data-slot='dialog-content']");
  return content instanceof HTMLElement ? content.style : undefined;
}

function dispatchFrameMessage(iframe: HTMLIFrameElement, data: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        source: iframe.contentWindow,
      }),
    );
  });
}

test("omitted height hugs content and does not fix the dialog or iframe min-height", async () => {
  renderOpenExtensionView();
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const iframe = document.querySelector("iframe");
  expect(iframe).toBeTruthy();
  expect(iframe?.className).not.toContain("min-h-64");
  expect(iframe?.className).not.toContain("h-full");
  expect(dialogContentStyle()?.height).toBe("");
});

test("declared height is an iframe max-height instead of a fixed dialog height", async () => {
  act(() => {
    void openExtensionView({
      requestId: "req-max-height",
      extensionId: "built-in/demo",
      viewId: "main",
      viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
      title: "Demo View",
      height: 360,
    });
  });
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const iframe = document.querySelector("iframe");
  expect(iframe?.style.maxHeight).toBe("360px");
  expect(iframe?.style.overflowY).toBe("auto");
  expect(dialogContentStyle()?.height).toBe("");
});

test("size messages from the iframe set the iframe height", async () => {
  act(() => {
    void openExtensionView({
      requestId: "req-size",
      extensionId: "built-in/demo",
      viewId: "main",
      viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
      title: "Demo View",
    });
  });
  await act(async () => {
    render(<ExtensionViewHost />);
  });
  const iframe = document.querySelector("iframe");
  expect(iframe).toBeTruthy();
  dispatchFrameMessage(iframe!, {
    type: SPIRIT_EXTENSION_VIEW_READY_MESSAGE,
    requestId: "req-size",
  });
  expect(iframe?.style.height).toBe("");
  dispatchFrameMessage(iframe!, {
    type: SPIRIT_EXTENSION_VIEW_SIZE_MESSAGE,
    requestId: "req-size",
    height: 280,
  });
  expect(iframe?.style.height).toBe("280px");
});
