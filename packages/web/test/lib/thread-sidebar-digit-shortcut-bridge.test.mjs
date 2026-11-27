import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  registerThreadSidebarDigitShortcut,
  resetThreadSidebarDigitShortcutBridgeForTests,
  resolveVisibleSidebarSessionsForDigitShortcut,
  unregisterThreadSidebarDigitShortcut,
} from "../../src/lib/thread-sidebar-digit-shortcut-bridge.ts";

afterEach(() => {
  resetThreadSidebarDigitShortcutBridgeForTests();
});

test("resolveVisibleSidebarSessionsForDigitShortcut returns empty when unregistered", () => {
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), []);
});

test("resolveVisibleSidebarSessionsForDigitShortcut reads the registered visible list", () => {
  registerThreadSidebarDigitShortcut({
    resolveVisibleSessions() {
      return [{ path: "/s1" }, { path: "/s2" }];
    },
  });
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), [
    { path: "/s1" },
    { path: "/s2" },
  ]);
});

test("unregisterThreadSidebarDigitShortcut clears the bridge", () => {
  registerThreadSidebarDigitShortcut({
    resolveVisibleSessions() {
      return [{ path: "/s1" }];
    },
  });
  unregisterThreadSidebarDigitShortcut();
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), []);
});
