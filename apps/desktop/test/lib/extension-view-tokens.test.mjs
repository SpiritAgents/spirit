/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectHostDocumentChrome,
  collectHostStylesheetCssText,
} from "../../src/lib/extension-view-tokens.ts";

test("collects live stylesheet cssText instead of a second token file", () => {
  const style = document.createElement("style");
  style.textContent = ":root { --primary: oklch(0.2 0 0); } .bg-primary { background: var(--primary); }";
  document.head.append(style);

  const cssText = collectHostStylesheetCssText(document);
  assert.match(cssText, /--primary/);
  assert.match(cssText, /bg-primary/);
  style.remove();
});

test("copies html class and inline style for theme sync", () => {
  document.documentElement.className = "dark";
  document.documentElement.setAttribute("style", "--font-sans: Geist");
  assert.deepEqual(collectHostDocumentChrome(document), {
    htmlClassName: "dark",
    htmlStyle: "--font-sans: Geist",
  });
});
