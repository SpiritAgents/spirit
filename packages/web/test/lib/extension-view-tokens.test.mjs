/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectHostDocumentChrome,
  collectHostThemeCssText,
} from "../../src/lib/extension-view-tokens.ts";

test("collects resolved tokens without leaking host component styles", () => {
  const style = document.createElement("style");
  style.textContent =
    ":root { --primary: oklch(0.2 0 0); } .bg-primary { background: var(--primary); }";
  document.head.append(style);

  const cssText = collectHostThemeCssText(document);
  assert.match(cssText, /--primary/);
  assert.doesNotMatch(cssText, /bg-primary/);
  style.remove();
});

test("copies html class and inline style for theme sync", () => {
  document.documentElement.className = "dark";
  document.documentElement.setAttribute("style", "--font-sans: Example Sans");
  assert.deepEqual(collectHostDocumentChrome(document), {
    htmlClassName: "dark",
    htmlStyle: "--font-sans: Example Sans",
  });
});
