import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildShellToolMonochromeTheme,
  compositeOpaqueSelectionOverSurface,
  rgbaChannelsToXtermHex,
  stripAnsiSgrSequences,
} from "../../src/lib/shell-tool-xterm-theme.ts";

test("buildShellToolMonochromeTheme forces every ANSI slot to the same foreground", () => {
  const theme = buildShellToolMonochromeTheme("#a1a1a1", "#333333");
  assert.equal(theme.foreground, "#a1a1a1");
  assert.equal(theme.background, "#00000000");
  assert.equal(theme.cursor, "#00000000");
  assert.equal(theme.selectionBackground, "#333333");
  assert.equal(theme.red, "#a1a1a1");
  assert.equal(theme.green, "#a1a1a1");
  assert.equal(theme.brightCyan, "#a1a1a1");
  assert.equal(theme.brightWhite, "#a1a1a1");
});

test("stripAnsiSgrSequences removes truecolor SGR but keeps erase-line CSI", () => {
  const input = "\x1b[38;2;225;80;80;1m×\x1b[0m \x1b[38;2;92;157;255;1mpath\x1b[0m\x1b[2K\rnext";
  const out = stripAnsiSgrSequences(input);
  assert.equal(out.includes("\x1b[38;2"), false);
  assert.equal(out.includes("\x1b[0m"), false);
  assert.equal(out.includes("\x1b[2K"), true);
  assert.equal(out.includes("×"), true);
  assert.equal(out.includes("path"), true);
  assert.equal(out.includes("\rnext"), true);
});

test("rgbaChannelsToXtermHex encodes the hex forms xterm accepts", () => {
  assert.equal(rgbaChannelsToXtermHex(255, 255, 255), "#ffffff");
  assert.equal(rgbaChannelsToXtermHex(0, 0, 0, 0.5), "#00000080");
  assert.equal(rgbaChannelsToXtermHex(161, 161, 161), "#a1a1a1");
  assert.equal(rgbaChannelsToXtermHex(16, 32, 48, 0.1), "#1020301a");
});

test("rgbaChannelsToXtermHex clamps out-of-range channels", () => {
  assert.equal(rgbaChannelsToXtermHex(-5, 300, 0), "#00ff00");
});

test("compositeOpaqueSelectionOverSurface blends the selection over the surface", () => {
  // The light-mode regression: rgba(0,0,0,0.15) must become a light gray over white, not the
  // pure black xterm's blend over a transparent theme background produced.
  assert.deepEqual(
    compositeOpaqueSelectionOverSurface([0, 0, 0, 0.15], [255, 255, 255, 1]),
    [217, 217, 217],
  );
  assert.deepEqual(
    compositeOpaqueSelectionOverSurface([255, 255, 255, 0.12], [10, 10, 10, 1]),
    [39, 39, 39],
  );
  // An opaque selection wins verbatim; a fully transparent pair has no color at all.
  assert.deepEqual(compositeOpaqueSelectionOverSurface([1, 2, 3, 1], [200, 100, 50, 1]), [1, 2, 3]);
  assert.equal(compositeOpaqueSelectionOverSurface([0, 0, 0, 0], [0, 0, 0, 0]), undefined);
});
