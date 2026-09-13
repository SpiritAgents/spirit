/** @vitest-environment jsdom */

import "./setup";

import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";

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
  type: "pointerdown" | "pointermove" | "pointerup",
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

  firePointer(separator!, "pointerdown", 300);
  firePointer(separator!, "pointermove", 520); // 200 + 220, beyond the 240 max
  expect(currentWidth()).toBe(240);
  firePointer(separator!, "pointermove", 0); // 200 - 300, below the 200 min
  expect(currentWidth()).toBe(SESSION_SIDEBAR_MIN_WIDTH_PX);
  firePointer(separator!, "pointermove", 340); // 200 + 40
  expect(currentWidth()).toBe(240);
  firePointer(separator!, "pointerup", 340);
  expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe("240");
});
