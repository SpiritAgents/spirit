/** @vitest-environment jsdom */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import "./setup";

import { render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceGitTab, type WorkspaceGitTabProps } from "@/components/workspace-git-tab";
import type { DesktopGitSnapshot, GitHistorySnapshot } from "@/types";

const gitSnapshot: DesktopGitSnapshot = {
  revision: 1,
  isRepository: true,
  hasChanges: false,
  branch: "main",
  branches: ["main"],
  aheadCount: 0,
  behindCount: 0,
  needsPush: false,
};

const emptyHistory: GitHistorySnapshot = {
  isRepository: true,
  commits: [],
  rows: [],
  hasMore: false,
  logCommits: [],
};

function renderGitTab(isActive: boolean) {
  const props = {
    gitSnapshot,
    gitChipBusy: false,
    readGitWorkingTree: vi.fn(async () => ({ isRepository: true, changes: [] })),
    readGitHistory: vi.fn(async () => emptyHistory),
    readGitCommitMessage: vi.fn(async () => ({ message: "" })),
    submitGitChip: vi.fn(async () => true),
  } satisfies Omit<WorkspaceGitTabProps, "isActive">;
  const view = (active: boolean) => (
    <TooltipProvider>
      <WorkspaceGitTab {...props} isActive={active} />
    </TooltipProvider>
  );
  const result = render(view(isActive));
  return { ...props, rerender: (active: boolean) => result.rerender(view(active)) };
}

describe("WorkspaceGitTab activation", () => {
  test("loads the working tree and history when first shown", async () => {
    const { readGitWorkingTree, readGitHistory } = renderGitTab(true);

    await waitFor(() => expect(readGitWorkingTree).toHaveBeenCalledTimes(1));
    expect(readGitHistory).toHaveBeenCalledTimes(1);
  });

  test("reloads history each time the tab becomes active again", async () => {
    const { readGitHistory, rerender } = renderGitTab(false);
    expect(readGitHistory).not.toHaveBeenCalled();

    rerender(true);
    await waitFor(() => expect(readGitHistory).toHaveBeenCalledTimes(1));

    rerender(false);
    rerender(true);
    await waitFor(() => expect(readGitHistory).toHaveBeenCalledTimes(2));
  });
});
