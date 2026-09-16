import assert from "node:assert/strict";
import { test } from "vitest";

import {
  computeWorkspaceToolsMaxWidthPx,
  readWorkspaceToolsFullScreen,
  readWorkspaceToolsFullScreenRestoreOpen,
  readWorkspaceToolsWidthPx,
  readWorkspaceToolsWidthRatio,
  writeWorkspaceToolsFullScreen,
  writeWorkspaceToolsFullScreenRestoreOpen,
  writeWorkspaceToolsWidthPx,
  writeWorkspaceToolsWidthRatio,
  WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO,
  WORKSPACE_TOOLS_MIN_WIDTH_PX,
} from "../../src/lib/layout-prefs.ts";

const RATIO_KEY = "spirit-desktop-workspace-tools-width-ratio";
const LEGACY_PX_KEY = "spirit-desktop-workspace-tools-width-px";
const FULLSCREEN_KEY = "spirit-desktop-workspace-tools-fullscreen";
const FULLSCREEN_RESTORE_OPEN_KEY = "spirit-desktop-workspace-tools-fullscreen-restore-open";

function withLocalStorage(run) {
  const previous = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  try {
    return run(store);
  } finally {
    globalThis.localStorage = previous;
  }
}

test("readWorkspaceToolsWidthPx scales with viewport from stored ratio", () => {
  withLocalStorage(() => {
    writeWorkspaceToolsWidthRatio(0.5, 1000);
    assert.equal(readWorkspaceToolsWidthPx(1000), 500);
    assert.equal(readWorkspaceToolsWidthPx(2000), 1000);
  });
});

test("writeWorkspaceToolsWidthPx persists ratio not absolute pixels", () => {
  withLocalStorage((store) => {
    writeWorkspaceToolsWidthPx(600, 1200);
    assert.equal(store.get(RATIO_KEY), "0.5");
    assert.equal(store.has(LEGACY_PX_KEY), false);
    assert.equal(readWorkspaceToolsWidthPx(2400), 1200);
  });
});

test("legacy pixel width migrates to ratio once", () => {
  withLocalStorage((store) => {
    store.set(LEGACY_PX_KEY, "600");
    assert.equal(readWorkspaceToolsWidthRatio(1200), 0.5);
    assert.equal(store.get(RATIO_KEY), "0.5");
    assert.equal(readWorkspaceToolsWidthPx(2400), 1200);
  });
});

test("readWorkspaceToolsWidthPx clamps to min and max", () => {
  withLocalStorage(() => {
    writeWorkspaceToolsWidthRatio(0.05, 1000);
    assert.equal(readWorkspaceToolsWidthPx(1000), WORKSPACE_TOOLS_MIN_WIDTH_PX);
    const max = computeWorkspaceToolsMaxWidthPx(1000);
    writeWorkspaceToolsWidthRatio(0.9, 1000);
    assert.equal(readWorkspaceToolsWidthPx(1000), max);
  });
});

test("default ratio is used when no prefs exist", () => {
  withLocalStorage(() => {
    assert.equal(readWorkspaceToolsWidthRatio(1200), WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO);
  });
});

test("workspace tools full-screen pref defaults to false and round-trips", () => {
  withLocalStorage((store) => {
    assert.equal(readWorkspaceToolsFullScreen(), false);
    writeWorkspaceToolsFullScreen(true);
    assert.equal(store.get(FULLSCREEN_KEY), "true");
    assert.equal(readWorkspaceToolsFullScreen(), true);
    writeWorkspaceToolsFullScreen(false);
    assert.equal(readWorkspaceToolsFullScreen(), false);
  });
});

test("workspace tools full-screen restore-open pref defaults to docked and round-trips", () => {
  withLocalStorage((store) => {
    assert.equal(readWorkspaceToolsFullScreenRestoreOpen(), true);
    writeWorkspaceToolsFullScreenRestoreOpen(false);
    assert.equal(store.get(FULLSCREEN_RESTORE_OPEN_KEY), "false");
    assert.equal(readWorkspaceToolsFullScreenRestoreOpen(), false);
    writeWorkspaceToolsFullScreenRestoreOpen(true);
    assert.equal(readWorkspaceToolsFullScreenRestoreOpen(), true);
  });
});
