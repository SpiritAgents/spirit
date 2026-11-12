import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyFontSmoothingToDocument,
  defaultFontSmoothing,
  FONT_SMOOTHING_CLASS,
  FONT_SMOOTHING_STORAGE_KEY,
  getStoredFontSmoothing,
  setStoredFontSmoothing,
} from "../../src/lib/font-smoothing.ts";

function withDesktopPlatform(platform, run) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    spiritDesktop: { platform },
  };
  try {
    return run();
  } finally {
    globalThis.window = previousWindow;
  }
}

function withWebNavigator(navigator, run) {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.window = {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    enumerable: true,
    value: navigator,
    writable: true,
  });
  try {
    return run();
  } finally {
    globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

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

function withDocumentClassList(run) {
  const classes = new Set();
  const previous = globalThis.document;
  globalThis.document = {
    documentElement: {
      classList: {
        toggle(name, force) {
          if (force) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
        },
        contains(name) {
          return classes.has(name);
        },
      },
    },
  };
  try {
    return run(classes);
  } finally {
    globalThis.document = previous;
  }
}

test("defaultFontSmoothing is on for Electron macOS desktop and off elsewhere", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(defaultFontSmoothing(), true);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(defaultFontSmoothing(), false);
  });
});

test("defaultFontSmoothing is on for Web macOS desktop and off for Web Windows / iOS / iPadOS", () => {
  withWebNavigator(
    {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    },
    () => {
      assert.equal(defaultFontSmoothing(), true);
    },
  );
  withWebNavigator(
    {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      maxTouchPoints: 0,
    },
    () => {
      assert.equal(defaultFontSmoothing(), false);
    },
  );
  withWebNavigator(
    {
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      maxTouchPoints: 5,
    },
    () => {
      assert.equal(defaultFontSmoothing(), false);
    },
  );
  withWebNavigator(
    {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 5,
    },
    () => {
      assert.equal(defaultFontSmoothing(), false);
    },
  );
});

test("getStoredFontSmoothing defaults to on on macOS desktop", () => {
  withDesktopPlatform("darwin", () => {
    withLocalStorage(() => {
      assert.equal(getStoredFontSmoothing(), true);
    });
  });
});

test("getStoredFontSmoothing defaults to off outside macOS desktop", () => {
  withDesktopPlatform("win32", () => {
    withLocalStorage(() => {
      assert.equal(getStoredFontSmoothing(), false);
    });
  });
});

test("getStoredFontSmoothing follows stored true and false", () => {
  withDesktopPlatform("darwin", () => {
    withLocalStorage((store) => {
      store.set(FONT_SMOOTHING_STORAGE_KEY, "false");
      assert.equal(getStoredFontSmoothing(), false);
      store.set(FONT_SMOOTHING_STORAGE_KEY, "true");
      assert.equal(getStoredFontSmoothing(), true);
    });
  });
});

test("setStoredFontSmoothing writes true and false", () => {
  withLocalStorage((store) => {
    setStoredFontSmoothing(true);
    assert.equal(store.get(FONT_SMOOTHING_STORAGE_KEY), "true");
    setStoredFontSmoothing(false);
    assert.equal(store.get(FONT_SMOOTHING_STORAGE_KEY), "false");
  });
});

test("applyFontSmoothingToDocument toggles the html class", () => {
  withDocumentClassList((classes) => {
    applyFontSmoothingToDocument(true);
    assert.equal(classes.has(FONT_SMOOTHING_CLASS), true);
    applyFontSmoothingToDocument(false);
    assert.equal(classes.has(FONT_SMOOTHING_CLASS), false);
  });
});
