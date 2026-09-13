import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
  DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT,
  DESKTOP_TRANSLUCENCY_BROWSER_TINT_CLASS,
  DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS,
  DESKTOP_TRANSLUCENCY_TERMINAL_TINT_CLASS,
  DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS,
  desktopComposerChipSurfaceClass,
  desktopComposerSurfaceBackdropClass,
  desktopTranslucencyBrowserTintClass,
  desktopTranslucencyFileDetailSurfaceClass,
  desktopTranslucencyTerminalTintClass,
  desktopTranslucencyTintClass,
  desktopTranslucencyTintInnerClass,
  desktopFullscreenOverlayTintClass,
} from "../../src/lib/desktop-translucency-surface.ts";

test("desktopTranslucencyTintClass returns solid background when content translucency is off", () => {
  assert.equal(desktopTranslucencyTintClass(false), "bg-background");
});

test("desktopTranslucencyTintClass returns semi-transparent tint without backdrop-blur when content translucency is on", () => {
  const cls = desktopTranslucencyTintClass(true);
  assert.equal(cls, DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS);
  assert.match(cls, /bg-background\//);
  assert.doesNotMatch(cls, /backdrop-blur/);
});

test("desktopTranslucencyTintInnerClass is transparent under translucency", () => {
  assert.equal(desktopTranslucencyTintInnerClass(false), "bg-background");
  assert.equal(desktopTranslucencyTintInnerClass(true), "bg-transparent");
});

test("desktopFullscreenOverlayTintClass keeps tint through exit so the whole sheet fades", () => {
  assert.equal(desktopFullscreenOverlayTintClass(false), "bg-background");
  assert.equal(desktopFullscreenOverlayTintClass(true), DESKTOP_TRANSLUCENCY_CONTENT_TINT_CLASS);
});

test("desktopTranslucencyBrowserTintClass uses a dedicated opacity under translucency", () => {
  assert.equal(desktopTranslucencyBrowserTintClass(true), DESKTOP_TRANSLUCENCY_BROWSER_TINT_CLASS);
  assert.notEqual(DESKTOP_TRANSLUCENCY_BROWSER_TINT_CLASS, "bg-background");
});

test("desktopTranslucencyTerminalTintClass keeps high opacity for readability", () => {
  assert.equal(
    desktopTranslucencyTerminalTintClass(true),
    DESKTOP_TRANSLUCENCY_TERMINAL_TINT_CLASS,
  );
  assert.match(DESKTOP_TRANSLUCENCY_TERMINAL_TINT_CLASS, /\/87$/);
});

test("desktopTranslucencyFileDetailSurfaceClass avoids stacking tint under translucency", () => {
  assert.equal(
    desktopTranslucencyFileDetailSurfaceClass(false),
    DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS,
  );
  assert.equal(desktopTranslucencyFileDetailSurfaceClass(true), "bg-transparent");
});

test("desktopComposerSurfaceBackdropClass keeps glass when translucency is off", () => {
  assert.equal(desktopComposerSurfaceBackdropClass(false), DESKTOP_COMPOSER_SURFACE_BACKDROP);
  assert.match(DESKTOP_COMPOSER_SURFACE_BACKDROP, /backdrop-blur/);
  assert.match(DESKTOP_COMPOSER_SURFACE_BACKDROP, /dark:bg-input/);
});

test("desktopComposerSurfaceBackdropClass uses translucent tint without blur when translucency is on", () => {
  assert.equal(
    desktopComposerSurfaceBackdropClass(true),
    DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT,
  );
  assert.doesNotMatch(DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT, /backdrop-blur/);
  assert.equal(DESKTOP_COMPOSER_SURFACE_TRANSLUCENCY_TINT, "bg-background/30");
});

test("desktopComposerChipSurfaceClass follows composer surface translucency tint/glass", () => {
  assert.match(desktopComposerChipSurfaceClass(false), /backdrop-blur/);
  assert.doesNotMatch(desktopComposerChipSurfaceClass(true), /backdrop-blur/);
  assert.match(desktopComposerChipSurfaceClass(true), /bg-background\/30/);
});
