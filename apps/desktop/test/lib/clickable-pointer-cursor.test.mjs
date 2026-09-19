import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyClickablePointerCursorToDocument,
  CLICKABLE_POINTER_CURSOR_CLASS,
  CLICKABLE_POINTER_CURSOR_STORAGE_KEY,
  defaultClickablePointerCursor,
  getStoredClickablePointerCursor,
  setStoredClickablePointerCursor,
} from "../../src/lib/clickable-pointer-cursor.ts";

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

function withWebWindow(run) {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    return run();
  } finally {
    globalThis.window = previousWindow;
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

test("defaultClickablePointerCursor is off on Desktop Electron chrome", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(defaultClickablePointerCursor(), false);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(defaultClickablePointerCursor(), false);
  });
});

test("defaultClickablePointerCursor is on when the host is not Desktop", () => {
  withWebWindow(() => {
    assert.equal(defaultClickablePointerCursor(), true);
  });
});

test("getStoredClickablePointerCursor defaults to off on Desktop when unset", () => {
  withDesktopPlatform("darwin", () => {
    withLocalStorage(() => {
      assert.equal(getStoredClickablePointerCursor(), false);
    });
  });
});

test("getStoredClickablePointerCursor defaults to on on Web when unset", () => {
  withWebWindow(() => {
    withLocalStorage(() => {
      assert.equal(getStoredClickablePointerCursor(), true);
    });
  });
});

test("getStoredClickablePointerCursor follows stored true and false", () => {
  withDesktopPlatform("darwin", () => {
    withLocalStorage((store) => {
      store.set(CLICKABLE_POINTER_CURSOR_STORAGE_KEY, "true");
      assert.equal(getStoredClickablePointerCursor(), true);
      store.set(CLICKABLE_POINTER_CURSOR_STORAGE_KEY, "false");
      assert.equal(getStoredClickablePointerCursor(), false);
    });
  });
});

test("setStoredClickablePointerCursor writes true and false", () => {
  withLocalStorage((store) => {
    setStoredClickablePointerCursor(true);
    assert.equal(store.get(CLICKABLE_POINTER_CURSOR_STORAGE_KEY), "true");
    setStoredClickablePointerCursor(false);
    assert.equal(store.get(CLICKABLE_POINTER_CURSOR_STORAGE_KEY), "false");
  });
});

test("applyClickablePointerCursorToDocument toggles the html class", () => {
  withDocumentClassList((classes) => {
    applyClickablePointerCursorToDocument(true);
    assert.equal(classes.has(CLICKABLE_POINTER_CURSOR_CLASS), true);
    applyClickablePointerCursorToDocument(false);
    assert.equal(classes.has(CLICKABLE_POINTER_CURSOR_CLASS), false);
  });
});
