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
    pinnedSessions: [],
    workspaceGroups: [group("alpha", ["a1", "a2"]), group("beta", ["b1"])],
    unboundSessions: [session("u1"), session("u2")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "a2", "b1", "u1", "u2"],
  );
});

test("listVisibleSidebarSessions lists pinned sessions before workspace groups and unbound", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [session("p2"), session("p1")],
    workspaceGroups: [group("alpha", ["a1"])],
    unboundSessions: [session("u1")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["p2", "p1", "a1", "u1"],
  );
});

test("listVisibleSidebarSessions omits pinned sessions when the section is collapsed", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [session("p1")],
    workspaceGroups: [group("alpha", ["a1"])],
    unboundSessions: [session("u1")],
    pinnedSectionExpanded: false,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "u1"],
  );
});

test("listVisibleSidebarSessions truncates pinned sessions to the visible page", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [session("p1"), session("p2"), session("p3")],
    workspaceGroups: [group("alpha", ["a1"])],
    unboundSessions: [session("u1")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: 2,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["p1", "p2", "a1", "u1"],
  );
});

test("listVisibleSidebarSessions omits collapsed workspace groups", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [],
    workspaceGroups: [group("alpha", ["a1"]), group("beta", ["b1"])],
    unboundSessions: [session("u1")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: { beta: false },
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1", "u1"],
  );
});

test("listVisibleSidebarSessions omits workspace sessions when the section is collapsed", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [],
    workspaceGroups: [group("alpha", ["a1", "a2"])],
    unboundSessions: [session("u1")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: false,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["u1"],
  );
});

test("listVisibleSidebarSessions omits unbound sessions when the section is collapsed", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [],
    workspaceGroups: [group("alpha", ["a1"])],
    unboundSessions: [session("u1"), session("u2")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: false,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    ["a1"],
  );
});

test("listVisibleSidebarSessions truncates groups and unbound to the visible page", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [],
    workspaceGroups: [group("alpha", ["a1", "a2", "a3", "a4"])],
    unboundSessions: [session("u1"), session("u2"), session("u3")],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: { alpha: 2 },
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
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
    pinnedSessions: [],
    workspaceGroups: [group("alpha", paths)],
    unboundSessions: [],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(
    visible.map((item) => item.path),
    paths.slice(0, SIDEBAR_SESSION_PAGE_SIZE),
  );
});

test("listVisibleSidebarSessions returns an empty list when nothing is visible", () => {
  const visible = listVisibleSidebarSessions({
    pinnedSessions: [],
    workspaceGroups: [],
    unboundSessions: [],
    pinnedSectionExpanded: true,
    workspaceSectionExpanded: true,
    noWorkspaceSectionExpanded: true,
    collapsedWorkspaceIds: {},
    visibleCountByWorkspaceGroupId: emptyCounts,
    pinnedVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
    unboundVisibleCount: SIDEBAR_SESSION_PAGE_SIZE,
  });
  assert.deepEqual(visible, []);
});
