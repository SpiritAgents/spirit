import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dockClipCss = readFileSync(join(here, "../../../ui/src/rendering/dock-clip.css"), "utf8");

test("dock-clip marks both translate-animated layers with will-change: translate", () => {
  const clipRule = dockClipCss.match(/\.spirit-dock-clip\s*\{([^}]*)\}/);
  const contentRule = dockClipCss.match(/\.spirit-dock-clip\s*>\s*\*\s*\{([^}]*)\}/);
  assert.ok(clipRule, "expected .spirit-dock-clip rule");
  assert.ok(contentRule, "expected .spirit-dock-clip > * rule");
  // Without will-change: translate on the view-timeline layers, mounting inside an ancestor
  // with a transient scale animation (e.g. DialogContent's zoom-in-95 enter) traps Chromium's
  // PictureLayerImpl tile raster scale at the initial <1 scale permanently.
  assert.match(clipRule[1], /will-change:\s*translate\b/);
  assert.match(contentRule[1], /will-change:\s*translate\b/);
  assert.doesNotMatch(clipRule[1], /will-change:\s*transform\b/);
  assert.doesNotMatch(contentRule[1], /will-change:\s*transform\b/);
});
