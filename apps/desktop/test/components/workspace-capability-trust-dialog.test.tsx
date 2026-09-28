/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { WorkspaceCapabilityTrustDialog } from "@/components/workspace-capability-trust-dialog";

const hostApiState = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/hooks/useHostApi", () => ({
  useHostApi: () => ({ api: hostApiState.api, error: "", ready: true }),
}));

const HOOK = { event: "sessionStart", command: "hooks/x.sh", resolvedPath: "/repo/hooks/x.sh" };
const TASK = { label: "build", command: "make all", sourcePath: "/repo/.spirit/tasks.json" };

function hooksRequest(overrides = {}) {
  return {
    workspaceRoot: "/repo",
    contentHash: "hooks-hash",
    hashChanged: false,
    hooks: [HOOK],
    ...overrides,
  };
}

function tasksPayload(overrides = {}) {
  return { contentHash: "tasks-hash", hashChanged: false, items: [TASK], ...overrides };
}

function renderDialog(pending, onReply = () => {}) {
  return render(<WorkspaceCapabilityTrustDialog pending={pending} onReply={onReply} />);
}

test("a hooks-only request renders the hooks list without any section header", () => {
  renderDialog(hooksRequest());
  // Section headers exist only to disambiguate a merged prompt.
  expect(screen.queryByText("Hooks that will run")).toBeNull();
  expect(screen.queryByText("Tasks that will be available")).toBeNull();
  expect(screen.getByText("hooks/x.sh")).toBeTruthy();
  // Hooks-only risk copy, not the tasks one.
  expect(screen.getByText(/defines hooks that run scripts/)).toBeTruthy();
  expect(screen.queryByText(/defines tasks that run commands/)).toBeNull();
});

test("a tasks-only request renders the tasks list and tasks risk copy, without headers", () => {
  renderDialog(hooksRequest({ hooks: [], tasks: tasksPayload() }));
  expect(screen.queryByText("Hooks that will run")).toBeNull();
  expect(screen.queryByText("Tasks that will be available")).toBeNull();
  expect(screen.getByText("build")).toBeTruthy();
  expect(screen.getByText("make all")).toBeTruthy();
  expect(screen.getByText(/defines tasks that run commands/)).toBeTruthy();
  expect(screen.queryByText(/defines hooks that run scripts/)).toBeNull();
});

test("a merged request renders both sections with headers and the combined risk copy", () => {
  renderDialog(hooksRequest({ tasks: tasksPayload() }));
  expect(screen.getByText("Hooks that will run")).toBeTruthy();
  expect(screen.getByText("Tasks that will be available")).toBeTruthy();
  expect(screen.getByText(/defines hooks and tasks that run scripts or commands/)).toBeTruthy();
});

test("changed banners render independently and stack", () => {
  const hooksBanner = /Workspace hooks have changed/;
  const tasksBanner = /Workspace tasks have changed/;

  const onlyHooks = renderDialog(hooksRequest({ hashChanged: true }));
  expect(screen.getByText(hooksBanner)).toBeTruthy();
  expect(screen.queryByText(tasksBanner)).toBeNull();
  onlyHooks.unmount();

  const onlyTasks = renderDialog(
    hooksRequest({ hooks: [], tasks: tasksPayload({ hashChanged: true }) }),
  );
  expect(screen.queryByText(hooksBanner)).toBeNull();
  expect(screen.getByText(tasksBanner)).toBeTruthy();
  onlyTasks.unmount();

  renderDialog(hooksRequest({ hashChanged: true, tasks: tasksPayload({ hashChanged: true }) }));
  expect(screen.getByText(hooksBanner)).toBeTruthy();
  expect(screen.getByText(tasksBanner)).toBeTruthy();
});

test("clicking a task row opens its source file; rows are disabled without the api", () => {
  const openPathInDefaultApp = vi.fn();
  hostApiState.api = { openPathInDefaultApp };

  const first = renderDialog(hooksRequest({ hooks: [], tasks: tasksPayload() }));
  const row = screen.getByTitle("Open tasks file in default editor");
  expect(row.hasAttribute("disabled")).toBe(false);
  fireEvent.click(row);
  expect(openPathInDefaultApp).toHaveBeenCalledWith("/repo/.spirit/tasks.json");
  first.unmount();

  hostApiState.api = null;
  renderDialog(hooksRequest({ hooks: [], tasks: tasksPayload() }));
  expect(screen.getByTitle("Open tasks file in default editor").hasAttribute("disabled")).toBe(
    true,
  );
});

test("the three reply buttons emit their decisions", () => {
  const onReply = vi.fn();
  renderDialog(hooksRequest(), onReply);
  fireEvent.click(screen.getByRole("button", { name: /Deny/ }));
  fireEvent.click(screen.getByRole("button", { name: /Always trust/ }));
  fireEvent.click(screen.getByRole("button", { name: /Allow once/ }));
  expect(onReply.mock.calls.map((call) => call[0])).toEqual(["deny", "alwaysTrust", "allowOnce"]);
});

test("nothing renders when no request is pending", () => {
  const { container } = renderDialog(undefined);
  expect(container.querySelector("[data-slot='dialog-content']")).toBeNull();
});
