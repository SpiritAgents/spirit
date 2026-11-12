/** @vitest-environment jsdom */

import "./setup";

import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { junctionResizeCursor, resizeCursor } from "@spiritagent/ui/resize-cursor";

import { SessionSidebarShell } from "@/components/session-sidebar-shell";
import {
  SessionSidebarChromeProvider,
  useSessionSidebarChrome,
} from "@/contexts/session-sidebar-chrome-context";
import { SESSION_SIDEBAR_MAX_WIDTH_PX, SESSION_SIDEBAR_MIN_WIDTH_PX } from "@/lib/desktop-chrome";

const WIDTH_STORAGE_KEY = "spirit-desktop-session-sidebar-width-px";
/** Matches the Electron BrowserWindow minWidth in electron/main.ts. */
const WINDOW_MIN_WIDTH_PX = 360;

// jsdom does not implement pointer capture; the resize handle calls it on drag.
HTMLElement.prototype.setPointerCapture = () => {};
HTMLElement.prototype.releasePointerCapture = () => {};

function WidthProbe() {
  const { widthPx } = useSessionSidebarChrome();
  return <output data-testid="sidebar-width">{widthPx}</output>;
}

function renderShell() {
  return render(
    <SessionSidebarChromeProvider>
      <SessionSidebarShell>
        <WidthProbe />
      </SessionSidebarShell>
    </SessionSidebarChromeProvider>,
  );
}

function currentWidth(): number {
  return Number(screen.getByTestId("sidebar-width").textContent);
}

function resizeViewport(widthPx: number) {
  act(() => {
    window.innerWidth = widthPx;
    window.dispatchEvent(new Event("resize"));
  });
}

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  clientX: number,
) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
  });
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1280;
});

test("window resize never compresses the sidebar below its minimum width", () => {
  localStorage.setItem(WIDTH_STORAGE_KEY, String(SESSION_SIDEBAR_MIN_WIDTH_PX));
  const { container } = renderShell();
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MIN_WIDTH_PX);

  // 40% of 360px is 144px: the viewport-capped max falls below the minimum here.
  resizeViewport(WINDOW_MIN_WIDTH_PX);
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MIN_WIDTH_PX);
  const shell = container.querySelector('[data-spirit-surface="session-sidebar-shell"]');
  expect(shell?.getAttribute("style")).toContain(`${SESSION_SIDEBAR_MIN_WIDTH_PX}px`);

  resizeViewport(1280);
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MIN_WIDTH_PX);
  expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(SESSION_SIDEBAR_MIN_WIDTH_PX));
});

test("window resize preserves a user-set width above the minimum", () => {
  localStorage.setItem(WIDTH_STORAGE_KEY, String(SESSION_SIDEBAR_MAX_WIDTH_PX));
  renderShell();
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MAX_WIDTH_PX);

  resizeViewport(WINDOW_MIN_WIDTH_PX);
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MAX_WIDTH_PX);

  resizeViewport(1280);
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MAX_WIDTH_PX);
  expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe(String(SESSION_SIDEBAR_MAX_WIDTH_PX));
});

test("dragging still resizes the sidebar and enforces the viewport-capped bounds", () => {
  window.innerWidth = 600; // viewport max = 240
  localStorage.setItem(WIDTH_STORAGE_KEY, String(SESSION_SIDEBAR_MIN_WIDTH_PX));
  const { container } = renderShell();
  const separator = container.querySelector('[role="separator"]');
  expect(separator).toBeTruthy();
  expect((separator as HTMLElement).style.cursor).toBe("e-resize");

  firePointer(separator!, "pointerdown", 300);
  expect(document.head.querySelector("style")?.textContent).toContain("cursor: e-resize");
  firePointer(separator!, "pointermove", 520); // 200 + 220, beyond the 240 max
  expect(currentWidth()).toBe(240);
  expect((separator as HTMLElement).style.cursor).toBe("w-resize");
  expect(document.head.querySelector("style")?.textContent).toContain("cursor: w-resize");
  firePointer(separator!, "pointermove", 0); // 200 - 300, below the 200 min
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MIN_WIDTH_PX);
  expect(document.head.querySelector("style")?.textContent).toContain("cursor: e-resize");
  firePointer(separator!, "pointermove", 320); // 200 + 20, free range
  expect((separator as HTMLElement).style.cursor).toBe("col-resize");
  expect(document.head.querySelector("style")?.textContent).toContain("cursor: col-resize");
  firePointer(separator!, "pointermove", 340); // 200 + 40
  expect(currentWidth()).toBe(240);
  firePointer(separator!, "pointerup", 340);
  expect(document.head.querySelector("style")).toBeNull();
  expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe("240");
});

test("directional cursors follow grow direction and both-blocked bounds", () => {
  expect(resizeCursor(10, 10, 20, "right")).toBe("e-resize");
  expect(resizeCursor(20, 10, 20, "right")).toBe("w-resize");
  expect(resizeCursor(10, 10, 20, "left")).toBe("w-resize");
  expect(resizeCursor(20, 10, 20, "left")).toBe("e-resize");
  expect(resizeCursor(10, 10, 20, "down")).toBe("s-resize");
  expect(resizeCursor(20, 10, 20, "down")).toBe("n-resize");
  expect(resizeCursor(10, 10, 20, "up")).toBe("n-resize");
  expect(resizeCursor(20, 10, 20, "up")).toBe("s-resize");
  expect(resizeCursor(15, 10, 20, "up")).toBe("row-resize");
  expect(resizeCursor(10, 10, 10, "right")).toBe("default");
});

test("intersection chooses a pinned axis or defaults when both are pinned", () => {
  expect(junctionResizeCursor(0.5, 0.5, 0.15, 0.85)).toBe("move");
  expect(junctionResizeCursor(0.15, 0.5, 0.15, 0.85)).toBe("e-resize");
  expect(junctionResizeCursor(0.5, 0.85, 0.15, 0.85)).toBe("n-resize");
  expect(junctionResizeCursor(0.85, 0.15, 0.15, 0.85)).toBe("default");
});

test("canceling a drag clears the global cursor", () => {
  const { container } = renderShell();
  const separator = container.querySelector('[role="separator"]')!;
  firePointer(separator, "pointerdown", 300);
  expect(document.head.querySelector("style")).not.toBeNull();
  firePointer(separator, "pointercancel", 300);
  expect(document.head.querySelector("style")).toBeNull();
});
