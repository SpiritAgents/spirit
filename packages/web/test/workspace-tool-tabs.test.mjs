import assert from "node:assert/strict";
import { test } from "vitest";

import {
  BROWSER_NEW_TAB_SENTINEL,
  addWorkspaceTaskTab,
  addWorkspaceToolTab,
  closeWorkspaceToolTab,
  createDefaultWorkspaceToolTabs,
  createInitialWorkspaceToolsState,
  createWorkspaceToolTab,
  defaultActiveWorkspaceToolTabId,
  focusFirstTabOfKind,
  isBrowserNewTabUrl,
  normalizeWorkspaceToolTabsForHost,
  openBrowserUrlInWorkspaceTabs,
  workspaceTerminalChipDisplayName,
  workspaceToolTabLabel,
} from "../src/lib/workspace-tool-tabs.ts";

const t = (key) =>
  ({
    "workspace.files": "Files",
    "workspace.terminal": "Terminal",
    "workspace.browser": "Browser",
    "workspace.prTab": "Pull Request",
    "workspace.terminalChipDefaultName": "Terminal",
  })[key] ?? key;

test("createDefaultWorkspaceToolTabs has files, terminal, and git", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  assert.equal(tabs.length, 3);
  const kinds = tabs.map((t) => t.kind);
  assert.deepEqual(kinds, ["files", "terminal", "git"]);
  assert.ok(tabs.every((t) => typeof t.id === "string" && t.id.length > 0));
});

test("workspaceToolTabLabel numbers duplicate kinds", () => {
  const a = createWorkspaceToolTab("files");
  const b = createWorkspaceToolTab("files");
  const tabs = [a, b];
  assert.equal(workspaceToolTabLabel("files", tabs, a.id, t), "Files");
  assert.equal(workspaceToolTabLabel("files", tabs, b.id, t), "Files 2");
  assert.equal(
    workspaceToolTabLabel("terminal", tabs, createWorkspaceToolTab("terminal").id, t),
    "Terminal",
  );
});

test("workspaceTerminalChipDisplayName prefers tab title then default label", () => {
  const terminalA = createWorkspaceToolTab("terminal");
  const terminalB = createWorkspaceToolTab("terminal");
  terminalA.tabTitle = "npm run dev";
  const tabs = [terminalA, terminalB];
  assert.equal(workspaceTerminalChipDisplayName(terminalA, tabs, t), "npm run dev");
  assert.equal(workspaceTerminalChipDisplayName(terminalB, tabs, t), "Terminal 2");
});

test("createWorkspaceToolTab browser defaults to new-tab sentinel", () => {
  const tab = createWorkspaceToolTab("browser");
  assert.equal(tab.kind, "browser");
  assert.equal(tab.browserUrl, BROWSER_NEW_TAB_SENTINEL);
  assert.equal(isBrowserNewTabUrl(tab.browserUrl), true);
});

test("addWorkspaceToolTab browser includes sentinel url", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "browser");
  const browserTab = next.find((item) => item.id === activeId);
  assert.equal(browserTab?.kind, "browser");
  assert.equal(browserTab?.browserUrl, BROWSER_NEW_TAB_SENTINEL);
});

test("focusFirstTabOfKind returns first matching id", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const filesId = focusFirstTabOfKind(tabs, "files");
  assert.equal(filesId, tabs[0].id);
  assert.equal(focusFirstTabOfKind([], "files"), null);
});

test("addWorkspaceToolTab appends and focuses new tab", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "terminal");
  assert.equal(next.length, 4);
  assert.equal(next.at(-1)?.kind, "terminal");
  assert.equal(activeId, next.at(-1)?.id);
});

test("closeWorkspaceToolTab recreates terminal when last terminal tab closes", () => {
  const tabs = [createWorkspaceToolTab("terminal")];
  const originalTerminalId = tabs[0].id;
  const closed = closeWorkspaceToolTab(tabs, originalTerminalId, originalTerminalId);
  assert.equal(closed.tabs.length, 1);
  assert.equal(closed.tabs[0]?.kind, "terminal");
  assert.notEqual(closed.tabs[0]?.id, originalTerminalId);
  assert.equal(closed.activeId, closed.tabs[0]?.id);
});

test("closeWorkspaceToolTab does not recreate optional pr tab", () => {
  const pr = createWorkspaceToolTab("pr");
  const closed = closeWorkspaceToolTab([pr], pr.id, pr.id);
  assert.equal(closed.tabs.length, 0);
  assert.equal(closed.activeId, "");
});

test("closeWorkspaceToolTab recreates kind without resetting other tabs", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  const terminalId = tabs[1].id;
  const closed = closeWorkspaceToolTab(tabs, terminalId, terminalId, { includeBrowser: true });
  assert.equal(closed.tabs.length, 4);
  assert.equal(closed.tabs.filter((tab) => tab.kind === "terminal").length, 1);
  assert.equal(closed.tabs.filter((tab) => tab.kind === "files").length, 1);
  assert.equal(closed.tabs.filter((tab) => tab.kind === "browser").length, 1);
  assert.equal(closed.activeId, closed.tabs.find((tab) => tab.kind === "terminal")?.id);
});

test("closeWorkspaceToolTab prefers left neighbor when kind still has tabs", () => {
  const files = createWorkspaceToolTab("files");
  const terminal1 = createWorkspaceToolTab("terminal");
  const terminal2 = createWorkspaceToolTab("terminal");
  const git = createWorkspaceToolTab("git");
  const tabs = [files, terminal1, terminal2, git];
  const closed = closeWorkspaceToolTab(tabs, terminal2.id, terminal2.id);
  assert.equal(closed.activeId, terminal1.id);
  assert.equal(closed.tabs.filter((tab) => tab.kind === "terminal").length, 1);
});

