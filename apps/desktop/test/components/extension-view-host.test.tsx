/** @vitest-environment jsdom */

import "./setup";

import { act, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ExtensionViewHost } from "@/components/extension-view-host";
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
