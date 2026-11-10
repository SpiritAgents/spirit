import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolvePaneContentStatus,
  resolveSessionNavPending,
} from "../../src/lib/conversation-navigation-pending.ts";

function snapshotOf({ activePath = null, paneSessions } = {}) {
  return {
    activeSession: activePath ? { filePath: activePath } : null,
    ...(paneSessions ? { paneSessions } : {}),
  };
}

test("resolveSessionNavPending is false without a navigation intent", () => {
  assert.equal(resolveSessionNavPending({ navTarget: null, snapshot: null }), false);
  assert.equal(
    resolveSessionNavPending({
      navTarget: null,
      snapshot: snapshotOf({ activePath: "/sessions/a.json" }),
    }),
    false,
  );
});

test("resolveSessionNavPending stays pending until the target session arrives", () => {
  const navTarget = { path: "/sessions/b.json" };
  assert.equal(resolveSessionNavPending({ navTarget, snapshot: null }), true);
  assert.equal(
    resolveSessionNavPending({ navTarget, snapshot: snapshotOf({ activePath: null }) }),
    true,
  );
  assert.equal(
    resolveSessionNavPending({
      navTarget,
      snapshot: snapshotOf({ activePath: "/sessions/a.json" }),
    }),
    true,
  );
  assert.equal(
    resolveSessionNavPending({
      navTarget,
      snapshot: snapshotOf({ activePath: "/sessions/b.json" }),
    }),
    false,
  );
});

test("resolveSessionNavPending normalizes case and separators when comparing paths", () => {
  const navTarget = { path: "C:\\Sessions\\Chat-B.json" };
  assert.equal(
    resolveSessionNavPending({
      navTarget,
      snapshot: snapshotOf({ activePath: "c:/sessions/chat-b.json" }),
    }),
    false,
  );
});

test("resolvePaneContentStatus shows a placeholder while the pane slice is missing", () => {
  // Split-layout sync in flight: the layout still points at a session the host
  // has not loaded yet. This must not depend on the pane count — the single-pane
  // case used to slip through paneMissingSliceDuringNav and flash the hero.
  const snapshot = snapshotOf({
    activePath: "/sessions/c.json",
    paneSessions: { "/sessions/a.json": {} },
  });
  assert.equal(
    resolvePaneContentStatus({ paneSessionPath: "/sessions/b.json", snapshot }),
    "pending-placeholder",
  );
});

test("resolvePaneContentStatus treats a missing snapshot as pending", () => {
  assert.equal(
    resolvePaneContentStatus({ paneSessionPath: "/sessions/a.json", snapshot: null }),
    "pending-placeholder",
  );
});

test("resolvePaneContentStatus is ready when the pane resolves to the foreground", () => {
  const snapshot = snapshotOf({
    activePath: "/sessions/b.json",
    paneSessions: { "/sessions/b.json": {} },
  });
  assert.equal(
    resolvePaneContentStatus({ paneSessionPath: "/sessions/b.json", snapshot }),
    "ready",
  );
});

test("resolvePaneContentStatus is ready when the pane has its own slice", () => {
  const snapshot = snapshotOf({
    activePath: "/sessions/a.json",
    paneSessions: { "/sessions/side.json": {} },
  });
  assert.equal(
    resolvePaneContentStatus({ paneSessionPath: "/sessions/side.json", snapshot }),
    "ready",
  );
});

test("resolvePaneContentStatus projects the foreground snapshot when no pane slices exist", () => {
  // Single-pane sessions carry no paneSessions map; the pane renders the
  // foreground snapshot even while its layout path has not caught up yet.
  const snapshot = snapshotOf({ activePath: "/sessions/b.json" });
  assert.equal(
    resolvePaneContentStatus({ paneSessionPath: "/sessions/a.json", snapshot }),
    "ready",
  );
});
