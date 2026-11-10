import assert from "node:assert/strict";
import { test } from "vitest";

import { File, FileCode, FileJson, FileText, Image as ImageIcon, ListTodo } from "lucide-react";

import {
  resolveWorkspaceFilesTabIcon,
  workspaceExplorerIcon,
  workspaceExplorerIconForPath,
} from "../../src/lib/workspace-explorer-icon.ts";

test("workspaceExplorerIcon maps common filenames and extensions", () => {
  assert.equal(workspaceExplorerIcon("package.json", "file"), FileJson);
  assert.equal(workspaceExplorerIcon("App.tsx", "file"), FileCode);
  assert.equal(workspaceExplorerIcon("README.md", "file"), FileText);
  assert.equal(workspaceExplorerIcon("logo.png", "file"), ImageIcon);
  assert.equal(workspaceExplorerIcon("notes", "file"), File);
});

test("workspaceExplorerIconForPath uses basename from relative paths", () => {
  assert.equal(workspaceExplorerIconForPath("src/App.tsx"), FileCode);
  assert.equal(workspaceExplorerIconForPath("docs/README.md"), FileText);
});

test("resolveWorkspaceFilesTabIcon returns ListTodo for Plan and Lucide for other file tabs", () => {
  assert.equal(resolveWorkspaceFilesTabIcon("Plan"), ListTodo);
  assert.equal(resolveWorkspaceFilesTabIcon("App.tsx"), FileCode);
  assert.equal(resolveWorkspaceFilesTabIcon(undefined), undefined);
});