test("defaultActiveWorkspaceToolTabId prefers files", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  assert.equal(defaultActiveWorkspaceToolTabId(tabs), tabs[0].id);
});

test("createDefaultWorkspaceToolTabs can include browser on Electron", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  assert.equal(tabs.length, 4);
  assert.deepEqual(
    tabs.map((t) => t.kind),
    ["files", "terminal", "git", "browser"],
  );
});

test("normalizeWorkspaceToolTabsForHost strips browser on web host", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  const browserTab = tabs.find((t) => t.kind === "browser");
  assert.ok(browserTab);
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, browserTab.id, false);
  assert.equal(
    normalized.tabs.some((t) => t.kind === "browser"),
    false,
  );
  assert.equal(normalized.tabs.length, 3);
  assert.equal(normalized.activeId, normalized.tabs[0].id);
});

test("normalizeWorkspaceToolTabsForHost adds browser on electron host", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, tabs[0].id, true);
  assert.equal(normalized.tabs.length, 4);
  assert.equal(
    normalized.tabs.some((t) => t.kind === "browser"),
    true,
  );
});

test("addWorkspaceToolTab can append pr tab", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "pr");
  assert.equal(next.at(-1)?.kind, "pr");
  assert.equal(activeId, next.at(-1)?.id);
});

test("normalizeWorkspaceToolTabsForHost strips pr on web host", () => {
  const tabs = [...createDefaultWorkspaceToolTabs(), createWorkspaceToolTab("pr")];
  const prTab = tabs.find((tab) => tab.kind === "pr");
  assert.ok(prTab);
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, prTab.id, false, false);
  assert.equal(
    normalized.tabs.some((tab) => tab.kind === "pr"),
    false,
  );
});

test("workspaceToolTabLabel supports pr tab", () => {
  const tab = createWorkspaceToolTab("pr");
  assert.equal(workspaceToolTabLabel("pr", [tab], tab.id, t), "Pull Request");
});

test("createInitialWorkspaceToolsState uses same tabs for active id", () => {
  const { tabs, activeTabId } = createInitialWorkspaceToolsState();
  assert.ok(tabs.some((t) => t.id === activeTabId));
  assert.equal(tabs.find((t) => t.id === activeTabId)?.kind, "files");
});

test("openBrowserUrlInWorkspaceTabs reuses untitled browser tab", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  const browserTab = tabs.find((t) => t.kind === "browser");
  assert.ok(browserTab);
  const result = openBrowserUrlInWorkspaceTabs(tabs, "https://example.com/docs");
  assert.equal(result.tabs.filter((t) => t.kind === "browser").length, 1);
  assert.equal(result.activeId, browserTab.id);
  assert.equal(
    result.tabs.find((t) => t.id === browserTab.id)?.browserUrl,
    "https://example.com/docs",
  );
});

test("openBrowserUrlInWorkspaceTabs creates new tab when titled browser tab exists", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  const browserTab = tabs.find((t) => t.kind === "browser");
  assert.ok(browserTab);
  browserTab.tabTitle = "Example Docs";
  const result = openBrowserUrlInWorkspaceTabs(tabs, "https://example.com/other");
  assert.equal(result.tabs.filter((t) => t.kind === "browser").length, 2);
  assert.notEqual(result.activeId, browserTab.id);
});

test("addWorkspaceTaskTab carries task metadata", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceTaskTab(tabs, {
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
  });
  const taskTab = next.find((t) => t.id === activeId);
  assert.ok(taskTab);
  assert.equal(taskTab.kind, "task");
  assert.equal(taskTab.taskKey, "/repo/.spirit/tasks.json#build");
  assert.equal(taskTab.tabTitle, "build");
  assert.equal(taskTab.pinnedTitle, undefined);
  assert.equal(next.length, tabs.length + 1);
});

test("addWorkspaceTaskTab pins the title only when requested", () => {
  const { tabs } = addWorkspaceTaskTab([], {
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
    pinnedTitle: true,
  });
  assert.equal(tabs[0].pinnedTitle, true);
});

test("closeWorkspaceToolTab does not recreate anything when the last task tab closes", () => {
  const { tabs } = addWorkspaceTaskTab([], {
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
  });
  const closed = closeWorkspaceToolTab(tabs, tabs[0].id, tabs[0].id);
  assert.deepEqual(closed, { tabs: [], activeId: "" });
});

test("closeWorkspaceToolTab keeps other tabs when the last task tab closes", () => {
  const base = createDefaultWorkspaceToolTabs();
  const { tabs } = addWorkspaceTaskTab(base, {
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
  });
  const taskTab = tabs.find((t) => t.kind === "task");
  assert.ok(taskTab);
  const closed = closeWorkspaceToolTab(tabs, taskTab.id, taskTab.id);
  assert.equal(
    closed.tabs.some((t) => t.kind === "task"),
    false,
  );
  assert.deepEqual(
    closed.tabs.map((t) => t.kind),
    base.map((t) => t.kind),
  );
});

test("closeWorkspaceToolTab still recreates the interactive terminal when task tabs exist", () => {
  const base = createDefaultWorkspaceToolTabs();
  const { tabs } = addWorkspaceTaskTab(base, {
    taskKey: "/repo/.spirit/tasks.json#build",
    label: "build",
  });
  const terminalTab = tabs.find((t) => t.kind === "terminal");
  assert.ok(terminalTab);
  const closed = closeWorkspaceToolTab(tabs, terminalTab.id, terminalTab.id);
  const terminals = closed.tabs.filter((t) => t.kind === "terminal");
  assert.equal(terminals.length, 1);
  assert.notEqual(terminals[0].id, terminalTab.id);
  assert.equal(
    closed.tabs.some((t) => t.kind === "task"),
    true,
  );
});
