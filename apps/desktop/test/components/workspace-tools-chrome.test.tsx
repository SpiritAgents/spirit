/** @vitest-environment jsdom */

import "./setup";

import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";

import {
  WorkspaceToolsChromeProvider,
  useWorkspaceToolsChrome,
  useWorkspaceToolsChromeFullScreen,
  useWorkspaceToolsChromeOpen,
  useWorkspaceToolsChromeWidthFlight,
} from "@/contexts/workspace-tools-chrome-context";
import { workspaceToolsShellWidthWhenOpen } from "@/lib/layout-prefs";

const FULLSCREEN_KEY = "spirit-desktop-workspace-tools-fullscreen";
const RESTORE_OPEN_KEY = "spirit-desktop-workspace-tools-fullscreen-restore-open";
/** Matches the real panel's docked width for deterministic width expressions. */
const DOCKED_WIDTH_PX = 420;

type ChromeSnapshot = { open: boolean; fullScreen: boolean; pinned: boolean };

const latestApi: { current: ReturnType<typeof useWorkspaceToolsChrome> | null } = {
  current: null,
};

/** Mirrors the shell width logic of WorkspaceToolsDockShell so assertions see React commits. */
function FakeShell() {
  const open = useWorkspaceToolsChromeOpen();
  const fullScreen = useWorkspaceToolsChromeFullScreen();
  const flight = useWorkspaceToolsChromeWidthFlight();
  const enterFlightPx = flight?.kind === "enter" ? flight.targetPx : null;
  const width = fullScreen
    ? enterFlightPx !== null
      ? `${enterFlightPx}px`
      : "100%"
    : workspaceToolsShellWidthWhenOpen(open, DOCKED_WIDTH_PX);
  return (
    <div data-testid="row">
      <div data-spirit-surface="workspace-dock">
        <div id="workspace-tools-panel-shell" style={{ width }}>
          <div data-workspace-tools-split>
            <aside id="workspace-tools-panel" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChromeProbe() {
  const chrome = useWorkspaceToolsChrome();
  latestApi.current = chrome;
  return (
    <output data-testid="chrome">
      {JSON.stringify({
        open: chrome.open,
        fullScreen: chrome.fullScreen,
        pinned: chrome.chromePinned,
      })}
    </output>
  );
}

function renderHarness() {
  return render(
    <WorkspaceToolsChromeProvider>
      <FakeShell />
      <ChromeProbe />
    </WorkspaceToolsChromeProvider>,
  );
}

function chromeState(): ChromeSnapshot {
  return JSON.parse(screen.getByTestId("chrome").textContent ?? "{}") as ChromeSnapshot;
}

function shellElement(): HTMLElement {
  const shell = document.getElementById("workspace-tools-panel-shell");
  if (!shell) {
    throw new Error("shell not mounted");
  }
  return shell;
}

/** The enter flight measures the conversation row; jsdom has no layout, so stub it. */
function mockRowWidth(widthPx: number) {
  const row = screen.getByTestId("row");
  row.getBoundingClientRect = () =>
    ({
      width: widthPx,
      height: 800,
      top: 0,
      left: 0,
      right: widthPx,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

async function waitForFlightSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 360));
  });
}

async function enterFullScreenAndSettle() {
  act(() => latestApi.current?.toggleFullScreen());
  await waitForFlightSettle();
}

beforeEach(() => {
  localStorage.clear();
  latestApi.current = null;
});

test("toggleFullScreen from collapsed flies to fullscreen in one segment and persists the snapshot", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: false });

  act(() => latestApi.current?.toggleFullScreen());

  expect(chromeState()).toEqual({ open: true, fullScreen: true, pinned: true });
  // Single segment: the shell aims straight at the row width, never at a docked intermediate.
  expect(shell.style.width).toBe("1000px");
  expect(localStorage.getItem(FULLSCREEN_KEY)).toBe("true");
  expect(localStorage.getItem(RESTORE_OPEN_KEY)).toBe("false");

  await waitForFlightSettle();
  expect(shell.style.width).toBe("100%");
  expect(shell.style.transition).toBe("");
  expect(chromeState()).toEqual({ open: true, fullScreen: true, pinned: true });
});

test("toggleFullScreen from settled full screen reverses to the collapsed snapshot", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  await enterFullScreenAndSettle();

  act(() => latestApi.current?.toggleFullScreen());

  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: true });
  expect(shell.style.width).toBe("0px");
  expect(localStorage.getItem(FULLSCREEN_KEY)).toBe("false");

  await waitForFlightSettle();
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: false });
});

test("toggle from full screen lands on the dock even when entered from collapsed", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  await enterFullScreenAndSettle();

  act(() => latestApi.current?.toggle());

  expect(chromeState()).toEqual({ open: true, fullScreen: false, pinned: true });
  // jsdom folds calc(1px + 420px) to calc(421px) when assigning inline styles.
  expect(shell.style.width).toBe(`calc(${1 + DOCKED_WIDTH_PX}px)`);
  expect(localStorage.getItem(FULLSCREEN_KEY)).toBe("false");

  await waitForFlightSettle();
  expect(chromeState()).toEqual({ open: true, fullScreen: false, pinned: false });

  // A second toggle collapses as usual.
  act(() => latestApi.current?.toggle());
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: false });
  expect(shell.style.width).toBe("0px");
});

test("toggle during the exit flight supersedes it and still releases the pin at settle", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  await enterFullScreenAndSettle();

  // Start the exit-to-collapsed flight, then reopen docked mid-flight.
  act(() => latestApi.current?.toggleFullScreen());
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: true });

  act(() => latestApi.current?.toggle());
  expect(chromeState()).toEqual({ open: true, fullScreen: false, pinned: true });
  expect(shell.style.width).toBe(`calc(${1 + DOCKED_WIDTH_PX}px)`);

  // The superseding open/close animation inherits the flight-clearing settle.
  await waitForFlightSettle();
  expect(chromeState()).toEqual({ open: true, fullScreen: false, pinned: false });
});

test("dismissForNewSession collapses instantly with no reverse flight", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  await enterFullScreenAndSettle();

  act(() => latestApi.current?.dismissForNewSession());

  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: false });
  expect(shell.style.width).toBe("0px");
  expect(shell.style.transition).toBe("");
  expect(localStorage.getItem(FULLSCREEN_KEY)).toBe("false");
});

test("setOpen(true) and openTools while full screen never rewrite the fullscreen width", async () => {
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();
  await enterFullScreenAndSettle();
  expect(shell.style.width).toBe("100%");

  act(() => latestApi.current?.setOpen(true));
  expect(chromeState()).toEqual({ open: true, fullScreen: true, pinned: true });
  expect(shell.style.width).toBe("100%");

  act(() => latestApi.current?.openTools());
  expect(chromeState()).toEqual({ open: true, fullScreen: true, pinned: true });
  expect(shell.style.width).toBe("100%");
});

test("persisted full screen mounts directly settled and keeps the restore snapshot", async () => {
  localStorage.setItem(FULLSCREEN_KEY, "true");
  localStorage.setItem(RESTORE_OPEN_KEY, "false");
  renderHarness();
  mockRowWidth(1000);
  const shell = shellElement();

  expect(chromeState()).toEqual({ open: true, fullScreen: true, pinned: true });
  expect(shell.style.width).toBe("100%");
  expect(shell.style.transition).toBe("");

  // The restore snapshot still drives the reverse flight after a restart.
  act(() => latestApi.current?.toggleFullScreen());
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: true });
  await waitForFlightSettle();
  expect(chromeState()).toEqual({ open: false, fullScreen: false, pinned: false });
});
