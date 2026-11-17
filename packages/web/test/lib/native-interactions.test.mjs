/** @vitest-environment jsdom */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../ui/src/native-interactions.css"),
  "utf8",
);

beforeEach(() => {
  document.documentElement.className = "";
  document.head.innerHTML = `<style>${css}</style><style>
    .cursor-pointer, .enabled\\:cursor-pointer:enabled { cursor: pointer; }
    .cursor-grab { cursor: grab; }
    .cursor-col-resize { cursor: col-resize; }
  </style>`;
});
afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.className = "";
});

test("pointer utilities and links follow off/on/off without recreating controls", () => {
  document.body.innerHTML = `
    <button class="cursor-pointer">Action</button>
    <button class="enabled:cursor-pointer">Variant</button>
    <a href="https://example.test">Link</a>
    <div role="menuitem" data-disabled="false" class="cursor-pointer">Menu</div>`;
  const controls = [...document.body.children];
  for (const enabled of [false, true, false]) {
    document.documentElement.classList.toggle("spirit-clickable-pointer", enabled);
    for (const control of controls) {
      assert.equal(getComputedStyle(control).cursor, enabled ? "pointer" : "default");
    }
    assert.equal(document.body.firstElementChild, controls[0]);
  }
});

test("disabled controls and explicit drag/resize cursors do not become clickable cursors", () => {
  document.body.innerHTML = `
    <button disabled class="cursor-pointer">Disabled</button>
    <div role="menuitem" data-disabled class="cursor-pointer">Disabled Item</div>
    <div role="button" aria-disabled="true" class="cursor-pointer">Disabled Role</div>
    <button class="cursor-grab">Drag</button>
    <div role="separator" class="cursor-col-resize">Resize</div>`;
  for (const enabled of [false, true]) {
    document.documentElement.classList.toggle("spirit-clickable-pointer", enabled);
    for (const control of [...document.body.children].slice(0, 3)) {
      assert.equal(getComputedStyle(control).cursor, "not-allowed");
    }
    assert.equal(getComputedStyle(document.body.children[3]).cursor, "grab");
    assert.equal(getComputedStyle(document.body.children[4]).cursor, "col-resize");
  }
});

test("chrome is unselectable while editable fields and explicit content remain selectable", () => {
  document.body.innerHTML = `
    <p>Interface Copy</p><input /><textarea></textarea><select></select>
    <div contenteditable="true">Editable</div>
    <p data-spirit-selectable="text">Copyable Value</p>
    <div data-spirit-markdown-root>Body</div>
    <code class="unified-diff-code">Diff</code>`;
  assert.equal(getComputedStyle(document.documentElement).userSelect, "none");
  for (const content of [...document.body.children].slice(1)) {
    assert.equal(getComputedStyle(content).userSelect, "text");
  }
});
