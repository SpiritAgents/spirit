import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyReduceMotionToDocument,
  getStoredReduceMotion,
  prefersReducedMotion,
  REDUCE_MOTION_CLASS,
  REDUCE_MOTION_QUERY,
  REDUCE_MOTION_STORAGE_KEY,
  resolveReduceMotion,
  setStoredReduceMotion,
} from "../../src/lib/reduce-motion.ts";

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

function withMatchMedia(matches, run) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    matchMedia(query) {
      assert.equal(query, REDUCE_MOTION_QUERY);
      return { matches };
    },
  };
  try {
    return run();
  } finally {
    globalThis.window = previousWindow;
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

test("getStoredReduceMotion defaults to system", () => {
  withLocalStorage(() => {
    assert.equal(getStoredReduceMotion(), "system");
  });
});

test("getStoredReduceMotion treats invalid values as system", () => {
  withLocalStorage((store) => {
    store.set(REDUCE_MOTION_STORAGE_KEY, "yes");
    assert.equal(getStoredReduceMotion(), "system");
  });
});

test("getStoredReduceMotion follows stored system, on, and off", () => {
  withLocalStorage((store) => {
    store.set(REDUCE_MOTION_STORAGE_KEY, "system");
    assert.equal(getStoredReduceMotion(), "system");
    store.set(REDUCE_MOTION_STORAGE_KEY, "on");
    assert.equal(getStoredReduceMotion(), "on");
    store.set(REDUCE_MOTION_STORAGE_KEY, "off");
    assert.equal(getStoredReduceMotion(), "off");
  });
});

test("setStoredReduceMotion writes the preference", () => {
  withLocalStorage((store) => {
    setStoredReduceMotion("on");
    assert.equal(store.get(REDUCE_MOTION_STORAGE_KEY), "on");
    setStoredReduceMotion("off");
    assert.equal(store.get(REDUCE_MOTION_STORAGE_KEY), "off");
    setStoredReduceMotion("system");
    assert.equal(store.get(REDUCE_MOTION_STORAGE_KEY), "system");
  });
});

test("resolveReduceMotion follows the system media query", () => {
  withMatchMedia(true, () => {
    assert.equal(resolveReduceMotion("system"), true);
  });
  withMatchMedia(false, () => {
    assert.equal(resolveReduceMotion("system"), false);
  });
});

test("resolveReduceMotion on is true even when the system query is false", () => {
  withMatchMedia(false, () => {
    assert.equal(resolveReduceMotion("on"), true);
  });
});

test("resolveReduceMotion off is false even when the system query is true", () => {
  withMatchMedia(true, () => {
    assert.equal(resolveReduceMotion("off"), false);
  });
});

test("applyReduceMotionToDocument on adds the class when the system query is false", () => {
  withMatchMedia(false, () => {
    withDocumentClassList((classes) => {
      applyReduceMotionToDocument("on");
      assert.equal(classes.has(REDUCE_MOTION_CLASS), true);
      assert.equal(prefersReducedMotion(), true);
    });
  });
});

test("applyReduceMotionToDocument off removes the class when the system query is true", () => {
  withMatchMedia(true, () => {
    withDocumentClassList((classes) => {
      classes.add(REDUCE_MOTION_CLASS);
      applyReduceMotionToDocument("off");
      assert.equal(classes.has(REDUCE_MOTION_CLASS), false);
      assert.equal(prefersReducedMotion(), false);
    });
  });
});

test("applyReduceMotionToDocument system follows the media query", () => {
  withMatchMedia(true, () => {
    withDocumentClassList((classes) => {
      applyReduceMotionToDocument("system");
      assert.equal(classes.has(REDUCE_MOTION_CLASS), true);
    });
  });
  withMatchMedia(false, () => {
    withDocumentClassList((classes) => {
      classes.add(REDUCE_MOTION_CLASS);
      applyReduceMotionToDocument("system");
      assert.equal(classes.has(REDUCE_MOTION_CLASS), false);
    });
  });
});
