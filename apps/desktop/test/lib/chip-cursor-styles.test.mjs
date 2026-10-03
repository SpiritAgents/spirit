import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const stylesCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/styles.css"),
  "utf8",
);

const CHIP = String.raw`\[data-spirit-chip\]\[data-chip-navigable\]`;

test("navigable chips show the pointer cursor only when the preference is enabled", () => {
  const pointerBlock = stylesCss.match(
    new RegExp(String.raw`html\.spirit-clickable-pointer[^{]*${CHIP}[^{]*\{([^}]*)\}`),
  );
  assert.ok(pointerBlock, "expected html.spirit-clickable-pointer chip rule");
  assert.match(pointerBlock[1], /cursor:\s*pointer/);
});

test("every chip keeps the default cursor, clickable or not", () => {
  // Chips (including non-clickable pills like Plan / Ask / Debug / Loop) sit inside the
  // composer's cursor-text chrome; without an explicit rule they would inherit the text cursor.
  // Navigable chips fall back to this same default when the pointer preference is off.
  const baseBlock = stylesCss.match(/\[data-spirit-chip\]\s*\{([^}]*)\}/);
  assert.ok(baseBlock, "expected base [data-spirit-chip] rule");
  assert.match(baseBlock[1], /cursor:\s*default/);
});

test("the hover underline stays on the chip label text", () => {
  const underlineBlock = stylesCss.match(
    new RegExp(String.raw`${CHIP}:hover\s*\[data-chip-label\]\s*\{([^}]*)\}`),
  );
  assert.ok(underlineBlock, "expected chip-hover label underline rule");
  assert.match(underlineBlock[1], /text-decoration:\s*underline/);
});

test("chip navigation is not scoped to the label anymore", () => {
  assert.doesNotMatch(stylesCss, /\[data-chip-label\]\[data-chip-navigable\]/);
});
