import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  registerSessionSidebarDigitShortcut,
  resetSessionSidebarDigitShortcutBridgeForTests,
  resolveVisibleSidebarSessionsForDigitShortcut,
  unregisterSessionSidebarDigitShortcut,
} from "../../src/lib/session-sidebar-digit-shortcut-bridge.ts";

afterEach(() => {
  resetSessionSidebarDigitShortcutBridgeForTests();
});

test("resolveVisibleSidebarSessionsForDigitShortcut returns empty when unregistered", () => {
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), []);
});

test("resolveVisibleSidebarSessionsForDigitShortcut reads the registered visible list", () => {
  registerSessionSidebarDigitShortcut({
    resolveVisibleSessions() {
      return [{ path: "/s1" }, { path: "/s2" }];
    },
  });
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), [
    { path: "/s1" },
    { path: "/s2" },
  ]);
});

test("unregisterSessionSidebarDigitShortcut clears the bridge", () => {
  registerSessionSidebarDigitShortcut({
    resolveVisibleSessions() {
      return [{ path: "/s1" }];
    },
  });
  unregisterSessionSidebarDigitShortcut();
  assert.deepEqual(resolveVisibleSidebarSessionsForDigitShortcut(), []);
});
