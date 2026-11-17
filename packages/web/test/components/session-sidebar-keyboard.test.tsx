/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { SessionSidebar } from "@/components/session-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionListItem } from "@/types";

vi.mock("@/host-api", () => ({
  createHostApi: async () => ({ kind: "web" }),
}));

const noop = () => {};

function makeSessions(count: number): SessionListItem[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `/workspace/chat-${index}.jsonl`,
    displayName: `Chat ${index}`,
    modifiedAtUnixMs: count - index,
    workspaceRoot: "/workspace",
    gitBranch: "main",
    transcriptPath: `/workspace/chat-${index}/transcript.json`,
  }));
}

function renderSidebar(sessions: SessionListItem[]) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SessionSidebar
        narrow={false}
        sessions={sessions}
        activeFilePath={sessions[0]?.path ?? null}
        userHomeDirectory="/home/user"
        onSelectSession={noop}
        onNewChat={noop}
        onNewChatInWorkspace={noop}
        onOpenMarketplace={noop}
        onOpenAutomations={noop}
        onOpenSettings={noop}
        onTogglePinSession={noop}
      />
    </TooltipProvider>,
  );
}

test("workspace and session rows keep their inline actions reachable with full inset rings", async () => {
  renderSidebar(makeSessions(11));
  const workspace = screen.getByRole("button", { name: "workspace" });
  const workspaceGroup = workspace.closest("[data-workspace-group-id]") as HTMLElement;
  const workspaceRow = workspace.parentElement as HTMLElement;
  const group = workspaceGroup.parentElement as HTMLElement;
  const plus = screen.getByRole("button", { name: "New Chat in workspace" });
  const chat0 = screen.getByRole("button", { name: "Chat 0" });
  const chat1 = screen.getByRole("button", { name: "Chat 1" });
  const chat0Row = chat0.closest("[data-session-path]") as HTMLElement;
  const chat1Row = chat1.closest("[data-session-path]") as HTMLElement;
  const chat0Pin = within(chat0Row).getByRole("button", { name: "Pin" });
  const chat1Pin = within(chat1Row).getByRole("button", { name: "Pin" });

  act(() => group.focus());
  expect(document.activeElement).toBe(chat0);
  act(() => workspace.focus());
  expect(plus.tabIndex).toBe(0);
  expect(plus.className).not.toContain("hidden");
  expect(plus.className).toContain("invisible");
  expect(plus.className).toContain("group-focus-within/workspace-row:visible");
  expect(plus.className).not.toContain("opacity-0");
  expect(plus.className).not.toContain("opacity-100");
  expect(plus.className).toContain("ring-inset");
  expect(workspace.className).not.toContain("focus-visible:ring");
  expect(workspaceRow.className).toContain("rounded-md");
  expect(workspaceRow.className).toContain("[data-sidebar-row-primary]:focus-visible");
  expect(chat0Row.className).toContain("[data-sidebar-row-primary]:focus-visible");

  fireEvent.keyDown(workspace, { key: "ArrowDown" });
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  expect(document.activeElement).toBe(chat0);
  expect(chat0Pin.tabIndex).toBe(0);
  expect(chat1Pin.tabIndex).toBe(-1);
  expect(chat0Pin.className).toContain("invisible");
  expect(chat0Pin.className).toContain("group-focus-within:visible");
  expect(chat0Pin.className).not.toContain("opacity-0");
  expect(chat0Pin.className).not.toContain("opacity-100");
  expect(chat0Pin.className).toContain("ring-inset");

  fireEvent.keyDown(chat0, { key: "ArrowDown" });
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  expect(document.activeElement).toBe(chat1);
  expect(chat0Pin.tabIndex).toBe(-1);
  expect(chat1Pin.tabIndex).toBe(0);
  expect(screen.getByRole("button", { name: "See more" }).className).toContain("ring-inset");
});

test("session details open from keyboard focus", async () => {
  renderSidebar(makeSessions(2));
  const chat0 = screen.getByRole("button", { name: "Chat 0" });
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => chat0.focus());
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 350);
    });
  });
  expect(screen.getByRole("tooltip").textContent).toContain("main");
});

test("settings navigation stays in the normal Tab order and ignores arrow navigation", async () => {
  const onSettingsTabChange = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <SessionSidebar
        narrow={false}
        mode="settings"
        sessions={[]}
        activeFilePath={null}
        settingsTab="models"
        onSelectSession={noop}
        onNewChat={noop}
        onOpenSettings={noop}
        onSettingsTabChange={onSettingsTabChange}
      />
    </TooltipProvider>,
  );
  const navigation = screen.getByRole("navigation", { name: "Settings Tabs" });
  const models = screen.getByRole("button", { name: "Models" });
  const agents = screen.getByRole("button", { name: "Agents" });
  expect(navigation.dataset.orientation).toBeUndefined();
  expect(models.tabIndex).toBe(0);
  expect(agents.tabIndex).toBe(0);

  act(() => models.focus());
  fireEvent.keyDown(models, { key: "ArrowDown" });
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  expect(document.activeElement).toBe(models);
  expect(onSettingsTabChange).not.toHaveBeenCalled();
});

test("section headers have rounded symmetric focus rings and No Workspace stays tabbable", () => {
  const sessions = makeSessions(3).map((session, index) =>
    index === 0 ? session : { ...session, workspaceRoot: "" },
  );
  renderSidebar(sessions);
  const workspaces = screen.getByRole("button", { name: "Workspaces" });
  const noWorkspace = screen.getByRole("button", { name: "No Workspace" });
  const unboundNavigation = noWorkspace.closest("nav") as HTMLElement;

  expect(workspaces.className).toContain("rounded-md");
  expect(workspaces.className).toContain("py-1");
  expect(workspaces.className).not.toContain("pb-1");
  expect(noWorkspace.className).toContain("rounded-md");
  expect(noWorkspace.tabIndex).toBe(0);
  expect(unboundNavigation.tabIndex).toBe(-1);

  const initialExpanded = noWorkspace.getAttribute("aria-expanded");
  fireEvent.click(noWorkspace);
  expect(noWorkspace.getAttribute("aria-expanded")).not.toBe(initialExpanded);
  fireEvent.click(noWorkspace);
  expect(noWorkspace.getAttribute("aria-expanded")).toBe(initialExpanded);
});
