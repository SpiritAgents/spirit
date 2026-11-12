import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildConversationScrollOccludeMaskStyle,
  conversationScrollOccludeShapeFromRects,
} from "../../src/lib/conversation-scroll-occlude-mask.ts";

test("buildConversationScrollOccludeMaskStyle returns undefined without geometry", () => {
  assert.equal(
    buildConversationScrollOccludeMaskStyle({
      viewportWidth: 0,
      viewportHeight: 100,
      shapes: [],
    }),
    undefined,
  );
  assert.equal(
    buildConversationScrollOccludeMaskStyle({
      viewportWidth: 400,
      viewportHeight: 800,
      shapes: [],
    }),
    undefined,
  );
});

test("buildConversationScrollOccludeMaskStyle encodes rounded rect and bottom slab", () => {
  const style = buildConversationScrollOccludeMaskStyle({
    viewportWidth: 400,
    viewportHeight: 800,
    shapes: [
      { x: 40, y: 600, width: 320, height: 120, rx: 16, ry: 16 },
      { x: 40, y: 560, width: 100, height: 28, rx: 14, ry: 14 },
    ],
    bottomSlabFromY: 704,
  });
  assert.ok(style);
  assert.match(style.maskImage, /^url\("data:image\/svg\+xml,/);
  const decoded = decodeURIComponent(style.maskImage.slice('url("data:image/svg+xml,'.length, -2));
  assert.match(decoded, /rx="16\.00"/);
  assert.match(decoded, /y="704\.00"/);
  assert.match(decoded, /fill="white"/);
  assert.equal(style.WebkitMaskImage, style.maskImage);
  assert.equal(style.maskMode, "luminance");
});

test("buildConversationScrollOccludeMaskStyle uses top-rounded path for TODO-like shapes", () => {
  const style = buildConversationScrollOccludeMaskStyle({
    viewportWidth: 400,
    viewportHeight: 800,
    shapes: [
      {
        x: 48,
        y: 520,
        width: 304,
        height: 80,
        rx: 16,
        ry: 16,
        roundTopOnly: true,
      },
    ],
  });
  assert.ok(style);
  const decoded = decodeURIComponent(style.maskImage.slice('url("data:image/svg+xml,'.length, -2));
  assert.match(decoded, /<path d="/);
  assert.doesNotMatch(decoded, /roundTopOnly/);
});

test("conversationScrollOccludeShapeFromRects is viewport-relative", () => {
  const viewport = { left: 100, top: 50, width: 400, height: 800 };
  const element = { left: 140, top: 650, width: 320, height: 100 };
  const shape = conversationScrollOccludeShapeFromRects(viewport, element, 16, 16);
  assert.deepEqual(shape, {
    x: 40,
    y: 600,
    width: 320,
    height: 100,
    rx: 16,
    ry: 16,
  });
});

test("rounded-full style radius clamps to stadium not ellipse", () => {
  const style = buildConversationScrollOccludeMaskStyle({
    viewportWidth: 400,
    viewportHeight: 800,
    shapes: [
      // Simulates Changes: rounded-full → extremely large computed radius
      { x: 40, y: 600, width: 128.93, height: 28, rx: 16777200, ry: 16777200 },
    ],
  });
  assert.ok(style);
  const decoded = decodeURIComponent(style.maskImage.slice('url("data:image/svg+xml,'.length, -2));
  // The pill should be rx=ry=14; an ellipse with rx≈64 must not appear
  assert.match(decoded, /rx="14\.00"/);
  assert.match(decoded, /ry="14\.00"/);
  assert.doesNotMatch(decoded, /rx="64/);
});
