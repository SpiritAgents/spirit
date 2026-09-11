import assert from "node:assert/strict";
import { test } from "vitest";

import {
  SIDEBAR_SESSION_PAGE_SIZE,
  listVisibleSidebarSessions,
} from "../../src/lib/session-sidebar-visible-order.ts";

function session(path) {
  return { path };
}

function group(id, paths) {
  return { id, sessions: paths.map(session) };
}

const emptyCounts = {};

test("listVisibleSidebarSessions merges expanded workspace groups then unbound", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", ["a1", "a2"]), group("beta", ["b1"])],
    unboundSessions: [session("u1"), session("u2")],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "a2", "b1", "u1", "u2"],
  );
});

test("listVisibleSidebarSessions omits collapsed workspace groups", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", ["a1"]), group("beta", ["b1"])],
    unboundSessions: [session("u1")],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: { beta: false },
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "u1"],
  );
});

test("listVisibleSidebarSessions omits workspace sessions when the section is collapsed", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", ["a1", "a2"])],
    unboundSessions: [session("u1")],
    workspaceSectionExpanded: false,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["u1"],
  );
});

test("listVisibleSidebarSessions omits unbound sessions when the section is collapsed", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", ["a1"])],
    unboundSessions: [session("u1"), session("u2")],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: false,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1"],
  );
});

test("listVisibleSidebarSessions truncates groups and unbound to the visible page", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", ["a1", "a2", "a3", "a4"])],
    unboundSessions: [session("u1"), session("u2"), session("u3")],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: { alpha: 2 },
    unboundVisibleCount: 1,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "a2", "u1"],
  );
});

test("listVisibleSidebarSessions defaults group visible count to page size", () => {
  const paths = Array.from({ length: 12 }, (_, index) => `s${index + 1}`);
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [group("alpha", paths)],
    unboundSessions: [],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    paths.slice(0, SIDEBAR_SESSION_PAGE_SIZE),
  );
});

test("listVisibleSidebarSessions returns an empty list when nothing is visible", () => {
  const visible = listVisibleSidebarSessions({
    workspaceGroups: [],
    unboundSessions: [],
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(visible, []);
});
