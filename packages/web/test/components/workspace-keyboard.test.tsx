/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AutomationHistoryTable } from "@/components/automation-history-table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import type { DesktopAutomationRun } from "@/types";

const hostApiKind = vi.hoisted(() => ({ current: "web" }));

vi.mock("@/host-api", () => ({
  createHostApi: async () => ({ kind: hostApiKind.current }),
}));

async function flushFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

test("automation history rows support vertical navigation and Enter", async () => {
  const onOpenSession = vi.fn();
  const runs = [
    {
      id: "run-1",
      sessionPath: "session-1",
      startedAtUnixMs: 100,
      status: "completed",
    },
    {
      id: "run-2",
      sessionPath: "session-2",
      startedAtUnixMs: 200,
      status: "failed",
    },
  ] as DesktopAutomationRun[];
  render(<AutomationHistoryTable runs={runs} onOpenSession={onOpenSession} />);
  const rows = screen.getAllByRole("row").slice(1);
  const body = document.querySelector("tbody") as HTMLElement;
  expect(rows).toHaveLength(2);

  act(() => body.focus());
  expect(document.activeElement).toBe(rows[0]);
  expect(rows[0]?.tabIndex).toBe(0);
  expect(rows[1]?.tabIndex).toBe(-1);

  fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });
  await flushFocus();
  expect(document.activeElement).toBe(rows[1]);
  fireEvent.keyDown(rows[1]!, { key: "Enter" });
  expect(onOpenSession).toHaveBeenCalledWith("session-1");
});

test("file tree arrows expand, enter children, and return to the parent", async () => {
  const listExplorerChildren = vi.fn(async (relativePath: string) => ({
    entries:
      relativePath === ""
        ? [
            { name: "folder", kind: "dir" as const },
            { name: "a.txt", kind: "file" as const },
          ]
        : [{ name: "b.txt", kind: "file" as const }],
  }));
  render(
    <WorkspaceFilesPanel
      workspaceRoot="/workspace"
      plan={{ path: "/workspace/.spirit/plan.md" } as never}
      listExplorerChildren={listExplorerChildren}
    />,
  );
  const tree = (await screen.findByRole("tree")) as HTMLElement;
  const folder = await screen.findByRole("treeitem", { name: "folder" });
  act(() => tree.focus());
  expect(document.activeElement).toBe(folder);
  expect(folder.getAttribute("aria-expanded")).toBe("false");

  fireEvent.keyDown(folder, { key: "ArrowRight" });
  const child = await screen.findByRole("treeitem", { name: "b.txt" });
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(folder, { key: "ArrowRight" });
  expect(document.activeElement).toBe(child);

  fireEvent.keyDown(child, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(folder);
  fireEvent.keyDown(folder, { key: "ArrowLeft" });
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "b.txt" })).toBeNull();

  fireEvent.keyDown(folder, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "workspace" }));
});

test("a merged single-child directory chain keeps keyboard focus while its label changes", async () => {
  const listExplorerChildren = vi.fn(async (relativePath: string) => ({
    entries:
      relativePath === ""
        ? [{ name: "folder", kind: "dir" as const }]
        : relativePath === "folder"
          ? [{ name: "child", kind: "dir" as const }]
          : [
              { name: "one", kind: "dir" as const },
              { name: "two", kind: "dir" as const },
            ],
  }));
  render(
    <WorkspaceFilesPanel
      workspaceRoot="/workspace"
      plan={{ path: "/workspace/.spirit/plan.md" } as never}
      listExplorerChildren={listExplorerChildren}
    />,
  );
  const folder = await screen.findByRole("treeitem", { name: "folder" });
  await flushFocus();
  act(() => folder.focus());
  fireEvent.keyDown(folder, { key: "ArrowRight" });

  const merged = await screen.findByRole("treeitem", { name: "folder/child" });
  expect(document.activeElement).toBe(merged);
  fireEvent.keyDown(merged, { key: "ArrowRight" });
  expect(document.activeElement).toBe(await screen.findByRole("treeitem", { name: "one" }));
});

test("file tree focus reveals root create actions and keeps them keyboard reachable", async () => {
  hostApiKind.current = "electron";
  try {
    render(
      <>
        <button type="button">Outside</button>
        <TooltipProvider>
          <WorkspaceFilesPanel
            workspaceRoot="/workspace"
            plan={{ path: "/workspace/.spirit/plan.md" } as never}
            listExplorerChildren={vi.fn(async () => ({
              entries: [
                { name: "folder", kind: "dir" as const },
                { name: "a.txt", kind: "file" as const },
              ],
            }))}
          />
        </TooltipProvider>
      </>,
    );
    const folder = await screen.findByRole("treeitem", { name: "folder" });
    const file = screen.getByRole("treeitem", { name: "a.txt" });
    const plan = screen.getByRole("treeitem", { name: "Plan" });
    const tree = screen.getByRole("tree");
    expect(screen.queryByRole("button", { name: "New File" })).toBeNull();

    act(() => folder.focus());
    const createFile = screen.getByRole("button", { name: "New File" });
    const createFolder = screen.getByRole("button", { name: "New Folder" });
    expect(createFile.tabIndex).toBe(0);
    expect(createFolder.tabIndex).toBe(0);
    expect(createFolder.compareDocumentPosition(tree)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    for (const target of [createFolder, createFile, file, plan]) {
      act(() => target.focus());
      expect(document.activeElement).toBe(target);
      expect(screen.getByRole("button", { name: "New File" })).toBe(createFile);
      expect(screen.getByRole("button", { name: "New Folder" })).toBe(createFolder);
    }

    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => outside.focus());
    expect(screen.queryByRole("button", { name: "New File" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Folder" })).toBeNull();
  } finally {
    hostApiKind.current = "web";
  }
});
