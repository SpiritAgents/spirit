import assert from "node:assert/strict";
import { test } from "vitest";

import { applyThemeToDocument, THEME_SWITCHING_CLASS } from "../../src/lib/theme.ts";

function withDocumentTheme(run) {
  const classes = new Set();
  const dataset = {};
  const previousDocument = globalThis.document;
  const previousRaf = globalThis.requestAnimationFrame;
  const frames = [];
  globalThis.document = {
    documentElement: {
      classList: {
        add(name) {
          classes.add(name);
        },
        remove(name) {
          classes.delete(name);
        },
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
      dataset,
      offsetHeight: 0,
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  const flushPaint = () => {
    const queued = frames.splice(0);
    for (const callback of queued) {
      callback(0);
    }
  };
  try {
    return run({ classes, dataset, flushPaint });
  } finally {
    globalThis.document = previousDocument;
    globalThis.requestAnimationFrame = previousRaf;
  }
}

test("applyThemeToDocument holds spirit-theme-switching until after the next paint", () => {
  withDocumentTheme(({ classes, dataset, flushPaint }) => {
    applyThemeToDocument("dark");
    assert.equal(classes.has("dark"), true);
    assert.equal(classes.has(THEME_SWITCHING_CLASS), true);
    assert.equal(dataset.spiritTheme, "dark");

    flushPaint();
    assert.equal(classes.has(THEME_SWITCHING_CLASS), true);

    flushPaint();
    assert.equal(classes.has(THEME_SWITCHING_CLASS), false);
    assert.equal(classes.has("dark"), true);
  });
});

test("applyThemeToDocument does not re-enter theme-switching when tokens are unchanged", () => {
  withDocumentTheme(({ classes, dataset, flushPaint }) => {
    applyThemeToDocument("light");
    flushPaint();
    flushPaint();
    assert.equal(classes.has(THEME_SWITCHING_CLASS), false);
    assert.equal(dataset.spiritTheme, "light");

    applyThemeToDocument("light");
    assert.equal(classes.has(THEME_SWITCHING_CLASS), false);
  });
});
