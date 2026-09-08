import assert from "node:assert/strict";
import { test } from "vitest";

import { assertMarketplaceIconPath, assertMarketplaceIconSvgContent } from "./icon.js";

test("icon path must be a registry-relative SVG", () => {
  assert.equal(assertMarketplaceIconPath("extensions/a/icon.svg", "icon"), "extensions/a/icon.svg");
  assert.equal(
    assertMarketplaceIconPath("./extensions/a/icon.SVG", "icon"),
    "extensions/a/icon.SVG",
  );
  assert.throws(() => assertMarketplaceIconPath("extensions/a/icon.png", "icon"), /SVG/);
  assert.throws(() => assertMarketplaceIconPath("../icon.svg", "icon"), /\.\./);
});

test("svg content must not contain script elements", () => {
  assertMarketplaceIconSvgContent('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "icon");
  assert.throws(
    () => assertMarketplaceIconSvgContent("<svg><script>alert(1)</script></svg>", "icon"),
    /<script>/,
  );
  assert.throws(
    () =>
      assertMarketplaceIconSvgContent(
        '<svg><SCRIPT type="text/javascript">x</SCRIPT></svg>',
        "icon",
      ),
    /<script>/,
  );
});
