import assert from "node:assert/strict";
import { test } from "vitest";

import {
  SESSION_SIDEBAR_MAX_WIDTH_PX,
  SESSION_SIDEBAR_MIN_WIDTH_PX,
  computeSessionSidebarMaxWidthPx,
} from "../../src/lib/desktop-chrome.ts";
import {
  readSessionSidebarWidthPx,
  writeSessionSidebarWidthPx,
} from "../../src/lib/layout-prefs.ts";

const WIDTH_KEY = "spirit-desktop-session-sidebar-width-px";
/** Matches the Electron BrowserWindow minWidth in electron/main.ts. */
const WINDOW_MIN_WIDTH_PX = 360;

function withViewportAndLocalStorage(viewportWidthPx, run) {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.window = { innerWidth: viewportWidthPx };
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
    globalThis.window = previousWindow;
    globalThis.localStorage = previousLocalStorage;
  }
}

test("computeSessionSidebarMaxWidthPx never drops below the minimum on the narrowest window", () => {
  withViewportAndLocalStorage(WINDOW_MIN_WIDTH_PX, () => {
    assert.equal(computeSessionSidebarMaxWidthPx(), SESSION_SIDEBAR_MIN_WIDTH_PX);
  });
});

test("computeSessionSidebarMaxWidthPx follows the viewport ratio up to the absolute cap", () => {
  withViewportAndLocalStorage(600, () => {
    assert.equal(computeSessionSidebarMaxWidthPx(), 240);
  });
  withViewportAndLocalStorage(1440, () => {
    assert.equal(computeSessionSidebarMaxWidthPx(), SESSION_SIDEBAR_MAX_WIDTH_PX);
  });
});

test("session sidebar width is never clamped below the minimum at the window minimum width", () => {
  withViewportAndLocalStorage(WINDOW_MIN_WIDTH_PX, () => {
    writeSessionSidebarWidthPx(120);
    assert.equal(readSessionSidebarWidthPx(), SESSION_SIDEBAR_MIN_WIDTH_PX);
    writeSessionSidebarWidthPx(SESSION_SIDEBAR_MAX_WIDTH_PX);
    assert.equal(readSessionSidebarWidthPx(), SESSION_SIDEBAR_MIN_WIDTH_PX);
  });
});

test("reading at a narrow viewport does not destroy the stored width", () => {
  withViewportAndLocalStorage(WINDOW_MIN_WIDTH_PX, (store) => {
    store.set(WIDTH_KEY, String(SESSION_SIDEBAR_MAX_WIDTH_PX));
    assert.equal(readSessionSidebarWidthPx(), SESSION_SIDEBAR_MIN_WIDTH_PX);
    assert.equal(store.get(WIDTH_KEY), String(SESSION_SIDEBAR_MAX_WIDTH_PX));
  });
});
